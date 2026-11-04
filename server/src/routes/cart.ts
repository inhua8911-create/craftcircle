import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Cart, Product } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { optionalAuth } from '../middleware/auth.js';
import { cookieSecure } from '../config/env.js';
import { toPublicProducts, availability } from '../services/publicShape.js';
import { AppError } from '../utils/errors.js';

export const cartRouter = Router();
cartRouter.use(optionalAuth);
const GUEST = 'cc_guest';

async function getCart(req: any, res: any, create = false) {
  if (req.user) return (await Cart.findOne({ user: req.user.id })) ?? (create ? Cart.create({ user: req.user.id, items: [] }) : null);
  let gid = req.cookies?.[GUEST];
  if (typeof gid !== 'string' || gid.length < 32) {
    if (!create) return null;
    gid = crypto.randomBytes(24).toString('hex');
    res.cookie(GUEST, gid, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: 30 * 86_400_000 });
  }
  return (await Cart.findOne({ guestId: gid })) ?? (create ? Cart.create({ guestId: gid, items: [], expiresAt: new Date(Date.now() + 30 * 86_400_000) }) : null);
}

/** Cart view priced from the database. Client-supplied prices do not exist in this API. */
export async function cartView(cart: any) {
  const ids = (cart?.items ?? []).map((i: any) => i.product);
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const pub = new Map((await toPublicProducts(products.filter((p) => p.status === 'published'))).map((p) => [p.id, p]));
  const lines = (cart?.items ?? []).map((i: any) => {
    const p = pub.get(String(i.product));
    const raw = products.find((x) => String(x._id) === String(i.product));
    const issue = !p ? 'unavailable' : i.quantity > p.maxPurchasable ? 'insufficient_stock' : null;
    return { productId: String(i.product), quantity: i.quantity, issue, product: p ?? null, lineTotalPaise: p && raw ? raw.sellingPricePaise! * i.quantity : 0 };
  });
  return { items: lines, subtotalPaise: lines.filter((l: any) => !l.issue).reduce((a: number, l: any) => a + l.lineTotalPaise, 0), hasIssues: lines.some((l: any) => l.issue) };
}

cartRouter.get('/', asyncHandler(async (req, res) => { res.json(await cartView(await getCart(req, res))); }));

cartRouter.put('/items', validateBody(z.strictObject({ productId: z.string().regex(/^[a-f0-9]{24}$/), quantity: z.number().int().min(0).max(20) })), asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;
  const cart = (await getCart(req, res, true))!;
  if (quantity > 0) {
    const p = await Product.findOne({ _id: productId, status: 'published' });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product is not available');
    if (quantity > availability(p).maxPurchasable) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for that quantity');
  }
  const existing = cart.items.find((i: any) => String(i.product) === productId);
  if (quantity === 0) cart.items = cart.items.filter((i: any) => String(i.product) !== productId) as any;
  else if (existing) existing.quantity = quantity;
  else cart.items.push({ product: productId as any, quantity });
  await cart.save();
  res.json(await cartView(cart));
}));

cartRouter.delete('/', asyncHandler(async (req, res) => {
  const cart = await getCart(req, res);
  if (cart) { cart.items = [] as any; await cart.save(); }
  res.json(await cartView(cart));
}));

// After login the client calls this to fold the guest cart into the account cart.
cartRouter.post('/merge', asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Sign in to merge carts');
  const gid = req.cookies?.[GUEST];
  const mine = (await Cart.findOne({ user: req.user.id })) ?? (await Cart.create({ user: req.user.id, items: [] }));
  const guest = typeof gid === 'string' ? await Cart.findOne({ guestId: gid }) : null;
  if (guest) {
    for (const gi of guest.items) {
      const m = mine.items.find((i: any) => String(i.product) === String(gi.product));
      if (m) m.quantity = Math.min(20, m.quantity + gi.quantity); else mine.items.push({ product: gi.product, quantity: gi.quantity } as any);
    }
    await mine.save(); await Cart.deleteOne({ _id: guest._id }); res.clearCookie(GUEST);
  }
  res.json(await cartView(mine));
}));
