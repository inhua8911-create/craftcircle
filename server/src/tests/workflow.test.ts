import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { CreatorEarning, CreatorIncentive, CreatorProfile, Notification, Order, OrderItem, Product, ProductPricingHistory, User } from '../models/index.js';
import { promoteEligibleEarnings } from '../services/earnings.js';
import { makeCreator, makeProduct } from './fixtures.js';
import { admin, asCreator, buy, cleanUploads, client, customer, key, PNG, productBody, uploadPng } from './helpers.js';

const app = createApp();
afterAll(cleanUploads);
const pay = (c: any, orderId: string) => c.post('/api/v1/payments/mock/confirm', { orderId, outcome: 'success' });

async function newCreatorProduct(cc: any, over: object = {}) {
  const r = await cc.post('/api/v1/creator/products', await productBody(cc, over));
  expect(r.status).toBe(201);
  return r.body.product.id as string;
}
async function liveProduct(selling = 89900, creatorAmt = 60000) {
  const profile = await makeCreator('Asha'); const cc = await asCreator(app, profile); const a = await admin(app);
  const id = await newCreatorProduct(cc);
  expect((await cc.post(`/api/v1/creator/products/${id}/submit`)).status).toBe(200);
  const r = await a.post(`/api/v1/admin/products/${id}/review`, { action: 'approve', sellingPricePaise: selling, creatorAmountPaise: creatorAmt, publish: true });
  expect(r.status).toBe(200);
  return { profile, cc, a, id };
}

describe('uploads', () => {
  it('accepts real images; rejects disguised files, oversize files, anonymous uploads', async () => {
    const c = await customer(app);
    await uploadPng(c);
    const svg = await c.agent.post('/api/v1/uploads/images').set('x-csrf-token', c.csrf).attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'evil.png');
    expect(svg.status).toBe(415);
    const big = await c.agent.post('/api/v1/uploads/images').set('x-csrf-token', c.csrf).attach('file', Buffer.concat([PNG(), Buffer.alloc(6 * 1024 * 1024)]), 'big.png');
    expect(big.status).toBe(413);
    expect((await c.agent.post('/api/v1/uploads/images').set('x-csrf-token', c.csrf)).status).toBe(400);
    const anon = await client(app);
    expect((await anon.agent.post('/api/v1/uploads/images').set('x-csrf-token', anon.csrf).attach('file', PNG(), 'a.png')).status).toBe(401);
  });
});

