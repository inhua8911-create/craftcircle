import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { User } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { issueCsrfToken, loginLimiter, registerLimiter, resetLimiter } from '../middleware/security.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema } from '../validators/auth.js';
import { AppError, conflict } from '../utils/errors.js';
import { sendEmail } from '../services/email.js';
import { env } from '../config/env.js';
import { brand } from '../config/brand.js';

export const authRouter = Router();
const COST = env.NODE_ENV === 'test' ? 4 : 12;
// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const publicUser = (u: { _id: unknown; name: string; email: string; role: string; phone?: string | null }) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, phone: u.phone ?? undefined });

authRouter.get('/csrf', (_req, res) => { res.json({ csrfToken: issueCsrfToken(res) }); });

authRouter.post('/register', registerLimiter, validateBody(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (await User.exists({ email })) throw conflict('An account with this email already exists');
  // Role is NOT read from input: public registration can only ever create customers.
  const user = await User.create({ name, email, phone, passwordHash: await bcrypt.hash(password, COST), role: 'customer' });
  setSessionCookie(res, user);
  void sendEmail({ to: email, subject: `Welcome to ${brand.name}`, text: `Hi ${name}, your account is ready.` });
  res.status(201).json({ user: publicUser(user) });
}));

authRouter.post('/login', loginLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash tokenVersion status role name email phone');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available. Contact support.');
  user.lastLoginAt = new Date();
  await user.save();
  setSessionCookie(res, user);
  res.json({ user: publicUser(user) });
}));

authRouter.post('/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const u = await User.findById(req.user!.id);
  res.json({ user: u ? publicUser(u) : null });
}));

// Always responds identically so it can't be used to discover registered emails.
authRouter.post('/forgot-password', resetLimiter, validateBody(forgotSchema), asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.body.email, status: 'active' });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = sha256(token);
    user.resetTokenExpires = new Date(Date.now() + 60 * 60_000);
    await user.save();
    const link = `${env.CLIENT_ORIGIN.split(',')[0]}/reset-password?token=${token}`;
    void sendEmail({ to: user.email, subject: `Reset your ${brand.name} password`, text: `Use this link within 1 hour: ${link}` });
  }
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
}));

authRouter.post('/reset-password', resetLimiter, validateBody(resetSchema), asyncHandler(async (req, res) => {
  const user = await User.findOne({ resetTokenHash: sha256(req.body.token), resetTokenExpires: { $gt: new Date() } }).select('+resetTokenHash +resetTokenExpires');
  if (!user) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
  user.passwordHash = await bcrypt.hash(req.body.password, COST);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  user.tokenVersion += 1; // signs out every existing session
  await user.save();
  clearSessionCookie(res);
  res.json({ message: 'Password updated. Please sign in.' });
}));
