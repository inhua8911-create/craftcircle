import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { cookieSecure, env } from '../config/env.js';
import { User, type Role } from '../models/index.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export const SESSION_COOKIE = 'cc_session';
export interface AuthUser { id: Types.ObjectId; role: Role; email: string; name: string }
declare module 'express-serve-static-core' { interface Request { user?: AuthUser } }

export function setSessionCookie(res: Response, user: { _id: Types.ObjectId; tokenVersion: number }) {
  const token = jwt.sign({ sub: String(user._id), tv: user.tokenVersion }, env.JWT_SECRET, { expiresIn: `${env.JWT_EXPIRES_IN_HOURS}h`, algorithm: 'HS256' });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/', maxAge: env.JWT_EXPIRES_IN_HOURS * 3_600_000 });
}
export const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/' });

/** Resolves the session on every request from the DB, so role changes, suspension and password resets apply immediately. */
async function resolve(req: Request): Promise<AuthUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') return null;
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { sub: string; tv: number };
    const u = await User.findById(p.sub).select('role status tokenVersion email name');
    if (!u || u.status !== 'active' || u.tokenVersion !== p.tv) return null;
    return { id: u._id, role: u.role, email: u.email, name: u.name };
  } catch { return null; }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try { const u = await resolve(req); if (u) req.user = u; next(); } catch (e) { next(e); }
}
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try { const u = await resolve(req); if (!u) throw unauthorized(); req.user = u; next(); } catch (e) { next(e); }
}
/** Always chain after requireAuth. Authorisation is enforced here, not by hidden UI. */
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
export const requireAdmin = requireRole('admin', 'super_admin');

// ---- creator context -------------------------------------------------------
import { CreatorProfile } from '../models/index.js';
declare module 'express-serve-static-core' { interface Request { creator?: { id: Types.ObjectId; slug: string } } }
/** Requires role=creator AND an active creator profile (suspended creators lose portal access immediately). */
export async function requireCreator(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) throw unauthorized();
    if (req.user.role !== 'creator') throw forbidden('Creator account required');
    const p = await CreatorProfile.findOne({ user: req.user.id, status: 'active' }).select('slug');
    if (!p) throw forbidden('Your creator account is not active');
    req.creator = { id: p._id, slug: p.slug };
    next();
  } catch (e) { next(e); }
}
