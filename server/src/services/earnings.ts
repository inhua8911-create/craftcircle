import { Types, type ClientSession } from 'mongoose';
import { CreatorEarning, FinancialLedgerEntry, Order, OrderItem, Refund } from '../models/index.js';
import { AppError, notFound } from '../utils/errors.js';
import { computeLineRefund } from './pricing.js';
import { assertTransition } from './orderStateMachine.js';
import { isDuplicateKey, withTx } from './tx.js';

type Id = Types.ObjectId | string;

async function post(entries: Record<string, unknown>[], session: ClientSession) {
  await FinancialLedgerEntry.create(entries, { session, ordered: true });
}

/**
 * Create creator earnings + ledger entries for an order whose payment has been VERIFIED
 * (webhook signature checked, or mock adapter in test mode). Idempotent: safe to call twice.
 */
export async function recordSaleFromPaidOrder(orderId: Id): Promise<{ alreadyProcessed: boolean; earnings: number }> {
  try {
    return await withTx(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw notFound('Order not found');
      if (order.paymentStatus !== 'paid') throw new AppError(409, 'ORDER_NOT_PAID', 'Earnings can only be recorded for paid orders');
      if (await CreatorEarning.exists({ order: order._id }).session(session)) return { alreadyProcessed: true, earnings: 0 };

      const items = await OrderItem.find({ order: order._id }).session(session);
      const sim = order.isSimulated;
      for (const it of items) {
        const creatorTotal = it.creatorAmountPerUnitPaise * it.quantity;
        const margin = it.lineTotalPaise - creatorTotal;
        await CreatorEarning.create(
          [{ creator: it.creator, order: order._id, orderItem: it._id, product: it.product, quantity: it.quantity, amountPerUnitPaise: it.creatorAmountPerUnitPaise, grossPaise: creatorTotal, status: 'pending', isSimulated: sim }],
          { session },
        );
        await post(
          [
            { entryType: 'sale', account: 'creator_payable', creator: it.creator, order: order._id, orderItem: it._id, amountPaise: creatorTotal, isSimulated: sim, reference: order.orderNumber, idempotencyKey: `sale:${it._id}:creator_payable` },
            { entryType: 'sale', account: 'platform_margin', creator: it.creator, order: order._id, orderItem: it._id, amountPaise: margin, isSimulated: sim, reference: order.orderNumber, memo: `net of discount ${it.discountAllocatedPaise}`, idempotencyKey: `sale:${it._id}:platform_margin` },
          ],
          session,
        );
      }
      const extra: any[] = [];
      if (order.shippingPaise) extra.push({ entryType: 'sale', account: 'shipping_collected', order: order._id, amountPaise: order.shippingPaise, isSimulated: sim, reference: order.orderNumber, idempotencyKey: `sale:${order._id}:shipping` });
      if (order.taxPaise) extra.push({ entryType: 'sale', account: 'tax_collected', order: order._id, amountPaise: order.taxPaise, isSimulated: sim, reference: order.orderNumber, idempotencyKey: `sale:${order._id}:tax` });
      if (extra.length) await post(extra, session);
      return { alreadyProcessed: false, earnings: items.length };
    });
  } catch (e) {
    // A concurrent duplicate loses on the unique index and its transaction rolls back entirely.
    if (isDuplicateKey(e)) return { alreadyProcessed: true, earnings: 0 };
    throw e;
  }
}

export interface RefundRequest {
  orderId: Id;
  lines: { orderItemId: Id; quantity: number }[];
  shippingRefundPaise?: number;
  reason?: string;
  actorId?: Id;
  idempotencyKey: string;
}

/**
 * Record a refund. Does NOT call a payment provider: the caller must have refunded (or simulated)
 * the money first. Financial effects are compensating ledger entries; nothing is overwritten.
 */
