import { Router } from 'express';
import { z } from 'zod';
import { Category, CreatorProfile, Product, Collection } from '../models/index.js';
import { asyncHandler } from '../middleware/common.js';
import { notFound } from '../utils/errors.js';
import { toPublicCreator, toPublicProducts } from '../services/publicShape.js';

export const catalogRouter = Router();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const listQuery = z.object({
  q: z.string().trim().max(100).optional(), category: z.string().max(80).optional(), creator: z.string().max(80).optional(),
  minPrice: z.coerce.number().int().min(0).optional(), maxPrice: z.coerce.number().int().min(0).optional(), // paise
  inStock: z.enum(['true', 'false']).optional(), featured: z.enum(['true']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'popular']).default('newest'),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(48).default(24),
});

async function findProducts(raw: unknown, forced: Record<string, unknown> = {}) {
  const q = listQuery.parse(raw);
  const suspended = await CreatorProfile.find({ status: 'suspended' }).distinct('_id');
  const filter: Record<string, any> = { status: 'published', ...(suspended.length && { creator: { $nin: suspended } }), ...forced };
  if (q.q) filter.$or = [{ name: new RegExp(esc(q.q), 'i') }, { description: new RegExp(esc(q.q), 'i') }];
  if (q.category) {
    const cat = await Category.findOne({ slug: q.category, active: true });
    const kids = cat ? await Category.find({ parent: cat._id }).select('_id') : [];
    filter.category = { $in: cat ? [cat._id, ...kids.map((k) => k._id)] : [] };
  }
  if (q.creator) { const c = await CreatorProfile.findOne({ slug: q.creator, status: 'active' }); filter.creator = c?._id ?? null; }
  if (q.minPrice != null || q.maxPrice != null) filter.sellingPricePaise = { ...(q.minPrice != null && { $gte: q.minPrice }), ...(q.maxPrice != null && { $lte: q.maxPrice }) };
  if (q.inStock === 'true') filter.$and = [...(filter.$and ?? []), { $or: [{ madeToOrder: true }, { $expr: { $gt: ['$stock', '$reserved'] } }] }];
  if (q.featured) filter.featured = true;
  const sort: Record<string, 1 | -1> = q.sort === 'price_asc' ? { sellingPricePaise: 1 } : q.sort === 'price_desc' ? { sellingPricePaise: -1 } : q.sort === 'popular' ? { soldCount: -1, _id: -1 } : { publishedAt: -1, _id: -1 };
  const [items, total] = await Promise.all([Product.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(), Product.countDocuments(filter)]);
  return { items: await toPublicProducts(items), page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) };
}

catalogRouter.get('/categories', asyncHandler(async (_req, res) => {
  const cats = await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
  res.json({ items: cats.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, parent: c.parent ? String(c.parent) : null, description: c.description, banner: c.banner })) });
}));

catalogRouter.get('/products', asyncHandler(async (req, res) => { res.json(await findProducts(req.query)); }));

catalogRouter.get('/products/:slug', asyncHandler(async (req, res) => {
  const p = await Product.findOne({ slug: req.params.slug, status: 'published' }).lean();
  if (!p || (await CreatorProfile.exists({ _id: p.creator, status: 'suspended' }))) throw notFound('Product not found');
  const [[product], related] = await Promise.all([toPublicProducts([p]), Product.find({ status: 'published', category: p.category, _id: { $ne: p._id } }).limit(4).lean()]);
  res.json({ product, related: await toPublicProducts(related) });
}));

catalogRouter.get('/creators/:slug', asyncHandler(async (req, res) => {
  const c = await CreatorProfile.findOne({ slug: req.params.slug, status: 'active' }).lean();
  if (!c) throw notFound('Creator not found');
  const products = await Product.find({ creator: c._id, status: 'published' }).sort({ publishedAt: -1 }).limit(48).lean();
  res.json({ creator: toPublicCreator(c), products: await toPublicProducts(products) });
}));

// Keyword search across products and creators.
catalogRouter.get('/search', asyncHandler(async (req, res) => {
  const term = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!term) return void res.json({ products: { items: [], total: 0, page: 1, limit: 24, pages: 0 }, creators: [] });
  const [products, creators] = await Promise.all([
    findProducts(req.query),
    CreatorProfile.find({ status: 'active', $or: [{ displayName: new RegExp(esc(term), 'i') }, { specialties: new RegExp(esc(term), 'i') }] }).limit(8).lean(),
  ]);
  res.json({ products, creators: creators.map(toPublicCreator) });
}));

catalogRouter.get('/collections', asyncHandler(async (_req, res) => {
  const cols = await Collection.find({ active: true }).sort({ sortOrder: 1 }).lean();
  res.json({ items: cols.map((c) => ({ slug: c.slug, title: c.title, description: c.description, occasion: c.occasion, banner: c.banner, featured: c.featured })) });
}));
catalogRouter.get('/collections/:slug', asyncHandler(async (req, res) => {
  const c = await Collection.findOne({ slug: req.params.slug, active: true }).lean();
  if (!c) throw notFound('Collection not found');
  const products = await Product.find({ _id: { $in: c.products }, status: 'published' }).lean();
  res.json({ collection: { slug: c.slug, title: c.title, description: c.description, banner: c.banner }, products: await toPublicProducts(products) });
}));
