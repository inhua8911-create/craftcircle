import { Schema, model } from 'mongoose';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    description: String,
    banner: { url: String, alt: String },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const Category = model('Category', categorySchema);

export const PRODUCT_STATUSES = [
  'draft', 'submitted', 'under_review', 'changes_requested', 'rejected',
  'approved', 'published', 'paused', 'archived',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const intPaise = { type: Number, min: 0, validate: { validator: Number.isSafeInteger, message: '{PATH} must be integer paise' } };

const productSchema = new Schema(
  {
    creator: { type: Schema.Types.ObjectId, ref: 'CreatorProfile', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, required: true, maxlength: 4000 },
    story: { type: String, maxlength: 4000 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    materials: [String],
    dimensions: String,
    colors: [String],
    careInstructions: String,
    personalizationOptions: String,
    productionDetails: String,
    madeToOrder: { type: Boolean, default: false },
    dispatchDays: { type: Number, min: 0 }, // creator-declared; only shown when provided
    stock: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    reserved: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft', index: true },
    reviewFeedback: [{ note: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } }],
    suggestedPricePaise: intPaise,
    proposedCreatorAmountPaise: intPaise,
    // Commercial terms set/confirmed by admin. platformMarginPaise is derived server-side.
    sellingPricePaise: intPaise,
    creatorAmountPaise: intPaise,
    platformMarginPaise: { type: Number, validate: Number.isSafeInteger },
    pricingVersion: { type: Number, default: 0 },
    requiresReapproval: { type: Boolean, default: false },
    featured: { type: Boolean, default: false, index: true },
    isSample: { type: Boolean, default: false }, // demo data flag
    soldCount: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    publishedAt: Date,
  },
  { timestamps: true },
);
productSchema.index({ status: 1, category: 1, sellingPricePaise: 1 });
productSchema.index({ name: 'text', description: 'text' });
// Hard guard: stock can never be reserved beyond what exists.
productSchema.pre('validate', function () {
  if (this.reserved > this.stock && !this.madeToOrder) throw new Error('reserved cannot exceed stock');
});
export const Product = model('Product', productSchema);

const productImageSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    url: { type: String, required: true },
    publicId: String,
    alt: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    width: Number,
    height: Number,
  },
  { timestamps: true },
);
export const ProductImage = model('ProductImage', productImageSchema);

const pricingHistorySchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    version: { type: Number, required: true },
    sellingPricePaise: { type: Number, required: true },
    creatorAmountPaise: { type: Number, required: true },
    platformMarginPaise: { type: Number, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
pricingHistorySchema.index({ product: 1, version: 1 }, { unique: true });
export const ProductPricingHistory = model('ProductPricingHistory', pricingHistorySchema);

const collectionSchema = new Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: String,
    occasion: String,
    banner: { url: String, alt: String },
    products: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    featured: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export const Collection = model('Collection', collectionSchema);
