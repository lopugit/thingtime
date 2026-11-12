import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getLiveRosterEntries, persistRoster, resolveRoster, type RosterDoc } from '../auth/accounts';
import { parseAccountsCookie, serializeAccountsCookie } from '../auth/accountsCookie';
import { currentRosterRepository, withHomeRosterRepository } from '../auth/rosterRepository';
import { createCollectionProvider } from './collectionProvider';
import { createNativeRosterRepository } from './nativeRosters';
import { createNativeHomeAuthRepositories } from './nativeUserIdentities';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { openSqliteDocumentStore } from './sqliteStore';
import type { CollectionProvider } from './collectionContract';

const code = (expected: string) => (error: unknown) => (error as { code?: string })?.code === expected;
const entry = (userId = 'synthetic-a') => ({ userId, jti: `session-${userId}`, addedAt: new Date('2026-01-01T00:00:00Z') });
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-rosters-'));
 const providers: CollectionProvider[] = [];
 const open = async (name = 'home.sqlite', plane = 'home') => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, name))); providers.push(provider);
  return { provider, repository: await createNativeRosterRepository(provider, plane), plane };
 };
 t.after(async () => { await Promise.all(providers.map(p => p.close())); await rm(directory, { recursive: true, force: true }); });
 return { open };
};
const cookieRequest = (cookies: string[]) => new Request('http://127.0.0.1:17873/api/v1/auth/accounts', { headers: { cookie: cookies.map(value => value.split(';')[0]).join('; ') } });

test('canonical roster persistence and cookies survive real SQLite reopen, guarded updates and logout deletion', async t => {
 const { open } = await fixture(t), f = await open(); let id = '', version = '';
 await withHomeRosterRepository(f.repository, f.plane, async () => {
  const first = await persistRoster(null, [entry()]);
  assert.equal(first.conflict, false); assert.ok(first.rosterId); id = first.rosterId;
  assert.equal((await parseAccountsCookie(cookieRequest(first.cookies))).rosterId, id);
  assert.deepEqual(await getLiveRosterEntries(id), [entry()]);
  const row = await f.repository.findById(id); assert.ok(row); version = row.version;
  assert.equal(row.expiresAt!.getTime() - row.updatedAt.getTime(), 30 * 86400000);
  row.entries[0].userId = 'mutated-copy';
  assert.equal((await getLiveRosterEntries(id))[0].userId, entry().userId);
 });
 await f.provider.close(); const reopened = await open();
 await withHomeRosterRepository(reopened.repository, reopened.plane, async () => {
  assert.deepEqual(await getLiveRosterEntries(id), [entry()]);
  const updated = await persistRoster(id, [entry(), entry('synthetic-b')], version);
  assert.equal(updated.rosterId, id); assert.equal(updated.conflict, false);
  const current = await reopened.repository.findById(id); assert.ok(current); assert.notEqual(current.version, version);
  const removed = await persistRoster(id, [], current.version);
  assert.equal(removed.conflict, false); assert.equal((await parseAccountsCookie(cookieRequest(removed.cookies))).rosterId, null);
  assert.equal(await reopened.repository.findById(id), null);
 });
});

test('competing canonical writes on two SQLite handles have one winner; stale delete preserves the winner', async t => {
 const { open } = await fixture(t), a = await open(), b = await open(); let row!: RosterDoc;
 await withHomeRosterRepository(a.repository, a.plane, async () => {
  const created = await persistRoster(null, [entry()]); row = (await a.repository.findById(created.rosterId!))!;
 });
 const writes = await Promise.all([a, b].map((f, index) => withHomeRosterRepository(f.repository, f.plane,
  () => persistRoster(row.rosterId, [entry(), entry(`winner-${index}`)], row.version))));
 assert.equal(writes.filter(result => result.conflict).length, 1);
 await withHomeRosterRepository(a.repository, a.plane, async () => {
  const winner = await a.repository.findById(row.rosterId); assert.ok(winner);
  const stale = await persistRoster(row.rosterId, [], row.version);
  assert.equal(stale.conflict, true); assert.deepEqual(await a.repository.findById(row.rosterId), winner);
 });
});

test('expired roster, planted pointer and Bearer-only request cannot expose account entries', async t => {
 const { open } = await fixture(t), f = await open();
 await withHomeRosterRepository(f.repository, f.plane, async () => {
  const created = await persistRoster(null, [entry()]); const row = (await f.repository.findById(created.rosterId!))!;
  const request = cookieRequest([await serializeAccountsCookie(row.rosterId)]);
  request.headers.set('Authorization', 'Bearer synthetic-not-a-browser-cookie');
  const resolved = await resolveRoster(request);
  assert.equal(resolved.rosterId, null); assert.equal(resolved.active, null); assert.deepEqual(resolved.accounts, []);
  await f.repository.replace(row.rosterId, { ...row, expiresAt: new Date(0) }, row.version);
  assert.deepEqual(await getLiveRosterEntries(row.rosterId), []);
  assert.equal((await resolveRoster(request)).rosterId, null);
 });
});

