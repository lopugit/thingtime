import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { getRateLimitConfig, setRateLimitConfig, RATE_LIMIT_DEFAULTS } from '../rateLimit/config';
import { enforceRateLimit, enforceFixedRateLimit, enforceQuotaRateLimit } from '../rateLimit/enforce';
import { consumeByteBudget, refundByteBudget } from '../rateLimit/byteBudget';
import { withHomeRateLimitRepository } from '../rateLimit/repository';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { createNativeRateLimitRepository } from './nativeRateLimits';
import type { CollectionProvider } from './collectionContract';
const key = (value: string) => createHash('sha256').update(value).digest('hex');
const request = new Request('http://127.0.0.1:17873/api/v1/auth/register', { headers: { 'x-forwarded-for': '192.0.2.11' } });
const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const at = new Date('2026-11-12T01:00:00Z');
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-limiter-')), providers: CollectionProvider[] = [];
 t.after(async () => { await Promise.all(providers.map(p => p.close())); await rm(directory, { recursive: true, force: true }); });
 const open = async (name = 'home.sqlite') => {
  const path = join(directory, name), provider = createCollectionProvider(await openSqliteDocumentStore(path)); providers.push(provider);
  const auth = await createNativeHomeAuthRepositories(provider, 'home'), repository = await createNativeRateLimitRepository(provider, 'home');
  return { path, provider, auth, repository, run: <T>(work: () => T | Promise<T>) => auth.run(() => withHomeRateLimitRepository(repository, work)) };
 };
 return { open };
};
const read = (f: any, bucket: string) => f.provider.transaction((tx: any) => {
 const bytes = tx.collection(physicalCollectionName('rateLimits')).find({ filter: { op: 'eq', path: ['key'], value: bucket }, limit: 1 }).documents[0];
 return bytes ? BSON.deserialize(bytes) : null;
});

