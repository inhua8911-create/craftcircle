import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { cookieSecure, env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export const CSRF_COOKIE = 'cc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Double-submit CSRF: unsafe methods must echo the csrf cookie value in a header. SameSite=Lax cookies add defence in depth. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== 'string' || typeof header !== 'string' || cookie.length < 32 || cookie.length !== header.length ||
      !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token'));
  }
  next();
}
export function issueCsrfToken(res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: 'lax', secure: cookieSecure, path: '/' });
  return token;
}

/** Strips Mongo operator keys ($...) and dotted keys from user input, in place. Zod schemas are the primary defence. */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  const clean = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v as object)) {
      if (k.startsWith('$') || k.includes('.')) delete (v as Record<string, unknown>)[k];
      else clean((v as Record<string, unknown>)[k]);
    }
  };
  clean(req.body); clean(req.query); clean(req.params);
  next();
}

export const corsOrigins = () => env.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

const limiter = (windowMs: number, max: number, code: string) =>
  rateLimit({
    windowMs, limit: max, standardHeaders: true, legacyHeaders: false,
    skip: () => (env.NODE_ENV === 'test' && !process.env.FORCE_RATE_LIMIT) || env.DISABLE_RATE_LIMIT === 'true',
    handler: (_req, _res, next) => next(new AppError(429, code, 'Too many attempts. Please wait a few minutes and try again.')),
  });
export const loginLimiter = limiter(15 * 60_000, 10, 'RATE_LIMITED');
export const registerLimiter = limiter(60 * 60_000, 10, 'RATE_LIMITED');
export const resetLimiter = limiter(60 * 60_000, 5, 'RATE_LIMITED');
export const uploadLimiter = limiter(10 * 60_000, 40, 'RATE_LIMITED');
export const apiLimiter = limiter(60_000, 300, 'RATE_LIMITED');
