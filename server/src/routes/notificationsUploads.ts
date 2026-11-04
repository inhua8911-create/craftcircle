import { Router } from 'express';
import multer from 'multer';
import { Notification } from '../models/index.js';
import { asyncHandler } from '../middleware/common.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/security.js';
import { AppError, notFound } from '../utils/errors.js';
import { MAX_IMAGE_BYTES, storeImage } from '../services/uploads.js';

export const notificationsRouter = Router();
notificationsRouter.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = 30;
  const [items, unread] = await Promise.all([Notification.find({ user: req.user!.id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Notification.countDocuments({ user: req.user!.id, readAt: null })]);
  res.json({ unread, items: items.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt })) });
}));
notificationsRouter.post('/notifications/read-all', requireAuth, asyncHandler(async (req, res) => { await Notification.updateMany({ user: req.user!.id, readAt: null }, { readAt: new Date() }); res.json({ ok: true }); }));
notificationsRouter.post('/notifications/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const r = await Notification.updateOne({ _id: req.params.id, user: req.user!.id }, { readAt: new Date() });
  if (!r.matchedCount) throw notFound('Notification not found'); res.json({ ok: true });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
export const uploadsRouter = Router();
uploadsRouter.post('/uploads/images', requireAuth, uploadLimiter, (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) return next(new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'IMAGE_TOO_LARGE' : 'UPLOAD_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller' : 'Upload failed'));
    next(err as Error | undefined);
  });
}, asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError(400, 'NO_FILE', 'Attach an image in the "file" field');
  res.status(201).json(await storeImage(req.file.buffer));
}));
