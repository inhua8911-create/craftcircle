// Development seed: clearly-labelled SAMPLE data, built through the real services so everything is consistent.
//   npm run seed            (aborts if data already exists)
//   npm run seed -- --reset (empties the database first; development, or DEMO_MODE)
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { connectDb } from './config/db.js';
import { env, isProd, demoMode } from './config/env.js';
import * as M from './models/index.js';
import { uniqueSlug, slugify } from './utils/slug.js';
import { validateCommercialTerms } from './services/pricing.js';
import { placeOrder, cancelUnpaidOrder } from './services/checkout.js';
import { confirmPayment, initiatePayment } from './services/payments.js';
import { promoteEligibleEarnings, recordRefund } from './services/earnings.js';
import { attachSeedImages } from './services/seedImages.js';
import { approvePayout, createPayoutDraft, markPayoutPaid } from './services/payouts.js';

if ((isProd && !demoMode) || env.PAYMENT_MODE !== 'mock') { console.error('Seeding is for development (or DEMO_MODE=true) with PAYMENT_MODE=mock only.'); process.exit(1); }
if (isProd && !demoMode && process.argv.includes('--reset')) { console.error('--reset is development only.'); process.exit(1); }
await connectDb();
if (process.argv.includes('--reset')) await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({}))); // empties every collection (works without dropDatabase rights, e.g. Atlas readWrite users)
else if (await M.User.exists({})) { console.error('Database is not empty. Re-run with --reset to wipe it (development only).'); process.exit(1); }
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

const password = process.env.SEED_PASSWORD ?? crypto.randomBytes(9).toString('base64url');
const hash = await bcrypt.hash(password, 10);
const rupees = (n: number) => n * 100;

// ---- categories (photos are attached from server/seed-images/ by attachSeedImages)
const catDefs: [string, string][] = [['Jewellery', 'jewellery'], ['Crochet', 'crochet'], ['Accessories', 'accessories'], ['Crafts', 'crafts'], ['Home Décor', 'decor']];
const cats: Record<string, any> = {};
for (const [i, [name, slug]] of catDefs.entries()) cats[slug] = await M.Category.create({ name, slug, sortOrder: i, description: `Handmade ${name.toLowerCase()} from independent makers.` });

// ---- creators (accounts + profiles)
const creatorDefs = [
  ['Meera Nair', 'meera-nair', 'Kochi', 'Kerala', ['Jewellery'], 'Strings pearls, crystals and charms into bracelets with a story.'],
  ['Little Bloom Crafts', 'little-bloom-crafts', 'Bihar', 'Bihar', ['Accessories', 'Crafts', 'Home Décor'], 'Makes flowers that never wilt, from hair clips to bouquets.'],
  ['Aisha Khan', 'aisha-khan', 'Hyderabad', 'Telangana', ['Crochet'], 'Turns cotton yarn into cosy, colourful home pieces.'],
];
const creators: any[] = [];
for (const [name, slug, city, state, spec, bio] of creatorDefs as any[]) {
  const user = await M.User.create({ name, email: `${slug}@sample.craftcircle.test`, passwordHash: hash, role: 'creator', emailVerified: true });
  const app = await M.CreatorApplication.create({ user: user._id, fullName: name, email: user.email, phone: '9000000000', city, state, categories: spec, bio, confirmsHandmade: true, acceptedTermsVersion: 'draft-1', status: 'approved' });
  creators.push(await M.CreatorProfile.create({ user: user._id, application: app._id, slug, displayName: name, bio, story: `${bio} Every piece is handmade in small batches.`, specialties: spec, city, state, termsVersion: 'draft-1', publicFields: { city: true, bio: true, story: true, links: false } }));
}

