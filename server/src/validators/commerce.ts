import { z } from 'zod';
const phone = z.string().trim().regex(/^[+0-9 -]{7,20}$/, 'Enter a valid phone number');
export const addressSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(120), phone, line1: z.string().trim().min(1).max(200), line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80), state: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'),
  country: z.literal('India'), // only India is configured as a shipping region for now
});
export const checkoutSchema = z.strictObject({
  customer: z.strictObject({ name: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().max(254).pipe(z.email()), phone: phone.optional() }),
  address: addressSchema, couponCode: z.string().trim().min(1).max(40).optional(),
});
export const mockConfirmSchema = z.strictObject({ orderId: z.string().regex(/^[a-f0-9]{24}$/), outcome: z.enum(['success', 'failure']) });
export const razorpayVerifySchema = z.strictObject({ orderId: z.string().regex(/^[a-f0-9]{24}$/), razorpay_payment_id: z.string().min(1).max(100), razorpay_order_id: z.string().min(1).max(100), razorpay_signature: z.string().length(64) });
export const orderStatusSchema = z.strictObject({
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned']), note: z.string().max(500).optional(),
  shipment: z.strictObject({ provider: z.string().trim().min(1).max(60), trackingNumber: z.string().trim().min(1).max(80) }).optional(),
});
export const refundSchema = z.strictObject({
  lines: z.array(z.strictObject({ orderItemId: z.string().regex(/^[a-f0-9]{24}$/), quantity: z.number().int().min(1).max(100) })).min(1).max(50),
  shippingRefundPaise: z.number().int().min(0).optional(), reason: z.string().trim().min(3).max(500),
  providerRefundId: z.string().trim().min(1).max(100).optional(),
});
