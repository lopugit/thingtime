import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { createNativeRateLimitRepository, nativeByteBudgetPersistenceInTransaction } from './nativeRateLimits';
import { withHomeRateLimitRepository } from '../rateLimit/repository';
import { consumeByteBudget, consumeByteBudgetUsing, refundByteBudget } from '../rateLimit/byteBudget';
import { setRateLimitConfig } from '../rateLimit/config';
import { physicalCollectionName } from '../mongodb/collectionNames';
const key = (name: string) => createHash('sha256').update(`bytes:${name}`).digest('hex');
const at = new Date('2026-11-12T01:00:00Z');
async function fixture(t: TestContext) {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-byte-budget-'));
 const providers: ReturnType<typeof createCollectionProvider>[] = [];
 t.after(async () => { await Promise.all(providers.map(p => p.close())); await rm(directory, { recursive: true, force: true }); });
 return async (name = 'home.sqlite') => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, name))); providers.push(provider);
  const auth = await createNativeHomeAuthRepositories(provider, 'home');
  const repository = await createNativeRateLimitRepository(provider, 'home');
  const run = <T>(work: () => T | Promise<T>) => auth.run(() => withHomeRateLimitRepository(repository, work));
  const read = (bucket: string) => provider.transaction(tx => { const row = tx.collection(physicalCollectionName('rateLimits')).find({ filter: { op: 'eq', path: ['key'], value: bucket }, limit: 1 }).documents[0]; return row ? BSON.deserialize(row) : null; });
  return { provider, auth, repository, run, read };
 };
}
test('byte fixed window matches exact cutoff, rejection metadata, floor refund and distinct budget identities', async t => {
 const open = await fixture(t), f = await open(), bucket = key('model');
 const charge = (offset: number, amount: number) => f.run(() => f.repository.consumeByteWindow({ key: bucket, now: new Date(at.getTime() + offset), charge: amount, limitBytes: 9, windowMs: 1000 }));
 assert.deepEqual(await charge(0, 9), { allowed: true, usedBytes: 9, limitBytes: 9, resetAt: new Date(at.getTime() + 1000).toISOString() });
 assert.equal((await charge(999, 1)).allowed, false);
 assert.equal((await f.read(bucket))!.expiresAt.getTime(), at.getTime() + 1999);
 assert.equal((await charge(1000, 8)).usedBytes, 8);
 await f.run(() => f.repository.refundByteWindow({ key: bucket, charge: 100 }));
 assert.equal((await f.read(bucket))!.bytes, 0);
 await f.run(async () => {
  assert.equal((await consumeByteBudget('sandbox.storage.global', 12.9)).usedBytes, 12);
  assert.equal((await consumeByteBudget('sandbox.storage.global', 12)).usedBytes, 24); // No idempotency key in this contract.
  assert.equal((await consumeByteBudget('auth.login', 2)).usedBytes, 2);
  await refundByteBudget('sandbox.storage.global', 3.9);
  assert.equal((await f.read(key('sandbox.storage.global')))!.bytes, 21);
 });
});
test('concurrent SQLite handles share budget; reopening persists; separate profiles isolate', async t => {
 const open = await fixture(t), a = await open(), b = await open();
 await a.run(() => setRateLimitConfig({ 'sandbox.storage.global': { limit: 1 } } as any, 'fixture'));
 const results = await Promise.all(Array.from({ length: 32 }, (_, i) => (i % 2 ? a : b).run(() => consumeByteBudget('sandbox.storage.global', 65536))));
 assert.equal(results.filter(r => r.allowed).length, 16);
 const reopened = await open(), isolated = await open('other.sqlite');
 assert.equal((await reopened.run(() => consumeByteBudget('sandbox.storage.global', 1))).allowed, false);
 assert.equal((await isolated.run(() => consumeByteBudget('sandbox.storage.global', 1))).usedBytes, 1);
 await assert.rejects(a.auth.run(() => withHomeRateLimitRepository(isolated.repository, () => consumeByteBudget('sandbox.storage.global', 1))), (e: any) => e.code === 'HOME_REPOSITORY_SCOPE');
});
test('bound transaction charges roll back with interrupted content; expired scope and closed provider fail closed', async t => {
 const open = await fixture(t), f = await open();
 await f.run(async () => {
  await assert.rejects(f.provider.transaction(async tx => {
   assert.equal((await consumeByteBudgetUsing(nativeByteBudgetPersistenceInTransaction(tx), 'sandbox.storage.global', 25)).allowed, true);
   throw Error('interrupted content');
  }), /interrupted content/);
  assert.equal(await f.read(key('sandbox.storage.global')), null);
 });
 await f.auth.run(async () => { const outcome = await consumeByteBudget('sandbox.storage.global', 1); assert.equal(outcome.allowed, false); assert.equal(outcome.unavailable, true); });
 let release!: () => void, entered!: () => void, pending!: Promise<unknown>;
 const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
 const blocker = f.provider.transaction(async () => { entered(); await gate; }); await started;
 await f.run(() => { pending = f.repository.consumeByteWindow({ key: key('expired'), now: at, charge: 1, limitBytes: 9, windowMs: 1000 }); });
 const rejected = assert.rejects(pending, (e: any) => e.code === 'RATE_LIMIT_REPOSITORY_SCOPE'); release(); await blocker; await rejected;
 assert.equal(await f.read(key('expired')), null);
 await f.provider.close();
 await f.run(async () => { const result = await consumeByteBudget('sandbox.storage.global', 1); assert.equal(result.allowed, false); assert.equal(result.unavailable, true); await refundByteBudget('sandbox.storage.global', 1); });
});
test('native invalid amounts and corrupted byte rows refuse without rewriting or Mongo fallback', async t => {
 const open = await fixture(t), f = await open();
 await f.run(async () => {
  assert.equal((await consumeByteBudget('sandbox.storage.global', NaN)).unavailable, true);
  await consumeByteBudget('sandbox.storage.global', 1);
  await f.provider.transaction(tx => tx.collection(physicalCollectionName('rateLimits')).updateOne({ op: 'eq', path: ['key'], value: key('sandbox.storage.global') }, [{ op: 'set', path: ['bytes'], value: -1 }]));
  const prior = await f.read(key('sandbox.storage.global'));
  assert.equal((await consumeByteBudget('sandbox.storage.global', 1)).unavailable, true);
  await refundByteBudget('sandbox.storage.global', 1);
  assert.deepEqual(await f.read(key('sandbox.storage.global')), prior);
 });
});
test('byte inputs snapshot before queued admission; disabled rule stays deliberate and oversized charge never burns', async t => {
 const open = await fixture(t), f = await open();
 await f.run(async () => {
  let getterRan = false;
  const hostile = Object.defineProperty({ key: key('hostile') }, 'now', { enumerable: true, get() { getterRan = true; return at; } });
  await assert.rejects(f.repository.consumeByteWindow(hostile as any)); assert.equal(getterRan, false);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const blocker = f.provider.transaction(async () => { entered(); await gate; }); await started;
  const input = { key: key('snapshot'), now: new Date(at), charge: 2, limitBytes: 9, windowMs: 1000 };
  const pending = f.repository.consumeByteWindow(input); input.charge = 9; input.now.setTime(0); release(); await blocker;
  assert.equal((await pending).usedBytes, 2); assert.equal((await f.read(key('snapshot')))!.bytesWindowStartedAt.getTime(), at.getTime());
  const oversized = await f.repository.consumeByteWindow({ key: key('oversized'), now: at, charge: 10, limitBytes: 9, windowMs: 1000 });
  assert.equal(oversized.allowed, false); assert.equal(oversized.usedBytes, 0);
  await setRateLimitConfig({ 'sandbox.storage.global': { enabled: false } } as any, 'fixture');
  assert.equal((await consumeByteBudget('sandbox.storage.global', 1)).allowed, true);
  assert.equal(await f.read(key('sandbox.storage.global')), null);
 });
});
test('hosted byte admission retains Mongo atomic guard, cutoff, refund and outage behavior without native imports', async () => {
 const { execFile } = await import('node:child_process'), { promisify } = await import('node:util'), { fileURLToPath } = await import('node:url');
 const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(new URL('./nativeByteBudgets.hosted.fixture.mts', import.meta.url))], { timeout: 30000 });
 assert.match(stdout, /hosted-byte-budget-operations-ok/);
});
test('byte adapter rejects actual foreign provider transactions despite matching home labels', async t => {
 const open = await fixture(t), a = await open(), b = await open('other.sqlite');
 await b.run(() => consumeByteBudget('sandbox.storage.global', 13));
 const prior = await b.read(key('sandbox.storage.global'));
 for (const operation of ['charge', 'refund', 'config'] as const) {
  await assert.rejects(a.run(() => b.provider.transaction(async tx => {
   const adapter = nativeByteBudgetPersistenceInTransaction(tx);
   if (operation === 'charge') await adapter.consumeByteWindow({ key: key('foreign-charge'), now: at, charge: 1, limitBytes: 10, windowMs: 1000 });
   else if (operation === 'refund') await adapter.refundByteWindow({ key: key('sandbox.storage.global'), charge: 10 });
   else await adapter.readConfig();
  })), (error: any) => error.code === 'HOME_REPOSITORY_SCOPE');
 }
 assert.equal(await b.read(key('foreign-charge')), null);
 assert.deepEqual(await b.read(key('sandbox.storage.global')), prior);
 assert.equal(await a.read(key('sandbox.storage.global')), null);
 await a.run(() => a.provider.transaction(async tx => {
  const outcome = await consumeByteBudgetUsing(nativeByteBudgetPersistenceInTransaction(tx), 'sandbox.storage.global', 7);
  assert.equal(outcome.usedBytes, 7);
 }));
});
