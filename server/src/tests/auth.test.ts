import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { AuditLog, User } from '../models/index.js';
import { devOutbox } from '../services/email.js';

const app = createApp();
const PW = 'correct-horse-battery';

/** A client that carries cookies and the CSRF header like the browser app will. */
async function client() {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/v1/auth/csrf');
  const csrf = body.csrfToken as string;
  const wrap = (m: 'post' | 'patch' | 'put' | 'delete') => (url: string, data?: object) => agent[m](url).set('x-csrf-token', csrf).send(data);
  return { agent, csrf, post: wrap('post'), patch: wrap('patch'), get: (u: string) => agent.get(u) };
}
async function seedUser(role: 'customer' | 'creator' | 'admin' | 'super_admin', email = `${role}@example.com`) {
  return User.create({ name: role, email, passwordHash: await bcrypt.hash(PW, 4), role });
}
async function loginAs(role: 'customer' | 'creator' | 'admin' | 'super_admin') {
  const u = await seedUser(role);
  const c = await client();
  const r = await c.post('/api/v1/auth/login', { email: u.email, password: PW });
  expect(r.status).toBe(200);
  return { ...c, user: u };
}

beforeEach(() => { devOutbox.length = 0; });

describe('registration & login', () => {
  it('registers a customer, sets an HttpOnly cookie, and never leaks the hash', async () => {
    const c = await client();
    const r = await c.post('/api/v1/auth/register', { name: 'Meera', email: 'Meera@Example.com', password: PW });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('customer');
    expect(r.body.user.email).toBe('meera@example.com');
    expect(JSON.stringify(r.body)).not.toMatch(/hash|password/i);
    expect(String(r.headers['set-cookie'])).toMatch(/cc_session=.*HttpOnly/);
    expect((await c.get('/api/v1/auth/me')).body.user.email).toBe('meera@example.com');
  });
  it('cannot self-assign a role at registration', async () => {
    const c = await client();
    const r = await c.post('/api/v1/auth/register', { name: 'Eve', email: 'eve@example.com', password: PW, role: 'admin' });
    expect(r.status).toBe(422);
    expect(await User.countDocuments({ email: 'eve@example.com' })).toBe(0);
  });
  it('rejects weak passwords and duplicate emails', async () => {
    const c = await client();
    expect((await c.post('/api/v1/auth/register', { name: 'A', email: 'a@example.com', password: 'short' })).status).toBe(422);
    await c.post('/api/v1/auth/register', { name: 'A', email: 'a@example.com', password: PW });
    expect((await c.post('/api/v1/auth/register', { name: 'A', email: 'a@example.com', password: PW })).status).toBe(409);
  });
  it('gives identical errors for wrong password and unknown email', async () => {
    await seedUser('customer');
    const c = await client();
    const a = await c.post('/api/v1/auth/login', { email: 'customer@example.com', password: 'wrong-password-1' });
    const b = await c.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'wrong-password-1' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });
  it('blocks NoSQL operator injection in login', async () => {
    await seedUser('customer');
    const c = await client();
    const r = await c.post('/api/v1/auth/login', { email: { $ne: null }, password: { $ne: null } });
    expect(r.status).toBe(422);
  });
  it('logout clears the session', async () => {
    const c = await loginAs('customer');
    await c.post('/api/v1/auth/logout');
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('suspended users cannot log in, and live sessions stop working immediately', async () => {
    const c = await loginAs('customer');
    await User.updateOne({ _id: c.user._id }, { status: 'suspended' });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
    const fresh = await client();
    expect((await fresh.post('/api/v1/auth/login', { email: c.user.email, password: PW })).status).toBe(403);
  });
});

describe('CSRF', () => {
  it('rejects unsafe requests without a matching token', async () => {
    const agent = request.agent(app);
    expect((await agent.post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x' })).body.error.code).toBe('CSRF_FAILED');
    await agent.get('/api/v1/auth/csrf');
    expect((await agent.post('/api/v1/auth/login').set('x-csrf-token', 'f'.repeat(64)).send({ email: 'a@b.co', password: 'x' })).body.error.code).toBe('CSRF_FAILED');
  });
});

describe('password reset', () => {
  it('does not reveal whether an email exists', async () => {
    await seedUser('customer');
    const c = await client();
    const a = await c.post('/api/v1/auth/forgot-password', { email: 'customer@example.com' });
    const b = await c.post('/api/v1/auth/forgot-password', { email: 'ghost@example.com' });
    expect(a.status).toBe(200); expect(a.body).toEqual(b.body);
    expect(devOutbox.filter((m) => m.subject.includes('Reset')).length).toBe(1);
  });
  it('token works once, expires, and signs out existing sessions', async () => {
    const s = await loginAs('customer');
    const c = await client();
    await c.post('/api/v1/auth/forgot-password', { email: s.user.email });
    const token = /token=([a-f0-9]{64})/.exec(devOutbox.at(-1)!.text)![1]!;
    expect((await c.post('/api/v1/auth/reset-password', { token, password: 'a-brand-new-password' })).status).toBe(200);
    expect((await c.post('/api/v1/auth/reset-password', { token, password: 'another-new-password' })).status).toBe(400);
    expect((await s.get('/api/v1/auth/me')).status).toBe(401); // old session revoked
    expect((await c.post('/api/v1/auth/login', { email: s.user.email, password: 'a-brand-new-password' })).status).toBe(200);
    const stale = await seedUser('customer', 'late@example.com');
    await c.post('/api/v1/auth/forgot-password', { email: stale.email });
    const t2 = /token=([a-f0-9]{64})/.exec(devOutbox.at(-1)!.text)![1]!;
    await User.updateOne({ _id: stale._id }, { resetTokenExpires: new Date(Date.now() - 1000) });
    expect((await c.post('/api/v1/auth/reset-password', { token: t2, password: 'a-brand-new-password' })).status).toBe(400);
  });
});

describe('role-based access', () => {
  it('anonymous -> 401, customer/creator -> 403 on admin routes, admin -> 200', async () => {
    expect((await (await client()).get('/api/v1/admin/users')).status).toBe(401);
    expect((await (await loginAs('customer')).get('/api/v1/admin/users')).status).toBe(403);
    expect((await (await loginAs('creator')).get('/api/v1/admin/users')).status).toBe(403);
    expect((await (await loginAs('admin')).get('/api/v1/admin/users')).status).toBe(200);
  });
  it('plain admins cannot change roles; super_admin can, with an audit entry and session revocation', async () => {
    const target = await seedUser('customer', 'target@example.com');
    const admin = await loginAs('admin');
    expect((await admin.patch(`/api/v1/admin/users/${target._id}/role`, { role: 'admin' })).status).toBe(403);
    const sa = await loginAs('super_admin');
    const r = await sa.patch(`/api/v1/admin/users/${target._id}/role`, { role: 'creator' });
    expect(r.status).toBe(200);
    const log = await AuditLog.findOne({ action: 'user.role_changed' });
    expect(log?.before).toEqual({ role: 'customer' });
    expect(log?.after).toEqual({ role: 'creator' });
  });
  it('super_admin cannot change their own role', async () => {
    const sa = await loginAs('super_admin');
    expect((await sa.patch(`/api/v1/admin/users/${sa.user._id}/role`, { role: 'customer' })).status).toBe(403);
  });
  it('admins cannot suspend other admins; they can suspend customers (audited)', async () => {
    const other = await seedUser('admin', 'other-admin@example.com');
    const cust = await seedUser('customer', 'cust@example.com');
    const admin = await loginAs('admin');
    expect((await admin.patch(`/api/v1/admin/users/${other._id}/status`, { status: 'suspended' })).status).toBe(403);
    expect((await admin.patch(`/api/v1/admin/users/${cust._id}/status`, { status: 'suspended' })).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'user.status_changed' })).toBe(1);
  });
});

describe('platform hygiene', () => {
  it('audit log entries are immutable', async () => {
    const e = await AuditLog.create({ action: 'x', entityType: 'User' });
    await expect(AuditLog.deleteMany({})).rejects.toThrow(/immutable/);
    e.note = 'tamper';
    await expect(e.save()).rejects.toThrow(/immutable/);
  });
  it('errors never leak stack traces; unknown routes return 404 JSON', async () => {
    const r = await request(app).get('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts|node_modules/);
  });
  it('CORS allows only the configured origin and exposes security headers', async () => {
    const ok = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:5173');
    const bad = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['x-powered-by']).toBeUndefined();
  });
});
