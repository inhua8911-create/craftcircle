import { Router } from 'express';
import { User } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAdmin, requireAuth, requireRole } from '../middleware/auth.js';
import { roleSchema, statusSchema } from '../validators/auth.js';
import { AppError, forbidden, notFound } from '../utils/errors.js';
import { audit } from '../services/audit.js';

export const adminUsersRouter = Router();
adminUsersRouter.use(requireAuth, requireAdmin);

adminUsersRouter.get('/users', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const role = typeof req.query.role === 'string' ? req.query.role : undefined;
  const filter: Record<string, unknown> = role ? { role } : {};
  const [items, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), User.countDocuments(filter)]);
  res.json({ items: items.map((u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt })), page, limit, total });
}));

// Only super_admin may change roles. Nobody can change their own role.
adminUsersRouter.patch('/users/:id/role', requireRole('super_admin'), validateBody(roleSchema), asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw notFound('User not found');
  if (String(target._id) === String(req.user!.id)) throw forbidden('You cannot change your own role');
  const before = target.role;
  target.role = req.body.role;
  target.tokenVersion += 1; // force re-login with new privileges
  await target.save();
  await audit(req, { action: 'user.role_changed', entityType: 'User', entityId: target._id, before: { role: before }, after: { role: target.role } });
  res.json({ id: target._id, role: target.role });
}));

// Admins can suspend/reactivate customers and creators. Only super_admin may touch admin accounts.
adminUsersRouter.patch('/users/:id/status', validateBody(statusSchema), asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw notFound('User not found');
  if (String(target._id) === String(req.user!.id)) throw forbidden('You cannot change your own status');
  if (['admin', 'super_admin'].includes(target.role) && req.user!.role !== 'super_admin') throw new AppError(403, 'FORBIDDEN', 'Only a super admin can change an admin account');
  const before = target.status;
  target.status = req.body.status;
  if (before !== target.status) target.tokenVersion += 1;
  await target.save();
  await audit(req, { action: 'user.status_changed', entityType: 'User', entityId: target._id, before: { status: before }, after: { status: target.status }, note: req.body.note });
  res.json({ id: target._id, status: target.status });
}));
