import { describe, it, expect } from 'vitest';
import { CreatorEarning, FinancialLedgerEntry, Order, OrderItem, Payout } from '../models/index.js';
import { recordSaleFromPaidOrder, recordRefund, creatorBalances, promoteEligibleEarnings } from '../services/earnings.js';
import { createPayoutDraft, approvePayout, markPayoutPaid, failPayout } from '../services/payouts.js';
import { makeCreator, makePaidOrder } from './fixtures.js';
import { Types } from 'mongoose';

const actor = new Types.ObjectId();
const sumAccount = async (account: string, creator?: any) => {
  const filter: Record<string, unknown> = { account };
  if (creator) filter.creator = creator;
  const rows = await FinancialLedgerEntry.find(filter);
  return rows.reduce((a, r) => a + r.amountPaise, 0);
};
async function eligibleSetup() {
  const c = await makeCreator();
  const { order, items } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 2 }], { discount: 5000, shipping: 4900 });
  await recordSaleFromPaidOrder(order._id);
  await Order.updateOne({ _id: order._id }, { 'shipment.deliveredAt': new Date(Date.now() - 10 * 86_400_000) });
  await promoteEligibleEarnings(new Date(), 7);
  return { c, order, items };
}

describe('sale recording', () => {
  it('creates earnings + ledger from a paid order and is idempotent', async () => {
    const c = await makeCreator();
    const { order } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 2 }], { discount: 5000, shipping: 4900 });
    expect((await recordSaleFromPaidOrder(order._id)).alreadyProcessed).toBe(false);
    expect((await recordSaleFromPaidOrder(order._id)).alreadyProcessed).toBe(true);
    expect(await CreatorEarning.countDocuments()).toBe(1);
    expect(await sumAccount('creator_payable')).toBe(80000);
    expect(await sumAccount('platform_margin')).toBe(119800 - 5000 - 80000);
    expect(await sumAccount('shipping_collected')).toBe(4900);
  });
  it('survives concurrent duplicate processing', async () => {
    const c = await makeCreator();
    const { order } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }]);
    await Promise.allSettled([recordSaleFromPaidOrder(order._id), recordSaleFromPaidOrder(order._id), recordSaleFromPaidOrder(order._id)]);
    expect(await CreatorEarning.countDocuments()).toBe(1);
    expect(await sumAccount('creator_payable')).toBe(40000);
  });
  it('refuses unpaid orders', async () => {
    const c = await makeCreator();
    const { order } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }]);
    await Order.updateOne({ _id: order._id }, { paymentStatus: 'unpaid' });
    await expect(recordSaleFromPaidOrder(order._id)).rejects.toThrow(/paid/);
  });
});

describe('ledger immutability', () => {
  it('blocks update and delete of ledger entries', async () => {
    const c = await makeCreator();
    const { order } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }]);
    await recordSaleFromPaidOrder(order._id);
    const e = (await FinancialLedgerEntry.findOne())!;
    await expect(FinancialLedgerEntry.updateOne({ _id: e._id }, { amountPaise: 1 })).rejects.toThrow(/immutable/);
    await expect(FinancialLedgerEntry.deleteMany({})).rejects.toThrow(/immutable/);
    e.amountPaise = 1;
    await expect(e.save()).rejects.toThrow(/immutable/);
  });
});

