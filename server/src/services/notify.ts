import type { Types } from 'mongoose';
import { Notification, User } from '../models/index.js';
import { sendEmail } from './email.js';
import { logger } from '../utils/logger.js';

/** In-app notification, optionally with an email. Email status is recorded honestly; failures never break the caller. */
export async function notify(userId: Types.ObjectId | string, n: { type: string; title: string; body?: string; link?: string; email?: { subject: string; text: string } }) {
  try {
    let emailStatus: 'not_requested' | 'sent' | 'failed' | 'not_configured' = 'not_requested';
    if (n.email) {
      const u = await User.findById(userId).select('email');
      if (u) emailStatus = await sendEmail({ to: u.email, subject: n.email.subject, text: n.email.text });
    }
    await Notification.create({ user: userId, type: n.type, title: n.title, body: n.body, link: n.link, emailStatus });
  } catch (e) { logger.error({ err: (e as Error).message, type: n.type }, 'notify failed'); }
}
