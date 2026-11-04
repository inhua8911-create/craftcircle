import { Schema, model } from 'mongoose';

export const APPLICATION_STATUSES = [
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'more_info_requested', 'suspended',
] as const;

const applicationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fullName: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    categories: [{ type: String, trim: true }],
    bio: { type: String, maxlength: 2000 },
    links: [{ type: String, trim: true, maxlength: 300 }],
    sampleImages: [{ url: String, publicId: String }],
    monthlyCapacity: { type: Number, min: 0 },
    confirmsHandmade: { type: Boolean, default: false },
    acceptedTermsVersion: String,
    status: { type: String, enum: APPLICATION_STATUSES, default: 'draft', index: true },
    decisions: [
      {
        status: String,
        note: String,
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);
export const CreatorApplication = model('CreatorApplication', applicationSchema);

const profileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    application: { type: Schema.Types.ObjectId, ref: 'CreatorApplication' },
    slug: { type: String, required: true, unique: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    bio: { type: String, maxlength: 2000 },
    story: { type: String, maxlength: 6000 },
    specialties: [String],
    profileImage: { url: String, publicId: String },
    city: String,
    state: String,
    // Creator controls which fields are public.
    publicFields: {
      city: { type: Boolean, default: false },
      bio: { type: Boolean, default: true },
      story: { type: Boolean, default: true },
      links: { type: Boolean, default: false },
    },
    links: [String],
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    featured: { type: Boolean, default: false },
    // Restricted: only admins and the owner may read. Never collect credentials; reference data only.
    payoutDetails: {
      type: new Schema(
        {
          accountHolder: String,
          bankName: String,
          accountLast4: { type: String, maxlength: 4 },
          ifsc: String,
          upiId: String,
        },
        { _id: false },
      ),
      select: false,
    },
    termsVersion: String,
  },
  { timestamps: true },
);
export const CreatorProfile = model('CreatorProfile', profileSchema);
