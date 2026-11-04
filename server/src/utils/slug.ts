import { Types } from 'mongoose';
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'item';
export const uniqueSlug = (s: string) => `${slugify(s)}-${new Types.ObjectId().toHexString().slice(-5)}`;
