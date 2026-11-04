import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { demoMode, env } from '../config/env.js';
import { StoredImage } from '../models/index.js';
import { AppError } from '../utils/errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_DIR = path.join(import.meta.dirname, '..', '..', 'uploads');

/** Detects the real image type from magic bytes. The client's filename and Content-Type are never trusted. */
export function sniffImage(b: Buffer): { ext: 'jpg' | 'png' | 'webp'; mime: string } | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null; // SVG, GIF, HTML, PDFs etc. are rejected
}

/** Local disk storage (default, dev), or MongoDB when DEMO_MODE=true. If CLOUDINARY_URL is set, uploads go to Cloudinary (signed REST call; not verified live). */
export async function storeImage(buf: Buffer): Promise<{ url: string; publicId: string }> {
  const type = sniffImage(buf);
  if (!type) throw new AppError(415, 'UNSUPPORTED_IMAGE', 'Only JPEG, PNG or WebP images are accepted');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', 'Images must be 5 MB or smaller');
  if (env.CLOUDINARY_URL) {
    const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(env.CLOUDINARY_URL);
    if (!m) throw new AppError(500, 'STORAGE_MISCONFIGURED', 'Image storage is misconfigured');
    const [, key, secret, cloud] = m; const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${secret}`).digest('hex');
    const form = new FormData();
    form.set('file', `data:${type.mime};base64,${buf.toString('base64')}`); form.set('api_key', key!); form.set('timestamp', String(timestamp)); form.set('signature', signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new AppError(502, 'STORAGE_ERROR', 'Could not store the image. Please try again.');
    const j = (await res.json()) as { secure_url: string; public_id: string };
    return { url: j.secure_url, publicId: j.public_id };
  }
  const name = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`; // server-chosen name: no path traversal possible
  if (demoMode) { // no disk, no image service: keep the bytes in MongoDB and serve them from /uploads/:name
    await StoredImage.create({ name, mime: type.mime, data: buf });
    return { url: `/uploads/${name}`, publicId: name };
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), buf, { flag: 'wx' });
  return { url: `/uploads/${name}`, publicId: name };
}

/** Only images we stored may be attached to products/applications (blocks hotlinked/tracking URLs). */
export function isOwnedImageUrl(u: string) {
  return /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(u) || /^https:\/\/res\.cloudinary\.com\//.test(u);
}
