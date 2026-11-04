import { CreatorEarning, CreatorProfile, OrderItem, Order, Payout } from '../models/index.js';
import { notFound } from '../utils/errors.js';
import { toCsv } from './csv.js';

export async function payoutStatement(payoutId: string, creatorId?: unknown) {
  const filter: Record<string, unknown> = { _id: payoutId }; if (creatorId) filter.creator = creatorId; // creators can only see their own
  const payout = await Payout.findOne(filter).lean(); if (!payout) throw notFound('Payout not found');
  const [creator, earnings] = await Promise.all([CreatorProfile.findById(payout.creator).select('displayName slug').lean(), CreatorEarning.find({ payout: payout._id }).lean()]);
  const [items, orders] = await Promise.all([OrderItem.find({ _id: { $in: earnings.map((e) => e.orderItem) } }).select('productName').lean(), Order.find({ _id: { $in: earnings.map((e) => e.order) } }).select('orderNumber').lean()]);
  const iname = new Map(items.map((i) => [String(i._id), i.productName])); const onum = new Map(orders.map((o) => [String(o._id), o.orderNumber]));
  const lines = earnings.map((e) => ({ orderNumber: onum.get(String(e.order)), product: iname.get(String(e.orderItem)), quantity: e.quantity, amountPerUnitPaise: e.amountPerUnitPaise, grossPaise: e.grossPaise, adjustmentPaise: e.adjustmentPaise, netPaise: e.grossPaise + e.adjustmentPaise }));
  return { payout: { id: String(payout._id), batchNumber: payout.batchNumber, status: payout.status, amountPaise: payout.amountPaise, paymentReference: payout.status === 'paid' ? payout.paymentReference : null, paidAt: payout.paidAt, simulated: payout.isSimulated, method: payout.method }, creator: { name: creator?.displayName, slug: creator?.slug }, lines };
}
export const statementCsv = (s: Awaited<ReturnType<typeof payoutStatement>>) => toCsv([
  ['Batch', s.payout.batchNumber, 'Creator', s.creator.name ?? '', 'Status', s.payout.status, 'Reference', s.payout.paymentReference ?? '', 'Simulated', s.payout.simulated ? 'yes' : 'no'],
  ['Order', 'Product', 'Quantity', 'Amount per unit (INR)', 'Gross (INR)', 'Adjustment (INR)', 'Net (INR)'],
  ...s.lines.map((l) => [l.orderNumber ?? '', l.product ?? '', l.quantity, (l.amountPerUnitPaise / 100).toFixed(2), (l.grossPaise / 100).toFixed(2), (l.adjustmentPaise / 100).toFixed(2), (l.netPaise / 100).toFixed(2)]),
  ['Total', '', '', '', '', '', (s.payout.amountPaise / 100).toFixed(2)],
]);
