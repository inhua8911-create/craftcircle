import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../models/index.js';

export async function audit(req: Request, e: { action: string; entityType: string; entityId?: Types.ObjectId | string; before?: unknown; after?: unknown; note?: string }) {
  await AuditLog.create({ ...e, actor: req.user?.id, actorRole: req.user?.role, ip: req.ip });
}
