import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isProd } from '../config/env.js';

/** Validates and replaces req.body with the parsed value. Use .strict() schemas to reject unknown fields. */
export const validateBody = (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body);
  if (!r.success) return next(r.error);
  req.body = r.data;
  next();
};
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) { next(new AppError(404, 'NOT_FOUND', 'Route not found')); }

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return void res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if (err instanceof ZodError) {
    return void res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) } });
  }
  const e = err as { type?: string; code?: number; name?: string };
  if (e?.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
  if (e?.name === 'CastError') return void res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid identifier' } });
  if (e?.code === 11000) return void res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
  logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err), path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: isProd ? 'Something went wrong' : 'Something went wrong (see server logs)' } });
}
