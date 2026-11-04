import request from 'supertest';
import bcrypt from 'bcryptjs';
import { expect } from 'vitest';
import { User } from '../models/index.js';

export const PW = 'correct-horse-battery';
export const ADDRESS = { fullName: 'Meera Rao', phone: '9876543210', line1: '12 Lake View Road', city: 'Hyderabad', state: 'Telangana', postalCode: '500081', country: 'India' };
export const CHECKOUT = { customer: { name: 'Meera Rao', email: 'meera@example.com', phone: '9876543210' }, address: ADDRESS };
let n = 0;
export const key = () => `idem-key-${Date.now()}-${n++}`;

export async function client(app: any) {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
  const send = (m: 'post' | 'patch' | 'put' | 'delete') => (url: string, data?: object, headers: Record<string, string> = {}) => agent[m](url).set('x-csrf-token', csrf).set(headers).send(data);
  return { agent, csrf, get: (u: string) => agent.get(u), post: send('post'), put: send('put'), patch: send('patch'), del: send('delete') };
}
export async function customer(app: any, email = `c${n++}@example.com`) {
  const c = await client(app);
  const r = await c.post('/api/v1/auth/register', { name: 'Customer', email, password: PW });
  expect(r.status).toBe(201);
  return { ...c, userId: r.body.user.id as string, email };
}
export async function admin(app: any, role: 'admin' | 'super_admin' = 'admin') {
  const u = await User.create({ name: 'Admin', email: `adm${n++}@example.com`, passwordHash: await bcrypt.hash(PW, 4), role });
  const c = await client(app);
  expect((await c.post('/api/v1/auth/login', { email: u.email, password: PW })).status).toBe(200);
  return c;
}
/** Adds to cart, checks out, returns the checkout response. */
export async function buy(c: Awaited<ReturnType<typeof customer>>, items: [string, number][], extra: object = {}, k = key()) {
  for (const [id, q] of items) expect((await c.put('/api/v1/cart/items', { productId: id, quantity: q })).status).toBe(200);
  return c.post('/api/v1/checkout', { ...CHECKOUT, ...extra }, { 'Idempotency-Key': k });
}

// ---- workflow helpers ----
import fs from 'node:fs';
import path from 'node:path';
import { CreatorProfile, Category } from '../models/index.js';
import { UPLOAD_DIR } from '../services/uploads.js';
export const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1), Buffer.from(String(Math.random()))]);
export async function uploadPng(c: any) {
  const r = await c.agent.post('/api/v1/uploads/images').set('x-csrf-token', c.csrf).attach('file', PNG(), 'photo.png');
  expect(r.status).toBe(201);
  return r.body.url as string;
}
export function cleanUploads() { try { for (const f of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, f)); } catch { /* none */ } }
/** Logs in as an existing creator profile's user (fixtures create users with a dummy hash; give them a real one). */
export async function asCreator(app: any, profile: { user: any }) {
  const u = (await User.findById(profile.user))!;
  u.passwordHash = await bcrypt.hash(PW, 4); await u.save();
  const c = await client(app);
  expect((await c.post('/api/v1/auth/login', { email: u.email, password: PW })).status).toBe(200);
  return c;
}
export async function anyCategory() { return (await Category.findOne({ slug: 'jewellery' })) ?? Category.create({ name: 'Jewellery', slug: 'jewellery' }); }
export const productBody = async (c: any, over: object = {}) => ({
  name: 'Brass Leaf Pendant', description: 'A hand-cut brass leaf on a cotton cord.', category: String((await anyCategory())._id),
  suggestedPricePaise: 89900, proposedCreatorAmountPaise: 60000, stock: 5, images: [await uploadPng(c)], materials: ['brass'], ...over,
});
export { CreatorProfile };
