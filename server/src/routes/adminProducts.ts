import { Router } from 'express';
import { CreatorProfile, Product, ProductPricingHistory } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { merchandisingSchema, pricingSchema, reviewSchema } from '../validators/creator.js';
import { AppError, notFound } from '../utils/errors.js';
import { assertMove } from '../services/productStateMachine.js';
import { applyTerms, changeStock, creatorView } from '../services/productOps.js';
import { validateCommercialTerms } from '../services/pricing.js';
import { notify } from '../services/notify.js';
import { audit } from '../services/audit.js';

export const adminProductsRouter = Router();
adminProductsRouter.use('/admin/products', requireAuth, requireAdmin);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const adminView = async (p: any) => {
  const [base, creator, history] = await Promise.all([creatorView(p), CreatorProfile.findById(p.creator).select('slug displayName user status'), ProductPricingHistory.find({ product: p._id }).sort({ version: -1 }).limit(20).lean()]);
  return { ...base, featured: p.featured, platformMarginPaise: p.platformMarginPaise, pricingVersion: p.pricingVersion, creator: creator && { id: String(creator._id), slug: creator.slug, name: creator.displayName, status: creator.status }, pricingHistory: history.map((h) => ({ version: h.version, sellingPricePaise: h.sellingPricePaise, creatorAmountPaise: h.creatorAmountPaise, platformMarginPaise: h.platformMarginPaise, reason: h.reason, at: h.createdAt })), reviewFeedback: p.reviewFeedback };
};
async function list(req: any, forced: Record<string, unknown> = {}) {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Number(req.query.limit) || 25);
  const f: Record<string, any> = { ...forced };
  if (!forced.status && typeof req.query.status === 'string') f.status = req.query.status;
  if (typeof req.query.q === 'string' && req.query.q.trim()) f.name = new RegExp(esc(req.query.q.trim().slice(0, 80)), 'i');
  if (typeof req.query.creator === 'string' && /^[a-f0-9]{24}$/.test(req.query.creator)) f.creator = req.query.creator;
  const [items, total] = await Promise.all([Product.find(f).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit), Product.countDocuments(f)]);
  return { items: await Promise.all(items.map(adminView)), page, limit, total };
}
adminProductsRouter.get('/admin/products/pending', asyncHandler(async (req, res) => { res.json(await list(req, { status: { $in: ['submitted', 'under_review'] } })); }));
adminProductsRouter.get('/admin/products', asyncHandler(async (req, res) => { res.json(await list(req)); }));
adminProductsRouter.get('/admin/products/:id', asyncHandler(async (req, res) => { const p = await Product.findById(req.params.id); if (!p) throw notFound('Product not found'); res.json({ product: await adminView(p) }); }));

async function creatorUser(p: any) { return (await CreatorProfile.findById(p.creator).select('user'))?.user; }

