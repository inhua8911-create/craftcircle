process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
import { beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterEach(async () => {
  // Raw driver bypasses the ledger/audit immutability hooks: test cleanup only.
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
});
afterAll(async () => {
  await mongoose.disconnect();
});
