import { z } from 'zod';
const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');
const phone = z.string().trim().regex(/^[+0-9 -]{7,20}$/, 'Enter a valid phone number');
const url = z.string().trim().url().max(300).refine((u) => /^https?:\/\//.test(u), 'Use an http(s) link');
export const CREATOR_TERMS_VERSION = 'draft-1';

// Every field optional so drafts can be saved; `submit: true` re-validates the merged record against fullApplication.
export const applicationInput = z.strictObject({
  fullName: z.string().trim().min(1).max(120).optional(), email: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(), phone: phone.optional(),
  city: z.string().trim().min(1).max(80).optional(), state: z.string().trim().min(1).max(80).optional(),
  categories: z.array(z.string().trim().min(1).max(60)).max(10).optional(), bio: z.string().trim().max(2000).optional(),
  links: z.array(url).max(5).optional(), sampleImages: z.array(z.string().max(300)).max(6).optional(),
  monthlyCapacity: z.number().int().min(0).max(100000).optional(), confirmsHandmade: z.boolean().optional(), acceptedTerms: z.boolean().optional(),
  submit: z.boolean().default(false),
});
export const fullApplication = z.object({
  fullName: z.string().min(1), email: z.string().min(3), phone, city: z.string().min(1), state: z.string().min(1),
  categories: z.array(z.string()).min(1, 'Choose at least one craft category'), bio: z.string().min(30, 'Tell us a little more (at least 30 characters)'),
  sampleImages: z.array(z.string()).min(1, 'Add at least one photo of your work'),
  confirmsHandmade: z.literal(true, 'Please confirm your products are handmade'), acceptedTerms: z.literal(true, 'Please accept the creator terms'),
});
export const decisionSchema = z.strictObject({ status: z.enum(['under_review', 'approved', 'rejected', 'more_info_requested']), note: z.string().trim().max(1000).optional() })
  .refine((d) => !['rejected', 'more_info_requested'].includes(d.status) || (d.note && d.note.length >= 3), { message: 'A note is required to reject or request more information', path: ['note'] });
export const creatorStatusSchema = z.strictObject({ action: z.enum(['suspend', 'reactivate']), note: z.string().trim().min(3).max(1000) });

const productFields = {
  name: z.string().trim().min(2).max(160), description: z.string().trim().min(10).max(4000), story: z.string().trim().max(4000), category: objectId,
  materials: z.array(z.string().trim().min(1).max(60)).max(20), dimensions: z.string().trim().max(200), colors: z.array(z.string().trim().min(1).max(40)).max(20),
  careInstructions: z.string().trim().max(1000), personalizationOptions: z.string().trim().max(1000), productionDetails: z.string().trim().max(1000),
  madeToOrder: z.boolean(), dispatchDays: z.number().int().min(0).max(90), stock: z.number().int().min(0).max(100000),
  suggestedPricePaise: z.number().int().min(100).max(10_000_000), proposedCreatorAmountPaise: z.number().int().min(100).max(10_000_000),
  images: z.array(z.string().max(300)).max(8),
};
export const productCreate = z.strictObject({ ...productFields, story: productFields.story.optional(), materials: productFields.materials.optional(), dimensions: productFields.dimensions.optional(), colors: productFields.colors.optional(), careInstructions: productFields.careInstructions.optional(), personalizationOptions: productFields.personalizationOptions.optional(), productionDetails: productFields.productionDetails.optional(), madeToOrder: productFields.madeToOrder.optional(), dispatchDays: productFields.dispatchDays.optional(), stock: productFields.stock.optional(), suggestedPricePaise: productFields.suggestedPricePaise.optional(), proposedCreatorAmountPaise: productFields.proposedCreatorAmountPaise.optional(), images: productFields.images.optional() });
export const productUpdate = z.strictObject({ ...Object.fromEntries(Object.entries(productFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])), acknowledgeReapproval: z.boolean().optional() } as Record<string, z.ZodTypeAny>);
export const MATERIAL_FIELDS = ['name', 'description', 'category', 'materials', 'dimensions', 'madeToOrder', 'productionDetails', 'personalizationOptions', 'suggestedPricePaise', 'proposedCreatorAmountPaise', 'images'] as const;

export const reviewSchema = z.strictObject({
  action: z.enum(['start_review', 'request_changes', 'reject', 'approve']), note: z.string().trim().max(1000).optional(),
  sellingPricePaise: z.number().int().min(100).max(10_000_000).optional(), creatorAmountPaise: z.number().int().min(100).max(10_000_000).optional(), publish: z.boolean().optional(),
}).refine((d) => !['request_changes', 'reject'].includes(d.action) || (d.note && d.note.length >= 3), { message: 'Feedback is required when requesting changes or rejecting', path: ['note'] });
export const pricingSchema = z.strictObject({ sellingPricePaise: z.number().int().min(100).max(10_000_000), creatorAmountPaise: z.number().int().min(100).max(10_000_000), reason: z.string().trim().min(3).max(500) });
export const merchandisingSchema = z.strictObject({ featured: z.boolean().optional(), stock: z.number().int().min(0).max(100000).optional() });
export const payoutDetailsSchema = z.strictObject({ accountHolder: z.string().trim().min(1).max(120), bankName: z.string().trim().max(120).optional(), accountLast4: z.string().regex(/^\d{4}$/).optional(), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC').optional(), upiId: z.string().trim().regex(/^[\w.-]{2,}@[\w]{2,}$/, 'Enter a valid UPI id').optional() });
export const profileSchema = z.strictObject({
  displayName: z.string().trim().min(2).max(80).optional(), bio: z.string().trim().max(2000).optional(), story: z.string().trim().max(6000).optional(),
  specialties: z.array(z.string().trim().min(1).max(60)).max(10).optional(), profileImage: z.string().max(300).optional(), links: z.array(url).max(5).optional(),
  publicFields: z.strictObject({ city: z.boolean(), bio: z.boolean(), story: z.boolean(), links: z.boolean() }).partial().optional(),
});
export const incentiveCampaignSchema = z.strictObject({
  name: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(1000), eligibility: z.string().trim().max(500).optional(),
  metric: z.enum(['units_sold', 'gross_sales']), threshold: z.number().int().min(1), rewardPaise: z.number().int().min(100),
  startsAt: z.coerce.date(), endsAt: z.coerce.date(),
}).refine((d) => d.endsAt > d.startsAt, { message: 'End must be after start', path: ['endsAt'] });
export const payoutCreateSchema = z.strictObject({ creatorId: objectId });
export const payoutPaySchema = z.strictObject({ reference: z.string().trim().min(3).max(100) });
export const payoutFailSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
