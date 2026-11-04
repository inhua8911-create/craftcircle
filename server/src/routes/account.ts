import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Address, CreatorProfile, NewsletterSubscription, Product, StoreSettings, User, Wishlist, Category } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAuth, setSessionCookie } from '../middleware/auth.js';
import { resetLimiter } from '../middleware/security.js';
import { addressSchema, checkoutSchema } from '../validators/commerce.js';
import { password } from '../validators/auth.js';
import { AppError, notFound } from '../utils/errors.js';
import { toPublicCreator, toPublicProducts } from '../services/publicShape.js';
import { quoteCart } from '../services/checkout.js';
import { env } from '../config/env.js';

export const accountRouter = Router();
const oidParam = /^[a-f0-9]{24}$/;

// ---- wishlist -------------------------------------------------------------------------------
accountRouter.get('/wishlist', requireAuth, asyncHandler(async (req, res) => {
  const w = await Wishlist.findOne({ user: req.user!.id });
  const products = w ? await Product.find({ _id: { $in: w.products }, status: 'published' }).lean() : [];
  res.json({ ids: products.map((p) => String(p._id)), items: await toPublicProducts(products) });
}));
accountRouter.put('/wishlist/:productId', requireAuth, asyncHandler(async (req, res) => {
  const id = String(req.params.productId); if (!oidParam.test(id)) throw notFound('Product not found');
  if (!(await Product.exists({ _id: id, status: 'published' }))) throw notFound('Product not found');
  await Wishlist.updateOne({ user: req.user!.id }, { $addToSet: { products: id } }, { upsert: true });
  res.json({ ok: true });
}));
accountRouter.delete('/wishlist/:productId', requireAuth, asyncHandler(async (req, res) => {
  await Wishlist.updateOne({ user: req.user!.id }, { $pull: { products: String(req.params.productId) } }); res.json({ ok: true });
}));

// ---- addresses (always scoped to the signed-in user) ------------------------------------------
const addrBody = addressSchema.extend({ label: z.string().trim().max(40).optional(), isDefault: z.boolean().optional() });
const addrView = (a: any) => ({ id: String(a._id), label: a.label, isDefault: a.isDefault, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode, country: a.country });
accountRouter.get('/addresses', requireAuth, asyncHandler(async (req, res) => { res.json({ items: (await Address.find({ user: req.user!.id }).sort({ isDefault: -1, createdAt: -1 })).map(addrView) }); }));
accountRouter.post('/addresses', requireAuth, validateBody(addrBody), asyncHandler(async (req, res) => {
  if ((await Address.countDocuments({ user: req.user!.id })) >= 10) throw new AppError(409, 'TOO_MANY_ADDRESSES', 'You can save up to 10 addresses');
  const first = !(await Address.exists({ user: req.user!.id }));
  if (req.body.isDefault) await Address.updateMany({ user: req.user!.id }, { isDefault: false });
  const a = await Address.create({ ...req.body, user: req.user!.id, isDefault: req.body.isDefault || first });
  res.status(201).json({ address: addrView(a) });
}));
accountRouter.put('/addresses/:id', requireAuth, validateBody(addrBody), asyncHandler(async (req, res) => {
  const a = await Address.findOne({ _id: req.params.id, user: req.user!.id }); if (!a) throw notFound('Address not found');
  if (req.body.isDefault) await Address.updateMany({ user: req.user!.id }, { isDefault: false });
  Object.assign(a, req.body); await a.save(); res.json({ address: addrView(a) });
}));
accountRouter.delete('/addresses/:id', requireAuth, asyncHandler(async (req, res) => {
  const a = await Address.findOneAndDelete({ _id: req.params.id, user: req.user!.id }); if (!a) throw notFound('Address not found');
  if (a.isDefault) { const n = await Address.findOne({ user: req.user!.id }); if (n) { n.isDefault = true; await n.save(); } }
  res.json({ ok: true });
}));

