import { Router } from 'express';
import { CreatorEarning, CreatorProfile, IncentiveCampaign, Payout, Product, StoreSettings, User } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { creatorStatusSchema, incentiveCampaignSchema, payoutCreateSchema, payoutFailSchema, payoutPaySchema } from '../validators/creator.js';
import { AppError, notFound } from '../utils/errors.js';
import { creatorBalances } from '../services/earnings.js';
import { salesTotals } from '../services/creatorStats.js';
import { approvePayout, cancelPayout, createPayoutDraft, failPayout, markPayoutPaid } from '../services/payouts.js';
import { payoutStatement, statementCsv } from '../services/payoutStatement.js';
import { notify } from '../services/notify.js';
import { audit } from '../services/audit.js';

export const adminCreatorsRouter = Router();
adminCreatorsRouter.use(['/admin/creators', '/admin/payouts', '/admin/incentives'], requireAuth, requireAdmin);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

adminCreatorsRouter.get('/admin/creators', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = 25; const f: Record<string, unknown> = {};
  if (typeof req.query.status === 'string') f.status = req.query.status;
  if (typeof req.query.q === 'string' && req.query.q.trim()) f.displayName = new RegExp(esc(req.query.q.trim().slice(0, 60)), 'i');
  const [items, total] = await Promise.all([CreatorProfile.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), CreatorProfile.countDocuments(f)]);
  res.json({ items: items.map((c) => ({ id: String(c._id), slug: c.slug, name: c.displayName, city: c.city, status: c.status, featured: c.featured, createdAt: c.createdAt })), page, total });
}));
adminCreatorsRouter.get('/admin/creators/:id', asyncHandler(async (req, res) => {
  const c = await CreatorProfile.findById(req.params.id).select('+payoutDetails').lean(); if (!c) throw notFound('Creator not found');
  const [user, byStatus, balances, sales, payouts] = await Promise.all([User.findById(c.user).select('email phone status').lean(), Product.aggregate([{ $match: { creator: c._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]), creatorBalances(c._id), salesTotals(c._id), Payout.find({ creator: c._id }).sort({ createdAt: -1 }).limit(10).lean()]);
  res.json({ creator: { id: String(c._id), slug: c.slug, name: c.displayName, status: c.status, city: c.city, state: c.state, email: user?.email, phone: user?.phone, payoutDetails: c.payoutDetails ?? null }, products: Object.fromEntries(byStatus.map((s) => [s._id, s.n])), balances, sales, payouts: payouts.map((p) => ({ id: String(p._id), batchNumber: p.batchNumber, amountPaise: p.amountPaise, status: p.status, paymentReference: p.paymentReference })) });
}));
adminCreatorsRouter.post('/admin/creators/:id/status', validateBody(creatorStatusSchema), asyncHandler(async (req, res) => {
  const c = await CreatorProfile.findById(req.params.id); if (!c) throw notFound('Creator not found');
  const target = req.body.action === 'suspend' ? 'suspended' : 'active';
  if (c.status === target) throw new AppError(409, 'NO_CHANGE', `Creator is already ${target}`);
  const before = c.status; c.status = target; await c.save();
  if (target === 'suspended') { await CreatorEarning.updateMany({ creator: c._id, status: { $in: ['eligible', 'approved'] }, payout: null }, { $set: { status: 'on_hold' } }); } // earnings held, not forfeited
  else await CreatorEarning.updateMany({ creator: c._id, status: 'on_hold', payout: null }, { $set: { status: 'eligible' } });
  await audit(req, { action: `creator.${req.body.action}`, entityType: 'CreatorProfile', entityId: c._id, before: { status: before }, after: { status: target }, note: req.body.note });
  await notify(c.user, { type: `creator_${target}`, title: target === 'suspended' ? 'Your creator account was suspended' : 'Your creator account was reactivated', body: req.body.note, email: { subject: target === 'suspended' ? 'Your creator account was suspended' : 'Your creator account was reactivated', text: req.body.note } });
  res.json({ id: String(c._id), status: c.status });
}));

// ---- payouts (manual bank-transfer reconciliation) ---------------------------------------------------
adminCreatorsRouter.get('/admin/payouts/balances', asyncHandler(async (_req, res) => {
  const net = { $subtract: [{ $add: ['$grossPaise', '$adjustmentPaise'] }, '$paidPaise'] };
  const rows = await CreatorEarning.aggregate([{ $group: { _id: '$creator', pendingPaise: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, net, 0] } }, availablePaise: { $sum: { $cond: [{ $in: ['$status', ['eligible', 'approved', 'adjusted']] }, net, 0] } }, onHoldPaise: { $sum: { $cond: [{ $eq: ['$status', 'on_hold'] }, net, 0] } }, paidPaise: { $sum: '$paidPaise' } } }]);
  const names = new Map((await CreatorProfile.find({ _id: { $in: rows.map((r) => r._id) } }).select('displayName').lean()).map((c) => [String(c._id), c.displayName]));
  res.json({ items: rows.map((r) => ({ creatorId: String(r._id), name: names.get(String(r._id)), pendingPaise: r.pendingPaise, availablePaise: r.availablePaise, onHoldPaise: r.onHoldPaise, paidPaise: r.paidPaise })) });
}));
adminCreatorsRouter.get('/admin/payouts', asyncHandler(async (req, res) => {
  const f: Record<string, unknown> = {}; if (typeof req.query.status === 'string') f.status = req.query.status;
  const items = await Payout.find(f).sort({ createdAt: -1 }).limit(100).lean();
  const names = new Map((await CreatorProfile.find({ _id: { $in: items.map((p) => p.creator) } }).select('displayName').lean()).map((c) => [String(c._id), c.displayName]));
  res.json({ items: items.map((p) => ({ id: String(p._id), batchNumber: p.batchNumber, creatorId: String(p.creator), creatorName: names.get(String(p.creator)), amountPaise: p.amountPaise, status: p.status, paymentReference: p.paymentReference, failureReason: p.failureReason, retryOf: p.retryOf ? String(p.retryOf) : null, simulated: p.isSimulated, createdAt: p.createdAt })) });
}));
adminCreatorsRouter.post('/admin/payouts', validateBody(payoutCreateSchema), asyncHandler(async (req, res) => {
  const c = await CreatorProfile.findById(req.body.creatorId); if (!c) throw notFound('Creator not found');
  if (c.status !== 'active') throw new AppError(409, 'CREATOR_INACTIVE', 'Reactivate the creator before paying out');
  const p = await createPayoutDraft(c._id, req.user!.id);
  await audit(req, { action: 'payout.drafted', entityType: 'Payout', entityId: p._id, after: { amountPaise: p.amountPaise } });
  res.status(201).json({ payout: { id: String(p._id), batchNumber: p.batchNumber, amountPaise: p.amountPaise, status: p.status } });
}));
adminCreatorsRouter.post('/admin/payouts/:id/approve', asyncHandler(async (req, res) => {
  const existing = await Payout.findById(req.params.id); if (!existing) throw notFound('Payout not found');
  const settings = await StoreSettings.findOne({ key: 'default' });
  if (settings?.requireSecondPayoutApprover && String(existing.createdBy) === String(req.user!.id)) throw new AppError(403, 'SECOND_APPROVER_REQUIRED', 'A different admin must approve this payout');
  const p = await approvePayout(existing._id, req.user!.id);
  await audit(req, { action: 'payout.approved', entityType: 'Payout', entityId: p._id, after: { amountPaise: p.amountPaise } });
  res.json({ payout: { id: String(p._id), status: p.status } });
}));
// Records that a bank transfer was made OUTSIDE this app. The reference is mandatory; the app never moves money.
adminCreatorsRouter.post('/admin/payouts/:id/pay', validateBody(payoutPaySchema), asyncHandler(async (req, res) => {
  const p = await markPayoutPaid(String(req.params.id), req.user!.id, req.body.reference);
  await audit(req, { action: 'payout.marked_paid', entityType: 'Payout', entityId: p._id, after: { amountPaise: p.amountPaise, reference: req.body.reference } });
  const c = await CreatorProfile.findById(p.creator).select('user');
  if (c) await notify(c.user, { type: 'payout_paid', title: 'A payout was recorded as paid', body: `Reference ${req.body.reference}`, link: '/creator/earnings', email: { subject: 'Your payout was recorded as paid', text: `Reference: ${req.body.reference}` } });
  res.json({ payout: { id: String(p._id), status: p.status, paymentReference: p.paymentReference } });
}));
adminCreatorsRouter.post('/admin/payouts/:id/fail', validateBody(payoutFailSchema), asyncHandler(async (req, res) => {
  const p = await failPayout(String(req.params.id), req.body.reason);
  await audit(req, { action: 'payout.failed', entityType: 'Payout', entityId: p._id, note: req.body.reason }); res.json({ payout: { id: String(p._id), status: p.status } });
}));
adminCreatorsRouter.post('/admin/payouts/:id/cancel', asyncHandler(async (req, res) => {
  const p = await cancelPayout(String(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : undefined);
  await audit(req, { action: 'payout.cancelled', entityType: 'Payout', entityId: p._id }); res.json({ payout: { id: String(p._id), status: p.status } });
}));
adminCreatorsRouter.get('/admin/payouts/:id/statement', asyncHandler(async (req, res) => {
  const s = await payoutStatement(String(req.params.id));
  if (req.query.format === 'csv') return void res.type('text/csv').attachment(`statement-${s.payout.batchNumber}.csv`).send(statementCsv(s));
  res.json(s);
}));

// ---- incentive campaigns -----------------------------------------------------------------------------
adminCreatorsRouter.get('/admin/incentives', asyncHandler(async (_req, res) => { res.json({ items: await IncentiveCampaign.find().sort({ startsAt: -1 }).limit(100).lean() }); }));
adminCreatorsRouter.post('/admin/incentives', validateBody(incentiveCampaignSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const c = await IncentiveCampaign.create({ name: b.name, description: b.description, eligibility: b.eligibility, rule: { metric: b.metric, threshold: b.threshold }, rewardPaise: b.rewardPaise, startsAt: b.startsAt, endsAt: b.endsAt, createdBy: req.user!.id });
  await audit(req, { action: 'incentive.created', entityType: 'IncentiveCampaign', entityId: c._id }); res.status(201).json({ id: String(c._id) });
}));
adminCreatorsRouter.post('/admin/incentives/:id/deactivate', asyncHandler(async (req, res) => {
  const c = await IncentiveCampaign.findByIdAndUpdate(req.params.id, { active: false }); if (!c) throw notFound('Campaign not found');
  await audit(req, { action: 'incentive.deactivated', entityType: 'IncentiveCampaign', entityId: c._id }); res.json({ ok: true });
}));
