// Usage: ADMIN_BOOTSTRAP_EMAIL=you@example.com ADMIN_BOOTSTRAP_PASSWORD='...' npm run bootstrap-admin
// Creates (or promotes) a super_admin. There is no default or demo admin, and no HTTP route can do this.
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from './config/db.js';
import { env } from './config/env.js';
import { User, AuditLog } from './models/index.js';
import { password } from './validators/auth.js';

const email = env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const pw = env.ADMIN_BOOTSTRAP_PASSWORD;
if (!email || !pw) { console.error('Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (single-use; remove them afterwards).'); process.exit(1); }
const check = password.safeParse(pw);
if (!check.success) { console.error('Password rejected:', check.error.issues[0]?.message); process.exit(1); }

await connectDb();
const existing = await User.findOne({ email });
const passwordHash = await bcrypt.hash(pw, 12);
let user;
if (existing) {
  existing.role = 'super_admin'; existing.passwordHash = passwordHash; existing.tokenVersion += 1; user = await existing.save();
} else {
  user = await User.create({ name: 'Administrator', email, passwordHash, role: 'super_admin', emailVerified: true });
}
await AuditLog.create({ action: 'admin.bootstrap', entityType: 'User', entityId: user._id, note: existing ? 'promoted existing user' : 'created' });
console.log(`super_admin ready: ${email}. Remove ADMIN_BOOTSTRAP_* from your environment now.`);
await mongoose.disconnect();
