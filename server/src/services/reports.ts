import { AuditLog, CreatorApplication, CreatorEarning, CreatorProfile, FinancialLedgerEntry, Order, OrderItem, Payout, Product, Refund, User } from '../models/index.js';

const PAID = ['paid', 'partially_refunded', 'refunded'];
const rs = (paise: number) => Number((paise / 100).toFixed(2));
export interface Range { from?: Date; to?: Date }
const between = (r: Range, field = 'createdAt') => (r.from || r.to ? { [field]: { ...(r.from && { $gte: r.from }), ...(r.to && { $lte: r.to }) } } : {});

/**
 * Metric definitions (also shown in the UI):
 *  - GMV: total customers paid on orders with verified payment (items + shipping + tax), before refunds.
 *  - Net sales: GMV minus refunds.
 *  - Creator earnings payable: ledger balance still owed to creators (earned - refunded - paid out).
 *  - Settled creator earnings: ledger total recorded as paid out.
 *  - Platform revenue (gross margin): selling price - agreed creator amount - discounts - refunded margin. NOT profit: excludes payment fees and other costs.
 * "simulated" figures come from demo/mock payments and are reported separately so they can never be mistaken for real money.
 */
export async function overview(range: Range) {
  const [orders, ledger] = await Promise.all([
    Order.aggregate([{ $match: { paymentStatus: { $in: PAID }, ...between(range) } }, { $group: { _id: '$isSimulated', gmv: { $sum: '$totalPaise' }, refunds: { $sum: '$refundedPaise' }, orders: { $sum: 1 } } }]),
    FinancialLedgerEntry.aggregate([{ $match: between(range) }, { $group: { _id: { a: '$account', s: '$isSimulated' }, total: { $sum: '$amountPaise' } } }]),
  ]);
  const side = (sim: boolean) => {
    const o = orders.find((x) => !!x._id === sim); const l = (a: string) => ledger.find((x) => x._id.a === a && !!x._id.s === sim)?.total ?? 0;
    const gmv = o?.gmv ?? 0; const refunds = o?.refunds ?? 0;
    return { orders: o?.orders ?? 0, gmvPaise: gmv, refundsPaise: refunds, netSalesPaise: gmv - refunds, creatorPayablePaise: l('creator_payable'), creatorSettledPaise: l('creator_paid'), platformRevenuePaise: l('platform_margin') };
  };
  const [customers, activeCreators, pendingApps, awaiting, published, byStatus, recent] = await Promise.all([
    User.countDocuments({ role: 'customer' }), CreatorProfile.countDocuments({ status: 'active' }), CreatorApplication.countDocuments({ status: { $in: ['submitted', 'under_review'] } }),
    Product.countDocuments({ status: { $in: ['submitted', 'under_review'] } }), Product.countDocuments({ status: 'published' }),
    Order.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]), AuditLog.find().sort({ createdAt: -1 }).limit(12).lean(),
  ]);
  return {
    counts: { customers, activeCreators, pendingApplications: pendingApps, productsAwaitingApproval: awaiting, publishedProducts: published },
    ordersByStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.n])),
    live: side(false), simulated: side(true),
    recentActivity: recent.map((a) => ({ id: String(a._id), action: a.action, entityType: a.entityType, entityId: a.entityId ? String(a.entityId) : null, actorRole: a.actorRole, note: a.note, at: a.createdAt })),
    definitions: {
      gmv: 'Total paid by customers on orders with verified payment (items, shipping and tax), before refunds.', netSales: 'GMV minus refunds.',
      creatorPayable: 'Still owed to creators: earned, less refunds, less amounts already paid out.', creatorSettled: 'Total recorded as paid out to creators.',
      platformRevenue: 'Gross margin only: selling price minus the agreed creator amount, discounts and refunded margin. This is NOT profit; payment fees and other costs are not included.',
      simulated: 'Demo-mode orders paid through the mock gateway. No real money moved.',
    },
  };
}

type Table = { columns: string[]; rows: (string | number)[][] };
const iso = (d?: Date | null) => (d ? d.toISOString() : '');
const nameMap = async (ids: unknown[]) => new Map((await CreatorProfile.find({ _id: { $in: ids } }).select('displayName').lean()).map((c) => [String(c._id), c.displayName ?? '']));
const itemsOnPaidOrders = (r: Range) => [{ $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'o' } }, { $unwind: '$o' }, { $match: { 'o.paymentStatus': { $in: PAID }, ...(r.from || r.to ? { 'o.createdAt': { ...(r.from && { $gte: r.from }), ...(r.to && { $lte: r.to }) } } : {}) } }];

