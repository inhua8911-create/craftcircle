import { OrderItem, Payment } from '../models/index.js';

/** Customer-facing order: never includes creator payments or platform margin. */
export async function customerOrder(o: any) {
  const items = await OrderItem.find({ order: o._id }).lean();
  return {
    id: String(o._id), orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, simulated: o.isSimulated,
    createdAt: o.createdAt, shippingAddress: o.shippingAddress, shipment: o.shipment ?? null,
    subtotalPaise: o.subtotalPaise, discountPaise: o.discountPaise, shippingPaise: o.shippingPaise, taxPaise: o.taxPaise, totalPaise: o.totalPaise, refundedPaise: o.refundedPaise,
    coupon: o.coupon?.code ?? null, reservedUntil: o.status === 'pending_payment' ? o.stockReservedUntil : null,
    items: items.map((i) => ({ id: String(i._id), productId: String(i.product), name: i.productName, slug: i.productSlug, quantity: i.quantity, unitPricePaise: i.unitPricePaise, lineTotalPaise: i.lineTotalPaise, refundedQuantity: i.refundedQuantity })),
  };
}
/** Admin view adds commercial terms and payment records. */
export async function adminOrder(o: any) {
  const [base, items, payments] = await Promise.all([customerOrder(o), OrderItem.find({ order: o._id }).lean(), Payment.find({ order: o._id }).lean()]);
  return {
    ...base, customer: { name: o.customerName, email: o.customerEmail, phone: o.customerPhone }, history: o.history,
    items: base.items.map((b, i) => ({ ...b, creatorId: String(items[i]!.creator), creatorAmountPerUnitPaise: items[i]!.creatorAmountPerUnitPaise, platformMarginPerUnitPaise: items[i]!.platformMarginPerUnitPaise, discountAllocatedPaise: items[i]!.discountAllocatedPaise, pricingVersion: items[i]!.pricingVersion })),
    payments: payments.map((p) => ({ id: String(p._id), provider: p.provider, simulated: p.isSimulated, status: p.status, amountPaise: p.amountPaise, providerOrderId: p.providerOrderId, providerPaymentId: p.providerPaymentId, failureReason: p.failureReason })),
  };
}
