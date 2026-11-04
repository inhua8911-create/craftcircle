import { Router } from 'express';
import { Order, Payment } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAuth } from '../middleware/auth.js';
import { checkoutSchema, mockConfirmSchema, razorpayVerifySchema } from '../validators/commerce.js';
import { AppError, notFound } from '../utils/errors.js';
import { cancelUnpaidOrder, placeOrder } from '../services/checkout.js';
import { confirmPayment, failPayment, initiatePayment, verifyCheckoutSignature } from '../services/payments.js';
import { customerOrder } from '../services/orderShape.js';
import { env, mockPaymentsAllowed, razorpayConfigured } from '../config/env.js';

export const checkoutRouter = Router();

// Idempotency-Key header is REQUIRED so a double-click or retry can never create two orders.
checkoutRouter.post('/checkout', requireAuth, validateBody(checkoutSchema), asyncHandler(async (req, res) => {
  const key = req.get('idempotency-key');
  if (!key || key.length < 8 || key.length > 100) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (8-100 chars) is required');
  const { order, reused } = await placeOrder({ userId: req.user!.id, customer: req.body.customer, address: req.body.address, couponCode: req.body.couponCode, idempotencyKey: `${req.user!.id}:${key}` });
  const payment = await initiatePayment(order._id, req.user!.id);
  res.status(reused ? 200 : 201).json({ order: await customerOrder(order), payment });
}));

checkoutRouter.post('/orders/:id/pay', requireAuth, asyncHandler(async (req, res) => { res.json({ payment: await initiatePayment(String(req.params.id), req.user!.id) }); }));

checkoutRouter.get('/orders', requireAuth, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = 20;
  const [orders, total] = await Promise.all([Order.find({ user: req.user!.id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Order.countDocuments({ user: req.user!.id })]);
  res.json({ items: await Promise.all(orders.map(customerOrder)), page, total });
}));
// Ownership is part of the query: someone else's order is indistinguishable from a missing one.
checkoutRouter.get('/orders/:id', requireAuth, asyncHandler(async (req, res) => {
  const o = await Order.findOne({ _id: req.params.id, user: req.user!.id });
  if (!o) throw notFound('Order not found');
  res.json({ order: await customerOrder(o) });
}));
checkoutRouter.post('/orders/:id/cancel', requireAuth, asyncHandler(async (req, res) => { await cancelUnpaidOrder(String(req.params.id), req.user!.id); res.json({ ok: true }); }));

// Development-only simulated gateway. Clearly flagged; refuses to run in production (unless DEMO_MODE=true) or when real payments are selected.
checkoutRouter.post('/payments/mock/confirm', requireAuth, validateBody(mockConfirmSchema), asyncHandler(async (req, res) => {
  if (!mockPaymentsAllowed) throw new AppError(404, 'NOT_FOUND', 'Route not found');
  const order = await Order.findOne({ _id: req.body.orderId, user: req.user!.id });
  if (!order) throw notFound('Order not found');
  const payment = await Payment.findOne({ order: order._id, provider: 'mock' }).sort({ createdAt: -1 });
  if (!payment?.providerOrderId) throw new AppError(409, 'NO_PAYMENT', 'Start payment first');
  if (req.body.outcome === 'failure') { await failPayment({ providerOrderId: payment.providerOrderId, provider: 'mock', reason: 'simulated failure' }); return void res.json({ simulated: true, status: 'payment_failed' }); }
  await confirmPayment({ providerOrderId: payment.providerOrderId, providerPaymentId: `mockpay_${payment._id}`, eventId: `mock:${payment._id}`, provider: 'mock' });
  res.json({ simulated: true, status: 'paid', notice: 'SIMULATED payment: no money was collected.' });
}));

// Browser-return verification for Razorpay Checkout. The signature, not the client's say-so, proves payment.
checkoutRouter.post('/payments/razorpay/verify', requireAuth, validateBody(razorpayVerifySchema), asyncHandler(async (req, res) => {
  if (!razorpayConfigured || env.PAYMENT_MODE !== 'razorpay') throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payments are not available right now');
  const b = req.body;
  const payment = await Payment.findOne({ providerOrderId: b.razorpay_order_id, provider: 'razorpay', order: (await Order.findOne({ _id: b.orderId, user: req.user!.id }))?._id });
  if (!payment) throw notFound('Payment not found');
  if (!verifyCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature, env.RAZORPAY_KEY_SECRET!)) throw new AppError(400, 'INVALID_SIGNATURE', 'Payment signature could not be verified');
  await confirmPayment({ providerOrderId: b.razorpay_order_id, providerPaymentId: b.razorpay_payment_id, eventId: `verify:${b.razorpay_payment_id}`, provider: 'razorpay' });
  res.json({ status: 'paid' });
}));