// ---- products: [creatorIdx, category, name, sellRs, creatorRs, stock, madeToOrder, materials]
const P: [number, string, string, number, number, number, boolean, string[]][] = [
  [0, 'jewellery', 'Pineapple Charm Pearl Bracelet', 399, 260, 14, false, ['pearls', 'gold beads', 'enamel charm']],
  [0, 'jewellery', 'Royal Blue Pearl Weave Bracelet', 549, 360, 10, false, ['pearls', 'glass beads']],
  [0, 'jewellery', 'Daisy & Crystal Charm Bracelet', 449, 290, 12, false, ['pearls', 'crystal beads', 'metal charms']],
  [0, 'jewellery', 'Pearl Bracelet Set of Eight', 1799, 1200, 6, false, ['pearls', 'glass beads']],
  [1, 'accessories', 'Velvet Bloom Hair Clips, Large', 349, 225, 20, false, ['velvet', 'metal clips']],
  [1, 'accessories', 'Mini Velvet Flower Clips, Set of 6', 299, 190, 25, false, ['velvet', 'metal clips']],
  [1, 'crafts', 'Chenille Lily Bouquet', 599, 390, 8, false, ['chenille wire', 'pearl beads']],
  [2, 'crochet', 'Sunflower & Daisy Flower Set', 499, 325, 15, false, ['cotton yarn']],
  [1, 'decor', 'Potted Flower Arrangement', 449, 290, 9, false, ['chenille wire', 'wool', 'pot']],
];
const products: any[] = [];
for (const [ci, cat, name, sell, cr, stock, mto, materials] of P) {
  const { platformMarginPaise } = validateCommercialTerms(rupees(sell), rupees(cr));
  const p = await M.Product.create({ creator: creators[ci]._id, name, slug: uniqueSlug(name), description: `${name}, handmade by ${creators[ci].displayName}.`, story: `Handmade in small batches by ${creators[ci].displayName}.`, category: cats[cat]._id, materials, madeToOrder: mto, dispatchDays: mto ? 10 : 3, stock, status: 'published', suggestedPricePaise: rupees(sell), proposedCreatorAmountPaise: rupees(cr), sellingPricePaise: rupees(sell), creatorAmountPaise: rupees(cr), platformMarginPaise, pricingVersion: 1, publishedAt: new Date(Date.now() - Math.random() * 30 * 86_400_000), featured: products.length % 3 === 0 });
  await M.ProductPricingHistory.create({ product: p._id, version: 1, sellingPricePaise: rupees(sell), creatorAmountPaise: rupees(cr), platformMarginPaise, changedBy: creators[ci].user, reason: 'seed' });
  products.push(p);
}
await M.Collection.create([
  { title: 'Gifts under ₹999', slug: 'gifts-under-999', description: 'Thoughtful handmade gifts.', occasion: 'gifting', featured: true, products: products.filter((p) => p.sellingPricePaise < rupees(999)).map((p) => p._id) },
  { title: 'Blooms that never wilt', slug: 'blooms-that-never-wilt', description: 'Velvet, chenille and crochet flowers that last.', featured: true, products: products.filter((p) => ['accessories', 'crafts', 'crochet', 'decor'].includes(String(P[products.indexOf(p)]![1]))).map((p) => p._id) },
  { title: 'New this season', slug: 'new-this-season', description: 'Recent arrivals.', products: products.slice(0, 8).map((p) => p._id) },
]);
await M.StoreSettings.create({ shipping: { flatRatePaise: rupees(60), freeAboveCartPaise: rupees(999) }, announcement: { enabled: true, text: 'Demo store: simulated payments only, no real money moves.' }, settlementHoldDays: 7 });
await M.Coupon.create({ code: 'SAMPLE10', type: 'percent', value: 10, maxDiscountPaise: rupees(100), startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 90 * 86_400_000), usageLimit: 100 });
await M.IncentiveCampaign.create({ name: 'Sample: first 10 sales bonus', description: 'Sample campaign: reach 10 units sold in the period to earn a bonus.', rule: { metric: 'units_sold', threshold: 10 }, rewardPaise: rupees(500), startsAt: new Date(), endsAt: new Date(Date.now() + 60 * 86_400_000), eligibility: 'All approved creators' });

