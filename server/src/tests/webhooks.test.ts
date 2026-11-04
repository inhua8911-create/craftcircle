import './razorpayEnv.js'; // must stay first
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { AuditLog, CreatorEarning, Order, Payment, Product } from '../models/index.js';
import { makeCreator, makeProduct } from './fixtures.js';
import { buy, customer } from './helpers.js';

const { createApp } = await import('../app.js');
const app = createApp();
const WH = 'webhook-secret-for-tests';
const sign = (raw: string, secret = WH) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const event = (type: string, orderId: string, payId: string, amount: number) => JSON.stringify({ event: type, payload: { payment: { entity: { id: payId, order_id: orderId, amount, error_description: 'declined' } } } });
const hook = (raw: string, sig: string | undefined, eventId: string = crypto.randomUUID()) => {
  const r = request(app).post('/api/v1/payments/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-event-id', eventId);
  if (sig) r.set('x-razorpay-signature', sig);
  return r.send(raw);
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: `order_${crypto.randomBytes(5).toString('hex')}` }), { status: 200 })));
});

async function pendingOrder(qty = 1) {
  const p = await makeProduct((await makeCreator())._id, { stock: 5 });
  const c = await customer(app);
  const r = await buy(c, [[String(p._id), qty]]);
  expect(r.status).toBe(201);
  expect(r.body.payment.simulated).toBe(false);
  expect(r.body.payment.keyId).toBe('rzp_test_dummy');
  expect(JSON.stringify(r.body)).not.toMatch(/key-secret|webhook-secret/);
  return { p, c, oid: r.body.order.id as string, rzpOrder: r.body.payment.providerOrderId as string, total: r.body.order.totalPaise as number };
}

describe('razorpay webhooks', () => {
  it('rejects missing, wrong and tampered signatures and changes nothing', async () => {
    const { rzpOrder, total, oid } = await pendingOrder();
    const raw = event('payment.captured', rzpOrder, 'pay_1', total);
    expect((await hook(raw, undefined)).status).toBe(401);
    expect((await hook(raw, sign(raw, 'wrong-secret'))).status).toBe(401);
    expect((await hook(raw.replace('pay_1', 'pay_2'), sign(raw))).status).toBe(401); // body altered after signing
    expect((await Order.findById(oid))!.status).toBe('pending_payment');
    expect(await CreatorEarning.countDocuments()).toBe(0);
  });
  it('a valid captured event marks the order paid exactly once, even if delivered repeatedly or concurrently', async () => {
    const { rzpOrder, total, oid, p } = await pendingOrder(2);
    const raw = event('payment.captured', rzpOrder, 'pay_ok', total);
    const rs = await Promise.all([hook(raw, sign(raw), 'evt-1'), hook(raw, sign(raw), 'evt-1'), hook(raw, sign(raw), 'evt-2')]);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const o = (await Order.findById(oid))!;
    expect([o.status, o.paymentStatus, o.isSimulated]).toEqual(['paid', 'paid', false]);
    expect(await CreatorEarning.countDocuments()).toBe(1);
    const prod = (await Product.findById(p._id))!;
    expect([prod.stock, prod.reserved, prod.soldCount]).toEqual([3, 0, 2]); // stock decremented once
    expect((await Payment.findOne({ order: oid }))!.providerPaymentId).toBe('pay_ok');
  });
  it('does not trust an amount that differs from our order total', async () => {
    const { rzpOrder, oid } = await pendingOrder();
    const raw = event('payment.captured', rzpOrder, 'pay_cheap', 100);
    expect((await hook(raw, sign(raw))).status).toBe(200);
    expect((await Order.findById(oid))!.status).toBe('pending_payment');
    expect(await CreatorEarning.countDocuments()).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'payment.amount_mismatch' })).toBe(1);
  });
  it('payment.failed moves the order to payment_failed but never overrides a captured payment', async () => {
    const a = await pendingOrder();
    const f = event('payment.failed', a.rzpOrder, 'pay_f', a.total);
    await hook(f, sign(f));
    expect((await Order.findById(a.oid))!.status).toBe('payment_failed');
    const b = await pendingOrder();
    const ok = event('payment.captured', b.rzpOrder, 'pay_b', b.total); await hook(ok, sign(ok));
    const late = event('payment.failed', b.rzpOrder, 'pay_b2', b.total); await hook(late, sign(late));
    expect((await Order.findById(b.oid))!.status).toBe('paid');
  });
  it('unknown events are acknowledged and ignored', async () => {
    const raw = JSON.stringify({ event: 'refund.created', payload: {} });
    expect((await hook(raw, sign(raw))).status).toBe(200);
  });
});

describe('razorpay checkout-return verification', () => {
  it('accepts a correct signature and rejects forged ones', async () => {
    const { c, oid, rzpOrder } = await pendingOrder();
    const body = (sig: string) => ({ orderId: oid, razorpay_order_id: rzpOrder, razorpay_payment_id: 'pay_v', razorpay_signature: sig });
    expect((await c.post('/api/v1/payments/razorpay/verify', body('0'.repeat(64)))).body.error.code).toBe('INVALID_SIGNATURE');
    expect((await Order.findById(oid))!.status).toBe('pending_payment');
    const good = crypto.createHmac('sha256', 'key-secret-for-tests').update(`${rzpOrder}|pay_v`).digest('hex');
    expect((await c.post('/api/v1/payments/razorpay/verify', body(good))).status).toBe(200);
    expect((await Order.findById(oid))!.status).toBe('paid');
  });
  it("another customer cannot verify (or probe) someone else's payment", async () => {
    const { oid, rzpOrder } = await pendingOrder();
    const other = await customer(app);
    const good = crypto.createHmac('sha256', 'key-secret-for-tests').update(`${rzpOrder}|pay_x`).digest('hex');
    expect((await other.post('/api/v1/payments/razorpay/verify', { orderId: oid, razorpay_order_id: rzpOrder, razorpay_payment_id: 'pay_x', razorpay_signature: good })).status).toBe(404);
  });
  it('mock confirmation is unavailable when real payments are selected', async () => {
    const { c, oid } = await pendingOrder();
    expect((await c.post('/api/v1/payments/mock/confirm', { orderId: oid, outcome: 'success' })).status).toBe(404);
    expect((await Order.findById(oid))!.status).toBe('pending_payment');
  });
  it('provider outage surfaces as a clean 502 and leaves no payment record', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const p = await makeProduct((await makeCreator())._id); const c = await customer(app);
    const r = await buy(c, [[String(p._id), 1]]);
    expect(r.status).toBe(502); expect(r.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect(await Payment.countDocuments()).toBe(0);
  });
});
