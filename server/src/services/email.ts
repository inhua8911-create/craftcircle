import { emailConfigured, env, isProd } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type EmailStatus = 'sent' | 'failed' | 'not_configured';
/** Dev/test only: captured messages when no provider is configured. Never populated in production. */
export const devOutbox: { to: string; subject: string; text: string }[] = [];

/** Honest delivery status: 'not_configured' is returned (never 'sent') when no provider credentials exist. */
export async function sendEmail(msg: { to: string; subject: string; text: string }): Promise<EmailStatus> {
  if (!emailConfigured) {
    if (!isProd) {
      devOutbox.push(msg);
      logger.info({ to: msg.to, subject: msg.subject }, 'email NOT sent (provider not configured); captured in dev outbox');
    }
    return 'not_configured';
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'email send failed');
    return 'failed';
  }
}