// ---- customers + orders through the REAL checkout/payment services (mock adapter => simulated)
const custs: any[] = [];
for (const n of ['Priya Menon', 'Ananya Gupta', 'Vikram Shah']) custs.push(await M.User.create({ name: n, email: `${slugify(n)}@sample.craftcircle.test`, passwordHash: hash, role: 'customer' }));
const addr = (n: string) => ({ fullName: n, phone: '9876543210', line1: '12 Sample Street', city: 'Hyderabad', state: 'Telangana', postalCode: '500081', country: 'India' });
async function order(ci: number, items: [number, number][], opts: { couponCode?: string } = {}) {
  const u = custs[ci];
  await M.Cart.deleteOne({ user: u._id });
  await M.Cart.create({ user: u._id, items: items.map(([i, q]) => ({ product: products[i]._id, quantity: q })) });
  const { order } = await placeOrder({ userId: u._id, customer: { name: u.name, email: u.email }, address: addr(u.name), couponCode: opts.couponCode ?? undefined, idempotencyKey: `seed:${crypto.randomUUID()}` });
  return order;
}
async function pay(o: any) {
  const p = await initiatePayment(o._id, o.user!);
  await confirmPayment({ providerOrderId: p.providerOrderId, providerPaymentId: `seedpay_${o._id}`, eventId: `seed:${o._id}`, provider: 'mock' });
}
async function ship(o: any, daysAgo: number, deliver: boolean) {
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  await M.Order.updateOne({ _id: o._id }, { status: deliver ? 'delivered' : 'shipped', shipment: { provider: 'Sample Courier', trackingNumber: `SAMPLE${String(o._id).slice(-6)}`, shippedAt: at, ...(deliver && { deliveredAt: new Date(at.getTime() + 3 * 86_400_000) }) } });
}
const o1 = await order(0, [[0, 2], [4, 1]]); await pay(o1); await ship(o1, 20, true);          // delivered long ago -> eligible
const o2 = await order(1, [[8, 1], [6, 2]], { couponCode: 'SAMPLE10' }); await pay(o2); await ship(o2, 15, true);
const o3 = await order(2, [[3, 1]]); await pay(o3); await ship(o3, 2, false);                // shipped
const o4 = await order(0, [[7, 1], [5, 3]]); await pay(o4);                                  // paid, awaiting dispatch
const o5 = await order(1, [[5, 1]]);                                                             // left unpaid (pending_payment)
const o6 = await order(2, [[6, 1]]); await cancelUnpaidOrder(o6._id, o6.user!);                  // cancelled before payment
const o7 = await order(0, [[2, 2]]); await pay(o7); await ship(o7, 12, true);
const item7 = (await M.OrderItem.findOne({ order: o7._id }))!;
await recordRefund({ orderId: o7._id, lines: [{ orderItemId: item7._id, quantity: 1 }], reason: 'Sample refund: item arrived damaged', idempotencyKey: 'seed-refund-1' });
await promoteEligibleEarnings(new Date(), 7);
const paidCreator = (await M.OrderItem.findOne({ order: o1._id, product: products[0]._id }))!.creator;
const draft = await createPayoutDraft(paidCreator, custs[0]._id, { isSimulated: true });                // sample payout (simulated bank transfer)
await approvePayout(draft._id, custs[0]._id); await markPayoutPaid(draft._id, custs[0]._id, 'SAMPLE-UTR-0001');

await attachSeedImages(); // real photos from server/seed-images/ if any are present
console.log(`Seeded: ${creators.length} creators, ${products.length} products, ${custs.length} customers, ${await M.Order.countDocuments()} orders, ${await M.CreatorEarning.countDocuments()} earnings, ${await M.FinancialLedgerEntry.countDocuments()} ledger entries.`);
console.log(`Sample accounts use the password: ${password}   (customers: *@sample.craftcircle.test; creators likewise). No admin is seeded: use npm run bootstrap-admin.`);
await mongoose.disconnect();
