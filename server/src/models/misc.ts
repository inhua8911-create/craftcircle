import { Schema, model } from 'mongoose';

export const Review = model(
  'Review',
  new Schema(
    {
      product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      orderItem: { type: Schema.Types.ObjectId, ref: 'OrderItem', required: true }, // verified purchase proof
      rating: { type: Number, required: true, min: 1, max: 5 },
      title: { type: String, maxlength: 120 },
      body: { type: String, maxlength: 2000 },
      status: { type: String, enum: ['pending', 'published', 'hidden'], default: 'pending' },
    },
    { timestamps: true },
  ).index({ user: 1, orderItem: 1 }, { unique: true }),
);

export const Notification = model(
  'Notification',
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      type: { type: String, required: true },
      title: { type: String, required: true },
      body: String,
      link: String,
      readAt: Date,
      emailStatus: { type: String, enum: ['not_configured', 'queued', 'sent', 'failed', 'not_requested'], default: 'not_requested' },
    },
    { timestamps: true },
  ).index({ user: 1, readAt: 1, createdAt: -1 }),
);

export const NewsletterSubscription = model(
  'NewsletterSubscription',
  new Schema({ email: { type: String, required: true, unique: true, lowercase: true }, active: { type: Boolean, default: true }, source: String }, { timestamps: true }),
);

const auditSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: String,
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, index: true },
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    note: String,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
const noMutate = () => { throw new Error('Audit log entries are immutable.'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  auditSchema.pre(op as any, noMutate);
}
auditSchema.pre('save', function () { if (!this.isNew) throw new Error('Audit log entries are immutable.'); });
export const AuditLog = model('AuditLog', auditSchema);

export const StoreSettings = model(
  'StoreSettings',
  new Schema(
    {
      key: { type: String, default: 'default', unique: true },
      announcement: { enabled: { type: Boolean, default: false }, text: String, link: String },
      shipping: { flatRatePaise: { type: Number, default: 0 }, freeAboveCartPaise: Number },
      taxEnabled: { type: Boolean, default: false },
      taxRatePercent: { type: Number, default: 0 },
      codEnabled: { type: Boolean, default: false },
      requireSecondPayoutApprover: { type: Boolean, default: false }, // four-eyes control for payouts
      settlementHoldDays: { type: Number, default: 7 }, // return window before earnings become eligible
      lowStockThreshold: { type: Number, default: 3 },
      socialLinks: [{ label: String, url: String }],
      instagramGallery: [{ imageUrl: String, link: String, alt: String }],
      contact: { email: String, phone: String, address: String },
    },
    { timestamps: true },
  ),
);

/** Image bytes kept in MongoDB. Used only when DEMO_MODE is on and Cloudinary is not configured, so the app needs no disk or image service. */
export const StoredImage = model(
  'StoredImage',
  new Schema({ name: { type: String, required: true, unique: true }, mime: { type: String, required: true }, data: { type: Buffer, required: true } }, { timestamps: true }),
);