describe('refunds', () => {
  it('posts compensating entries, adjusts earnings, and is idempotent', async () => {
    const c = await makeCreator();
    const { order, items } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 2 }]);
    await recordSaleFromPaidOrder(order._id);
    const req = { orderId: order._id, lines: [{ orderItemId: items[0]!._id, quantity: 1 }], idempotencyKey: 'r1', actorId: actor };
    expect((await recordRefund(req)).alreadyProcessed).toBe(false);
    expect((await recordRefund(req)).alreadyProcessed).toBe(true);
    expect(await sumAccount('creator_payable')).toBe(40000);
    expect(await sumAccount('platform_margin')).toBe(19900);
    const o = (await Order.findById(order._id))!;
    expect(o.status).toBe('partially_refunded');
    expect(o.refundedPaise).toBe(59900);
    expect((await creatorBalances(c._id)).adjustmentsPaise).toBe(-40000);
  });
  it('rejects refunding more than was bought', async () => {
    const c = await makeCreator();
    const { order, items } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }]);
    await recordSaleFromPaidOrder(order._id);
    await expect(recordRefund({ orderId: order._id, lines: [{ orderItemId: items[0]!._id, quantity: 2 }], idempotencyKey: 'x' })).rejects.toThrow();
    expect(await OrderItem.findById(items[0]!._id).then((i) => i!.refundedQuantity)).toBe(0);
  });
  it('full refund moves order to refunded', async () => {
    const c = await makeCreator();
    const { order, items } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }], { discount: 999 });
    await recordSaleFromPaidOrder(order._id);
    await recordRefund({ orderId: order._id, lines: [{ orderItemId: items[0]!._id, quantity: 1 }], idempotencyKey: 'full' });
    const o = (await Order.findById(order._id))!;
    expect(o.status).toBe('refunded');
    expect(o.refundedPaise).toBe(o.totalPaise);
  });
});

describe('payouts', () => {
  it('only pays eligible earnings, and the hold window is respected', async () => {
    const c = await makeCreator();
    const { order } = await makePaidOrder([{ creatorId: c._id, unit: 59900, creatorAmt: 40000, qty: 1 }]);
    await recordSaleFromPaidOrder(order._id);
    await expect(createPayoutDraft(c._id, actor)).rejects.toThrow(/No eligible/);
  });
  it('draft -> approve -> paid updates balances and ledger exactly once', async () => {
    const { c } = await eligibleSetup();
    const d = await createPayoutDraft(c._id, actor);
    expect(d.amountPaise).toBe(80000);
    await expect(createPayoutDraft(c._id, actor)).rejects.toThrow(); // earnings already reserved
    await expect(markPayoutPaid(d._id, actor, 'UTR123')).rejects.toThrow(/expected "approved"/);
    await approvePayout(d._id, actor);
    await expect(markPayoutPaid(d._id, actor, '  ')).rejects.toThrow(/reference/i);
    await markPayoutPaid(d._id, actor, 'UTR123');
    await expect(markPayoutPaid(d._id, actor, 'UTR123')).rejects.toThrow(); // no double pay
    const b = await creatorBalances(c._id);
    expect(b.paidPaise).toBe(80000);
    expect(b.availablePaise).toBe(0);
    expect(await sumAccount('creator_payable', c._id)).toBe(0);
    expect(await sumAccount('creator_paid', c._id)).toBe(80000);
  });
  it('concurrent payout drafts cannot double-batch the same earnings', async () => {
    const { c } = await eligibleSetup();
    const r = await Promise.allSettled([createPayoutDraft(c._id, actor), createPayoutDraft(c._id, actor)]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect(await Payout.countDocuments()).toBe(1);
  });
  it('failed payout releases earnings for a retry', async () => {
    const { c } = await eligibleSetup();
    const d = await createPayoutDraft(c._id, actor);
    await approvePayout(d._id, actor);
    await failPayout(d._id, 'bank rejected');
    const retry = await createPayoutDraft(c._id, actor, { retryOf: d._id });
    expect(retry.amountPaise).toBe(80000);
  });
  it('a refund after drafting makes the payout stale instead of overpaying', async () => {
    const { c, order, items } = await eligibleSetup();
    const d = await createPayoutDraft(c._id, actor);
    await approvePayout(d._id, actor);
    await recordRefund({ orderId: order._id, lines: [{ orderItemId: items[0]!._id, quantity: 1 }], idempotencyKey: 'late' });
    await expect(markPayoutPaid(d._id, actor, 'UTR9')).rejects.toThrow(/adjusted/);
  });
  it('refund after payout leaves a visible clawback balance', async () => {
    const { c, order, items } = await eligibleSetup();
    const d = await createPayoutDraft(c._id, actor);
    await approvePayout(d._id, actor);
    await markPayoutPaid(d._id, actor, 'UTR1');
    await recordRefund({ orderId: order._id, lines: [{ orderItemId: items[0]!._id, quantity: 1 }], idempotencyKey: 'after' });
    const b = await creatorBalances(c._id);
    expect(b.availablePaise).toBe(-40000);
  });
});
