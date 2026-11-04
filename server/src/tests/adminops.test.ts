import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AuditLog, Coupon, FinancialLedgerEntry, NewsletterSubscription, Order, OrderItem, Product, StoreSettings } from '../models/index.js';
import { makeCreator } from './fixtures.js';
import { admin, asCreator, buy, client, customer, productBody } from './helpers.js';

const app = createApp();
const pay = (c: any, id: string) => c.post('/api/v1/payments/mock/confirm', { orderId: id, outcome: 'success' });
async function live(name = 'Brass Leaf Pendant') {
  const cc = await asCreator(app, await makeCreator('Asha')); const a = await admin(app);
  const r = await cc.post('/api/v1/creator/products', await productBody(cc, { name })); const id = r.body.product.id as string;
  await cc.post(`/api/v1/creator/products/${id}/submit`);
  await a.post(`/api/v1/admin/products/${id}/review`, { action: 'approve', sellingPricePaise: 89900, creatorAmountPaise: 60000, publish: true });
  return { cc, a, id };
}
async function sale(id: string, qty = 2) { const b = await customer(app); const o = await buy(b, [[id, qty]]); await pay(b, o.body.order.id); return { b, oid: o.body.order.id as string }; }

const ENDPOINTS: [string, string][] = [['get', '/admin/overview'], ['get', '/admin/audit'], ['get', '/admin/reports'], ['get', '/admin/reports/orders'], ['get', '/admin/coupons'], ['get', '/admin/settings'], ['get', '/admin/newsletter']];
describe('access control', () => {
  it('every admin-ops route rejects anonymous (401), customers and creators (403)', async () => {
    const anon = await client(app); const cust = await customer(app); const cr = await asCreator(app, await makeCreator());
    for (const [, url] of ENDPOINTS) {
      expect((await anon.get(`/api/v1${url}`)).status, url).toBe(401);
      expect((await cust.get(`/api/v1${url}`)).status, url).toBe(403);
      expect((await cr.get(`/api/v1${url}`)).status, url).toBe(403);
    }
    expect((await cust.post('/api/v1/admin/coupons', {})).status).toBe(403);
    expect((await cust.put('/api/v1/admin/settings', {})).status).toBe(403);
  });
});

describe('overview', () => {
  it('computes defined metrics from real records and keeps simulated money separate from live', async () => {
    await StoreSettings.create({ shipping: { flatRatePaise: 6000 } });
    const { a, id } = await live(); const { oid } = await sale(id, 2);
    let o = (await a.get('/api/v1/admin/overview')).body;
    expect(o.live).toMatchObject({ orders: 0, gmvPaise: 0, platformRevenuePaise: 0 });
    expect(o.simulated).toMatchObject({ orders: 1, gmvPaise: 2 * 89900 + 6000, refundsPaise: 0, netSalesPaise: 2 * 89900 + 6000, creatorPayablePaise: 120000, creatorSettledPaise: 0, platformRevenuePaise: 2 * 89900 - 120000 });
    expect(o.counts).toMatchObject({ publishedProducts: 1, activeCreators: 1, productsAwaitingApproval: 0 });
    expect(o.ordersByStatus.paid).toBe(1);
    expect(o.definitions.platformRevenue).toMatch(/NOT profit/);
    // refund one unit: net sales drop, creator payable drops by the agreed amount, margin absorbs the rest
    const item = (await OrderItem.findOne({ order: oid }))!;
    await a.post(`/api/v1/admin/orders/${oid}/refund`, { lines: [{ orderItemId: String(item._id), quantity: 1 }], reason: 'return' }, { 'Idempotency-Key': 'ov-refund-1' });
    o = (await a.get('/api/v1/admin/overview')).body;
    expect(o.simulated).toMatchObject({ refundsPaise: 89900, netSalesPaise: 2 * 89900 + 6000 - 89900, creatorPayablePaise: 60000, platformRevenuePaise: (2 * 89900 - 120000) - (89900 - 60000) });
    // flipping the records to "live" moves the same numbers to the live side
    await Order.updateOne({ _id: oid }, { isSimulated: false });
    await FinancialLedgerEntry.collection.updateMany({}, { $set: { isSimulated: false } }); // raw driver: test-only bypass of immutability
    o = (await a.get('/api/v1/admin/overview')).body;
    expect(o.simulated).toMatchObject({ orders: 0, gmvPaise: 0 }); expect(o.live.orders).toBe(1); expect(o.live.creatorPayablePaise).toBe(60000);
  });
  it('payouts move money from payable to settled; date filters and validation work', async () => {
    const { a, id } = await live(); const { oid } = await sale(id, 1);
    await Order.updateOne({ _id: oid }, { 'shipment.deliveredAt': new Date(Date.now() - 10 * 86_400_000) });
    const { promoteEligibleEarnings } = await import('../services/earnings.js'); await promoteEligibleEarnings(new Date(), 7);
    const bal = (await a.get('/api/v1/admin/payouts/balances')).body.items[0];
    const pid = (await a.post('/api/v1/admin/payouts', { creatorId: bal.creatorId })).body.payout.id;
    await a.post(`/api/v1/admin/payouts/${pid}/approve`); await a.post(`/api/v1/admin/payouts/${pid}/pay`, { reference: 'UTR-OV-1' });
    const o = (await a.get('/api/v1/admin/overview')).body.simulated;
    expect(o.creatorPayablePaise).toBe(0); expect(o.creatorSettledPaise).toBe(60000);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await a.get(`/api/v1/admin/overview?from=${tomorrow}`)).body.simulated.orders).toBe(0);
    expect((await a.get('/api/v1/admin/overview?from=not-a-date')).status).toBe(422);
    expect((await a.get('/api/v1/admin/overview?from=2026-12-31&to=2026-01-01')).body.error.code).toBe('INVALID_RANGE');
  });
});