describe('creator application', () => {
  const body = (images: string[]) => ({ fullName: 'Lakshmi Iyer', email: 'lakshmi@example.com', phone: '9876543210', city: 'Chennai', state: 'Tamil Nadu', categories: ['Home Décor'], bio: 'I make macramé wall hangings and wooden name plates by hand.', sampleImages: images, confirmsHandmade: true, acceptedTerms: true });
  it('draft -> incomplete submit rejected -> submit -> admin approves -> creator portal opens', async () => {
    const c = await customer(app); const a = await admin(app);
    expect((await c.post('/api/v1/creator/application', { fullName: 'Lakshmi' })).body.application.status).toBe('draft');
    expect((await c.post('/api/v1/creator/application', { submit: true })).status).toBe(422);
    expect((await c.post('/api/v1/creator/application', { sampleImages: ['https://tracker.example/x.png'] })).body.error.code).toBe('INVALID_IMAGE');
    const sub = await c.post('/api/v1/creator/application', { ...body([await uploadPng(c)]), submit: true });
    expect(sub.status).toBe(201); expect(sub.body.application.status).toBe('submitted');
    expect((await c.post('/api/v1/creator/application', { submit: true })).status).toBe(409);
    expect((await c.get('/api/v1/creator/products')).status).toBe(403); // not a creator yet

    const id = sub.body.application.id;
    expect((await c.post(`/api/v1/admin/applications/${id}/decision`, { status: 'approved' })).status).toBe(403);
    expect((await a.post(`/api/v1/admin/applications/${id}/decision`, { status: 'rejected' })).status).toBe(422); // note required
    expect((await a.post(`/api/v1/admin/applications/${id}/decision`, { status: 'approved' })).status).toBe(200);
    expect((await a.post(`/api/v1/admin/applications/${id}/decision`, { status: 'rejected', note: 'too late' })).status).toBe(409);
    expect((await User.findById(c.userId))!.role).toBe('creator');
    expect((await c.get('/api/v1/creator/dashboard')).status).toBe(200);
    expect((await Notification.countDocuments({ user: c.userId, type: 'application_approved' }))).toBe(1);
  });
  it('rejected applicants can re-apply; more-info requests allow edits and resubmission', async () => {
    const c = await customer(app); const a = await admin(app);
    const first = await c.post('/api/v1/creator/application', { ...body([await uploadPng(c)]), submit: true });
    await a.post(`/api/v1/admin/applications/${first.body.application.id}/decision`, { status: 'more_info_requested', note: 'Please add more photos' });
    const again = await c.post('/api/v1/creator/application', { bio: 'I make macramé wall hangings, planters and wooden name plates by hand.', submit: true });
    expect(again.status).toBe(201);
    await a.post(`/api/v1/admin/applications/${first.body.application.id}/decision`, { status: 'rejected', note: 'Not a fit right now' });
    expect((await c.get('/api/v1/creator/application')).body.application.decisions.at(-1).note).toBe('Not a fit right now');
    const re = await c.post('/api/v1/creator/application', { ...body([await uploadPng(c)]), submit: true });
    expect(re.status).toBe(201); expect(re.body.application.id).not.toBe(first.body.application.id);
  });
  it('staff accounts cannot apply; admins never get downgraded by approval', async () => {
    const a = await admin(app);
    expect((await a.post('/api/v1/creator/application', { fullName: 'x' })).status).toBe(409);
  });
});