test('real SQLite canonical config/enforcement survives reopen without hosted config cache or Mongo', async t => {
 const { open } = await fixture(t), a = await open();
 await a.run(async () => {
  assert.deepEqual((await getRateLimitConfig())['auth.register'], RATE_LIMIT_DEFAULTS['auth.register']);
  await setRateLimitConfig({ 'auth.register': { limit: 2 } } as any, 'fixture-admin');
  assert.equal((await enforceRateLimit(request, 'auth.register', null)).remaining, 1);
  assert.equal((await enforceRateLimit(request, 'auth.register', null)).allowed, true);
  assert.equal((await enforceRateLimit(request, 'auth.register', null)).allowed, false);
 });
 await a.provider.close(); const b = await open(), isolated = await open('other.sqlite');
 await b.run(async () => { assert.equal((await getRateLimitConfig())['auth.register'].limit, 2); assert.equal((await enforceRateLimit(request, 'auth.register', null)).allowed, false); });
 await isolated.run(async () => { assert.equal((await getRateLimitConfig())['auth.register'].limit, 10); assert.equal((await enforceRateLimit(request, 'auth.register', null)).allowed, true); });
});
test('inclusive sliding cutoff, multi-unit charge, rejected metadata and exact expiry match independent timestamp model', async t => {
 const { open } = await fixture(t), f = await open(), bucket = key('model'); let model: number[] = [];
 for (const [offset, cost] of [[0, 2], [200, 1], [1000, 1], [1001, 2], [1200, 2], [1201, 1], [2202, 3]]) {
  const now = new Date(at.getTime() + offset), active = model.filter(time => time >= now.getTime() - 1000), allowed = active.length + cost <= 3;
  if (allowed) model = [...active, ...Array.from({ length: cost }, () => now.getTime())];
  const result = await f.run(() => f.repository.consumeWindow({ key: bucket, now, cost, limit: 3, windowMs: 1000 }));
  assert.equal(result.allowed, allowed); assert.equal(result.remaining, allowed ? 3 - model.length : 0);
  const effective = model.filter(time => time >= now.getTime() - 1000);
  assert.equal(result.resetAt, new Date((effective.length ? Math.min(...effective) : now.getTime()) + 1000).toISOString());
  const stored = await read(f, bucket); assert.deepEqual(stored.requests.map((date: Date) => date.getTime()), model);
  assert.equal(stored.updatedAt.getTime(), now.getTime()); assert.equal(stored.expiresAt.getTime(), now.getTime() + 1000);
 }
});
test('concurrent real handles never exceed quota and canonical fixed/quota/multiplier/disabled policies are retained', async t => {
 const { open } = await fixture(t), a = await open(), b = await open();
 const results = await Promise.all(Array.from({ length: 35 }, (_, i) => (i % 2 ? a : b).run(() => enforceFixedRateLimit(request, 'competing', 'identity', { limit: 7, windowMs: 60000 }))));
 assert.equal(results.filter(row => row.allowed).length, 7); assert.equal((await read(a, key('fixed:competing:identity'))).requests.length, 7);
 await a.run(async () => {
  await setRateLimitConfig({ 'auth.login': { limit: 1 }, 'auth.register': { enabled: false } } as any, 'fixture');
  for (let i = 0; i < 5; i++) assert.equal((await enforceRateLimit(request, 'auth.login', 'multiplied', { limitMultiplier: 5 })).allowed, true);
  assert.equal((await enforceRateLimit(request, 'auth.login', 'multiplied', { limitMultiplier: 5 })).allowed, false);
  assert.equal((await enforceRateLimit(request, 'auth.register', null)).allowed, true);
  assert.equal((await enforceQuotaRateLimit('quota', 'owner', 1)).allowed, true); assert.equal((await enforceQuotaRateLimit('quota', 'owner', 1)).allowed, false);
  assert.equal((await enforceQuotaRateLimit('quota', 'owner', 11001)).limit, 0);
 });
});
test('atomic concurrent partial config patches preserve both changes and canonical legacy migration', async t => {
 const { open } = await fixture(t), a = await open(), b = await open();
 await Promise.all([a.run(() => setRateLimitConfig({ 'auth.login': { limit: 9 } } as any, 'a')), b.run(() => setRateLimitConfig({ 'auth.login': { windowMs: 2000 } } as any, 'b'))]);
 await a.run(async () => { assert.deepEqual((await getRateLimitConfig())['auth.login'], { limit: 9, windowMs: 2000, enabled: true }); });
});
test('native missing/failed composition denies ordinary requests without hosted fail-open; byte budget refuses Mongo', async t => {
 const { open } = await fixture(t), f = await open();
 await f.auth.run(async () => { const denied = await enforceRateLimit(request, 'auth.login', null); assert.equal(denied.allowed, false); assert.equal(denied.unavailable, true); });
 await f.run(async () => { await assert.rejects(consumeByteBudget('auth.login', 12), code('RATE_LIMIT_UNSUPPORTED')); await assert.rejects(refundByteBudget('auth.login', 12), code('RATE_LIMIT_UNSUPPORTED')); });
 await f.provider.close(); await f.run(async () => { const denied = await enforceRateLimit(request, 'auth.login', null); assert.equal(denied.allowed, false); assert.equal(denied.unavailable, true); });
});
test('same-label other file, saved repository and queued expired lifetime cannot read or write', async t => {
 const { open } = await fixture(t), a = await open(), b = await open('other.sqlite'); let entered = false;
 await a.auth.run(() => assert.rejects(withHomeRateLimitRepository(b.repository, () => { entered = true; }), code('HOME_REPOSITORY_SCOPE'))); assert.equal(entered, false);
 await assert.rejects(a.repository.readConfig(), code('RATE_LIMIT_REPOSITORY_SCOPE'));
 let release!: () => void, started!: () => void, pending!: Promise<unknown>;
 const gate = new Promise<void>(r => { release = r; }), start = new Promise<void>(r => { started = r; });
 const blocker = a.provider.transaction(async () => { started(); await gate; }); await start;
 await a.run(() => { pending = a.repository.consumeWindow({ key: key('expired'), now: at, cost: 1, limit: 2, windowMs: 1000 }); });
 const refused = assert.rejects(pending, code('RATE_LIMIT_REPOSITORY_SCOPE')); release(); await blocker; await refused;
 assert.equal(await read(a, key('expired')), null); assert.equal(await read(b, key('expired')), null);
});
test('hostile input is inert and accepted input/config is snapshotted before queue admission', async t => {
 const { open } = await fixture(t), f = await open(); let called = false;
 await f.run(async () => {
  const hostile = Object.defineProperty({ key: key('hostile') }, 'now', { enumerable: true, get() { called = true; return at; } });
  await assert.rejects(f.repository.consumeWindow(hostile as any)); assert.equal(called, false);
  let release!: () => void, started!: () => void; const gate = new Promise<void>(r => { release = r; }), start = new Promise<void>(r => { started = r; });
  const blocker = f.provider.transaction(async () => { started(); await gate; }); await start;
  const input = { key: key('frozen'), now: new Date(at), cost: 1, limit: 2, windowMs: 1000 };
  const pending = f.repository.consumeWindow(input); input.cost = 2; input.now.setTime(0); release(); await blocker;
  assert.equal((await pending).remaining, 1); assert.equal((await read(f, key('frozen'))).requests[0].getTime(), at.getTime());
 });
});
test('malformed persisted counters/settings refuse rather than grant and do not mutate state', async t => {
 const { open } = await fixture(t), f = await open(), bucket = key('corrupt');
 await f.run(() => f.repository.consumeWindow({ key: bucket, now: at, cost: 1, limit: 2, windowMs: 1000 }));
 await f.provider.transaction(tx => tx.collection(physicalCollectionName('rateLimits')).updateOne({ op: 'eq', path: ['key'], value: bucket }, [{ op: 'set', path: ['requests'], value: ['not-a-date'] }]));
 const prior = await read(f, bucket);
 await f.run(() => assert.rejects(f.repository.consumeWindow({ key: bucket, now: at, cost: 1, limit: 2, windowMs: 1000 }), code('RATE_LIMIT_UNAVAILABLE')));
 assert.deepEqual(await read(f, bucket), prior);
 await f.run(() => setRateLimitConfig({}, 'fixture'));
 await f.provider.transaction(tx => tx.collection(physicalCollectionName('settings')).updateOne({ op: 'eq', path: ['key'], value: 'rateLimits' }, [{ op: 'set', path: ['endpoints'], value: { 'auth.login': { enabled: 'false' } } }]));
 await f.run(async () => { const result = await enforceRateLimit(request, 'auth.login', null); assert.equal(result.allowed, false); assert.equal(result.unavailable, true); });
});
test('hosted pipeline operations/fail-open and no native import remain compatible', async () => {
 const { execFile } = await import('node:child_process'), { promisify } = await import('node:util'), { fileURLToPath } = await import('node:url');
 const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(new URL('./nativeRateLimits.mongo.fixture.mts', import.meta.url))], { timeout: 30000, maxBuffer: 16384 });
 assert.match(stdout, /hosted-rate-limit-operations-ok/);
});

