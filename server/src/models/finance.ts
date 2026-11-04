import { Schema, model } from 'mongoose';

const paise = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: '{PATH} must be integer paise' } };

export const EARNING_STATUSES = ['pending', 'eligible', 'approved', 'paid', 'on_hold', 'adjusted'] as const;
export type EarningStatus = (typeof EARNING_STATUSES)[number];

// One row per order item. Created ONLY from validated payment events; never user-editable.
export const CreatorEarning = model(
  'CreatorEarning',
  new Schema(
    {
      creator: { type: Schema.Types.ObjectId, ref: 'CreatorProfile', required: true, index: true },
      order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
      orderItem: { type: Schema.Types.ObjectId, ref: 'OrderItem', required: true, unique: true },
      product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
      quantity: { type: Number, required: true, min: 1 },
      amountPerUnitPaise: paise,
      grossPaise: paise,
      adjustmentPaise: { ...paise, default: 0 }, // negative for refunds
      paidPaise: { ...paise, default: 0 },
      status: { type: String, enum: EARNING_STATUSES, default: 'pending', index: true },
      eligibleAt: Date,
      payout: { type: Schema.Types.ObjectId, ref: 'Payout' },
      isSimulated: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
);

export const LEDGER_ACCOUNTS = [
  'creator_payable', 'creator_paid', 'platform_margin', 'discount_funded', 'shipping_collected', 'tax_collected', 'refund',
] as const;
export const LEDGER_TYPES = ['sale', 'refund_adjustment', 'payout', 'payout_reversal', 'manual_adjustment', 'incentive'] as const;

const ledgerSchema = new Schema(
  {
    entryType: { type: String, enum: LEDGER_TYPES, required: true, index: true },
    account: { type: String, enum: LEDGER_ACCOUNTS, required: true, index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'CreatorProfile', index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    orderItem: { type: Schema.Types.ObjectId, ref: 'OrderItem' },
    payout: { type: Schema.Types.ObjectId, ref: 'Payout' },
    amountPaise: paise, // signed; corrections are NEW entries with opposite sign
    isSimulated: { type: Boolean, default: false },
    reference: String,
    memo: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    idempotencyKey: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
// Append-only enforcement at the model layer.
const blocked = () => { throw new Error('Ledger entries are immutable. Post a compensating entry instead.'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  ledgerSchema.pre(op as any, blocked);
}
ledgerSchema.pre('save', function () {
  if (!this.isNew) throw new Error('Ledger entries are immutable. Post a compensating entry instead.');
});
export const FinancialLedgerEntry = model('FinancialLedgerEntry', ledgerSchema);

export const Payout = model(
  'Payout',
  new Schema(
    {
      batchNumber: { type: String, required: true, unique: true },
      creator: { type: Schema.Types.ObjectId, ref: 'CreatorProfile', required: true, index: true },
      earnings: [{ type: Schema.Types.ObjectId, ref: 'CreatorEarning' }],
      amountPaise: paise,
      status: { type: String, enum: ['draft', 'approved', 'paid', 'failed', 'cancelled'], default: 'draft', index: true },
      method: { type: String, default: 'manual_bank_transfer' },
      paymentReference: String,
      failureReason: String,
      retryOf: { type: Schema.Types.ObjectId, ref: 'Payout' },
      approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
      paidAt: Date,
      isSimulated: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
);

export const IncentiveCampaign = model(
  'IncentiveCampaign',
  new Schema(
    {
      name: { type: String, required: true },
      description: { type: String, required: true },
      rule: { metric: { type: String, enum: ['units_sold', 'gross_sales'], required: true }, threshold: { type: Number, required: true, min: 1 } },
      rewardPaise: paise,
      startsAt: { type: Date, required: true },
      endsAt: { type: Date, required: true },
      eligibility: String,
      active: { type: Boolean, default: true },
      createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true },
  ),
);

const creatorIncentiveSchema = new Schema(
  {
    campaign: { type: Schema.Types.ObjectId, ref: 'IncentiveCampaign', required: true },
    creator: { type: Schema.Types.ObjectId, ref: 'CreatorProfile', required: true },
    progress: { type: Number, default: 0 },
    earnedPaise: { ...paise, default: 0 },
    status: { type: String, enum: ['in_progress', 'earned', 'approved', 'paid', 'void'], default: 'in_progress' },
  },
  { timestamps: true },
);
creatorIncentiveSchema.index({ campaign: 1, creator: 1 }, { unique: true });
export const CreatorIncentive = model('CreatorIncentive', creatorIncentiveSchema);
