import { Schema, model, Types } from 'mongoose';

export const ROLES = ['customer', 'creator', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'customer', required: true, index: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    emailVerified: { type: Boolean, default: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0 }, // bump to invalidate all sessions
    lastLoginAt: Date,
  },
  { timestamps: true },
);
export const User = model('User', userSchema);
export type UserId = Types.ObjectId;
