import { Router } from 'express';
import { Product, User } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAuth, requireCreator } from '../middleware/auth.js';
import { MATERIAL_FIELDS, productCreate, productUpdate } from '../validators/creator.js';
import { AppError, notFound } from '../utils/errors.js';
import { uniqueSlug } from '../utils/slug.js';
import { assertMove } from '../services/productStateMachine.js';
import { validateCommercialTerms } from '../services/pricing.js';
import { assertCategory, changeStock, creatorView, setImages } from '../services/productOps.js';
import { notify } from '../services/notify.js';
import { audit } from '../services/audit.js';
import { ProductImage } from '../models/index.js';

export const creatorProductsRouter = Router();
creatorProductsRouter.use('/creator/products', requireAuth, requireCreator);
const own = async (req: any) => { const p = await Product.findOne({ _id: req.params.id, creator: req.creator.id }); if (!p) throw notFound('Product not found'); return p; }; // ownership is in the query

creatorProductsRouter.get('/creator/products', asyncHandler(async (req, res) => {
  const f: Record<string, unknown> = { creator: req.creator!.id }; if (typeof req.query.status === 'string') f.status = req.query.status;
  const items = await Product.find(f).sort({ updatedAt: -1 }).limit(200);
  res.json({ items: await Promise.all(items.map(creatorView)) });
}));
creatorProductsRouter.get('/creator/products/:id', asyncHandler(async (req, res) => { res.json({ product: await creatorView(await own(req)) }); }));

creatorProductsRouter.post('/creator/products', validateBody(productCreate), asyncHandler(async (req, res) => {
  const { images, category, ...rest } = req.body;
  await assertCategory(category);
  const p = new Product({ ...rest, category, creator: req.creator!.id, slug: uniqueSlug(rest.name), status: 'draft', stock: rest.stock ?? 0 });
  await p.save();
  if (images) await setImages(p._id, images, p.name);
  await audit(req, { action: 'product.created', entityType: 'Product', entityId: p._id });
  res.status(201).json({ product: await creatorView(p) });
}));

creatorProductsRouter.put('/creator/products/:id', validateBody(productUpdate), asyncHandler(async (req, res) => {
  const p = await own(req);
  const { acknowledgeReapproval, stock, dispatchDays, images, ...rest } = req.body;
  const touched = Object.keys(req.body).filter((k) => k !== 'acknowledgeReapproval');
  const material = touched.filter((k) => (MATERIAL_FIELDS as readonly string[]).includes(k));
  if (p.status === 'archived') throw new AppError(409, 'PRODUCT_ARCHIVED', 'Archived products cannot be edited');
  if (['submitted', 'under_review', 'approved'].includes(p.status) && touched.some((k) => !['stock', 'dispatchDays'].includes(k))) throw new AppError(409, 'PRODUCT_LOCKED', 'This product is being reviewed. You can change stock and dispatch time only.');
  let resubmit = false;
  if (['published', 'paused'].includes(p.status) && material.length) {
    if (!acknowledgeReapproval) throw new AppError(409, 'REAPPROVAL_REQUIRED', 'These changes need re-approval and will take the listing offline until approved. Resend with acknowledgeReapproval: true to continue.', { fields: material });
    resubmit = true;
  }
  if (rest.category) await assertCategory(rest.category);
  const before = { status: p.status };
  for (const [k, v] of Object.entries(rest)) (p as any)[k] = v;
  if (dispatchDays !== undefined) p.dispatchDays = dispatchDays;
  if (resubmit) { assertMove(p.status, 'submitted'); p.status = 'submitted'; p.requiresReapproval = true; }
  else if (p.status === 'rejected') p.status = 'draft';
  await p.save();
  if (images) await setImages(p._id, images, p.name);
  if (stock !== undefined) await changeStock(p, stock, req.user!.id, 'creator stock update');
  await audit(req, { action: resubmit ? 'product.edited_needs_reapproval' : 'product.edited', entityType: 'Product', entityId: p._id, before, after: { status: p.status, fields: touched } });
  res.json({ product: await creatorView((await Product.findById(p._id))!), reapprovalRequired: resubmit });
}));

creatorProductsRouter.post('/creator/products/:id/submit', asyncHandler(async (req, res) => {
  const p = await own(req);
  assertMove(p.status, 'submitted');
  const problems: string[] = [];
  if (!(await ProductImage.countDocuments({ product: p._id }))) problems.push('Add at least one photo');
  if (!p.suggestedPricePaise) problems.push('Suggest a retail price');
  if (!p.proposedCreatorAmountPaise) problems.push('Enter the amount you want to receive per unit');
  if (p.suggestedPricePaise && p.proposedCreatorAmountPaise && p.suggestedPricePaise <= p.proposedCreatorAmountPaise) problems.push('The retail price must be higher than your payment per unit');
  if (!p.madeToOrder && p.stock < 1) problems.push('Add stock, or mark the product as made to order');
  if (problems.length) throw new AppError(422, 'INCOMPLETE_PRODUCT', 'Please complete the product before submitting', { problems });
  p.status = 'submitted'; await p.save();
  const admins = await User.find({ role: { $in: ['admin', 'super_admin'] }, status: 'active' }).select('_id').limit(25);
  await Promise.all(admins.map((u) => notify(u._id, { type: 'product_submitted', title: 'Product awaiting review', body: p.name, link: '/admin/products/pending' })));
  await audit(req, { action: 'product.submitted', entityType: 'Product', entityId: p._id });
  res.json({ product: await creatorView(p) });
}));

creatorProductsRouter.post('/creator/products/:id/pause', asyncHandler(async (req, res) => {
  const p = await own(req); assertMove(p.status, 'paused'); p.status = 'paused'; await p.save();
  await audit(req, { action: 'product.paused', entityType: 'Product', entityId: p._id }); res.json({ product: await creatorView(p) });
}));
creatorProductsRouter.post('/creator/products/:id/resume', asyncHandler(async (req, res) => {
  const p = await own(req); assertMove(p.status, 'published');
  if (p.requiresReapproval) throw new AppError(409, 'REAPPROVAL_REQUIRED', 'This product needs re-approval before it can go live');
  validateCommercialTerms(p.sellingPricePaise ?? undefined, p.creatorAmountPaise ?? undefined);
  p.status = 'published'; await p.save();
  await audit(req, { action: 'product.resumed', entityType: 'Product', entityId: p._id }); res.json({ product: await creatorView(p) });
}));
creatorProductsRouter.post('/creator/products/:id/archive', asyncHandler(async (req, res) => {
  const p = await own(req);
  if (!['draft', 'rejected', 'paused', 'changes_requested'].includes(p.status)) throw new AppError(409, 'CANNOT_ARCHIVE', 'Pause a live product before archiving it');
  p.status = 'archived'; await p.save();
  await audit(req, { action: 'product.archived', entityType: 'Product', entityId: p._id }); res.json({ product: await creatorView(p) });
}));