describe('reports', () => {
  it('orders report omits customer personal data; CSV is injection-safe and exports are audited', async () => {
    const { a, id } = await live('=SUM(1+1)'); const { b } = await sale(id, 1);
    const csv = (await a.get('/api/v1/admin/reports/orders?format=csv')).text;
    expect(csv).toMatch(/CC-/); expect(csv).toContain('Hyderabad'); expect(csv).toContain('Telangana');
    expect(csv).not.toContain(b.email); expect(csv).not.toMatch(/Meera|9876543210|Lake View/);
    const ps = (await a.get('/api/v1/admin/reports/product-sales?format=csv')).text;
    expect(ps).toContain("'=SUM(1+1)"); // formula neutralised
    expect((await AuditLog.countDocuments({ action: 'report.exported' }))).toBe(2);
  });
  it('product-sales, creator-performance, inventory and platform-revenue reconcile with the sale', async () => {
    const { a, id } = await live(); await sale(id, 2);
    const json = async (t: string) => (await a.get(`/api/v1/admin/reports/${t}`)).body;
    const ps = await json('product-sales'); expect(ps.rows[0].slice(2)).toEqual([2, 1798, 1200]);
    const cp = await json('creator-performance'); expect(cp.rows[0].slice(1)).toEqual([1, 2, 1798, 1200, 598]);
    const inv = await json('inventory'); expect(inv.rows[0].slice(4, 7)).toEqual([3, 0, 3]); // 5 stock - 2 sold
    const pr = await json('platform-revenue'); expect(pr.rows.find((r: any[]) => r[1] === 'Gross margin')![3]).toBe(598);
    const er = await json('creator-earnings'); expect(er.rows[0][5]).toBe(1200);
    expect((await a.get('/api/v1/admin/reports/nope')).status).toBe(404);
    expect((await a.get('/api/v1/admin/reports')).body.reports).toContain('refunds');
  });
  it('date range limits rows', async () => {
    const { a, id } = await live(); await sale(id, 1);
    expect((await a.get('/api/v1/admin/reports/orders?from=2020-01-01&to=2020-01-31')).body.total).toBe(0);
    expect((await a.get('/api/v1/admin/reports/orders?from=2020-01-01')).body.total).toBe(1);
  });
});

describe('coupons', () => {
  const valid = () => ({ code: 'diwali10', type: 'percent', value: 10, startsAt: new Date(Date.now() - 1e6).toISOString(), endsAt: new Date(Date.now() + 864e5).toISOString(), usageLimit: 2 });
  it('validates input, stores codes upper-case, rejects duplicates, and freezes code/type/value', async () => {
    const a = await admin(app);
    expect((await a.post('/api/v1/admin/coupons', { ...valid(), value: 150 })).status).toBe(422);
    expect((await a.post('/api/v1/admin/coupons', { ...valid(), type: 'fixed', value: 50 })).status).toBe(422);
    expect((await a.post('/api/v1/admin/coupons', { ...valid(), endsAt: new Date(Date.now() - 5e6).toISOString() })).status).toBe(422);
    expect((await a.post('/api/v1/admin/coupons', { ...valid(), code: 'bad code!' })).status).toBe(422);
    const r = await a.post('/api/v1/admin/coupons', valid()); expect(r.status).toBe(201);
    expect((await Coupon.findById(r.body.id))!.code).toBe('DIWALI10');
    expect((await a.post('/api/v1/admin/coupons', valid())).status).toBe(409);
    expect((await a.patch(`/api/v1/admin/coupons/${r.body.id}`, { value: 99 })).status).toBe(422);
    expect((await AuditLog.countDocuments({ action: 'coupon.created' }))).toBe(1);
  });
  it('a created code works at checkout; deactivating stops it; usage limit cannot go below uses', async () => {
    const { a, id } = await live(); const cid = (await a.post('/api/v1/admin/coupons', valid())).body.id;
    const b = await customer(app); await b.put('/api/v1/cart/items', { productId: id, quantity: 1 });
    expect((await b.post('/api/v1/checkout/quote', { couponCode: 'DIWALI10' })).body.discountPaise).toBe(8990);
    const o = await buy(b, [], { couponCode: 'DIWALI10' }, 'coupon-flow-key-1'); expect(o.body.order.discountPaise).toBe(8990);
    expect((await a.patch(`/api/v1/admin/coupons/${cid}`, { usageLimit: 1 })).status).toBe(200);
    expect((await a.patch(`/api/v1/admin/coupons/${cid}`, { usageLimit: 0 })).status).toBe(422);
    await a.patch(`/api/v1/admin/coupons/${cid}`, { active: false });
    const c2 = await customer(app); await c2.put('/api/v1/cart/items', { productId: id, quantity: 1 });
    expect((await c2.post('/api/v1/checkout/quote', { couponCode: 'DIWALI10' })).body.couponError).toMatch(/not valid/);
  });
});

