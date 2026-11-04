import crypto from 'node:crypto';
import { Router, raw } from 'express';
import { asyncHandler } from '../middleware/common.js';
import { env, razorpayConfigured } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { confirmPayment, failPayment, verifyWebhookSignature } from '../services/payments.js';

export const webhookRouter = Router();
// Raw body is required for signature verification. Mounted BEFORE json parsing and CSRF (the signature is the auth).
webhookRouter.post('/razorpay', raw({ type: 'application/json', limit: '200kb' }), asyncHandler(async (req, res) => {
  if (!razorpayConfigured || env.PAYMENT_MODE !== 'razorpay') throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Webhook not enabled');
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !verifyWebhookSignature(body, req.get('x-razorpay-signature'), env.RAZORPAY_WEBHOOK_SECRET!)) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature');
  const evt = JSON.parse(body.toString('utf8')) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; error_description?: string } } } };
  const eventId = req.get('x-razorpay-event-id') ?? crypto.createHash('sha256').update(body).digest('hex');
  const pay = evt.payload?.payment?.entity;
  if (pay?.order_id && pay.id) {
    if (evt.event === 'payment.captured') await confirmPayment({ providerOrderId: pay.order_id, providerPaymentId: pay.id, amountPaise: pay.amount, eventId, provider: 'razorpay' });
    else if (evt.event === 'payment.failed') await failPayment({ providerOrderId: pay.order_id, provider: 'razorpay', reason: pay.error_description });
  }
  res.json({ received: true }); // 2xx for handled, duplicate and ignored events so the provider stops retrying
}));
