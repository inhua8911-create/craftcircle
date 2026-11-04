import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { Address, Coupon, NewsletterSubscription, StoreSettings } from '../models/index.js';
import { makeCreator, makeProduct } from './fixtures.js';
import { ADDRESS, buy, client, customer, PW } from './helpers.js';

const app = createApp();

describe('wishlist', () => {
  it('is per-user, idempotent, and only holds published products', async () => {
    const cr = await makeCreator(); const p = await makeProduct(cr._id); const draft = await makeProduct(cr._id, { status: 'draft' });
    const a = await customer(app); const b = await customer(app);
    expect((await a.put(`/api/v1/wishlist/${p._id}`)).status).toBe(200);
    expect((await a.put(`/api/v1/wishlist/${p._id}`)).status).toBe(200);
    expect((await a.put(`/api/v1/wishlist/${draft._id}`)).status).toBe(404);
    expect((await a.put('/api/v1/wishlist/not-an-id')).status).toBe(404);
    expect((await a.get('/api/v1/wishlist')).body.ids).toEqual([String(p._id)]);
    expect((await b.get('/api/v1/wishlist')).body.ids).toEqual([]);
    await a.del(`/api/v1/wishlist/${p._id}`);
    expect((await a.get('/api/v1/wishlist')).body.items).toEqual([]);
    expect((await (await client(app)).get('/api/v1/wishlist')).status).toBe(401);
  });
});

describe('addresses', () => {
  it('first becomes default, one default at a time, and other users cannot touch them', async () => {
    const a = await customer(app); const b = await customer(app);
    const r1 = await a.post('/api/v1/addresses', ADDRESS); const r2 = await a.post('/api/v1/addresses', { ...ADDRESS, label: 'Work', isDefault: true });
    expect(r1.body.address.isDefault).toBe(true);
    const list = (await a.get('/api/v1/addresses')).body.items;
    expect(list.filter((x: any) => x.isDefault).length).toBe(1); expect(list[0].label).toBe('Work');
    expect((await b.put(`/api/v1/addresses/${r1.body.address.id}`, ADDRESS)).status).toBe(404);
    expect((await b.del(`/api/v1/addresses/${r1.body.address.id}`)).status).toBe(404);
    expect(await Address.countDocuments({ user: a.userId })).toBe(2);
    await a.del(`/api/v1/addresses/${r2.body.address.id}`); // deleting the default promotes another
    expect((await a.get('/api/v1/addresses')).body.items[0].isDefault).toBe(true);
    expect((await a.post('/api/v1/addresses', { ...ADDRESS, postalCode: 'abc' })).status).toBe(422);
  });
});

describe('account', () => {
  it('updates profile (no role escalation) and changes password, revoking other sessions', async () => {
    const a = await customer(app, 'pw@example.com');
    expect((await a.patch('/api/v1/account', { name: 'New Name', role: 'admin' })).status).toBe(422);
    expect((await a.patch('/api/v1/account', { name: 'New Name' })).body.user.name).toBe('New Name');
    const other = await client(app); await other.post('/api/v1/auth/login', { email: 'pw@example.com', password: PW });
    expect((await a.post('/api/v1/account/change-password', { currentPassword: 'wrong-password-1', newPassword: 'another-long-password' })).body.error.code).toBe('WRONG_PASSWORD');
    expect((await a.post('/api/v1/account/change-password', { currentPassword: PW, newPassword: 'another-long-password' })).status).toBe(200);
    expect((await a.get('/api/v1/auth/me')).status).toBe(200); // this device stays signed in
    expect((await other.get('/api/v1/auth/me')).status).toBe(401); // the other one does not
  });
});

describe('quote, store info, creators, newsletter, sitemap', () => {
  it('quotes shipping, discount and total without reserving stock or consuming the coupon', async () => {
    await StoreSettings.create({ shipping: { flatRatePaise: 6000, freeAboveCartPaise: 99900 } });
    await Coupon.create({ code: 'HELLO10', type: 'percent', value: 10, startsAt: new Date(Date.now() - 1e6), endsAt: new Date(Date.now() + 1e6), usageLimit: 1 });
    const p = await makeProduct((await makeCreator())._id, { stock: 3 }); const c = await customer(app);
    await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 1 });
    const q = (await c.post('/api/v1/checkout/quote', {})).body;
    expect(q).toMatchObject({ subtotalPaise: 59900, shippingPaise: 6000, discountPaise: 0, totalPaise: 65900 });
    const q2 = (await c.post('/api/v1/checkout/quote', { couponCode: 'hello10' })).body;
    expect(q2).toMatchObject({ discountPaise: 5990, coupon: 'HELLO10', totalPaise: 59900 - 5990 + 6000 });
    expect((await c.post('/api/v1/checkout/quote', { couponCode: 'NOPE' })).body.couponError).toMatch(/not valid/);
    expect((await Coupon.findOne())!.usedCount).toBe(0);
    const { Product } = await import('../models/index.js'); expect((await Product.findById(p._id))!.reserved).toBe(0);
    // and the quote matches what checkout actually charges
    const o = await buy(c, [], { couponCode: 'HELLO10' }, 'quote-match-key-1');
    expect(o.body.order.totalPaise).toBe(q2.totalPaise);
  });
  it('flags unavailable items in the quote instead of throwing', async () => {
    const p = await makeProduct((await makeCreator())._id, { stock: 2 }); const c = await customer(app);
    await c.put('/api/v1/cart/items', { productId: String(p._id), quantity: 2 });
    const { Product } = await import('../models/index.js'); await Product.updateOne({ _id: p._id }, { reserved: 1 });
    expect((await c.post('/api/v1/checkout/quote', {})).body.issues[0].issue).toBe('insufficient_stock');
  });
  it('store info exposes the announcement only when enabled, and no secrets', async () => {
    const c = await client(app);
    expect((await c.get('/api/v1/store')).body.announcement).toBeNull();
    await StoreSettings.create({ announcement: { enabled: true, text: 'Free shipping over ₹999' } });
    const r = (await c.get('/api/v1/store')).body;
    expect(r.announcement.text).toBe('Free shipping over ₹999'); expect(JSON.stringify(r)).not.toMatch(/secret|key/i);
  });
  it('lists only creators who have published products', async () => {
    const a = await makeCreator('Visible'); await makeCreator('Empty'); await makeProduct(a._id);
    const r = await (await client(app)).get('/api/v1/creators');
    expect(r.body.items.map((c: any) => c.slug)).toEqual([a.slug]);
  });
  it('newsletter responds identically for new and existing emails and stores one record', async () => {
    const c = await client(app);
    const a = await c.post('/api/v1/newsletter', { email: 'Reader@Example.com' }); const b = await c.post('/api/v1/newsletter', { email: 'reader@example.com' });
    expect(a.body).toEqual(b.body); expect(await NewsletterSubscription.countDocuments()).toBe(1);
    expect((await c.post('/api/v1/newsletter', { email: 'nope' })).status).toBe(422);
  });
  it('sitemap lists published items only; robots blocks private areas', async () => {
    const cr = await makeCreator(); const live = await makeProduct(cr._id); const draft = await makeProduct(cr._id, { status: 'draft' });
    const sm = (await request(app).get('/sitemap.xml')).text;
    expect(sm).toContain(`/products/${live.slug}`); expect(sm).not.toContain(draft.slug); expect(sm).not.toMatch(/\/account|\/admin|\/cart/);
    const rb = (await request(app).get('/robots.txt')).text;
    expect(rb).toMatch(/Disallow: \/account/); expect(rb).toMatch(/Sitemap:/);
  });
});