describe('settings', () => {
  it('updates shipping/announcement, flows to the storefront and quote, and is audited with before/after', async () => {
    const a = await admin(app); const { id } = await live(); const b = await customer(app);
    expect((await a.put('/api/v1/admin/settings', { announcement: { enabled: true, text: 'Festive sale', link: 'https://evil.example' } })).status).toBe(422);
    expect((await a.put('/api/v1/admin/settings', { codEnabled: true })).status).toBe(422); // COD is not implemented, so it cannot be switched on
    expect((await a.put('/api/v1/admin/settings', { announcement: { enabled: true, text: 'Festive sale', link: '/shop' }, shipping: { flatRatePaise: 9900, freeAboveCartPaise: 500000 } })).status).toBe(200);
    const store = (await b.get('/api/v1/store')).body; expect(store.announcement.text).toBe('Festive sale'); expect(store.shipping.flatRatePaise).toBe(9900);
    await b.put('/api/v1/cart/items', { productId: id, quantity: 1 });
    expect((await b.post('/api/v1/checkout/quote', {})).body.shippingPaise).toBe(9900);
    const log = (await AuditLog.findOne({ action: 'settings.updated' }))!; expect(log.after).toMatchObject({ shipping: { flatRatePaise: 9900 } });
    expect((await a.get('/api/v1/admin/settings')).body.settings.shipping.freeAboveCartPaise).toBe(500000);
  });
});

describe('audit log & newsletter', () => {
  it('audit viewer lists and filters entries and offers no way to change them', async () => {
    const { a } = await live();
    const all = (await a.get('/api/v1/admin/audit')).body; expect(all.total).toBeGreaterThanOrEqual(3);
    const f = (await a.get('/api/v1/admin/audit?action=product.')).body; expect(f.items.every((x: any) => x.action.startsWith('product.'))).toBe(true);
    expect((await a.patch(`/api/v1/admin/audit/${all.items[0].id}`, { note: 'x' })).status).toBe(404);
    expect((await a.del(`/api/v1/admin/audit/${all.items[0].id}`)).status).toBe(404);
  });
  it('newsletter export lists active subscribers and is itself audited', async () => {
    const a = await admin(app); await NewsletterSubscription.create([{ email: 'a@example.com' }, { email: 'b@example.com', active: false }]);
    expect((await a.get('/api/v1/admin/newsletter')).body.total).toBe(1);
    const csv = (await a.get('/api/v1/admin/newsletter?format=csv')).text; expect(csv).toContain('a@example.com'); expect(csv).not.toContain('b@example.com');
    expect(await AuditLog.countDocuments({ action: 'newsletter.exported' })).toBe(1);
  });
});
export { Product };

describe('payout simulation flag', () => {
  it('real and simulated earnings are never mixed in one payout batch', async () => {
    const { createPayoutDraft } = await import('../services/payouts.js'); const { CreatorEarning, Payout } = await import('../models/index.js');
    const { makePaidOrder } = await import('./fixtures.js'); const { recordSaleFromPaidOrder } = await import('../services/earnings.js');
    const { Types } = await import('mongoose'); const c = await makeCreator('Mixed'); const actor = new Types.ObjectId();
    for (const simulated of [true, false]) { const { order } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }], { simulated }); await recordSaleFromPaidOrder(order._id); }
    await CreatorEarning.updateMany({}, { status: 'eligible' });
    const first = await createPayoutDraft(c._id, actor); expect([first.isSimulated, first.earnings.length]).toEqual([false, 1]); // real money first
    const second = await createPayoutDraft(c._id, actor); expect([second.isSimulated, second.earnings.length]).toEqual([true, 1]);
    expect(await Payout.countDocuments()).toBe(2);
  });
});
