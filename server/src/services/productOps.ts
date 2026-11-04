import type { ClientSession, Types } from 'mongoose';
import { Category, InventoryMovement, Product, ProductImage, ProductPricingHistory } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { isOwnedImageUrl } from './uploads.js';
import { validateCommercialTerms } from './pricing.js';

export async function setImages(productId: Types.ObjectId, urls: string[], alt: string) {
  if (!urls.every(isOwnedImageUrl)) throw new AppError(422, 'INVALID_IMAGE', 'Photos must be uploaded through this site');
  await ProductImage.deleteMany({ product: productId });
  if (urls.length) await ProductImage.insertMany(urls.map((url, i) => ({ product: productId, url, alt: `${alt} (photo ${i + 1})`, sortOrder: i })));
}
export async function assertCategory(id: string) {
  if (!(await Category.exists({ _id: id, active: true }))) throw new AppError(422, 'INVALID_CATEGORY', 'Choose a valid category');
}

/** Optimistic stock change: fails (instead of overwriting) if stock moved meanwhile, and never drops below reserved units. */
export async function changeStock(p: { _id: Types.ObjectId; stock: number; reserved: number }, newStock: number, actor: Types.ObjectId, note: string, session?: ClientSession) {
  if (newStock === p.stock) return;
  if (newStock < p.reserved) throw new AppError(409, 'STOCK_BELOW_RESERVED', `${p.reserved} unit(s) are held in customers' checkouts; stock cannot go below that`);
  const r = await Product.updateOne({ _id: p._id, stock: p.stock, reserved: { $lte: newStock } }, { $set: { stock: newStock } }, { session });
  if (r.modifiedCount !== 1) throw new AppError(409, 'STOCK_CHANGED', 'Stock changed while you were editing. Reload and try again.');
  await InventoryMovement.create([{ product: p._id, type: 'adjustment', delta: newStock - p.stock, actor, note }], { session });
}

/** Records new commercial terms. Past orders keep their own snapshot; only new orders use the new version. */
export async function applyTerms(product: any, selling: number | undefined, creatorAmt: number | undefined, actor: Types.ObjectId, reason: string) {
  const { platformMarginPaise } = validateCommercialTerms(selling, creatorAmt);
  const changed = product.sellingPricePaise !== selling || product.creatorAmountPaise !== creatorAmt || !product.pricingVersion;
  product.sellingPricePaise = selling; product.creatorAmountPaise = creatorAmt; product.platformMarginPaise = platformMarginPaise;
  if (changed) {
    product.pricingVersion = (product.pricingVersion || 0) + 1;
    await ProductPricingHistory.create({ product: product._id, version: product.pricingVersion, sellingPricePaise: selling, creatorAmountPaise: creatorAmt, platformMarginPaise, changedBy: actor, reason });
  }
  return changed;
}

export const creatorView = async (p: any) => ({
  id: String(p._id), slug: p.slug, name: p.name, description: p.description, story: p.story, category: String(p.category), materials: p.materials, dimensions: p.dimensions, colors: p.colors,
  careInstructions: p.careInstructions, personalizationOptions: p.personalizationOptions, productionDetails: p.productionDetails, madeToOrder: p.madeToOrder, dispatchDays: p.dispatchDays,
  stock: p.stock, reserved: p.reserved, status: p.status, requiresReapproval: p.requiresReapproval,
  suggestedPricePaise: p.suggestedPricePaise, proposedCreatorAmountPaise: p.proposedCreatorAmountPaise,
  approvedSellingPricePaise: p.sellingPricePaise, approvedCreatorAmountPaise: p.creatorAmountPaise, // margin is deliberately not shown
  feedback: (p.reviewFeedback ?? []).map((f: any) => ({ note: f.note, at: f.at })), soldCount: p.soldCount,
  images: (await ProductImage.find({ product: p._id }).sort({ sortOrder: 1 }).lean()).map((i) => i.url), updatedAt: p.updatedAt,
});
