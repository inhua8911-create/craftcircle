import { Types, type ClientSession } from 'mongoose';
import { Cart, Coupon, CreatorProfile, InventoryMovement, Order, OrderItem, Product, StoreSettings } from '../models/index.js';
import { AppError, notFound } from '../utils/errors.js';
import { computeTaxPaise, priceOrder, validateCommercialTerms } from './pricing.js';
import { assertTransition } from './orderStateMachine.js';
import { isDuplicateKey, withTx } from './tx.js';

export const RESERVATION_MINUTES = 30;
const orderNumber = () => `CC-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`;

export interface CheckoutInput {
  userId: Types.ObjectId | string;
  customer: { name: string; email: string; phone?: string };
  address: { fullName: string; phone: string; line1: string; line2?: string; city: string; state: string; postalCode: string; country: string };
  couponCode?: string;
  idempotencyKey: string;
}

async function evaluateCoupon(code: string, subtotal: number, userId: Types.ObjectId | string, now: Date, session: ClientSession | null) {
  const c = await Coupon.findOne({ code: code.trim().toUpperCase(), active: true }).session(session);
  const bad = (m: string) => new AppError(422, 'COUPON_INVALID', m);
  if (!c || c.startsAt > now || c.endsAt < now) throw bad('This promo code is not valid right now');
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) throw bad('This promo code has been fully redeemed');
  if (subtotal < c.minOrderPaise) throw bad('Your order does not meet the minimum for this promo code');
  const used = await Order.countDocuments({ user: userId, 'coupon.couponId': c._id, status: { $nin: ['cancelled', 'payment_failed'] } }).session(session);
  if (used >= c.perUserLimit) throw bad('You have already used this promo code');
  let d = c.type === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
  if (c.maxDiscountPaise != null) d = Math.min(d, c.maxDiscountPaise);
  return { coupon: c, discountPaise: Math.min(d, subtotal) };
}

