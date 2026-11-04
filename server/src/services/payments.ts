import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import { AuditLog, InventoryMovement, Order, OrderItem, Payment, Product, WebhookEvent } from '../models/index.js';
import { env, mockPaymentsAllowed, razorpayConfigured } from '../config/env.js';
import { AppError, notFound } from '../utils/errors.js';
import { assertTransition } from './orderStateMachine.js';
import { recordSaleFromPaidOrder } from './earnings.js';
import { isDuplicateKey, withTx } from './tx.js';

type Id = Types.ObjectId | string;
export const paymentMode = () => env.PAYMENT_MODE;

/** Creates the provider-side payment intent. 'mock' moves no money and is always flagged simulated. */
export async function initiatePayment(orderId: Id, userId: Id) {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw notFound('Order not found');
  if (!['pending_payment', 'payment_failed'].includes(order.status)) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order cannot be paid');
  if (order.stockReservedUntil && order.stockReservedUntil < new Date()) throw new AppError(409, 'RESERVATION_EXPIRED', 'Your reservation expired. Please check out again.');

  let providerOrderId: string; let simulated: boolean; let publicConfig: Record<string, unknown> = {};
  if (env.PAYMENT_MODE === 'mock') {
    if (!mockPaymentsAllowed) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Mock payments are disabled in production');
    providerOrderId = `mock_${order._id}_${crypto.randomBytes(4).toString('hex')}`; simulated = true;
  } else {
    if (!razorpayConfigured) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payments are not available right now');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}` },
      body: JSON.stringify({ amount: order.totalPaise, currency: 'INR', receipt: order.orderNumber }),
    });
    if (!res.ok) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not start the payment. Please try again.');
    providerOrderId = ((await res.json()) as { id: string }).id; simulated = false; publicConfig = { keyId: env.RAZORPAY_KEY_ID };
  }
  const payment = await Payment.create({ order: order._id, provider: env.PAYMENT_MODE, isSimulated: simulated, providerOrderId, amountPaise: order.totalPaise });
  if (order.status === 'payment_failed') { assertTransition('payment_failed', 'pending_payment'); order.status = 'pending_payment'; await order.save(); }
  return { paymentId: String(payment._id), provider: env.PAYMENT_MODE, simulated, providerOrderId, amountPaise: order.totalPaise, ...publicConfig };
}

/**
 * THE one path that marks an order paid. Called only with a verified signal: a verified Razorpay webhook or
 * checkout signature, or the mock adapter. Idempotent per event and per payment; amount is checked against OUR order total.
 */
export async function confirmPayment(a: { providerOrderId: string; providerPaymentId: string; amountPaise?: number; eventId: string; provider: 'mock' | 'razorpay' }) {
  let outcome: { orderId: Types.ObjectId; alreadyProcessed: boolean; needsManualRefund?: boolean; amountMismatch?: boolean };
  try {
    outcome = await withTx(async (session) => {
      const payment = await Payment.findOne({ providerOrderId: a.providerOrderId, provider: a.provider }).session(session);
      if (!payment) throw notFound('Payment not found');
      const order = await Order.findById(payment.order).session(session);
      if (!order) throw notFound('Order not found');
      if (payment.status === 'captured') return { orderId: order._id, alreadyProcessed: true };
      if (a.amountPaise != null && a.amountPaise !== payment.amountPaise) return { orderId: order._id, alreadyProcessed: false, amountMismatch: true };

      await WebhookEvent.create([{ provider: a.provider, eventId: a.eventId, type: 'payment.captured' }], { session });
      payment.status = 'captured'; payment.providerPaymentId = a.providerPaymentId;
      if (!['pending_payment', 'payment_failed'].includes(order.status)) {
        // Money arrived for an order we already cancelled/expired: record it, do NOT fulfil, flag for manual refund.
        payment.failureReason = 'captured_after_order_closed';
        await payment.save({ session });
        await AuditLog.create([{ action: 'payment.captured_for_closed_order', entityType: 'Order', entityId: order._id, note: 'Manual refund required' }], { session });
        return { orderId: order._id, alreadyProcessed: false, needsManualRefund: true };
      }
      await payment.save({ session });
      for (const it of await OrderItem.find({ order: order._id }).session(session)) {
        const p = await Product.findById(it.product).session(session);
        if (p && !p.madeToOrder) {
          const r = await Product.updateOne({ _id: p._id, stock: { $gte: it.quantity }, reserved: { $gte: it.quantity } }, { $inc: { stock: -it.quantity, reserved: -it.quantity, soldCount: it.quantity } }, { session });
          if (r.modifiedCount !== 1) throw new AppError(500, 'INVENTORY_INCONSISTENT', 'Reservation missing for a paid order');
          await InventoryMovement.create([{ product: p._id, type: 'sale', delta: -it.quantity, reservedDelta: -it.quantity, order: order._id, idempotencyKey: `sale:${order._id}:${p._id}` }], { session });
        } else if (p) await Product.updateOne({ _id: p._id }, { $inc: { soldCount: it.quantity } }, { session });
      }
      assertTransition(order.status, 'paid');
      order.history.push({ from: order.status, to: 'paid', note: a.provider === 'mock' ? 'SIMULATED payment' : 'payment captured', at: new Date() } as any);
      order.status = 'paid'; order.paymentStatus = 'paid'; order.isSimulated = payment.isSimulated; order.stockReservedUntil = undefined;
      await order.save({ session });
      return { orderId: order._id, alreadyProcessed: false };
    });
  } catch (e) {
    if (!isDuplicateKey(e)) throw e;
    const p = await Payment.findOne({ providerOrderId: a.providerOrderId });
    if (!p) throw e;
    outcome = { orderId: p.order, alreadyProcessed: true };
  }
  if (outcome.amountMismatch) {
    await AuditLog.create({ action: 'payment.amount_mismatch', entityType: 'Order', entityId: outcome.orderId, note: `provider reported ${a.amountPaise}` });
    return outcome;
  }
  if (!outcome.needsManualRefund) await recordSaleFromPaidOrder(outcome.orderId); // idempotent; also heals a crash between the two steps
  return outcome;
}

export async function failPayment(a: { providerOrderId: string; provider: 'mock' | 'razorpay'; reason?: string }) {
  return withTx(async (session) => {
    const payment = await Payment.findOne({ providerOrderId: a.providerOrderId, provider: a.provider }).session(session);
    if (!payment) throw notFound('Payment not found');
    if (payment.status === 'captured') return { ignored: true };
    payment.status = 'failed'; payment.failureReason = a.reason; await payment.save({ session });
    const order = await Order.findById(payment.order).session(session);
    if (order?.status === 'pending_payment') { order.history.push({ from: 'pending_payment', to: 'payment_failed', note: a.reason, at: new Date() } as any); order.status = 'payment_failed'; order.paymentStatus = 'failed'; await order.save({ session }); }
    return { ignored: false };
  });
}

export const verifyWebhookSignature = (raw: Buffer, signature: string | undefined, secret: string) => safeEq(crypto.createHmac('sha256', secret).update(raw).digest('hex'), signature);
export const verifyCheckoutSignature = (orderId: string, paymentId: string, signature: string | undefined, secret: string) => safeEq(crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'), signature);
function safeEq(expected: string, given: string | undefined) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}
