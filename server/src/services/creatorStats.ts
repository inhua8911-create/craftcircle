import { Types } from 'mongoose';
import { CreatorEarning, IncentiveCampaign, CreatorIncentive, OrderItem, Payout, Product } from '../models/index.js';
import { creatorBalances } from './earnings.js';

const oid = (id: unknown) => new Types.ObjectId(String(id));
const PAID = ['paid', 'partially_refunded', 'refunded'];

/**
 * Definitions (shown in the UI):
 *  - confirmedSales: money customers paid for this creator's items, net of refunds, on orders with verified payment.
 *  - unitsSold: units on such orders, net of refunded units. Cancelled / failed / unpaid orders never count.
 *  - creator earnings: the agreed per-unit amount (NOT sales revenue). pending/available/paid come from CreatorEarning rows.
 */
export async function salesTotals(creatorId: unknown, range?: { from: Date; to: Date }) {
  const match: Record<string, unknown> = { creator: oid(creatorId) };
  const [r] = await OrderItem.aggregate([
    { $match: match },
    { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'o' } }, { $unwind: '$o' },
    { $match: { 'o.paymentStatus': { $in: PAID }, ...(range && { 'o.createdAt': { $gte: range.from, $lte: range.to } }) } },
    { $group: { _id: null, units: { $sum: { $subtract: ['$quantity', '$refundedQuantity'] } }, sales: { $sum: { $subtract: ['$lineTotalPaise', '$refundedPaise'] } }, grossBeforeRefunds: { $sum: '$lineTotalPaise' } } },
  ]);
  return { unitsSold: r?.units ?? 0, confirmedSalesPaise: r?.sales ?? 0, grossBeforeRefundsPaise: r?.grossBeforeRefunds ?? 0 };
}

export async function creatorDashboard(creatorId: unknown) {
  const id = oid(creatorId);
  const [byStatus, inv, totals, balances, perf, recent, payouts] = await Promise.all([
    Product.aggregate([{ $match: { creator: id } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Product.aggregate([{ $match: { creator: id, status: { $in: ['published', 'paused', 'approved'] }, madeToOrder: false } }, { $group: { _id: null, units: { $sum: '$stock' }, low: { $sum: { $cond: [{ $lte: ['$stock', 3] }, 1, 0] } } } }]),
    salesTotals(id), creatorBalances(id),
    OrderItem.aggregate([
      { $match: { creator: id } }, { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'o' } }, { $unwind: '$o' }, { $match: { 'o.paymentStatus': { $in: PAID } } },
      { $group: { _id: '$product', name: { $first: '$productName' }, units: { $sum: { $subtract: ['$quantity', '$refundedQuantity'] } }, salesPaise: { $sum: { $subtract: ['$lineTotalPaise', '$refundedPaise'] } } } }, { $sort: { units: -1 } }, { $limit: 5 },
    ]),
    OrderItem.aggregate([
      { $match: { creator: id } }, { $lookup: { from: 'orders', localField: 'order', foreignField: '_id', as: 'o' } }, { $unwind: '$o' }, { $match: { 'o.paymentStatus': { $in: PAID } } },
      { $sort: { createdAt: -1 } }, { $limit: 10 }, { $project: { orderNumber: '$o.orderNumber', status: '$o.status', productName: 1, quantity: 1, createdAt: 1 } },
    ]),
    Payout.find({ creator: id }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  const count = (s: string) => byStatus.find((x) => x._id === s)?.n ?? 0;
  return {
    products: { published: count('published'), pendingReview: count('submitted') + count('under_review'), changesRequested: count('changes_requested'), draft: count('draft') },
    inventory: { unitsOnHand: inv[0]?.units ?? 0, lowStockProducts: inv[0]?.low ?? 0 },
    sales: totals,
    earnings: { pendingPaise: balances.pendingPaise, availablePaise: balances.availablePaise, onHoldPaise: balances.onHoldPaise, paidOutPaise: balances.paidPaise, adjustmentsPaise: balances.adjustmentsPaise },
    topProducts: perf.map((p) => ({ productId: String(p._id), name: p.name, units: p.units, salesPaise: p.salesPaise })),
    recentOrders: recent.map((r) => ({ orderNumber: r.orderNumber, status: r.status, productName: r.productName, quantity: r.quantity, createdAt: r.createdAt })),
    recentPayouts: payouts.map((p) => ({ id: String(p._id), batchNumber: p.batchNumber, amountPaise: p.amountPaise, status: p.status, paymentReference: p.status === 'paid' ? p.paymentReference : undefined, paidAt: p.paidAt })),
    definitions: {
      confirmedSales: 'What customers paid for your items on orders with verified payment, after refunds. Cancelled, failed and refunded orders are excluded.',
      earnings: 'Your agreed per-unit amount multiplied by units sold. This is what you are owed, not sales revenue.',
      pending: 'Earned but still inside the return window.', available: 'Eligible for the next payout batch.', paidOut: 'Already transferred to you.',
    },
  };
}

/** Progress is computed from real sales in the campaign window. Earned status never auto-pays. */
export async function incentiveProgress(creatorId: unknown) {
  const cid = oid(creatorId);
  const now = new Date();
  const campaigns = await IncentiveCampaign.find({ active: true, endsAt: { $gte: new Date(now.getTime() - 90 * 86_400_000) } }).sort({ startsAt: -1 }).lean();
  const out = [];
  for (const c of campaigns) {
    const t = await salesTotals(creatorId, { from: c.startsAt, to: c.endsAt });
    const progress = c.rule!.metric === 'units_sold' ? t.unitsSold : t.confirmedSalesPaise;
    const reached = progress >= c.rule!.threshold;
    const rec = await CreatorIncentive.findOne({ campaign: c._id, creator: cid }).lean();
    // Persist "earned" only when reached; never downgrade a record an admin has already approved/paid.
    if (reached && (!rec || rec.status === 'in_progress')) await CreatorIncentive.updateOne({ campaign: c._id, creator: cid }, { $set: { progress, earnedPaise: c.rewardPaise, status: 'earned' } }, { upsert: true });
    else if (!reached && rec && rec.status === 'earned') await CreatorIncentive.updateOne({ _id: rec._id }, { $set: { progress, earnedPaise: 0, status: 'in_progress' } });
    else if (rec && rec.status === 'in_progress') await CreatorIncentive.updateOne({ _id: rec._id }, { $set: { progress } });
    const status = rec && ['approved', 'paid', 'void'].includes(rec.status) ? rec.status : reached ? 'earned' : 'in_progress';
    out.push({ campaignId: String(c._id), name: c.name, description: c.description, eligibility: c.eligibility, metric: c.rule!.metric, threshold: c.rule!.threshold, rewardPaise: c.rewardPaise, startsAt: c.startsAt, endsAt: c.endsAt, progress, status, running: c.startsAt <= now && c.endsAt >= now });
  }
  return out;
}
export { CreatorEarning };