/** Creates an unpaid order and reserves stock atomically. Any failure rolls the whole thing back. */
export async function placeOrder(input: CheckoutInput) {
  try {
    return await withTx(async (session) => {
      const prior = await Order.findOne({ idempotencyKey: input.idempotencyKey }).session(session);
      if (prior) {
        if (String(prior.user) !== String(input.userId)) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already used');
        return { order: prior, reused: true };
      }
      const cart = await Cart.findOne({ user: input.userId }).session(session);
      if (!cart || !cart.items.length) throw new AppError(422, 'EMPTY_CART', 'Your cart is empty');
      const now = new Date();

      const products = await Product.find({ _id: { $in: cart.items.map((i) => i.product) } }).session(session);
      const creators = await CreatorProfile.find({ _id: { $in: products.map((p) => p.creator) }, status: 'active' }).select('_id').session(session);
      const activeCreator = new Set(creators.map((c) => String(c._id)));
      const orderId = new Types.ObjectId();

      const lines: { p: (typeof products)[number]; quantity: number }[] = [];
      for (const ci of cart.items) {
        const p = products.find((x) => String(x._id) === String(ci.product));
        if (!p || p.status !== 'published' || !activeCreator.has(String(p.creator))) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'An item in your cart is no longer available', { productId: String(ci.product) });
        validateCommercialTerms(p.sellingPricePaise ?? undefined, p.creatorAmountPaise ?? undefined); // never sell a product with broken terms
        if (!p.madeToOrder) {
          const r = await Product.updateOne({ _id: p._id, status: 'published', $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, ci.quantity] } }, { $inc: { reserved: ci.quantity } }, { session });
          if (r.modifiedCount !== 1) throw new AppError(409, 'OUT_OF_STOCK', `Not enough stock for "${p.name}"`, { productId: String(p._id) });
          await InventoryMovement.create([{ product: p._id, type: 'reserve', delta: 0, reservedDelta: ci.quantity, order: orderId, actor: input.userId as any, idempotencyKey: `reserve:${orderId}:${p._id}` }], { session });
        }
        lines.push({ p, quantity: ci.quantity });
      }

      const settings = (await StoreSettings.findOne({ key: 'default' }).session(session)) ?? new StoreSettings({});
      const subtotal = lines.reduce((a, l) => a + l.p.sellingPricePaise! * l.quantity, 0);
      let discountPaise = 0; let couponRef: { code: string; couponId: Types.ObjectId } | undefined;
      if (input.couponCode) {
        const ev = await evaluateCoupon(input.couponCode, subtotal, input.userId, now, session);
        const claimed = await Coupon.updateOne({ _id: ev.coupon._id, $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] }, { $inc: { usedCount: 1 } }, { session });
        if (claimed.modifiedCount !== 1) throw new AppError(422, 'COUPON_INVALID', 'This promo code has been fully redeemed');
        discountPaise = ev.discountPaise; couponRef = { code: ev.coupon.code, couponId: ev.coupon._id };
      }
      const after = subtotal - discountPaise;
      const shippingPaise = settings.shipping?.freeAboveCartPaise != null && after >= settings.shipping.freeAboveCartPaise ? 0 : settings.shipping?.flatRatePaise ?? 0;
      const taxPaise = settings.taxEnabled ? computeTaxPaise(after, settings.taxRatePercent ?? 0) : 0;
      const priced = priceOrder({ lines: lines.map((l) => ({ key: String(l.p._id), unitPricePaise: l.p.sellingPricePaise!, creatorAmountPerUnitPaise: l.p.creatorAmountPaise!, quantity: l.quantity })), discountPaise, shippingPaise, taxPaise });

      const [order] = await Order.create([{
        _id: orderId, orderNumber: orderNumber(), user: input.userId, customerEmail: input.customer.email, customerName: input.customer.name, customerPhone: input.customer.phone,
        shippingAddress: input.address, status: 'pending_payment', paymentStatus: 'unpaid',
        subtotalPaise: priced.subtotalPaise, discountPaise: priced.discountPaise, shippingPaise: priced.shippingPaise, taxPaise: priced.taxPaise, totalPaise: priced.totalPaise,
        coupon: couponRef, idempotencyKey: input.idempotencyKey, stockReservedUntil: new Date(now.getTime() + RESERVATION_MINUTES * 60_000),
        history: [{ from: 'none', to: 'pending_payment', at: now }],
      }], { session });
      await OrderItem.create(priced.lines.map((l, i) => {
        const p = lines[i]!.p;
        return { order: orderId, product: p._id, creator: p.creator, productName: p.name, productSlug: p.slug, quantity: l.quantity, unitPricePaise: l.unitPricePaise, creatorAmountPerUnitPaise: l.creatorAmountPerUnitPaise, platformMarginPerUnitPaise: l.unitPricePaise - l.creatorAmountPerUnitPaise, pricingVersion: p.pricingVersion, discountAllocatedPaise: l.discountAllocatedPaise, shippingAllocatedPaise: l.shippingAllocatedPaise, lineTotalPaise: l.lineTotalPaise };
      }), { session, ordered: true });
      cart.items = [] as any;
      await cart.save({ session });
      return { order: order!, reused: false };
    });
  } catch (e) {
    if (isDuplicateKey(e)) { // lost a race on the idempotency key: return the winner
      const prior = await Order.findOne({ idempotencyKey: input.idempotencyKey });
      if (prior && String(prior.user) === String(input.userId)) return { order: prior, reused: true };
    }
    throw e;
  }
}

/** Releases reserved stock + coupon usage and cancels an unpaid order. */
async function cancelInTx(orderId: Types.ObjectId | string, session: ClientSession, by: { userId?: any; note: string }) {
  const order = await Order.findOneAndUpdate({ _id: orderId, status: { $in: ['pending_payment', 'payment_failed'] }, paymentStatus: { $ne: 'paid' } }, { $set: { status: 'cancelled' }, $push: { history: { from: 'pending_payment', to: 'cancelled', by: by.userId, note: by.note, at: new Date() } } }, { returnDocument: 'before', session });
  if (!order) return null;
  for (const it of await OrderItem.find({ order: order._id }).session(session)) {
    const p = await Product.findById(it.product).session(session);
    if (p && !p.madeToOrder) {
      await Product.updateOne({ _id: p._id, reserved: { $gte: it.quantity } }, { $inc: { reserved: -it.quantity } }, { session });
      await InventoryMovement.create([{ product: p._id, type: 'release', delta: 0, reservedDelta: -it.quantity, order: order._id, note: by.note, idempotencyKey: `release:${order._id}:${p._id}` }], { session });
    }
  }
  if (order.coupon?.couponId) await Coupon.updateOne({ _id: order.coupon.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }, { session });
  return order;
}

