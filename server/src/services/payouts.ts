import { Types } from 'mongoose';
import { CreatorEarning, FinancialLedgerEntry, Payout } from '../models/index.js';
import { AppError, notFound } from '../utils/errors.js';
import { withTx } from './tx.js';

type Id = Types.ObjectId | string;
const net = (e: { grossPaise: number; adjustmentPaise: number; paidPaise: number }) => e.grossPaise + e.adjustmentPaise - e.paidPaise;
const batchNo = () => `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`;

/** Draft a payout from a creator's eligible earnings. Earnings are reserved so they cannot be batched twice. */
export async function createPayoutDraft(creatorId: Id, actorId: Id, opts: { retryOf?: Id; isSimulated?: boolean } = {}) {
  return withTx(async (session) => {
    const earnings = await CreatorEarning.find({ creator: creatorId, status: 'eligible', payout: null }).session(session);
    // Simulated (demo) and real earnings are never mixed in one batch: a payout inherits the flag of what it settles.
    // Real earnings are batched first; simulated ones are paid in their own batch.
    const positive = earnings.filter((e) => net(e) > 0);
    const real = positive.filter((e) => !e.isSimulated);
    const usable = real.length ? real : positive;
    const amount = usable.reduce((a, e) => a + net(e), 0);
    if (!usable.length || amount <= 0) throw new AppError(409, 'NOTHING_TO_PAY', 'No eligible unpaid earnings for this creator');
    const simulated = usable.every((e) => e.isSimulated);
    const [payout] = await Payout.create(
      [{ batchNumber: batchNo(), creator: creatorId, earnings: usable.map((e) => e._id), amountPaise: amount, status: 'draft', createdBy: actorId, retryOf: opts.retryOf, isSimulated: simulated }],
      { session },
    );
    const res = await CreatorEarning.updateMany({ _id: { $in: usable.map((e) => e._id) }, status: 'eligible', payout: null }, { $set: { payout: payout!._id } }, { session });
    if (res.modifiedCount !== usable.length) throw new AppError(409, 'PAYOUT_CONFLICT', 'Earnings changed while drafting; try again');
    return payout!;
  });
}

export async function approvePayout(payoutId: Id, actorId: Id) {
  return withTx(async (session) => {
    const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: 'draft' }, { $set: { status: 'approved', approvedBy: actorId } }, { returnDocument: 'after', session });
    if (!payout) throw await explain(payoutId, 'draft');
    await CreatorEarning.updateMany({ payout: payout._id }, { $set: { status: 'approved' } }, { session });
    return payout;
  });
}

/** Mark paid after the manual bank transfer. A bank reference is mandatory. Never moves real money itself. */
export async function markPayoutPaid(payoutId: Id, actorId: Id, paymentReference: string) {
  const ref = paymentReference?.trim();
  if (!ref) throw new AppError(422, 'REFERENCE_REQUIRED', 'A bank transfer reference is required to record a payout as paid');
  return withTx(async (session) => {
    const current = await Payout.findById(payoutId).session(session);
    if (!current) throw notFound('Payout not found');
    const earnings = await CreatorEarning.find({ payout: current._id }).session(session);
    const live = earnings.reduce((a, e) => a + net(e), 0);
    if (live !== current.amountPaise) throw new AppError(409, 'PAYOUT_STALE', 'Earnings were adjusted after this payout was drafted. Cancel it and create a new one.');

    const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: 'approved' }, { $set: { status: 'paid', paymentReference: ref, paidAt: new Date() } }, { returnDocument: 'after', session });
    if (!payout) throw await explain(payoutId, 'approved');

    for (const e of earnings) {
      await CreatorEarning.updateOne({ _id: e._id }, { $inc: { paidPaise: net(e) }, $set: { status: 'paid' } }, { session });
    }
    await FinancialLedgerEntry.create(
      [
        { entryType: 'payout', account: 'creator_payable', creator: payout.creator, payout: payout._id, amountPaise: -payout.amountPaise, reference: ref, createdBy: actorId, isSimulated: payout.isSimulated, idempotencyKey: `payout:${payout._id}:payable` },
        { entryType: 'payout', account: 'creator_paid', creator: payout.creator, payout: payout._id, amountPaise: payout.amountPaise, reference: ref, createdBy: actorId, isSimulated: payout.isSimulated, idempotencyKey: `payout:${payout._id}:paid` },
      ],
      { session, ordered: true },
    );
    return payout;
  });
}

/** Failed or cancelled payouts release their earnings back to the eligible pool. Retry = create a new draft. */
async function release(payoutId: Id, from: Array<'draft' | 'approved'>, to: 'failed' | 'cancelled', reason?: string) {
  return withTx(async (session) => {
    const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: { $in: from } }, { $set: { status: to, failureReason: reason } }, { returnDocument: 'after', session });
    if (!payout) throw await explain(payoutId, from.join(' or '));
    await CreatorEarning.updateMany({ payout: payout._id }, { $set: { status: 'eligible' }, $unset: { payout: '' } }, { session });
    return payout;
  });
}
export const failPayout = (id: Id, reason: string) => release(id, ['approved'], 'failed', reason);
export const cancelPayout = (id: Id, reason?: string) => release(id, ['draft', 'approved'], 'cancelled', reason);

async function explain(payoutId: Id, expected: string) {
  const p = await Payout.findById(payoutId);
  if (!p) return notFound('Payout not found');
  return new AppError(409, 'INVALID_PAYOUT_STATE', `Payout is "${p.status}"; expected "${expected}"`);
}
