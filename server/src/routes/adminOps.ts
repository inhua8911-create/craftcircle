import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, Coupon, NewsletterSubscription, StoreSettings } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { AppError, notFound } from '../utils/errors.js';
import { audit } from '../services/audit.js';
import { REPORTS, overview, type Range } from '../services/reports.js';
import { toCsv } from '../services/csv.js';

export const adminOpsRouter = Router();
adminOpsRouter.use(['/admin/overview', '/admin/audit', '/admin/reports', '/admin/coupons', '/admin/settings', '/admin/newsletter'], requireAuth, requireAdmin);

const parseRange = (q: Record<string, unknown>): Range => {
  const d = (v: unknown, end = false) => { if (typeof v !== 'string' || !v) return undefined; const x = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${end ? '23:59:59.999' : '00:00:00'}+05:30` : v); if (Number.isNaN(x.getTime())) throw new AppError(422, 'INVALID_DATE', 'Dates must look like 2026-10-31'); return x; }; // calendar days are Asia/Kolkata
  const r = { from: d(q.from), to: d(q.to, true) }; if (r.from && r.to && r.from > r.to) throw new AppError(422, 'INVALID_RANGE', 'The start date must be before the end date'); return r;
};

adminOpsRouter.get('/admin/overview', asyncHandler(async (req, res) => { res.json(await overview(parseRange(req.query))); }));

adminOpsRouter.get('/admin/audit', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = 50; const f: Record<string, unknown> = {};
  if (typeof req.query.action === 'string' && req.query.action) f.action = new RegExp(`^${req.query.action.replace(/[^\w.]/g, '')}`);
  if (typeof req.query.entityType === 'string' && req.query.entityType) f.entityType = req.query.entityType;
  const [items, total] = await Promise.all([AuditLog.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(f)]);
  res.json({ items: items.map((a) => ({ id: String(a._id), action: a.action, entityType: a.entityType, entityId: a.entityId ? String(a.entityId) : null, actorRole: a.actorRole, actor: a.actor ? String(a.actor) : null, before: a.before, after: a.after, note: a.note, at: a.createdAt })), page, total });
}));

adminOpsRouter.get('/admin/reports', (_req, res) => { res.json({ reports: Object.keys(REPORTS) }); });
adminOpsRouter.get('/admin/reports/:type', asyncHandler(async (req, res) => {
  const fn = REPORTS[String(req.params.type)]; if (!fn) throw notFound('Unknown report');
  const table = await fn(parseRange(req.query));
  await audit(req, { action: 'report.exported', entityType: 'Report', note: `${req.params.type} (${req.query.format === 'csv' ? 'csv' : 'view'}, ${table.rows.length} rows)` });
  if (req.query.format === 'csv') return void res.type('text/csv').attachment(`${req.params.type}.csv`).send(toCsv([table.columns, ...table.rows]));
  res.json({ columns: table.columns, rows: table.rows.slice(0, 200), total: table.rows.length });
}));

const couponBody = z.strictObject({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, 'Use 3 to 20 letters, numbers, - or _'), type: z.enum(['percent', 'fixed']), value: z.number().int().min(1),
  minOrderPaise: z.number().int().min(0).default(0), maxDiscountPaise: z.number().int().min(100).optional(), startsAt: z.coerce.date(), endsAt: z.coerce.date(),
  usageLimit: z.number().int().min(1).optional(), perUserLimit: z.number().int().min(1).max(50).default(1),
}).refine((c) => c.endsAt > c.startsAt, { path: ['endsAt'], message: 'The end must be after the start' })
  .refine((c) => c.type !== 'percent' || c.value <= 100, { path: ['value'], message: 'A percentage cannot exceed 100' })
  .refine((c) => c.type !== 'fixed' || c.value >= 100, { path: ['value'], message: 'A fixed discount is in paise (minimum 100)' });
adminOpsRouter.get('/admin/coupons', asyncHandler(async (_req, res) => { res.json({ items: (await Coupon.find().sort({ createdAt: -1 }).limit(200).lean()).map((c) => ({ id: String(c._id), code: c.code, type: c.type, value: c.value, minOrderPaise: c.minOrderPaise, maxDiscountPaise: c.maxDiscountPaise, startsAt: c.startsAt, endsAt: c.endsAt, usageLimit: c.usageLimit, usedCount: c.usedCount, perUserLimit: c.perUserLimit, active: c.active })) }); }));
adminOpsRouter.post('/admin/coupons', validateBody(couponBody), asyncHandler(async (req, res) => {
  const c = await Coupon.create(req.body); await audit(req, { action: 'coupon.created', entityType: 'Coupon', entityId: c._id, after: { code: c.code, type: c.type, value: c.value } }); res.status(201).json({ id: String(c._id) });
}));
// Code, type and value are fixed after creation so a live campaign can't be silently re-priced.
adminOpsRouter.patch('/admin/coupons/:id', validateBody(z.strictObject({ active: z.boolean().optional(), endsAt: z.coerce.date().optional(), usageLimit: z.number().int().min(1).optional() })), asyncHandler(async (req, res) => {
  const c = await Coupon.findById(req.params.id); if (!c) throw notFound('Coupon not found');
  const before = { active: c.active, endsAt: c.endsAt, usageLimit: c.usageLimit };
  if (req.body.endsAt && req.body.endsAt <= c.startsAt) throw new AppError(422, 'INVALID_DATE', 'The end must be after the start');
  if (req.body.usageLimit != null && req.body.usageLimit < c.usedCount) throw new AppError(422, 'LIMIT_TOO_LOW', `${c.usedCount} uses are already recorded`);
  Object.assign(c, req.body); await c.save(); await audit(req, { action: 'coupon.updated', entityType: 'Coupon', entityId: c._id, before, after: req.body }); res.json({ ok: true });
}));

const settingsBody = z.strictObject({
  announcement: z.strictObject({ enabled: z.boolean(), text: z.string().trim().max(200).optional(), link: z.string().trim().max(200).regex(/^\/[\w\-./?=&%]*$/, 'Use a site path like /shop').optional() }).optional(),
  shipping: z.strictObject({ flatRatePaise: z.number().int().min(0).max(1_000_000), freeAboveCartPaise: z.number().int().min(0).max(100_000_000).nullable() }).optional(),
  taxEnabled: z.boolean().optional(), taxRatePercent: z.number().min(0).max(100).optional(), settlementHoldDays: z.number().int().min(0).max(90).optional(), lowStockThreshold: z.number().int().min(0).max(100).optional(),
  requireSecondPayoutApprover: z.boolean().optional(), codEnabled: z.literal(false).optional(),
  contact: z.strictObject({ email: z.string().trim().max(254).optional(), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(300).optional() }).optional(),
  socialLinks: z.array(z.strictObject({ label: z.string().trim().min(1).max(30), url: z.string().trim().url().max(200).refine((u) => /^https:\/\//.test(u), 'Use an https link') })).max(8).optional(),
});
const settingsView = (s: any) => ({ announcement: s?.announcement ?? { enabled: false }, shipping: { flatRatePaise: s?.shipping?.flatRatePaise ?? 0, freeAboveCartPaise: s?.shipping?.freeAboveCartPaise ?? null }, taxEnabled: !!s?.taxEnabled, taxRatePercent: s?.taxRatePercent ?? 0, settlementHoldDays: s?.settlementHoldDays ?? 7, lowStockThreshold: s?.lowStockThreshold ?? 3, requireSecondPayoutApprover: !!s?.requireSecondPayoutApprover, codEnabled: false, contact: s?.contact ?? {}, socialLinks: s?.socialLinks ?? [] });
adminOpsRouter.get('/admin/settings', asyncHandler(async (_req, res) => { res.json({ settings: settingsView(await StoreSettings.findOne({ key: 'default' }).lean()) }); }));
adminOpsRouter.put('/admin/settings', validateBody(settingsBody), asyncHandler(async (req, res) => {
  const before = settingsView(await StoreSettings.findOne({ key: 'default' }).lean());
  const s = await StoreSettings.findOneAndUpdate({ key: 'default' }, { $set: req.body }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  await audit(req, { action: 'settings.updated', entityType: 'StoreSettings', entityId: s._id, before, after: req.body }); res.json({ settings: settingsView(s.toObject()) });
}));

adminOpsRouter.get('/admin/newsletter', asyncHandler(async (req, res) => {
  const subs = await NewsletterSubscription.find({ active: true }).sort({ createdAt: -1 }).limit(50000).lean();
  if (req.query.format === 'csv') { await audit(req, { action: 'newsletter.exported', entityType: 'NewsletterSubscription', note: `${subs.length} rows` }); return void res.type('text/csv').attachment('newsletter.csv').send(toCsv([['Email', 'Subscribed'], ...subs.map((s) => [s.email, s.createdAt.toISOString()])])); }
  res.json({ total: subs.length, items: subs.slice(0, 100).map((s) => ({ email: s.email, at: s.createdAt })) });
}));
