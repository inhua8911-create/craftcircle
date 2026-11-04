import type { OrderStatus } from '../models/index.js';
import { AppError } from '../utils/errors.js';

// Fulfilment path is linear. Cancellation, failure, refund and return are separate branches.
const transitions: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'payment_failed', 'cancelled'],
  payment_failed: ['pending_payment', 'cancelled'],
  paid: ['processing', 'cancelled', 'partially_refunded', 'refunded'],
  processing: ['shipped', 'cancelled', 'partially_refunded', 'refunded'],
  shipped: ['delivered', 'return_requested'],
  delivered: ['return_requested', 'partially_refunded', 'refunded'],
  return_requested: ['returned', 'delivered'],
  returned: ['refunded', 'partially_refunded'],
  partially_refunded: ['refunded', 'return_requested', 'processing', 'shipped', 'delivered'],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return transitions[from]?.includes(to) ?? false;
}
export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_ORDER_TRANSITION', `Cannot move an order from "${from}" to "${to}"`);
  }
}
export const allowedNext = (from: OrderStatus) => [...(transitions[from] ?? [])];
