import { MongoMemoryReplSet } from 'mongodb-memory-server';

let repl: MongoMemoryReplSet;
export async function setup() {
  // Uses MONGOMS_SYSTEM_BINARY if provided (see docs/TESTING.md); otherwise downloads mongod.
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = repl.getUri('craftcircle_test');
}
export async function teardown() {
  await repl?.stop();
}