// ---- account ------------------------------------------------------------------------------------
accountRouter.patch('/account', requireAuth, validateBody(z.strictObject({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/).optional() })), asyncHandler(async (req, res) => {
  const u = await User.findByIdAndUpdate(req.user!.id, req.body, { returnDocument: 'after' }); res.json({ user: { id: String(u!._id), name: u!.name, email: u!.email, phone: u!.phone, role: u!.role } });
}));
accountRouter.post('/account/change-password', requireAuth, resetLimiter, validateBody(z.strictObject({ currentPassword: z.string().min(1).max(200), newPassword: password })), asyncHandler(async (req, res) => {
  const u = await User.findById(req.user!.id).select('+passwordHash tokenVersion');
  if (!u || !(await bcrypt.compare(req.body.currentPassword, u.passwordHash))) throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is incorrect');
  u.passwordHash = await bcrypt.hash(req.body.newPassword, env.NODE_ENV === 'test' ? 4 : 12); u.tokenVersion += 1; await u.save();
  setSessionCookie(res, u); // other devices are signed out; this one stays signed in
  res.json({ ok: true });
}));

// ---- public store info ---------------------------------------------------------------------------
accountRouter.get('/store', asyncHandler(async (_req, res) => {
  const s = await StoreSettings.findOne({ key: 'default' }).lean();
  res.json({ announcement: s?.announcement?.enabled && s.announcement.text ? { text: s.announcement.text, link: s.announcement.link } : null,
    shipping: { flatRatePaise: s?.shipping?.flatRatePaise ?? 0, freeAboveCartPaise: s?.shipping?.freeAboveCartPaise ?? null },
    contact: s?.contact ?? {}, socialLinks: s?.socialLinks ?? [], instagramGallery: s?.instagramGallery ?? [], paymentMode: env.PAYMENT_MODE });
}));
accountRouter.get('/creators', asyncHandler(async (req, res) => {
  const f: Record<string, unknown> = { status: 'active' }; if (req.query.featured === 'true') f.featured = true;
  const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));
  const withProducts = await Product.distinct('creator', { status: 'published' });
  const items = await CreatorProfile.find({ ...f, _id: { $in: withProducts } }).sort({ featured: -1, createdAt: -1 }).limit(limit).lean();
  res.json({ items: items.map(toPublicCreator) });
}));
accountRouter.post('/newsletter', resetLimiter, validateBody(z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) })), asyncHandler(async (req, res) => {
  await NewsletterSubscription.updateOne({ email: req.body.email }, { $setOnInsert: { email: req.body.email, source: 'site' }, $set: { active: true } }, { upsert: true });
  res.json({ message: 'Thanks for subscribing.' }); // identical response whether or not already subscribed
}));
accountRouter.post('/checkout/quote', requireAuth, validateBody(z.strictObject({ couponCode: z.string().trim().min(1).max(40).optional() })), asyncHandler(async (req, res) => { res.json(await quoteCart(req.user!.id, req.body.couponCode)); }));
void checkoutSchema; void Category;

/** sitemap.xml: published products, categories, creators. Private pages and unpublished items never appear. */
export const sitemapHandler = asyncHandler(async (_req, res) => {
  const base = (process.env.PUBLIC_URL ?? env.CLIENT_ORIGIN.split(',')[0]!).replace(/\/$/, '');
  const [products, cats, creators] = await Promise.all([Product.find({ status: 'published' }).select('slug updatedAt').lean(), Category.find({ active: true }).select('slug').lean(), CreatorProfile.find({ status: 'active' }).select('slug').lean()]);
  const u = (path: string, lm?: Date) => `<url><loc>${base}${path}</loc>${lm ? `<lastmod>${lm.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  const statics = ['/', '/shop', '/about', '/contact', '/faq', '/how-it-works', '/become-a-creator', '/shipping-policy', '/returns-refunds', '/privacy-policy', '/terms'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...statics.map((p) => u(p)), ...cats.map((c) => u(`/categories/${c.slug}`)), ...creators.map((c) => u(`/creators/${c.slug}`)), ...products.map((p) => u(`/products/${p.slug}`, p.updatedAt))].join('')}</urlset>`);
});
