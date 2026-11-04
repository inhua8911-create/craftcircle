import { z } from 'zod';

export const password = z.string().min(10, 'Use at least 10 characters').max(72, 'Use at most 72 characters');
// strictObject rejects unknown keys, so clients can never smuggle in `role` or `status`.
export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/, 'Enter a valid phone number').optional(),
  password,
});
export const loginSchema = z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1).max(200) });
export const forgotSchema = z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email()) });
export const resetSchema = z.strictObject({ token: z.string().length(64), password });
export const roleSchema = z.strictObject({ role: z.enum(['customer', 'creator', 'admin', 'super_admin']) });
export const statusSchema = z.strictObject({ status: z.enum(['active', 'suspended']), note: z.string().max(500).optional() });
