import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/craftcircle'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN_HOURS: z.coerce.number().default(24 * 7),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  PAYMENT_MODE: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CLOUDINARY_URL: z.string().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),
  DISABLE_RATE_LIMIT: z.enum(['true', 'false']).optional(), // local/e2e only; refused in production
  // One switch for a self-contained project/portfolio deployment: simulated payments allowed in production, images kept in MongoDB,
  // sample data seeded on first start, admin created from ADMIN_BOOTSTRAP_* on first start. Never enable for a real store.
  DEMO_MODE: z.enum(['true', 'false']).optional(),
  DEMO_PASSWORD: z.string().min(10).max(72).optional(), // password for the seeded sample accounts (default below)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print field names only; never echo values (they may be secrets).
  const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  throw new Error(`Invalid environment configuration:\n  ${fields}`);
}

export const env = parsed.data;
if (env.NODE_ENV === 'production' && env.DISABLE_RATE_LIMIT === 'true') throw new Error('DISABLE_RATE_LIMIT must not be set in production');
export const isProd = env.NODE_ENV === 'production';
export const demoMode = env.DEMO_MODE === 'true';
/** Simulated payments are fine in development, and in production only when DEMO_MODE is on. */
export const mockPaymentsAllowed = env.PAYMENT_MODE === 'mock' && (!isProd || demoMode);
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd;
export const emailConfigured = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
export const razorpayConfigured = Boolean(
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET,
);
