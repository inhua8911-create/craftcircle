import { Router } from 'express';
import { CreatorEarning, CreatorProfile, Payout } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAuth, requireCreator } from '../middleware/auth.js';
import { payoutDetailsSchema, profileSchema } from '../validators/creator.js';
import { creatorDashboard, incentiveProgress } from '../services/creatorStats.js';
import { creatorBalances } from '../services/earnings.js';
import { payoutStatement, statementCsv } from '../services/payoutStatement.js';
import { isOwnedImageUrl } from '../services/uploads.js';
import { AppError, notFound } from '../utils/errors.js';
import { toCsv } from '../services/csv.js';
import { audit } from '../services/audit.js';

export const creatorPortalRouter = Router();
const guard = [requireAuth, requireCreator] as const;

creatorPortalRouter.get('/creator/dashboard', ...guard, asyncHandler(async (req, res) => { res.json(await creatorDashboard(req.creator!.id)); }));

// Itemised statement. Rows come from CreatorEarning, which only the payment/refund/payout services can write.
creatorPortalRouter.get('/creator/earnings', ...guard, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = req.query.format === 'csv' ? 5000 : 25;
  const f: Record<string, unknown> = { creator: req.creator!.id }; if (typeof req.query.status === 'string') f.status = req.query.status;
  const [rows, total, balances] = await Promise.all([
    CreatorEarning.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('order', 'orderNumber').populate('orderItem', 'productName').populate('payout', 'paymentReference status batchNumber').lean() as any,
    CreatorEarning.countDocuments(f), creatorBalances(req.creator!.id),
  ]);
  const items = rows.map((e: any) => ({ id: String(e._id), orderNumber: e.order?.orderNumber, product: e.orderItem?.productName, quantity: e.quantity, amountPerUnitPaise: e.amountPerUnitPaise, grossPaise: e.grossPaise, adjustmentPaise: e.adjustmentPaise, status: e.status, paidPaise: e.paidPaise, remainingPaise: e.grossPaise + e.adjustmentPaise - e.paidPaise, payoutReference: e.payout?.status === 'paid' ? e.payout.paymentReference : null, batchNumber: e.payout?.batchNumber ?? null, simulated: e.isSimulated, date: e.createdAt }));
  if (req.query.format === 'csv') {
    res.type('text/csv').attachment('earnings.csv').send(toCsv([['Order', 'Product', 'Qty', 'Per unit (INR)', 'Gross (INR)', 'Adjustment (INR)', 'Status', 'Paid (INR)', 'Remaining (INR)', 'Payout ref'], ...items.map((i: any) => [i.orderNumber, i.product, i.quantity, (i.amountPerUnitPaise / 100).toFixed(2), (i.grossPaise / 100).toFixed(2), (i.adjustmentPaise / 100).toFixed(2), i.status, (i.paidPaise / 100).toFixed(2), (i.remainingPaise / 100).toFixed(2), i.payoutReference ?? ''])]));
    return;
  }
  res.json({ items, page, total, balances });
}));

creatorPortalRouter.get('/creator/payouts', ...guard, asyncHandler(async (req, res) => {
  const items = await Payout.find({ creator: req.creator!.id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items: items.map((p) => ({ id: String(p._id), batchNumber: p.batchNumber, amountPaise: p.amountPaise, status: p.status, paymentReference: p.status === 'paid' ? p.paymentReference : null, paidAt: p.paidAt, simulated: p.isSimulated })) });
}));
creatorPortalRouter.get('/creator/payouts/:id/statement', ...guard, asyncHandler(async (req, res) => {
  const s = await payoutStatement(String(req.params.id), req.creator!.id);
  if (req.query.format === 'csv') return void res.type('text/csv').attachment(`statement-${s.payout.batchNumber}.csv`).send(statementCsv(s));
  res.json(s);
}));

creatorPortalRouter.get('/creator/incentives', ...guard, asyncHandler(async (req, res) => { res.json({ items: await incentiveProgress(req.creator!.id), note: 'Incentives are optional bonuses with the rules shown. They are not guaranteed earnings.' }); }));

creatorPortalRouter.get('/creator/profile', ...guard, asyncHandler(async (req, res) => {
  const p = await CreatorProfile.findById(req.creator!.id).select('+payoutDetails'); if (!p) throw notFound('Profile not found');
  res.json({ profile: { slug: p.slug, displayName: p.displayName, bio: p.bio, story: p.story, specialties: p.specialties, profileImage: p.profileImage?.url, links: p.links, publicFields: p.publicFields, city: p.city, state: p.state }, payoutDetails: p.payoutDetails ?? null });
}));
creatorPortalRouter.put('/creator/profile', ...guard, validateBody(profileSchema), asyncHandler(async (req, res) => {
  const p = await CreatorProfile.findById(req.creator!.id); if (!p) throw notFound('Profile not found');
  const { publicFields, profileImage, ...rest } = req.body;
  if (profileImage !== undefined) { if (!isOwnedImageUrl(profileImage)) throw new AppError(422, 'INVALID_IMAGE', 'Photos must be uploaded through this site'); p.profileImage = { url: profileImage } as any; }
  Object.assign(p, rest); if (publicFields) p.publicFields = { ...(p.publicFields as any)?.toObject?.() ?? p.publicFields, ...publicFields } as any;
  await p.save(); res.json({ ok: true });
}));
// Bank REFERENCE details only (never account numbers/passwords/PINs): last 4 digits, IFSC, UPI id.
creatorPortalRouter.put('/creator/payout-details', ...guard, validateBody(payoutDetailsSchema), asyncHandler(async (req, res) => {
  const p = await CreatorProfile.findById(req.creator!.id); if (!p) throw notFound('Profile not found');
  const before = !!(await CreatorProfile.findById(req.creator!.id).select('+payoutDetails'))?.payoutDetails;
  p.payoutDetails = req.body; await p.save();
  await audit(req, { action: 'creator.payout_details_updated', entityType: 'CreatorProfile', entityId: p._id, note: before ? 'changed' : 'set' }); // values are never written to the log
  res.json({ ok: true });
}));
