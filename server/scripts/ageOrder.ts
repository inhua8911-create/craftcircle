// Test support only: backdates a delivery so earnings clear the return window, then runs the real eligibility job.
// Usage (from server/): npx tsx scripts/ageOrder.ts <orderNumber>
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Order } from '../src/models/index.js';
import { promoteEligibleEarnings } from '../src/services/earnings.js';
await connectDb();
const r = await Order.updateOne({ orderNumber: process.argv[2] }, { 'shipment.deliveredAt': new Date(Date.now() - 10 * 86_400_000) });
console.log('backdated', r.modifiedCount, 'promoted', await promoteEligibleEarnings(new Date(), 7));
await mongoose.disconnect();
