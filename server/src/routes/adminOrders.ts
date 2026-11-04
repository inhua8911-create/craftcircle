import { Router } from 'express';
import { Order, OrderItem } from '../models/index.js';
import { asyncHandler, validateBody } from '../middleware/common.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { orderStatusSchema, refundSchema } from '../validators/commerce.js';
import { AppError, notFound } from '../utils/errors.js';
import { assertTransition, allowedNext } from '../services/orderStateMachine.js';
import { audit } from '../services/audit.js';
import { adminOrder } from '../services/orderShape.js';
import { recordRefund } from '../services/earnings.js';

export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAuth, requireAdmin);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

adminOrdersRouter.get('/orders', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Number(req.query.limit) || 25);
  const f: Record<string, unknown> = {};
  if (typeof req.query.status === 'string') f.status = req.query.status;
  if (typeof req.query.q === 'string' && req.query.q.trim()) { const r = new RegExp(esc(req.query.q.trim().slice(0, 60)), 'i'); f.$or = [{ orderNumber: r }, { customerEmail: r }, { customerName: r }]; }
  if (typeof req.query.from === 'string' || typeof req.query.to === 'string') f.createdAt = { ...(req.query.from && { $gte: new Date(String(req.query.from)) }), ...(req.query.to && { $lte: new Date(String(req.query.to)) }) };
  const [items, total] = await Promise.all([Order.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(f)]);
  res.json({ items: items.map((o) => ({ id: String(o._id), orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, simulated: o.isSimulated, customerName: o.customerName, totalPaise: o.totalPaise, createdAt: o.createdAt })), page, limit, total });
}));

adminOrdersRouter.get('/orders/:id', asyncHandler(async (req, res) => {
  const o = await Order.findById(req.params.id); if (!o) throw notFound('Order not found');
  res.json({ order: await adminOrder(o), allowedNext: allowedNext(o.status) });
}));

// Payment-derived states (paid, payment_failed, refunded, partially_refunded) are not settable here:
// they come only from verified payment events and the refund workflow.
adminOrdersRouter.patch('/orders/:id/status', validateBody(orderStatusSchema), asyncHandler(async (req, res) => {
  const o = await Order.findById(req.params.id); if (!o) throw notFound('Order not found');
  const { status, shipment, note } = req.body;
  if (status === 'cancelled' && o.paymentStatus === 'paid') throw new AppError(409, 'REFUND_REQUIRED', 'Paid orders must be refunded, not cancelled');
  assertTransition(o.status, status);
  if (status === 'shipped') {
    if (!shipment) throw new AppError(422, 'SHIPMENT_REQUIRED', 'Shipping provider and tracking number are required');
    o.shipment = { ...(o.shipment ?? {}), provider: shipment.provider, trackingNumber: shipment.trackingNumber, shippedAt: new Date() } as any;
  }
  if (status === 'delivered') { if (!o.shipment) throw new AppError(409, 'NOT_SHIPPED', 'Order has no shipment'); o.shipment!.deliveredAt = new Date(); }
  const before = o.status;
  o.history.push({ from: before, to: status, by: req.user!.id, note, at: new Date() } as any);
  o.status = status;
  await o.save();
  await audit(req, { action: 'order.status_changed', entityType: 'Order', entityId: o._id, before: { status: before }, after: { status }, note });
  res.json({ order: await adminOrder(o) });
}));

// Records a refund. Real (non-simulated) orders must reference the refund made in the payment provider's dashboard:
// this app does not claim to move real money automatically.
adminOrdersRouter.post('/orders/:id/refund', validateBody(refundSchema), asyncHandler(async (req, res) => {
  const key = req.get('idempotency-key');
  if (!key || key.length < 8) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  const o = await Order.findById(req.params.id); if (!o) throw notFound('Order not found');
  if (!o.isSimulated && !req.body.providerRefundId) throw new AppError(422, 'PROVIDER_REFUND_REQUIRED', 'Issue the refund in the payment provider first, then record its reference here');
  const { refund, alreadyProcessed } = await recordRefund({ orderId: o._id, lines: req.body.lines.map((l: any) => ({ orderItemId: l.orderItemId, quantity: l.quantity })), shippingRefundPaise: req.body.shippingRefundPaise, reason: req.body.reason, actorId: req.user!.id, idempotencyKey: `${o._id}:${key}` });
  if (!alreadyProcessed) await audit(req, { action: 'order.refunded', entityType: 'Order', entityId: o._id, after: { amountPaise: refund.amountPaise, providerRefundId: req.body.providerRefundId }, note: req.body.reason });
  res.status(alreadyProcessed ? 200 : 201).json({ refund: { id: String(refund._id), amountPaise: refund.amountPaise, simulated: refund.isSimulated }, alreadyProcessed });
}));