export async function cancelUnpaidOrder(orderId: Types.ObjectId | string, userId?: Types.ObjectId | string) {
  return withTx(async (session) => {
    const filter: Record<string, unknown> = { _id: orderId };
    if (userId) filter.user = userId;
    const o = await Order.findOne(filter).session(session);
    if (!o) throw notFound('Order not found');
    const done = await cancelInTx(o._id, session, { userId, note: 'cancelled before payment' });
    if (!done) throw new AppError(409, 'CANNOT_CANCEL', 'Only unpaid orders can be cancelled here. Paid orders need a refund.');
    return true;
  });
}

/** Sweeper: cancels unpaid orders whose reservation window passed and returns their stock. Run on a timer. */
export async function expireReservations(now = new Date()): Promise<number> {
  const stale = await Order.find({ status: { $in: ['pending_payment', 'payment_failed'] }, paymentStatus: { $ne: 'paid' }, stockReservedUntil: { $lt: now } }).select('_id').limit(200);
  let n = 0;
  for (const o of stale) { const ok = await withTx((s) => cancelInTx(o._id, s, { note: 'reservation expired' })); if (ok) n++; }
  return n;
}
export { assertTransition };

/** Read-only price preview for the checkout page. Reserves nothing and claims no coupon use. */
export async function quoteCart(userId: Types.ObjectId | string, couponCode?: string) {
  const cart = await Cart.findOne({ user: userId });
  if (!cart || !cart.items.length) throw new AppError(422, 'EMPTY_CART', 'Your cart is empty');
  const products = await Product.find({ _id: { $in: cart.items.map((i) => i.product) } });
  const creators = await CreatorProfile.find({ _id: { $in: products.map((p) => p.creator) }, status: 'active' }).select('_id');
  const active = new Set(creators.map((c) => String(c._id)));
  const issues: { productId: string; issue: string }[] = []; const lines: { p: (typeof products)[number]; quantity: number }[] = [];
  for (const ci of cart.items) {
    const p = products.find((x) => String(x._id) === String(ci.product));
    if (!p || p.status !== 'published' || !active.has(String(p.creator))) { issues.push({ productId: String(ci.product), issue: 'unavailable' }); continue; }
    if (!p.madeToOrder && p.stock - p.reserved < ci.quantity) issues.push({ productId: String(p._id), issue: 'insufficient_stock' });
    try { validateCommercialTerms(p.sellingPricePaise ?? undefined, p.creatorAmountPaise ?? undefined); } catch { issues.push({ productId: String(p._id), issue: 'unavailable' }); continue; }
    lines.push({ p, quantity: ci.quantity });
  }
  const settings = (await StoreSettings.findOne({ key: 'default' })) ?? new StoreSettings({});
  const subtotal = lines.reduce((a, l) => a + l.p.sellingPricePaise! * l.quantity, 0);
  let discountPaise = 0; let couponError: string | undefined; let appliedCode: string | null = null;
  if (couponCode && lines.length) {
    try { const ev = await evaluateCoupon(couponCode, subtotal, userId, new Date(), null); discountPaise = ev.discountPaise; appliedCode = ev.coupon.code; }
    catch (e) { couponError = e instanceof AppError ? e.message : 'This promo code could not be applied'; }
  }
  const build = (discount: number) => {
    const after = subtotal - discount;
    const shippingPaise = settings.shipping?.freeAboveCartPaise != null && after >= settings.shipping.freeAboveCartPaise ? 0 : settings.shipping?.flatRatePaise ?? 0;
    const taxPaise = settings.taxEnabled ? computeTaxPaise(after, settings.taxRatePercent ?? 0) : 0;
    return priceOrder({ lines: lines.map((l) => ({ key: String(l.p._id), unitPricePaise: l.p.sellingPricePaise!, creatorAmountPerUnitPaise: l.p.creatorAmountPaise!, quantity: l.quantity })), discountPaise: discount, shippingPaise, taxPaise });
  };
  if (!lines.length) return { subtotalPaise: 0, discountPaise: 0, shippingPaise: 0, taxPaise: 0, totalPaise: 0, coupon: null, couponError, issues };
  let priced; try { priced = build(discountPaise); } catch (e) { if (!(e instanceof AppError) || !discountPaise) throw e; couponError = 'This promo code cannot be applied to these items'; appliedCode = null; priced = build(0); }
  return { subtotalPaise: priced.subtotalPaise, discountPaise: priced.discountPaise, shippingPaise: priced.shippingPaise, taxPaise: priced.taxPaise, totalPaise: priced.totalPaise, coupon: appliedCode, couponError, issues, freeShippingAbovePaise: settings.shipping?.freeAboveCartPaise ?? null };
}
