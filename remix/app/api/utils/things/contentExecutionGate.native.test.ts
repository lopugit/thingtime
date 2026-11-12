import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { createNativeAccountHttpHome } from '../documentStore/nativeAccountHttpHome';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
import { action as register } from '../../../routes/api/v1/auth/register/_register';
import { createThing } from './things';
import { getBoundThingsPersistence } from './persistenceContext';
import { getThingsTransactionBinding, type ThingsTransaction } from './persistence';
import { createNativeTimelinePersistence } from '../documentStore/nativeTimelinePersistence';
import { appendTimelineEvent } from '../timeline/repository';
import { eventFixture } from '../../../timeline/testFixtures';
import { resolveWebpage } from '../webpages/webpages';
import { getSubscription } from '../subscriptions/subscriptions';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { attachContentExecutionHold, contentExecutionHeld, CREATION_COMPLETION_ADAPTER, type ContentExecutionHold } from './contentExecutionGate';

test('registered SQLite account creates and attaches real protected holds with immutable receipt completion and atomic refusal', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-content-hold-')), path = join(directory, 'home.sqlite');
 const vault = randomBytes(32), outbox = randomBytes(32), origin = 'http://127.0.0.1:18637';
 const env = { NODE_ENV: 'development', APP_URL: origin, JWT_SECRET: randomBytes(32).toString('base64url'), THINGTIME_USER_VAULT_KEY: vault.toString('base64url'), THINGTIME_ADMIN_VAULT_KEY: '', JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '', MONGODB_URI: 'mongodb://127.0.0.1:1/forbidden-content-hold', EMAIL_PROVIDER: 'console' };
 const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])), previousHost = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 Object.assign(process.env, env); Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 let provider = createCollectionProvider(await openSqliteDocumentStore(path));
 let home = await createNativeAccountHttpHome({ provider, homePlaneId: 'home', keyId: 'fixture', vaultKey: vault, outboxKey: outbox });
 t.after(async () => {
  home.close(); await provider.close(); vault.fill(0); outbox.fill(0); await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  if (previousHost) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, previousHost); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
 });
 const registered = await home.run(() => register({ request: new Request(origin + '/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username: 'content-hold-fixture', email: 'content-hold@example.invalid', password: 'Disposable synthetic credential only' }) }) }));
 assert.equal(registered.status, 200); const ownerId = (await registered.json()).user.id;
 const hold: ContentExecutionHold = { version: 1, operationId: 'operation', completionEventId: 'completion', rootId: 'page', binding: 'a'.repeat(64) };
 const create = (id: string, trusted?: ContentExecutionHold, extra = {}) => home.run(() => createThing(ownerId, { shareId: id, thingtime: ['webpage'], crystal: { name: id, blocks: [] }, acl: ['tt:user'], ...extra }, { id: ownerId }, null, trusted ? { executionHold: trusted } : {}));
 const transact = <T>(work: (tx: ThingsTransaction, port: ReturnType<typeof createNativeTimelinePersistence>, session: unknown) => Promise<T>) => home.run(() => getBoundThingsPersistence(ownerId)!.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, ownerId); assert.equal(binding.kind, 'native'); if (binding.kind !== 'native') throw Error('Expected native binding');
  return work(tx, createNativeTimelinePersistence(binding.collections, { ownerId, session: binding.session }), binding.session);
 }));
 const read = (id: string) => home.run(() => getBoundThingsPersistence(null)!.readExact(id));
 const completion = (current: ContentExecutionHold, overrides: Record<string, unknown> = {}) => eventFixture(current.completionEventId, {
  ownerId, actorId: ownerId, source: 'api', clientId: null, operationId: current.operationId, thingId: current.rootId, branchId: 'main', mode: 'effect', operation: 'effect', before: null,
  after: { adapter: CREATION_COMPLETION_ADAPTER, version: 1, value: { binding: current.binding, count: 1 } }, ...overrides
 });
 const state = () => home.run(async () => ({ rows: await getBoundThingsPersistence(null)!.readWindow({ ownerId, limit: 128 }), subscription: await getSubscription('user', ownerId) }));
 const untrusted = await create('untrusted', undefined, { executionHold: hold }); assert.equal(untrusted.ok, true); assert.equal((await read('untrusted'))?.executionHold, undefined);
 assert.equal((await create('page', hold)).ok, true);
 assert.equal(await home.run(async () => contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact('page'))!)), true);
 const resolved = await home.run(() => resolveWebpage({ id: ownerId }, { id: 'page' })); assert.equal(resolved.ok, true); if (resolved.ok) assert.equal(resolved.page?.executionHeld, true);
 await transact(async (_tx, port, session) => { await appendTimelineEvent(port, completion(hold), session); });
 assert.equal(await home.run(async () => contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact('page'))!)), false);
 const completedBefore = (await read('page'))!;
 const nextHold = { ...hold, operationId: hold.operationId.slice(0, -1) + 'B', completionEventId: hold.completionEventId.slice(0, -1) + 'B' };
 await transact(async (tx, port, session) => { await attachContentExecutionHold(port, completedBefore, nextHold, session, tx); });
 const pendingBefore = await state();
 await assert.rejects(transact(async (tx, port, session) => { await attachContentExecutionHold(port, completedBefore, { ...nextHold, operationId: hold.operationId.slice(0, -1) + 'C' }, session, tx); }), /Content changed/);
 assert.deepEqual(await state(), pendingBefore);
 await transact(async (_tx, port, session) => { await appendTimelineEvent(port, completion(nextHold), session); });
 assert.equal((await create('attached')).ok, true); const before = (await read('attached'))!;
 const attached = { ...hold, rootId: 'attached', operationId: 'attach-operation', completionEventId: 'attach-completion' };
 await transact(async (tx, port, session) => { await attachContentExecutionHold(port, before, attached, session, tx); });
 assert.equal((await read('attached'))?.updatedAt.getTime(), before.updatedAt.getTime());
 const saved = await state();
 await assert.rejects(transact(async (tx, port, session) => { await attachContentExecutionHold(port, (await tx.readExact('attached'))!, { ...attached, operationId: 'replacement' }, session, tx); }), /Another creation/);
 assert.deepEqual(await state(), saved);
 await assert.rejects(transact(async (tx, port, session) => { await attachContentExecutionHold(port, { ...before, sizeBytes: before.sizeBytes + 1 }, attached, session, tx); }), /accounted|changed/);
 assert.deepEqual(await state(), saved);
 await assert.rejects(transact(async (tx, port, session) => { await attachContentExecutionHold(port, (await tx.readExact('attached'))!, attached, {}, tx); }), /exact native/);
 await assert.rejects(transact(async (_tx, port, session) => { await attachContentExecutionHold(port, before, attached, session); }), /native content transaction/);
 await assert.rejects(transact(async (tx, port, session) => { await attachContentExecutionHold(port, (await tx.readExact('attached'))!, { ...attached, binding: 'invalid' }, session, tx); }), /Invalid content/);
 assert.deepEqual(await state(), saved);
 await transact(async (_tx, port, session) => { await appendTimelineEvent(port, completion(attached, { after: { adapter: CREATION_COMPLETION_ADAPTER, version: 1, value: { binding: 'b'.repeat(64), count: 1 } } }), session); });
 assert.equal(await home.run(async () => contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact('attached'))!)), true);
 const stable = await state();
 await assert.rejects(transact(async (_tx, port, session) => { await appendTimelineEvent(port, completion(attached), session); }), /identity was reused/);
 assert.deepEqual(await state(), stable);
 assert.equal((await create('rollback-attach')).ok, true);
 const rollbackBefore = await state(), rollbackRow = (await read('rollback-attach'))!;
 await assert.rejects(transact(async (tx, port, session) => {
  await attachContentExecutionHold(port, rollbackRow, { ...hold, rootId: 'rollback-attach', completionEventId: 'rollback-completion' }, session, tx);
  throw Error('Controlled failure after hold CAS');
 }), /Controlled failure/);
 assert.deepEqual(await state(), rollbackBefore);
 for (const failure of ['failed-result', 'wrong-actor']) {
  const pending = { ...hold, rootId: failure, completionEventId: `completion-${failure}`, operationId: `operation-${failure}` };
  assert.equal((await create(failure, pending)).ok, true);
  await transact(async (_tx, port, session) => { await appendTimelineEvent(port, completion(pending, failure === 'wrong-actor' ? { actorId: 'foreign' } :
   { after: { adapter: CREATION_COMPLETION_ADAPTER, version: 1, value: { binding: pending.binding, count: 0 } } }), session); });
  assert.equal(await home.run(async () => contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact(failure))!)), true);
 }
 const quotaHold = { ...hold, rootId: 'budget-page', completionEventId: 'quota-completion', operationId: 'quota-operation' };
 const quotaPage = await create('budget-page', quotaHold);
 assert.equal(quotaPage.ok, true, 'Canonical held page must be created before quota injection');
 // Explicit synthetic quota fault injection only. Account/content/receipt
 // creation above uses canonical services; this is not an HTTP setup claim.
 const ledgerId = subscriptionShareId('user', ownerId), ledger = (await read(ledgerId))!;
 const injectQuota = (value: unknown) => provider.transaction(collections => {
  collections.collection(physicalCollectionName('things')).updateOne({ op: 'eq', path: ['shareId'], value: ledgerId }, [{ op: 'set', path: ['crystal', 'tierQuotas', 'userStorageBytes'], value }]);
 });
 await injectQuota(ledger.crystal.storageUsedBytes);
 const atQuota = await state();
 await assert.rejects(transact(async (_tx, port, session) => { await appendTimelineEvent(port, completion(quotaHold), session); }));
 assert.deepEqual(await state(), atQuota);
 assert.equal((await create('budget-refused', { ...hold, rootId: 'budget-refused' })).ok, false);
 assert.deepEqual(await state(), atQuota);
 assert.equal(await home.run(async () => contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact('budget-page'))!)), true);
 await injectQuota(ledger.crystal.tierQuotas.userStorageBytes);
 home.close(); await provider.close(); provider = createCollectionProvider(await openSqliteDocumentStore(path));
 home = await createNativeAccountHttpHome({ provider, homePlaneId: 'home', keyId: 'fixture', vaultKey: vault, outboxKey: outbox });
 await home.run(async () => {
  assert.equal(await contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact('page'))!), false);
  assert.equal(await contentExecutionHeld((await getBoundThingsPersistence(null)!.readExact('attached'))!), true);
 });
});
