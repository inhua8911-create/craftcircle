import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  // Transactions (orders, earnings, payouts) require a replica set. Fail loudly instead of corrupting money later.
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid') {
    throw new Error('MongoDB must run as a replica set (or Atlas) because financial operations use transactions. See README: "MongoDB setup".');
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  logger.info('MongoDB connected');
}