describe('product approval pipeline', () => {
  it('draft -> submit -> review -> publish; storefront shows ADMIN-approved terms and hides creator numbers', async () => {
    const { cc, id } = await liveProduct(89900, 60000);
    const pub = await (await customer(app)).get('/api/v1/products');
    expect(pub.body.items.length).toBe(1);
    expect(pub.body.items[0].pricePaise).toBe(89900);
    expect(JSON.stringify(pub.body)).not.toMatch(/creatorAmount|platformMargin|proposed|60000/);
    const mine = (await cc.get(`/api/v1/creator/products/${id}`)).body.product;
    expect(mine.status).toBe('published'); expect(mine.approvedCreatorAmountPaise).toBe(60000);
    expect(JSON.stringify(mine)).not.toMatch(/platformMargin/);
    expect(await ProductPricingHistory.countDocuments({ product: id })).toBe(1);
  });
  it('incomplete products cannot be submitted', async () => {
    const cc = await asCreator(app, await makeCreator());
    const r = await cc.post('/api/v1/creator/products', { name: 'Bare product', description: 'Just a description here', category: String((await (await import('./helpers.js')).anyCategory())._id) });
    const s = await cc.post(`/api/v1/creator/products/${r.body.product.id}/submit`);
    expect(s.status).toBe(422); expect(s.body.error.details.problems.length).toBeGreaterThanOrEqual(3);
  });
  it('creators cannot set status, final price, or touch other creators’ products', async () => {
    const cc = await asCreator(app, await makeCreator('A')); const other = await asCreator(app, await makeCreator('B'));
    const body = await productBody(cc);
    expect((await cc.post('/api/v1/creator/products', { ...body, status: 'published' })).status).toBe(422);
    expect((await cc.post('/api/v1/creator/products', { ...body, sellingPricePaise: 1 })).status).toBe(422);
    const id = await newCreatorProduct(cc);
    expect((await other.get(`/api/v1/creator/products/${id}`)).status).toBe(404);
    expect((await other.put(`/api/v1/creator/products/${id}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await other.post(`/api/v1/creator/products/${id}/submit`)).status).toBe(404);
    expect((await cc.post(`/api/v1/admin/products/${id}/review`, { action: 'approve' })).status).toBe(403);
    expect((await (await customer(app)).get('/api/v1/creator/products')).status).toBe(403);
  });
  it('is locked during review; feedback loop works', async () => {
    const cc = await asCreator(app, await makeCreator()); const a = await admin(app);
    const id = await newCreatorProduct(cc); await cc.post(`/api/v1/creator/products/${id}/submit`);
    expect((await cc.put(`/api/v1/creator/products/${id}`, { name: 'Sneaky edit' })).body.error.code).toBe('PRODUCT_LOCKED');
    expect((await a.post(`/api/v1/admin/products/${id}/review`, { action: 'request_changes' })).status).toBe(422);
    expect((await a.post(`/api/v1/admin/products/${id}/review`, { action: 'request_changes', note: 'Photo is blurry' })).status).toBe(200);
    expect((await cc.get(`/api/v1/creator/products/${id}`)).body.product.feedback[0].note).toBe('Photo is blurry');
    expect((await cc.put(`/api/v1/creator/products/${id}`, { images: [await uploadPng(cc)] })).status).toBe(200);
    expect((await cc.post(`/api/v1/creator/products/${id}/submit`)).status).toBe(200);
  });
  it('rejects invalid commercial terms and unpublishable products', async () => {
    const cc = await asCreator(app, await makeCreator()); const a = await admin(app);
    const id = await newCreatorProduct(cc); await cc.post(`/api/v1/creator/products/${id}/submit`);
    expect((await a.post(`/api/v1/admin/products/${id}/review`, { action: 'approve', sellingPricePaise: 50000, creatorAmountPaise: 60000 })).body.error.code).toBe('PRICING_INVALID');
    expect((await Product.findById(id))!.status).toBe('submitted');
    const ok = await a.post(`/api/v1/admin/products/${id}/review`, { action: 'approve' }); // defaults to the creator's proposal
    expect(ok.status).toBe(200);
    await Product.updateOne({ _id: id }, { $unset: { sellingPricePaise: 1 } });
    expect((await a.post(`/api/v1/admin/products/${id}/publish`)).body.error.code).toBe('PRICING_INCOMPLETE');
    expect((await (await customer(app)).get('/api/v1/products')).body.total).toBe(0);
  });
  it('material edits to a live product need acknowledgement and take it offline until re-approved', async () => {
    const { cc, a, id } = await liveProduct();
    const c = await customer(app);
    const r1 = await cc.put(`/api/v1/creator/products/${id}`, { name: 'Renamed pendant' });
    expect(r1.status).toBe(409); expect(r1.body.error.code).toBe('REAPPROVAL_REQUIRED');
    expect((await c.get('/api/v1/products')).body.total).toBe(1); // still live: nothing changed
    expect((await cc.put(`/api/v1/creator/products/${id}`, { dispatchDays: 4 })).body.reapprovalRequired).toBe(false); // non-material is direct
    const r2 = await cc.put(`/api/v1/creator/products/${id}`, { name: 'Renamed pendant', acknowledgeReapproval: true });
    expect(r2.body.reapprovalRequired).toBe(true);
    expect((await c.get('/api/v1/products')).body.total).toBe(0);
    expect((await a.post(`/api/v1/admin/products/${id}/review`, { action: 'approve', publish: true })).status).toBe(200);
    expect((await c.get('/api/v1/products')).body.total).toBe(1);
  });
  it('price changes are versioned and never rewrite existing orders', async () => {
    const { a, id } = await liveProduct(89900, 60000);
    const c = await customer(app);
    const o = await buy(c, [[id, 1]]); await pay(c, o.body.order.id);
    expect((await a.patch(`/api/v1/admin/products/${id}/pricing`, { sellingPricePaise: 99900, creatorAmountPaise: 65000, reason: 'material costs' })).body.changed).toBe(true);
    const item = (await OrderItem.findOne({ order: o.body.order.id }))!;
    expect([item.unitPricePaise, item.creatorAmountPerUnitPaise, item.pricingVersion]).toEqual([89900, 60000, 1]);
    const o2 = await buy(c, [[id, 1]]);
    expect(o2.body.order.totalPaise).toBe(99900);
    expect((await Product.findById(id))!.pricingVersion).toBe(2);
    expect((await a.patch(`/api/v1/admin/products/${id}/pricing`, { sellingPricePaise: 65000, creatorAmountPaise: 65000, reason: 'oops' })).status).toBe(422);
  });
  it('pause/resume/archive rules and stock safety', async () => {
    const { cc, id } = await liveProduct();
    expect((await cc.post(`/api/v1/creator/products/${id}/archive`)).body.error.code).toBe('CANNOT_ARCHIVE'); // must pause first
    const c = await customer(app); await buy(c, [[id, 3]]); // 3 reserved of 5
    expect((await cc.put(`/api/v1/creator/products/${id}`, { stock: 2 })).body.error.code).toBe('STOCK_BELOW_RESERVED');
    expect((await cc.put(`/api/v1/creator/products/${id}`, { stock: 10 })).status).toBe(200);
    expect((await cc.post(`/api/v1/creator/products/${id}/pause`)).status).toBe(200);
    expect((await (await customer(app)).get('/api/v1/products')).body.total).toBe(0);
    expect((await cc.post(`/api/v1/creator/products/${id}/resume`)).status).toBe(200);
    await cc.post(`/api/v1/creator/products/${id}/pause`);
    expect((await cc.post(`/api/v1/creator/products/${id}/archive`)).status).toBe(200);
    expect((await cc.post(`/api/v1/creator/products/${id}/resume`)).status).toBe(409);
  });
});

describe('creator dashboard, earnings and incentives', () => {
  it('metrics come from verified sales only and distinguish sales from earnings', async () => {
    const { cc, id } = await liveProduct(89900, 60000);
    const buyer = await customer(app);
    const o1 = await buy(buyer, [[id, 2]]); await pay(buyer, o1.body.order.id);
    const o2 = await buy(buyer, [[id, 1]]); await buyer.post(`/api/v1/orders/${o2.body.order.id}/cancel`); // cancelled: must not count
    await buy(buyer, [[id, 1]]); // left unpaid: must not count
    const d = (await cc.get('/api/v1/creator/dashboard')).body;
    expect(d.sales).toMatchObject({ unitsSold: 2, confirmedSalesPaise: 179800 });
    expect(d.earnings).toMatchObject({ pendingPaise: 120000, availablePaise: 0, paidOutPaise: 0 });
    expect(d.products.published).toBe(1);
    expect(d.topProducts[0]).toMatchObject({ units: 2 });
    expect(JSON.stringify(d.recentOrders)).not.toMatch(/email|address|phone|customer/i); // no customer PII for creators
    expect(d.definitions.confirmedSales).toBeTruthy();
  });
  it('refunds reduce sales and earnings; statements are itemised, private and CSV-safe', async () => {
    const { cc, a, id, profile } = await liveProduct(89900, 60000);
    await Product.updateOne({ _id: id }, { name: '=HYPERLINK("http://evil")' });
    const buyer = await customer(app);
    const o = await buy(buyer, [[id, 2]]); await pay(buyer, o.body.order.id);
    const item = (await OrderItem.findOne({ order: o.body.order.id }))!;
    await a.post(`/api/v1/admin/orders/${o.body.order.id}/refund`, { lines: [{ orderItemId: String(item._id), quantity: 1 }], reason: 'damaged' }, { 'Idempotency-Key': 'rf-12345' });
    const d = (await cc.get('/api/v1/creator/dashboard')).body;
    expect(d.sales.unitsSold).toBe(1);
    const st = (await cc.get('/api/v1/creator/earnings')).body;
    expect(st.items[0]).toMatchObject({ quantity: 2, amountPerUnitPaise: 60000, grossPaise: 120000, adjustmentPaise: -60000, remainingPaise: 60000, status: 'pending' });
    const csv = (await cc.get('/api/v1/creator/earnings?format=csv')).text;
    expect(csv).toContain("'=HYPERLINK"); // formula injection neutralised
    const other = await asCreator(app, await makeCreator('Other'));
    expect((await other.get('/api/v1/creator/earnings')).body.items).toEqual([]);
    void profile;
  });
  it('incentive progress is computed from real sales and reverts if sales are refunded', async () => {
    const { cc, a, id } = await liveProduct();
    await a.post('/api/v1/admin/incentives', { name: 'Two units bonus', description: 'Sell 2 units in the window.', metric: 'units_sold', threshold: 2, rewardPaise: 50000, startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await cc.get('/api/v1/creator/incentives')).body.items[0]).toMatchObject({ progress: 0, status: 'in_progress', threshold: 2 });
    const buyer = await customer(app); const o = await buy(buyer, [[id, 2]]); await pay(buyer, o.body.order.id);
    expect((await cc.get('/api/v1/creator/incentives')).body.items[0]).toMatchObject({ progress: 2, status: 'earned', rewardPaise: 50000 });
    const item = (await OrderItem.findOne({ order: o.body.order.id }))!;
    await a.post(`/api/v1/admin/orders/${o.body.order.id}/refund`, { lines: [{ orderItemId: String(item._id), quantity: 1 }], reason: 'return' }, { 'Idempotency-Key': 'rf-incent1' });
    expect((await cc.get('/api/v1/creator/incentives')).body.items[0]).toMatchObject({ progress: 1, status: 'in_progress' });
    expect((await CreatorIncentive.findOne())!.status).toBe('in_progress');
  });
});

describe('admin creators & payouts', () => {
  async function eligibleSale() {
    const { profile, cc, a, id } = await liveProduct(89900, 60000);
    const buyer = await customer(app); const o = await buy(buyer, [[id, 2]]); await pay(buyer, o.body.order.id);
    await Order.updateOne({ _id: o.body.order.id }, { 'shipment.deliveredAt': new Date(Date.now() - 10 * 86_400_000) });
    await promoteEligibleEarnings(new Date(), 7);
    return { profile, cc, a, id };
  }
  it('payout lifecycle over the API, with statements visible only to the right creator', async () => {
    const { profile, cc, a } = await eligibleSale();
    const bal = (await a.get('/api/v1/admin/payouts/balances')).body.items[0];
    expect(bal.availablePaise).toBe(120000);
    const d = await a.post('/api/v1/admin/payouts', { creatorId: String(profile._id) });
    expect(d.status).toBe(201); const pid = d.body.payout.id;
    expect((await a.post(`/api/v1/admin/payouts/${pid}/pay`, { reference: 'UTR-1' })).status).toBe(409); // must be approved first
    expect((await a.post(`/api/v1/admin/payouts/${pid}/approve`)).status).toBe(200);
    expect((await a.post(`/api/v1/admin/payouts/${pid}/pay`, { reference: '  ' })).status).toBe(422);
    expect((await cc.post(`/api/v1/admin/payouts/${pid}/pay`, { reference: 'UTR-1' })).status).toBe(403); // creators cannot pay themselves
    expect((await a.post(`/api/v1/admin/payouts/${pid}/pay`, { reference: 'UTR-8841' })).status).toBe(200);
    expect((await a.post(`/api/v1/admin/payouts/${pid}/pay`, { reference: 'UTR-8841' })).status).toBe(409);
    const d2 = (await cc.get('/api/v1/creator/dashboard')).body.earnings;
    expect(d2).toMatchObject({ availablePaise: 0, paidOutPaise: 120000 });
    const csv = (await a.get(`/api/v1/admin/payouts/${pid}/statement?format=csv`)).text;
    expect(csv).toContain('UTR-8841'); expect(csv).toContain('1200.00');
    expect((await cc.get(`/api/v1/creator/payouts/${pid}/statement`)).body.payout.paymentReference).toBe('UTR-8841');
    const stranger = await asCreator(app, await makeCreator('Stranger'));
    expect((await stranger.get(`/api/v1/creator/payouts/${pid}/statement`)).status).toBe(404);
    expect((await Notification.countDocuments({ type: 'payout_paid' }))).toBe(1);
  });
  it('can require a second approver', async () => {
    const { profile } = await eligibleSale();
    const { StoreSettings } = await import('../models/index.js');
    await StoreSettings.create({ requireSecondPayoutApprover: true });
    const a1 = await admin(app); const a2 = await admin(app);
    const pid = (await a1.post('/api/v1/admin/payouts', { creatorId: String(profile._id) })).body.payout.id;
    expect((await a1.post(`/api/v1/admin/payouts/${pid}/approve`)).body.error.code).toBe('SECOND_APPROVER_REQUIRED');
    expect((await a2.post(`/api/v1/admin/payouts/${pid}/approve`)).status).toBe(200);
  });
  it('suspending a creator hides their products, closes the portal, holds earnings; reactivation restores them', async () => {
    const { profile, cc, a } = await eligibleSale();
    const c = await customer(app);
    expect((await c.get('/api/v1/products')).body.total).toBe(1);
    expect((await a.post(`/api/v1/admin/creators/${profile._id}/status`, { action: 'suspend' })).status).toBe(422); // reason required
    expect((await a.post(`/api/v1/admin/creators/${profile._id}/status`, { action: 'suspend', note: 'Policy breach (test)' })).status).toBe(200);
    expect((await c.get('/api/v1/products')).body.total).toBe(0);
    expect((await cc.get('/api/v1/creator/dashboard')).status).toBe(403);
    expect((await CreatorEarning.findOne())!.status).toBe('on_hold');
    expect((await a.post('/api/v1/admin/payouts', { creatorId: String(profile._id) })).body.error.code).toBe('CREATOR_INACTIVE');
    expect((await a.post(`/api/v1/admin/creators/${profile._id}/status`, { action: 'reactivate', note: 'Resolved' })).status).toBe(200);
    expect((await c.get('/api/v1/products')).body.total).toBe(1);
    expect((await CreatorEarning.findOne())!.status).toBe('eligible');
    expect((await cc.get('/api/v1/creator/dashboard')).status).toBe(200);
  });
  it('creator detail exposes payout reference details to admins only; values never land in the audit log', async () => {
    const profile = await makeCreator('Asha'); const cc = await asCreator(app, profile); const a = await admin(app);
    expect((await cc.put('/api/v1/creator/payout-details', { accountHolder: 'Asha Menon', ifsc: 'hdfc0001234', accountLast4: '4321', accountNumber: '123456784321' })).status).toBe(422); // full account numbers are rejected
    expect((await cc.put('/api/v1/creator/payout-details', { accountHolder: 'Asha Menon', ifsc: 'hdfc0001234', accountLast4: '4321', upiId: 'asha@okbank' })).status).toBe(200);
    expect((await a.get(`/api/v1/admin/creators/${profile._id}`)).body.creator.payoutDetails).toMatchObject({ ifsc: 'HDFC0001234', accountLast4: '4321' });
    const pub = await (await customer(app)).get(`/api/v1/creators/${profile.slug}`);
    expect(JSON.stringify(pub.body)).not.toMatch(/HDFC|4321|asha@okbank|payoutDetails/);
    const { AuditLog } = await import('../models/index.js');
    expect(JSON.stringify(await AuditLog.find().lean())).not.toMatch(/HDFC|4321|asha@okbank/);
    expect((await (await customer(app)).get(`/api/v1/admin/creators/${profile._id}`)).status).toBe(403);
  });
});

describe('notifications', () => {
  it('are private to their owner and can be marked read', async () => {
    const { cc, a, id } = await liveProduct();
    void a; void id;
    const list = (await cc.get('/api/v1/notifications')).body;
    expect(list.unread).toBeGreaterThanOrEqual(1);
    const nid = list.items[0].id;
    const other = await customer(app);
    expect((await other.post(`/api/v1/notifications/${nid}/read`)).status).toBe(404);
    expect((await cc.post(`/api/v1/notifications/${nid}/read`)).status).toBe(200);
    expect((await cc.post('/api/v1/notifications/read-all')).status).toBe(200);
    expect((await cc.get('/api/v1/notifications')).body.unread).toBe(0);
    expect((await Notification.findById(nid))!.emailStatus).not.toBe('sent'); // no provider configured => never claims delivery
  });
});
export { key, makeProduct, CreatorProfile };