adminProductsRouter.post('/admin/products/:id/review', validateBody(reviewSchema), asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id); if (!p) throw notFound('Product not found');
  const { action, note, sellingPricePaise, creatorAmountPaise, publish } = req.body;
  const before = { status: p.status }; const actor = req.user!.id;
  if (action === 'start_review') { assertMove(p.status, 'under_review'); p.status = 'under_review'; }
  else if (action === 'request_changes') { assertMove(p.status, 'changes_requested'); p.status = 'changes_requested'; p.reviewFeedback.push({ note, by: actor, at: new Date() } as any); }
  else if (action === 'reject') { assertMove(p.status, 'rejected'); p.status = 'rejected'; p.reviewFeedback.push({ note, by: actor, at: new Date() } as any); }
  else {
    assertMove(p.status, 'approved');
    const creator = await CreatorProfile.findById(p.creator);
    if (!creator || creator.status !== 'active') throw new AppError(409, 'CREATOR_INACTIVE', 'The creator account is not active');
    // Admin confirms final terms explicitly; defaults come from the creator's proposal, never the other way round.
    await applyTerms(p, sellingPricePaise ?? p.sellingPricePaise ?? p.suggestedPricePaise ?? undefined, creatorAmountPaise ?? p.creatorAmountPaise ?? p.proposedCreatorAmountPaise ?? undefined, actor, note ?? 'approved');
    p.status = 'approved'; p.requiresReapproval = false;
    if (publish) { assertMove('approved', 'published'); p.status = 'published'; p.publishedAt = p.publishedAt ?? new Date(); }
  }
  await p.save();
  await audit(req, { action: `product.${action}`, entityType: 'Product', entityId: p._id, before, after: { status: p.status, sellingPricePaise: p.sellingPricePaise, creatorAmountPaise: p.creatorAmountPaise }, note });
  const uid = await creatorUser(p);
  const copy: Record<string, string> = { approve: `"${p.name}" was approved${p.status === 'published' ? ' and is now live' : ''}`, reject: `"${p.name}" was not approved`, request_changes: `Changes requested on "${p.name}"`, start_review: `"${p.name}" is being reviewed` };
  if (uid) await notify(uid, { type: `product_${action}`, title: copy[action]!, body: note, link: `/creator/products/${p._id}/edit`, email: { subject: copy[action]!, text: note ?? copy[action]! } });
  res.json({ product: await adminView(p) });
}));

adminProductsRouter.post('/admin/products/:id/publish', asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id); if (!p) throw notFound('Product not found');
  assertMove(p.status, 'published');
  validateCommercialTerms(p.sellingPricePaise ?? undefined, p.creatorAmountPaise ?? undefined); // incomplete/inconsistent terms can never go live
  const c = await CreatorProfile.findById(p.creator); if (!c || c.status !== 'active') throw new AppError(409, 'CREATOR_INACTIVE', 'The creator account is not active');
  p.status = 'published'; p.publishedAt = p.publishedAt ?? new Date(); await p.save();
  await audit(req, { action: 'product.published', entityType: 'Product', entityId: p._id }); res.json({ product: await adminView(p) });
}));

adminProductsRouter.patch('/admin/products/:id/pricing', validateBody(pricingSchema), asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id); if (!p) throw notFound('Product not found');
  if (['draft', 'archived', 'rejected'].includes(p.status)) throw new AppError(409, 'PRICING_NOT_ALLOWED', 'Terms are set during approval');
  const before = { sellingPricePaise: p.sellingPricePaise, creatorAmountPaise: p.creatorAmountPaise, version: p.pricingVersion };
  const changed = await applyTerms(p, req.body.sellingPricePaise, req.body.creatorAmountPaise, req.user!.id, req.body.reason);
  await p.save();
  if (changed) await audit(req, { action: 'product.pricing_changed', entityType: 'Product', entityId: p._id, before, after: { sellingPricePaise: p.sellingPricePaise, creatorAmountPaise: p.creatorAmountPaise, version: p.pricingVersion }, note: req.body.reason });
  res.json({ product: await adminView(p), changed });
}));

adminProductsRouter.patch('/admin/products/:id/merchandising', validateBody(merchandisingSchema), asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id); if (!p) throw notFound('Product not found');
  if (req.body.featured !== undefined) { p.featured = req.body.featured; await p.save(); }
  if (req.body.stock !== undefined) await changeStock(p, req.body.stock, req.user!.id, 'admin stock update');
  await audit(req, { action: 'product.merchandising_changed', entityType: 'Product', entityId: p._id, after: req.body });
  res.json({ product: await adminView((await Product.findById(p._id))!) });
}));

adminProductsRouter.post('/admin/products/:id/archive', asyncHandler(async (req, res) => {
  const p = await Product.findById(req.params.id); if (!p) throw notFound('Product not found');
  if (p.status === 'archived') throw new AppError(409, 'ALREADY_ARCHIVED', 'Already archived');
  const before = { status: p.status }; p.status = 'archived'; p.featured = false; await p.save();
  await audit(req, { action: 'product.archived_by_admin', entityType: 'Product', entityId: p._id, before, note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined });
  res.json({ product: await adminView(p) });
}));
