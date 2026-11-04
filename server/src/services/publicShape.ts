import { CreatorProfile, ProductImage } from '../models/index.js';

/** Public view of a product. Deliberately omits creatorAmount, margin, proposed amounts, reserved and review notes. */
export function availability(p: { stock: number; reserved: number; madeToOrder: boolean }) {
  const free = Math.max(0, p.stock - p.reserved);
  return { available: p.madeToOrder || free > 0, maxPurchasable: p.madeToOrder ? 20 : Math.min(20, free) };
}

export async function toPublicProducts(products: any[]) {
  if (!products.length) return [];
  const ids = products.map((p) => p._id);
  const [images, creators] = await Promise.all([
    ProductImage.find({ product: { $in: ids } }).sort({ sortOrder: 1 }).lean(),
    CreatorProfile.find({ _id: { $in: products.map((p) => p.creator) } }).select('slug displayName').lean(),
  ]);
  const imgBy = new Map<string, any[]>();
  for (const i of images) { const k = String(i.product); imgBy.set(k, [...(imgBy.get(k) ?? []), { url: i.url, alt: i.alt }]); }
  const crBy = new Map(creators.map((c) => [String(c._id), c]));
  return products.map((p) => {
    const c = crBy.get(String(p.creator));
    return {
      id: String(p._id), slug: p.slug, name: p.name, description: p.description, story: p.story,
      pricePaise: p.sellingPricePaise, materials: p.materials, dimensions: p.dimensions, colors: p.colors,
      careInstructions: p.careInstructions, personalizationOptions: p.personalizationOptions,
      madeToOrder: p.madeToOrder, dispatchDays: p.dispatchDays ?? null, featured: p.featured, isSample: p.isSample,
      rating: p.reviewCount ? { average: Math.round((p.ratingSum / p.reviewCount) * 10) / 10, count: p.reviewCount } : null,
      soldCount: p.soldCount, category: String(p.category),
      creator: c ? { slug: c.slug, name: c.displayName } : null,
      images: imgBy.get(String(p._id)) ?? [], ...availability(p),
    };
  });
}

/** Creator's public profile honours their chosen visibility flags. */
export function toPublicCreator(c: any) {
  const pf = c.publicFields ?? {};
  return {
    slug: c.slug, name: c.displayName, specialties: c.specialties, profileImage: c.profileImage?.url ?? null,
    bio: pf.bio ? c.bio : undefined, story: pf.story ? c.story : undefined,
    city: pf.city ? c.city : undefined, links: pf.links ? c.links : undefined,
  };
}
