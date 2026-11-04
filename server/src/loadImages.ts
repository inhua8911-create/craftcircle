// Usage: npm run load-images   (from server/, with the same .env as the app)
// Re-reads server/seed-images/ and puts those photos on the sample products already in the database. Safe to re-run.
import mongoose from 'mongoose';
import { connectDb } from './config/db.js';
import { attachSeedImages } from './services/seedImages.js';

await connectDb();
const r = await attachSeedImages();
if (!r.products) console.log('No photos attached. Check the file names in server/seed-images/ (see the README there).');
await mongoose.disconnect();
