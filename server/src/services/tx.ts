import mongoose, { type ClientSession } from 'mongoose';

/** Run fn inside a transaction (requires a replica set / mongos). Retries on transient errors. */
export async function withTx<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
export const isDuplicateKey = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