export async function recordRefund(req: RefundRequest) {
  try {
    return await withTx(async (session) => {
      const existing = await Refund.findOne({ idempotencyKey: req.idempotencyKey }).session(session);
      if (existing) return { refund: existing, alreadyProcessed: true };

      const order = await Order.findById(req.orderId).session(session);
      if (!order) throw notFound('Order not found');
      if (order.paymentStatus === 'unpaid' || order.paymentStatus === 'failed') throw new AppError(409, 'ORDER_NOT_PAID', 'Order has no captured payment to refund');

      const shippingRefund = req.shippingRefundPaise ?? 0;
      if (!Number.isSafeInteger(shippingRefund) || shippingRefund < 0) throw new AppError(422, 'REFUND_INVALID', 'Invalid shipping refund');

      let total = shippingRefund;
      const refundItems: { orderItem: Types.ObjectId; quantity: number; amountPaise: number }[] = [];
      for (const line of req.lines) {
        const it = await OrderItem.findOne({ _id: line.orderItemId, order: order._id }).session(session);
        if (!it) throw new AppError(404, 'NOT_FOUND', 'Order item not found on this order');
        const r = computeLineRefund({ quantity: it.quantity, lineTotalPaise: it.lineTotalPaise, creatorAmountPerUnitPaise: it.creatorAmountPerUnitPaise, alreadyRefundedQuantity: it.refundedQuantity, refundQuantity: line.quantity });
        total += r.refundPaise;
        refundItems.push({ orderItem: it._id, quantity: line.quantity, amountPaise: r.refundPaise });

        await OrderItem.updateOne({ _id: it._id }, { $inc: { refundedQuantity: line.quantity, refundedPaise: r.refundPaise } }, { session });
        await post(
          [
            { entryType: 'refund_adjustment', account: 'creator_payable', creator: it.creator, order: order._id, orderItem: it._id, amountPaise: -r.creatorAdjustmentPaise, isSimulated: order.isSimulated, reference: order.orderNumber, createdBy: req.actorId, idempotencyKey: `refund:${req.idempotencyKey}:${it._id}:creator` },
            { entryType: 'refund_adjustment', account: 'platform_margin', creator: it.creator, order: order._id, orderItem: it._id, amountPaise: -r.platformMarginAdjustmentPaise, isSimulated: order.isSimulated, reference: order.orderNumber, createdBy: req.actorId, idempotencyKey: `refund:${req.idempotencyKey}:${it._id}:margin` },
          ],
          session,
        );
        const earning = await CreatorEarning.findOne({ orderItem: it._id }).session(session);
        if (earning) {
          earning.adjustmentPaise -= r.creatorAdjustmentPaise;
          const net = earning.grossPaise + earning.adjustmentPaise;
          if (earning.paidPaise > 0 || net === 0) earning.status = 'adjusted'; // paid-out earnings => clawback tracked in balance
          await earning.save({ session });
        }
      }
      if (order.refundedPaise + total > order.totalPaise) throw new AppError(422, 'REFUND_EXCEEDS_ORDER', 'Refund total exceeds the amount collected');
      if (total <= 0) throw new AppError(422, 'REFUND_INVALID', 'Refund amount must be greater than zero');
      if (shippingRefund) {
        await post([{ entryType: 'refund_adjustment', account: 'shipping_collected', order: order._id, amountPaise: -shippingRefund, isSimulated: order.isSimulated, createdBy: req.actorId, idempotencyKey: `refund:${req.idempotencyKey}:shipping` }], session);
      }

      const [refund] = await Refund.create(
        [{ order: order._id, items: refundItems, amountPaise: total, shippingRefundPaise: shippingRefund, reason: req.reason, status: 'processed', isSimulated: order.isSimulated, idempotencyKey: req.idempotencyKey, processedBy: req.actorId }],
        { session },
      );

      order.refundedPaise += total;
      const full = order.refundedPaise === order.totalPaise;
      order.paymentStatus = full ? 'refunded' : 'partially_refunded';
      const target = full ? 'refunded' : 'partially_refunded';
      if (order.status !== target) {
        assertTransition(order.status, target);
        order.history.push({ from: order.status, to: target, by: req.actorId as any, note: req.reason, at: new Date() } as any);
        order.status = target;
      }
      await order.save({ session });
      return { refund: refund!, alreadyProcessed: false };
    });
  } catch (e) {
    if (isDuplicateKey(e)) {
      const refund = await Refund.findOne({ idempotencyKey: req.idempotencyKey });
      if (refund) return { refund, alreadyProcessed: true };
    }
    throw e;
  }
}

/** Earnings become eligible for settlement once the order has been delivered for `holdDays`. */
export async function promoteEligibleEarnings(now = new Date(), holdDays = 7): Promise<number> {
  const cutoff = new Date(now.getTime() - holdDays * 86_400_000);
  const orders = await Order.find({ 'shipment.deliveredAt': { $lte: cutoff }, paymentStatus: { $in: ['paid', 'partially_refunded'] } }).select('_id');
  if (!orders.length) return 0;
  const res = await CreatorEarning.updateMany(
    { order: { $in: orders.map((o) => o._id) }, status: 'pending' },
    { $set: { status: 'eligible', eligibleAt: now } },
  );
  return res.modifiedCount;
}

export interface CreatorBalances {
  pendingPaise: number; // not yet eligible
  availablePaise: number; // eligible/approved, unpaid
  onHoldPaise: number;
  paidPaise: number;
  grossEarnedPaise: number;
  adjustmentsPaise: number;
}

/** Everything derived from CreatorEarning rows, which are themselves derived from paid orders. */
export async function creatorBalances(creatorId: Id): Promise<CreatorBalances> {
  const rows = await CreatorEarning.find({ creator: creatorId }).select('grossPaise adjustmentPaise paidPaise status');
  const b: CreatorBalances = { pendingPaise: 0, availablePaise: 0, onHoldPaise: 0, paidPaise: 0, grossEarnedPaise: 0, adjustmentsPaise: 0 };
  for (const r of rows) {
    const net = r.grossPaise + r.adjustmentPaise;
    const unpaid = net - r.paidPaise; // negative => clawback owed after a paid-out earning was refunded
    b.grossEarnedPaise += r.grossPaise;
    b.adjustmentsPaise += r.adjustmentPaise;
    b.paidPaise += r.paidPaise;
    if (r.status === 'pending') b.pendingPaise += unpaid;
    else if (r.status === 'on_hold') b.onHoldPaise += unpaid;
    else if (['eligible', 'approved', 'adjusted'].includes(r.status)) b.availablePaise += unpaid;
  }
  return b;
}