test('profile isolation and expired or nested home scopes refuse saved repository access', async t => {
 const { open } = await fixture(t), a = await open('a.sqlite', 'a'), b = await open('b.sqlite', 'b');
 await assert.rejects(withHomeRosterRepository(a.repository, b.plane, () => undefined), code('ROSTER_REPOSITORY_SCOPE'));
 let row!: RosterDoc;
 await withHomeRosterRepository(a.repository, a.plane, async () => {
  const made = await persistRoster(null, [entry()]); row = (await a.repository.findById(made.rosterId!))!;
  await assert.rejects(b.repository.findById(row.rosterId), code('ROSTER_REPOSITORY_SCOPE'));
  await assert.rejects(withHomeRosterRepository(b.repository, b.plane, () => undefined), code('ROSTER_REPOSITORY_SCOPE'));
 });
 await withHomeRosterRepository(b.repository, b.plane, async () => assert.equal(await b.repository.findById(row.rosterId), null));
 await assert.rejects(a.repository.findById(row.rosterId), code('ROSTER_REPOSITORY_SCOPE'));
 await assert.rejects(a.repository.remove(row.rosterId), code('ROSTER_REPOSITORY_SCOPE'));
 assert.equal(currentRosterRepository().kind, 'mongo-home');
});

test('native identity scope without its matching roster binding cannot fall back to Mongo', async t => {
 const { open } = await fixture(t), f = await open(), foreign = await open('foreign.sqlite', 'foreign');
 const auth = await createNativeHomeAuthRepositories(f.provider, f.plane);
 await auth.run(async () => {
  assert.throws(() => currentRosterRepository(), code('ROSTER_REPOSITORY_SCOPE'));
  await assert.rejects(persistRoster(null, [entry()]), code('ROSTER_REPOSITORY_SCOPE'));
  await assert.rejects(withHomeRosterRepository(foreign.repository, foreign.plane, () => foreign.repository.findById('any')), code('ROSTER_REPOSITORY_SCOPE'));
  await withHomeRosterRepository(f.repository, f.plane, async () => {
   const made = await persistRoster(null, [entry()]); assert.ok(made.rosterId);
  });
 });
});

test('different SQLite providers with the same home label cannot combine identity and roster authority', async t => {
 const { open } = await fixture(t), a = await open('a.sqlite', 'home'), b = await open('b.sqlite', 'home');
 const auth = await createNativeHomeAuthRepositories(a.provider, a.plane);
 await auth.run(async () => {
  await assert.rejects(withHomeRosterRepository(b.repository, b.plane, () => persistRoster(null, [entry()])), code('HOME_REPOSITORY_SCOPE'));
  await assert.rejects(withHomeRosterRepository(b.repository, b.plane, () => b.repository.findById('foreign')), code('HOME_REPOSITORY_SCOPE'));
  await withHomeRosterRepository(a.repository, a.plane, async () => {
   const made = await persistRoster(null, [entry()]); assert.ok(made.rosterId);
  });
 });
 await b.provider.transaction(s => assert.equal(s.collection(physicalCollectionName('rosters')).find({ limit: 1 }).documents.length, 0));
});

test('detached and queued roster writes refuse after the home scope closes', async t => {
 const { open } = await fixture(t), f = await open();
 let resume!: () => void, pending!: Promise<unknown>;
 const gate = new Promise<void>(resolve => { resume = resolve; });
 await withHomeRosterRepository(f.repository, f.plane, () => { pending = gate.then(() => persistRoster(null, [entry()])); });
 const refused = assert.rejects(pending, code('ROSTER_REPOSITORY_SCOPE')); resume(); await refused;
 let entered!: () => void, release!: () => void;
 const ready = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
 const blocker = f.provider.transaction(async () => { entered(); await hold; }); await ready;
 let queued!: Promise<unknown>;
 await withHomeRosterRepository(f.repository, f.plane, () => { queued = persistRoster(null, [entry()]); });
 const queuedRefused = assert.rejects(queued, code('ROSTER_REPOSITORY_SCOPE')); release(); await blocker; await queuedRefused;
});

test('native roster admission rejects malformed dates and hostile getters without executing them', async t => {
 const { open } = await fixture(t), f = await open(); let executed = false;
 await withHomeRosterRepository(f.repository, f.plane, async () => {
  const made = await persistRoster(null, [entry()]), row = (await f.repository.findById(made.rosterId!))!;
  await assert.rejects(f.repository.replace(row.rosterId, { ...row, expiresAt: new Date(NaN) }), code('UNSUPPORTED_COLLECTION_OPERATION'));
  await assert.rejects(f.repository.replace(row.rosterId, { ...row, expiresAt: 'invalid' as unknown as Date }), code('INVALID_ROSTER'));
  const hostile = Object.defineProperty({ ...row, rosterId: 'hostile' }, 'entries', { enumerable: true, get() { executed = true; return []; } });
  await assert.rejects(f.repository.insert(hostile), code('UNSUPPORTED_COLLECTION_OPERATION'));
  assert.equal(await f.repository.findById('hostile'), null);
  assert.deepEqual(await f.repository.findById(row.rosterId), row);
 });
 assert.equal(executed, false);
});

test('native queued update snapshots caller entries before waiting', async t => {
 const { open } = await fixture(t), f = await open();
 await withHomeRosterRepository(f.repository, f.plane, async () => {
  const made = await persistRoster(null, [entry()]), row = (await f.repository.findById(made.rosterId!))!;
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
  const blocker = f.provider.transaction(async () => { entered(); await hold; }); await ready;
  const update = { ...row, entries: [entry('immutable-input')], version: 'next-version' };
  const queued = f.repository.replace(row.rosterId, update, row.version);
  update.entries[0].userId = 'changed-after-admission'; release(); await blocker; assert.equal(await queued, true);
  assert.equal((await f.repository.findById(row.rosterId))!.entries[0].userId, 'immutable-input');
 });
});

test('hosted roster repository preserves Mongo operation shapes and never imports SQLite', async () => {
 const run = promisify(execFile);
 const { stdout } = await run(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', fileURLToPath(new URL('./nativeRosters.mongo.fixture.mts', import.meta.url))],
  { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), timeout: 15000, maxBuffer: 32768 });
 assert.match(stdout, /hosted-roster-contract-ok/);
});