/** Reports deliberately omit customer names, emails, phones and street addresses. */
export const REPORTS: Record<string, (r: Range) => Promise<Table>> = {
  orders: async (r) => ({ columns: ['Order', 'Date', 'Status', 'Payment', 'Simulated', 'Subtotal (INR)', 'Discount (INR)', 'Shipping (INR)', 'Tax (INR)', 'Total (INR)', 'Refunded (INR)', 'Coupon', 'Ship to city', 'Ship to state'],
    rows: (await Order.find(between(r)).sort({ createdAt: -1 }).limit(50000).lean()).map((o) => [o.orderNumber, iso(o.createdAt), o.status, o.paymentStatus, o.isSimulated ? 'yes' : 'no', rs(o.subtotalPaise), rs(o.discountPaise), rs(o.shippingPaise), rs(o.taxPaise), rs(o.totalPaise), rs(o.refundedPaise), o.coupon?.code ?? '', o.shippingAddress?.city ?? '', o.shippingAddress?.state ?? '']) }),
  'product-sales': async (r) => {
    const rows = await OrderItem.aggregate([...itemsOnPaidOrders(r), { $group: { _id: '$product', name: { $first: '$productName' }, creator: { $first: '$creator' }, units: { $sum: { $subtract: ['$quantity', '$refundedQuantity'] } }, sales: { $sum: { $subtract: ['$lineTotalPaise', '$refundedPaise'] } }, owed: { $sum: { $multiply: [{ $subtract: ['$quantity', '$refundedQuantity'] }, '$creatorAmountPerUnitPaise'] } } } }, { $sort: { sales: -1 } }]);
    const n = await nameMap(rows.map((x) => x.creator));
    return { columns: ['Product', 'Creator', 'Units sold (net)', 'Net sales (INR)', 'Creator amount (INR)'], rows: rows.map((x) => [x.name, n.get(String(x.creator)) ?? '', x.units, rs(x.sales), rs(x.owed)]) };
  },
  'creator-performance': async (r) => {
    const rows = await OrderItem.aggregate([...itemsOnPaidOrders(r), { $group: { _id: '$creator', orders: { $addToSet: '$order' }, units: { $sum: { $subtract: ['$quantity', '$refundedQuantity'] } }, sales: { $sum: { $subtract: ['$lineTotalPaise', '$refundedPaise'] } }, owed: { $sum: { $multiply: [{ $subtract: ['$quantity', '$refundedQuantity'] }, '$creatorAmountPerUnitPaise'] } } } }, { $sort: { sales: -1 } }]);
    const n = await nameMap(rows.map((x) => x._id));
    return { columns: ['Creator', 'Orders', 'Units sold (net)', 'Net sales (INR)', 'Creator earnings (INR)', 'Gross margin (INR)'], rows: rows.map((x) => [n.get(String(x._id)) ?? '', x.orders.length, x.units, rs(x.sales), rs(x.owed), rs(x.sales - x.owed)]) };
  },
  'creator-earnings': async (r) => {
    const e = await CreatorEarning.find(between(r)).sort({ createdAt: -1 }).limit(50000).populate('order', 'orderNumber').populate('orderItem', 'productName').lean() as any[];
    const n = await nameMap(e.map((x) => x.creator));
    return { columns: ['Creator', 'Order', 'Product', 'Qty', 'Per unit (INR)', 'Gross (INR)', 'Adjustment (INR)', 'Paid (INR)', 'Status', 'Simulated'], rows: e.map((x) => [n.get(String(x.creator)) ?? '', x.order?.orderNumber ?? '', x.orderItem?.productName ?? '', x.quantity, rs(x.amountPerUnitPaise), rs(x.grossPaise), rs(x.adjustmentPaise), rs(x.paidPaise), x.status, x.isSimulated ? 'yes' : 'no']) };
  },
  payouts: async (r) => {
    const p = await Payout.find(between(r)).sort({ createdAt: -1 }).limit(50000).lean(); const n = await nameMap(p.map((x) => x.creator));
    return { columns: ['Batch', 'Creator', 'Amount (INR)', 'Status', 'Bank reference', 'Paid at', 'Simulated'], rows: p.map((x) => [x.batchNumber, n.get(String(x.creator)) ?? '', rs(x.amountPaise), x.status, x.paymentReference ?? '', iso(x.paidAt), x.isSimulated ? 'yes' : 'no']) };
  },
  refunds: async (r) => {
    const f = await Refund.find(between(r)).sort({ createdAt: -1 }).limit(50000).populate('order', 'orderNumber').lean() as any[];
    return { columns: ['Order', 'Date', 'Amount (INR)', 'Shipping refunded (INR)', 'Status', 'Reason', 'Simulated'], rows: f.map((x) => [x.order?.orderNumber ?? '', iso(x.createdAt), rs(x.amountPaise), rs(x.shippingRefundPaise), x.status, x.reason ?? '', x.isSimulated ? 'yes' : 'no']) };
  },
  inventory: async () => {
    const p = await Product.find({ status: { $ne: 'archived' } }).sort({ name: 1 }).limit(50000).lean(); const n = await nameMap(p.map((x) => x.creator));
    return { columns: ['Product', 'Creator', 'Status', 'Made to order', 'On hand', 'Reserved', 'Available', 'Selling price (INR)'], rows: p.map((x) => [x.name, n.get(String(x.creator)) ?? '', x.status, x.madeToOrder ? 'yes' : 'no', x.stock, x.reserved, x.madeToOrder ? '' : Math.max(0, x.stock - x.reserved), x.sellingPricePaise != null ? rs(x.sellingPricePaise) : '']) };
  },
  'platform-revenue': async (r) => {
    const rows = await FinancialLedgerEntry.aggregate([{ $match: { account: { $in: ['platform_margin', 'shipping_collected', 'tax_collected'] }, ...between(r) } }, { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, a: '$account', s: '$isSimulated' }, total: { $sum: '$amountPaise' } } }, { $sort: { '_id.d': -1 } }]);
    return { columns: ['Date (IST)', 'Account', 'Simulated', 'Amount (INR)'], rows: rows.map((x) => [x._id.d, x._id.a === 'platform_margin' ? 'Gross margin' : x._id.a === 'shipping_collected' ? 'Shipping collected' : 'Tax collected', x._id.s ? 'yes' : 'no', rs(x.total)]) };
  },
};