test('two independent Node processes atomically share the real-file canonical bucket', { timeout: 40000 }, async t => {
 const { fork } = await import('node:child_process'), { fileURLToPath } = await import('node:url');
 const { open } = await fixture(t), f = await open();
 const children = [0, 1].map(() => fork(fileURLToPath(new URL('./nativeRateLimits.process.fixture.mts', import.meta.url)), [f.path], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
 t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
 const ready = children.map(child => new Promise<void>((resolve, reject) => {
  child.once('error', reject); child.once('exit', code => { if (code !== 0) reject(Error('Child exited before readiness')); });
  child.once('message', message => { if (message === 'ready') resolve(); else reject(Error('Invalid readiness')); });
 }));
 const results = children.map(child => new Promise<number>((resolve, reject) => {
  let allowed: number | undefined, errors = '';
  child.stderr!.on('data', value => { errors += String(value); });
  child.on('message', (value: any) => { if (typeof value?.allowed === 'number') allowed = value.allowed; });
  child.once('error', reject); child.once('exit', code => { if (code !== 0 || allowed === undefined) reject(Error('Child failed: ' + errors)); else resolve(allowed); });
 }));
 // Install handlers before waiting; a failed worker must not leak a rejection.
 const completed = Promise.all(results); completed.catch(() => undefined);
 await Promise.all(ready); children.forEach(child => child.send('go'));
 assert.equal((await completed).reduce((sum, value) => sum + value, 0), 9);
 assert.equal((await read(f, key('fixed:process-contention:shared'))).requests.length, 9);
});
