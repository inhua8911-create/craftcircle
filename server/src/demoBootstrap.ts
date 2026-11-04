// DEMO_MODE only. Runs once per start, after the DB connects:
//  1. if the database has no users, seeds the sample marketplace (same seed script as `npm run seed`);
//  2. creates the admin from ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD if that account does not exist yet.
// An existing account is never modified, so restarting never resets a password you changed.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { env } from './config/env.js';
import { AuditLog, User } from './models/index.js';
import { password } from './validators/auth.js';
import { logger } from './utils/logger.js';

export const DEFAULT_DEMO_PASSWORD = 'CraftDemo2026!';

export async function demoBootstrap() {
  if (!(await User.exists({}))) {
    logger.info('DEMO_MODE: empty database, seeding sample data');
    const seed = path.join(import.meta.dirname, `seed${path.extname(import.meta.filename)}`);
    const r = spawnSync(process.execPath, [...process.execArgv, seed], { stdio: 'inherit', env: { ...process.env, SEED_PASSWORD: env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD } });
    if (r.status !== 0) logger.error('DEMO_MODE: seeding failed (see output above); the store will start empty');
  }

  const email = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const pw = env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !pw) return logger.warn('DEMO_MODE: ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD not set, so no admin account was created');
  const ok = password.safeParse(pw);
  if (!ok.success) return logger.error(`DEMO_MODE: admin password rejected: ${ok.error.issues[0]?.message}`);
  if (await User.exists({ email })) return;
  const user = await User.create({ name: 'Administrator', email, passwordHash: await bcrypt.hash(pw, 12), role: 'super_admin', emailVerified: true });
  await AuditLog.create({ action: 'admin.bootstrap', entityType: 'User', entityId: user._id, note: 'created on first start (DEMO_MODE)' });
  logger.info(`DEMO_MODE: admin account created for ${email}`);
}
