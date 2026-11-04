// Puts REAL photos on the demo shop. Photos are plain files in server/seed-images/ (see the README there), matched by name:
//   products:   <product-name-slug>.jpg  (extra photos: -2, -3), else the product's <category-slug>.jpg
//   categories: <category-slug>.jpg  (banner)            creators: creator-<creator-slug>.jpg  (profile photo)
// Products with no matching file keep their placeholder. Images go through storeImage(), so in DEMO_MODE they live in MongoDB.
// Only the seed's own images are replaced: photos a creator uploaded through the app are never touched.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Category, CreatorProfile, Product, ProductImage } from '../models/index.js';
import { storeImage } from './uploads.js';
import { slugify } from '../utils/slug.js';

export const SEED_IMAGE_DIR = path.join(import.meta.dirname, '..', '..', 'seed-images');
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const SEED_MARK = 'seed'; // ProductImage.publicId of images placed by this script

export async function attachSeedImages(log: (m: string) => void = console.log) {
  let names: string[];
  try { names = await fs.readdir(SEED_IMAGE_DIR); } catch { return { products: 0, files: 0 }; }
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const filesFor = (base: string) => ['', '-2', '-3', '-4'].flatMap((suffix) => EXTS.map((e) => byLower.get(`${base}${suffix}.${e}`)).filter((x): x is string => !!x).slice(0, 1));

  const stored = new Map<string, string>(); // file -> url, so one photo used twice is stored once
  const urlOf = async (f: string) => {
    if (!stored.has(f)) stored.set(f, (await storeImage(await fs.readFile(path.join(SEED_IMAGE_DIR, f)))).url);
    return stored.get(f)!;
  };

  const cats = await Category.find({}).lean();
  const catSlug = new Map(cats.map((c) => [String(c._id), c.slug]));
  let banners = 0;
  for (const c of cats) {
    const [f] = filesFor(c.slug);
    if (f) { await Category.updateOne({ _id: c._id }, { banner: { url: await urlOf(f), alt: c.name } }); banners++; }
  }
  let avatars = 0;
  for (const cp of await CreatorProfile.find({}).lean()) {
    const [f] = filesFor(`creator-${cp.slug}`);
    if (f) { await CreatorProfile.updateOne({ _id: cp._id }, { profileImage: { url: await urlOf(f) } }); avatars++; }
  }

  let products = 0;
  for (const p of await Product.find({}).lean()) {
    const existing = await ProductImage.find({ product: p._id }).lean();
    if (!existing.every((i) => i.url.startsWith('/sample/') || i.publicId === SEED_MARK)) continue; // has real creator uploads: leave alone
    let files = filesFor(slugify(p.name));
    if (!files.length) files = filesFor(catSlug.get(String(p.category)) ?? '');
    if (!files.length) continue;
    const rows = await Promise.all(files.map(async (f, i) => ({ product: p._id, url: await urlOf(f), alt: p.name, sortOrder: i, publicId: SEED_MARK })));
    await ProductImage.deleteMany({ product: p._id });
    await ProductImage.insertMany(rows);
    products++;
  }
  log(`Seed photos: ${products} products, ${banners} category banners, ${avatars} creator photos (from ${stored.size} image file(s)).`);
  return { products, files: stored.size };
}
