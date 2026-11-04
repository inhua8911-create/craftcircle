import { describe, it, expect } from 'vitest';
import { createApp } from '../app.js';
import { Coupon, CreatorEarning, CreatorProfile, InventoryMovement, Order, Product, StoreSettings } from '../models/index.js';
import { cancelUnpaidOrder, expireReservations } from '../services/checkout.js';
import { makeCreator, makeProduct } from './fixtures.js';
import { ADDRESS, admin, buy, CHECKOUT, customer, key } from './helpers.js';

const app = createApp();
const stockOf = async (id: any) => { const p = (await Product.findById(id))!; return { stock: p.stock, reserved: p.reserved, sold: p.soldCount }; };
const pay = (c: any, orderId: string, outcome: 'success' | 'failure' = 'success') => c.post('/api/v1/payments/mock/confirm', { orderId, outcome });

describe('public catalogue', () => {
  it('never exposes creator payment, margin, or internal stock; hides unpublished products', async () => {
    const cr = await makeCreator('Asha');
    const live = await makeProduct(cr._id);
    const draft = await makeProduct(cr._id, { status: 'draft' });
    const c = await customer(app);
    const list = await c.get('/api/v1/products');
    expect(list.body.items.map((p: any) => p.id)).toEqual([String(live._id)]);
    const detail = await c.get(`/api/v1/products/${live.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.product.pricePaise).toBe(59900);
    expect(JSON.stringify(detail.body)).not.toMatch(/creatorAmount|platformMargin|margin|reserved|proposed/i);
    expect((await c.get(`/api/v1/products/${draft.slug}`)).status).toBe(404);
  });
  it('filters, sorts and searches safely', async () => {
    const cr = await makeCreator('Asha');
    await makeProduct(cr._id, { selling: 30000, creator: 20000 }); await makeProduct(cr._id, { selling: 90000, creator: 50000 });
    const c = await customer(app);
    expect((await c.get('/api/v1/products?minPrice=50000')).body.total).toBe(1);
    expect((await c.get('/api/v1/products?sort=price_desc')).body.items[0].pricePaise).toBe(90000);
    expect((await c.get('/api/v1/products?q=(.*+')).status).toBe(200); // regex metacharacters are escaped
    expect((await c.get('/api/v1/products?limit=9999')).status).toBe(422);
  });
  it('creator profiles only show fields the creator made public', async () => {
    const cr = await makeCreator('Asha');
    await CreatorProfile.updateOne({ _id: cr._id }, { city: 'Pune', bio: 'Potter', publicFields: { city: false, bio: true, story: true, links: false } });
    const r = await (await customer(app)).get(`/api/v1/creators/${cr.slug}`);
    expect(r.body.creator.bio).toBe('Potter');
    expect(r.body.creator.city).toBeUndefined();
  });
});

describe('cart', () => {
  it('prices from the database and rejects over-stock quantities', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 2 });
    const c = await customer(app);
    expect((await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 3 })).status).toBe(409);
    const r = await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 2, pricePaise: 1 });
    expect(r.status).toBe(422); // client-supplied prices are rejected outright
    const ok = await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 2 });
    expect(ok.body.subtotalPaise).toBe(119800);
  });
  it('merges a guest cart into the account cart', async () => {
    const p = await makeProduct((await makeCreator())._id);
    const { client: mk } = await import('./helpers.js');
    const g = await mk(app);
    await g.put('/api/v1/cart/items', { productId: String(p._id), quantity: 2 });
    expect((await g.get('/api/v1/cart')).body.items.length).toBe(1);
    await g.post('/api/v1/auth/register', { name: 'G', email: 'g@example.com', password: 'correct-horse-battery' });
    expect((await g.post('/api/v1/cart/merge')).body.items[0].quantity).toBe(2);
  });
});

describe('checkout & mock payment', () => {
  it('reserves stock, then a simulated payment converts it to a sale and creates earnings once', async () => {
    await StoreSettings.create({ shipping: { flatRatePaise: 5000 } });
    const cr = await makeCreator(); const p = await makeProduct(cr._id, { stock: 5 });
    const c = await customer(app);
    const r = await buy(c, [[String(p._id), 2]]);
    expect(r.status).toBe(201);
    expect(r.body.order.totalPaise).toBe(119800 + 5000);
    expect(r.body.payment.simulated).toBe(true);
    expect(await stockOf(p._id)).toEqual({ stock: 5, reserved: 2, sold: 0 });

    const oid = r.body.order.id;
    const a = await pay(c, oid); const b = await pay(c, oid); // double confirmation
    expect(a.status).toBe(200); expect(a.body.notice).toMatch(/SIMULATED/);
    expect(b.status).toBe(200);
    expect(await stockOf(p._id)).toEqual({ stock: 3, reserved: 0, sold: 2 });
    const o = (await Order.findById(oid))!;
    expect([o.status, o.paymentStatus, o.isSimulated]).toEqual(['paid', 'paid', true]);
    const earnings = await CreatorEarning.find();
    expect(earnings.length).toBe(1); expect(earnings[0]!.grossPaise).toBe(80000); expect(earnings[0]!.isSimulated).toBe(true);
    expect((await c.get('/api/v1/cart')).body.items.length).toBe(0);
  });
  it('customer order JSON never leaks creator amounts or margin', async () => {
    const p = await makeProduct((await makeCreator())._id);
    const c = await customer(app);
    const r = await buy(c, [[String(p._id), 1]]);
    expect(JSON.stringify(r.body)).not.toMatch(/creatorAmount|platformMargin/i);
  });
  it('cannot oversell: concurrent buyers of the last unit => exactly one wins', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 1 });
    const [a, b, c3] = await Promise.all([customer(app), customer(app), customer(app)]);
    for (const c of [a, b, c3]) await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 1 });
    const res = await Promise.all([a, b, c3].map((c) => c.post('/api/v1/checkout', CHECKOUT, { 'Idempotency-Key': key() })));
    expect(res.filter((r) => r.status === 201).length).toBe(1);
    expect(res.filter((r) => r.status === 409).every((r) => r.body.error.code === 'OUT_OF_STOCK')).toBe(true);
    expect((await stockOf(p._id)).reserved).toBe(1);
    expect(await Order.countDocuments()).toBe(1);
  });
  it('is idempotent on the Idempotency-Key, and requires one', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 5 });
    const c = await customer(app); const k = key();
    const first = await buy(c, [[String(p._id), 1]], {}, k);
    const again = await c.post('/api/v1/checkout', { ...CHECKOUT }, { 'Idempotency-Key': k });
    expect(again.status).toBe(200); expect(again.body.order.id).toBe(first.body.order.id);
    expect(await Order.countDocuments()).toBe(1);
    expect((await stockOf(p._id)).reserved).toBe(1);
    expect((await c.post('/api/v1/checkout', CHECKOUT)).body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('rejects invalid input and empty carts; guests cannot check out', async () => {
    const c = await customer(app);
    expect((await c.post('/api/v1/checkout', CHECKOUT, { 'Idempotency-Key': key() })).body.error.code).toBe('EMPTY_CART');
    expect((await c.post('/api/v1/checkout', { ...CHECKOUT, address: { ...ADDRESS, postalCode: '12' } }, { 'Idempotency-Key': key() })).status).toBe(422);
    const { client: mk } = await import('./helpers.js');
    expect((await (await mk(app)).post('/api/v1/checkout', CHECKOUT, { 'Idempotency-Key': key() })).status).toBe(401);
  });
  it('failed payment can be retried', async () => {
    const p = await makeProduct((await makeCreator())._id);
    const c = await customer(app);
    const oid = (await buy(c, [[String(p._id), 1]])).body.order.id;
    await pay(c, oid, 'failure');
    expect((await Order.findById(oid))!.status).toBe('payment_failed');
    expect((await c.post(`/api/v1/orders/${oid}/pay`)).status).toBe(200);
    expect((await Order.findById(oid))!.status).toBe('pending_payment');
    await pay(c, oid);
    expect((await Order.findById(oid))!.status).toBe('paid');
  });
});

describe('coupons', () => {
  const mk = (o: object = {}) => Coupon.create({ code: 'WELCOME10', type: 'percent', value: 10, startsAt: new Date(Date.now() - 1e6), endsAt: new Date(Date.now() + 1e6), usageLimit: 5, ...o });
  it('applies a percent discount without reducing creator earnings', async () => {
    await mk(); const p = await makeProduct((await makeCreator())._id);
    const c = await customer(app);
    const r = await buy(c, [[String(p._id), 1]], { couponCode: 'welcome10' });
    expect(r.body.order.discountPaise).toBe(5990);
    expect(r.body.order.totalPaise).toBe(59900 - 5990);
    await pay(c, r.body.order.id);
    expect((await CreatorEarning.findOne())!.grossPaise).toBe(40000);
    expect((await Coupon.findOne())!.usedCount).toBe(1);
  });
  it('rejects expired, exhausted and per-user-exceeded codes, and unsafe-margin discounts (rolling back stock)', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 3 });
    const c = await customer(app);
    await mk({ code: 'OLD', endsAt: new Date(Date.now() - 1000) });
    expect((await buy(c, [[String(p._id), 1]], { couponCode: 'OLD' })).body.error.code).toBe('COUPON_INVALID');
    await mk({ code: 'BIG', type: 'percent', value: 50 }); // 50% of 599 > 199 margin
    expect((await c.post('/api/v1/checkout', { ...CHECKOUT, couponCode: 'BIG' }, { 'Idempotency-Key': key() })).body.error.code).toBe('DISCOUNT_EXCEEDS_MARGIN');
    expect((await stockOf(p._id)).reserved).toBe(0); // reservation rolled back with the failed order
    await mk({ code: 'ONCE', value: 5 });
    expect((await c.post('/api/v1/checkout', { ...CHECKOUT, couponCode: 'ONCE' }, { 'Idempotency-Key': key() })).status).toBe(201);
    await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 1 });
    expect((await c.post('/api/v1/checkout', { ...CHECKOUT, couponCode: 'ONCE' }, { 'Idempotency-Key': key() })).body.error.code).toBe('COUPON_INVALID');
  });
});

describe('cancellation & expiry', () => {
  it('cancelling an unpaid order releases stock and coupon use', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 2 }); const c = await customer(app);
    const oid = (await buy(c, [[String(p._id), 2]])).body.order.id;
    expect((await stockOf(p._id)).reserved).toBe(2);
    expect((await c.post(`/api/v1/orders/${oid}/cancel`)).status).toBe(200);
    expect(await stockOf(p._id)).toEqual({ stock: 2, reserved: 0, sold: 0 });
    expect((await c.post(`/api/v1/orders/${oid}/cancel`)).status).toBe(409);
  });
  it('paid orders cannot be cancelled through the unpaid path', async () => {
    const p = await makeProduct((await makeCreator())._id); const c = await customer(app);
    const oid = (await buy(c, [[String(p._id), 1]])).body.order.id; await pay(c, oid);
    expect((await c.post(`/api/v1/orders/${oid}/cancel`)).status).toBe(409);
  });
  it('sweeper returns expired reservations; a late payment is flagged for refund and never fulfilled', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 1 }); const c = await customer(app);
    const oid = (await buy(c, [[String(p._id), 1]])).body.order.id;
    await Order.updateOne({ _id: oid }, { stockReservedUntil: new Date(Date.now() - 1000) });
    expect(await expireReservations()).toBe(1);
    expect(await stockOf(p._id)).toEqual({ stock: 1, reserved: 0, sold: 0 });
    expect((await Order.findById(oid))!.status).toBe('cancelled');
    expect(await InventoryMovement.countDocuments({ type: 'release' })).toBe(1);
    await expect(cancelUnpaidOrder(oid)).rejects.toThrow();
  });
  it('payment arriving for a closed order does not create earnings', async () => {
    const { confirmPayment } = await import('../services/payments.js');
    const p = await makeProduct((await makeCreator())._id); const c = await customer(app);
    const r = await buy(c, [[String(p._id), 1]]);
    await Order.updateOne({ _id: r.body.order.id }, { stockReservedUntil: new Date(Date.now() - 1000) });
    await expireReservations();
    const out = await confirmPayment({ providerOrderId: r.body.payment.providerOrderId, providerPaymentId: 'late1', eventId: 'e-late', provider: 'mock' });
    expect(out.needsManualRefund).toBe(true);
    expect(await CreatorEarning.countDocuments()).toBe(0);
    expect((await Order.findById(r.body.order.id))!.status).toBe('cancelled');
  });
});

describe('order access control', () => {
  it("other customers' orders are 404, anonymous is 401", async () => {
    const p = await makeProduct((await makeCreator())._id);
    const owner = await customer(app); const other = await customer(app);
    const oid = (await buy(owner, [[String(p._id), 1]])).body.order.id;
    expect((await owner.get(`/api/v1/orders/${oid}`)).status).toBe(200);
    expect((await other.get(`/api/v1/orders/${oid}`)).status).toBe(404);
    expect((await other.post(`/api/v1/orders/${oid}/cancel`)).status).toBe(404);
    expect((await other.post(`/api/v1/orders/${oid}/pay`)).status).toBe(404);
    expect((await other.get('/api/v1/orders')).body.items.length).toBe(0);
    const { client: mk } = await import('./helpers.js');
    expect((await (await mk(app)).get(`/api/v1/orders/${oid}`)).status).toBe(401);
  });
});

describe('admin order management', () => {
  async function paid() {
    const p = await makeProduct((await makeCreator())._id, { stock: 5 }); const c = await customer(app);
    const r = await buy(c, [[String(p._id), 2]]); await pay(c, r.body.order.id);
    return { oid: r.body.order.id as string, c, p };
  }
  it('non-admins are blocked', async () => {
    const { oid, c } = await paid();
    expect((await c.get('/api/v1/admin/orders')).status).toBe(403);
    expect((await c.patch(`/api/v1/admin/orders/${oid}/status`, { status: 'processing' })).status).toBe(403);
  });
  it('enforces valid transitions, shipment details, and blocks payment-derived states', async () => {
    const { oid } = await paid(); const a = await admin(app);
    const url = `/api/v1/admin/orders/${oid}/status`;
    expect((await a.patch(url, { status: 'paid' })).status).toBe(422);
    expect((await a.patch(url, { status: 'delivered' })).body.error.code).toBe('INVALID_ORDER_TRANSITION');
    expect((await a.patch(url, { status: 'processing' })).status).toBe(200);
    expect((await a.patch(url, { status: 'shipped' })).body.error.code).toBe('SHIPMENT_REQUIRED');
    expect((await a.patch(url, { status: 'shipped', shipment: { provider: 'DTDC', trackingNumber: 'D123' } })).status).toBe(200);
    expect((await a.patch(url, { status: 'delivered' })).status).toBe(200);
    const o = (await Order.findById(oid))!;
    expect(o.shipment!.trackingNumber).toBe('D123'); expect(o.shipment!.deliveredAt).toBeTruthy();
    expect(o.history.length).toBeGreaterThanOrEqual(4);
  });
  it('paid orders cannot be cancelled without a refund', async () => {
    const { oid } = await paid(); const a = await admin(app);
    expect((await a.patch(`/api/v1/admin/orders/${oid}/status`, { status: 'cancelled' })).body.error.code).toBe('REFUND_REQUIRED');
  });
  it('refunds are idempotent, adjust earnings, and real-money orders need a provider reference', async () => {
    const { oid } = await paid(); const a = await admin(app);
    const item = (await a.get(`/api/v1/admin/orders/${oid}`)).body.order.items[0];
    const body = { lines: [{ orderItemId: item.id, quantity: 1 }], reason: 'damaged in transit' };
    const k = { 'Idempotency-Key': 'refund-key-1' };
    const r1 = await a.post(`/api/v1/admin/orders/${oid}/refund`, body, k); const r2 = await a.post(`/api/v1/admin/orders/${oid}/refund`, body, k);
    expect([r1.status, r2.status]).toEqual([201, 200]); expect(r2.body.alreadyProcessed).toBe(true);
    expect((await CreatorEarning.findOne())!.adjustmentPaise).toBe(-40000);
    expect((await Order.findById(oid))!.status).toBe('partially_refunded');
    await Order.updateOne({ _id: oid }, { isSimulated: false });
    expect((await a.post(`/api/v1/admin/orders/${oid}/refund`, body, { 'Idempotency-Key': 'refund-key-2' })).body.error.code).toBe('PROVIDER_REFUND_REQUIRED');
  });
});
