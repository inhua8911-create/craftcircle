import { Schema, model } from 'mongoose';

const paise = { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: '{PATH} must be integer paise' } };
const addressFields = {
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  line1: { type: String, required: true, trim: true },
  line2: { type: String, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  postalCode: { type: String, required: true, trim: true },
  country: { type: String, required: true, default: 'India' },
};

export const Address = model(
  'Address',
  new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, label: String, isDefault: { type: Boolean, default: false }, ...addressFields }, { timestamps: true }),
);

export const Cart = model(
  'Cart',
  new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
      guestId: { type: String, unique: true, sparse: true },
      items: [{ product: { type: Schema.Types.ObjectId, ref: 'Product', required: true }, quantity: { type: Number, required: true, min: 1, max: 20 }, _id: false }],
      expiresAt: { type: Date, index: { expireAfterSeconds: 0 } }, // guest carts only
    },
    { timestamps: true },
  ),
);

export const Wishlist = model(
  'Wishlist',
  new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, products: [{ type: Schema.Types.ObjectId, ref: 'Product' }] }, { timestamps: true }),
);

export const ORDER_STATUSES = [
  'pending_payment', 'paid', 'processing', 'shipped', 'delivered',
  'payment_failed', 'cancelled', 'refunded', 'partially_refunded', 'return_requested', 'returned',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    customerEmail: { type: String, required: true, lowercase: true },
    customerName: { type: String, required: true },
    customerPhone: String,
    shippingAddress: addressFields,
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_payment', index: true },
    paymentStatus: { type: String, enum: ['unpaid', 'paid', 'failed', 'refunded', 'partially_refunded'], default: 'unpaid' },
    isSimulated: { type: Boolean, default: false }, // paid via mock adapter: no real money moved
    subtotalPaise: paise,
    discountPaise: { ...paise, default: 0 },
    shippingPaise: { ...paise, default: 0 },
    taxPaise: { ...paise, default: 0 },
    totalPaise: paise,
    refundedPaise: { ...paise, default: 0 },
    coupon: { code: String, couponId: Schema.Types.ObjectId },
    shipment: { provider: String, trackingNumber: String, shippedAt: Date, deliveredAt: Date },
    idempotencyKey: { type: String, unique: true, sparse: true },
    stockReservedUntil: Date,
    history: [{ from: String, to: String, by: { type: Schema.Types.ObjectId, ref: 'User' }, note: String, at: { type: Date, default: Date.now }, _id: false }],
  },
  { timestamps: true },
);
orderSchema.index({ createdAt: -1 });
export const Order = model('Order', orderSchema);

// Immutable snapshot of what was agreed at purchase time.
export const OrderItem = model(
  'OrderItem',
  new Schema(
    {
      order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
      product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
      creator: { type: Schema.Types.ObjectId, ref: 'CreatorProfile', required: true, index: true },
      productName: { type: String, required: true },
      productSlug: String,
      quantity: { type: Number, required: true, min: 1 },
      unitPricePaise: paise,
      creatorAmountPerUnitPaise: paise,
      platformMarginPerUnitPaise: paise,
      pricingVersion: { type: Number, required: true },
      discountAllocatedPaise: { ...paise, default: 0 },
      shippingAllocatedPaise: { ...paise, default: 0 },
      lineTotalPaise: paise, // unit*qty - discount (shipping tracked separately)
      refundedQuantity: { type: Number, default: 0, min: 0 },
      refundedPaise: { ...paise, default: 0 },
    },
    { timestamps: true },
  ),
);

export const Payment = model(
  'Payment',
  new Schema(
    {
      order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
      provider: { type: String, enum: ['mock', 'razorpay'], required: true },
      isSimulated: { type: Boolean, required: true },
      providerOrderId: { type: String, unique: true, sparse: true },
      providerPaymentId: { type: String, unique: true, sparse: true },
      amountPaise: paise,
      currency: { type: String, default: 'INR' },
      status: { type: String, enum: ['created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded'], default: 'created' },
      failureReason: String,
      processedEventIds: [String],
    },
    { timestamps: true },
  ),
);

export const WebhookEvent = model(
  'WebhookEvent',
  new Schema({ provider: String, eventId: { type: String, required: true }, type: String, processedAt: { type: Date, default: Date.now } }, { timestamps: false }).index({ provider: 1, eventId: 1 }, { unique: true }),
);

export const Refund = model(
  'Refund',
  new Schema(
    {
      order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
      payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
      items: [{ orderItem: { type: Schema.Types.ObjectId, ref: 'OrderItem' }, quantity: Number, amountPaise: Number, _id: false }],
      amountPaise: paise,
      shippingRefundPaise: { ...paise, default: 0 },
      reason: String,
      status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending' },
      isSimulated: { type: Boolean, default: false },
      providerRefundId: { type: String, unique: true, sparse: true },
      idempotencyKey: { type: String, required: true, unique: true },
      processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true },
  ),
);

export const MOVEMENT_TYPES = ['reserve', 'release', 'sale', 'restock', 'adjustment', 'return'] as const;
export const InventoryMovement = model(
  'InventoryMovement',
  new Schema(
    {
      product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
      type: { type: String, enum: MOVEMENT_TYPES, required: true },
      delta: { type: Number, required: true }, // change in on-hand stock
      reservedDelta: { type: Number, default: 0 },
      order: { type: Schema.Types.ObjectId, ref: 'Order' },
      actor: { type: Schema.Types.ObjectId, ref: 'User' },
      note: String,
      idempotencyKey: { type: String, unique: true, sparse: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  ),
);

export const Coupon = model(
  'Coupon',
  new Schema(
    {
      code: { type: String, required: true, unique: true, uppercase: true, trim: true },
      type: { type: String, enum: ['percent', 'fixed'], required: true },
      value: { type: Number, required: true, min: 1 }, // percent (1-100) or paise
      minOrderPaise: { type: Number, default: 0 },
      maxDiscountPaise: Number,
      startsAt: { type: Date, required: true },
      endsAt: { type: Date, required: true },
      usageLimit: Number,
      usedCount: { type: Number, default: 0 },
      perUserLimit: { type: Number, default: 1 },
      active: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);
