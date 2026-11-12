import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { createNativeAccountCreationRepositories } from '../documentStore/nativeAccountCreation';
import { isNativeUserStorageSession } from '../documentStore/nativeUserStorage';
import { createUserAccount } from '../auth/registerUser';
import { createNativeThingsPersistenceContext, getBoundThingsPersistence, withBoundTimelineRead } from './persistenceContext';
import { createThing, updateThing } from './things';
import { newThingMutationCapture } from '../timeline/recordMutation';
import { readTimelineEntries } from '../timeline/repository';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { applyUserStorageDelta } from '../storage/userStorage';

test('native canonical mutation hooks share content, quota and History transactions with trusted actor attribution', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-mutation-hooks-')), path = join(directory, 'home.sqlite');
 let provider = createCollectionProvider(await openSqliteDocumentStore(path));
 let auth = await createNativeAccountCreationRepositories(provider, 'home'), context = createNativeThingsPersistenceContext(provider, 'home');
 const run = <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work));
 t.after(async () => { context.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); });
 const register = (username: string) => run(async () => {
  const result = await createUserAccount({ username, password: 'Disposable isolated fixture phrase', email: `${username}@example.invalid` });
  assert.equal(result.ok, true); return result.publicUser;
 });
 const owner = await register('mutation-owner'), actor = await register('mutation-actor');
 const read = (id: string) => run(() => getBoundThingsPersistence(null)!.readExact(id));
 const state = () => run(async () => ({
  rows: await getBoundThingsPersistence(null)!.readWindow({ ownerId: owner.id, kinds: ['data', 'folder', 'timeline-event', 'timeline-head', 'timeline-branch'], limit: 128 }),
  subscription: await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', owner.id))
 }));
 const events = (head: string) => run(() => withBoundTimelineRead(owner.id, port => readTimelineEntries(port, owner.id, [head])));
 const input = (id: string) => ({ shareId: id, thingtime: ['data'], crystal: { text: id }, acl: ['tt:user'] });
 let escapedSession: unknown;
 const observed: string[] = [];
 const capture = newThingMutationCapture(actor.id);
 const created = await run(() => createThing(owner.id, input('hooked'), { id: owner.id }, null, {
  timelineCapture: capture,
  afterInsert: async (doc, session) => {
   assert.equal(isNativeUserStorageSession(session), true); escapedSession = session;
   assert.ok(doc._id); assert.equal(doc.shareId, 'hooked');
   const current = await getBoundThingsPersistence(null)!.readExact(doc.shareId);
   assert.equal(current?.crystal.text, 'hooked'); assert.equal(current?.timelineHeadId, undefined);
   await applyUserStorageDelta(owner.id, 0, session);
   await Promise.resolve(); observed.push('inserted before History');
  }
 }));
 assert.equal(created.ok, true); if (!created.ok) return;
 assert.deepEqual(observed, ['inserted before History']);
 const first = (await read('hooked'))!;
 assert.ok(first.timelineHeadId);
 const creationEvents = await events(first.timelineHeadId);
 assert.equal(creationEvents![0].event.actorId, actor.id); assert.equal(creationEvents![0].event.ownerId, owner.id);
 await assert.rejects(run(() => applyUserStorageDelta(owner.id, 0, escapedSession)), /expired|transaction|session|scope/i);

 const beforeFailedCreate = await state();
 await assert.rejects(run(() => createThing(owner.id, input('failed-insert'), { id: owner.id }, null, {
  afterInsert: async (_doc, session) => {
   assert.equal((await getBoundThingsPersistence(null)!.readExact('failed-insert'))?.crystal.text, 'failed-insert');
   await applyUserStorageDelta(owner.id, 0, session);
   await Promise.resolve(); throw Error('Controlled afterInsert failure');
  }
 })), /Controlled afterInsert failure/);
 assert.deepEqual(await state(), beforeFailedCreate); assert.equal(await read('failed-insert'), null);

 const updatedCapture = newThingMutationCapture(actor.id);
 const updated = await run(() => updateThing(owner.id, 'hooked', { crystal: { text: 'edited' } }, {
  mutation: {
   capture: updatedCapture,
   beforeWrite: async (before, session) => {
    assert.equal(isNativeUserStorageSession(session), true);
    assert.equal(before.crystal.text, 'hooked'); assert.equal((await getBoundThingsPersistence(null)!.readExact('hooked'))?.crystal.text, 'hooked');
    await applyUserStorageDelta(owner.id, 0, session); observed.push('before');
   },
   afterWrite: async session => {
    assert.equal(isNativeUserStorageSession(session), true);
    const current = await getBoundThingsPersistence(null)!.readExact('hooked');
    assert.equal(current?.crystal.text, 'edited'); assert.equal(current?.timelineHeadId, updatedCapture.id);
    await applyUserStorageDelta(owner.id, 0, session); observed.push('after History');
   }
  }
 }));
 assert.equal(updated.ok, true); assert.deepEqual(observed, ['inserted before History', 'before', 'after History']);
 const updateEvents = await events(updatedCapture.id);
 assert.equal(updateEvents![0].event.actorId, actor.id); assert.equal(updateEvents![0].event.ownerId, owner.id);

 for (const phase of ['beforeWrite', 'afterWrite'] as const) {
  const saved = await state(); let called = false;
  await assert.rejects(run(() => updateThing(owner.id, 'hooked', { crystal: { text: phase } }, {
   mutation: { [phase]: async () => {
    const current = await getBoundThingsPersistence(null)!.readExact('hooked');
    assert.equal(current?.crystal.text, phase === 'beforeWrite' ? 'edited' : phase);
    if (phase === 'afterWrite') assert.notEqual(current?.timelineHeadId, updatedCapture.id);
    called = true; await Promise.resolve(); throw Error(`Controlled ${phase} failure`);
   } }
  })), new RegExp(`Controlled ${phase} failure`));
  assert.equal(called, true); assert.deepEqual(await state(), saved);
 }

 let forbiddenHookCalls = 0;
 const forbidden = await run(() => updateThing(actor.id, 'hooked', { crystal: { text: 'foreign' } }, {
  mutation: { beforeWrite: async () => { forbiddenHookCalls++; }, afterWrite: async () => { forbiddenHookCalls++; } }
 }));
 assert.equal(forbidden.ok, false); if (!forbidden.ok) assert.equal(forbidden.status, 404);
 const stale = await run(() => updateThing(owner.id, 'hooked', { crystal: { text: 'stale' } }, {
  expectedUpdatedAt: first.updatedAt.toISOString(), mutation: { beforeWrite: async () => { forbiddenHookCalls++; } }
 }));
 assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.status, 409);
 assert.equal(forbiddenHookCalls, 0);

 const stable = await state();
 context.close(); await provider.close();
 provider = createCollectionProvider(await openSqliteDocumentStore(path));
 auth = await createNativeAccountCreationRepositories(provider, 'home'); context = createNativeThingsPersistenceContext(provider, 'home');
 assert.deepEqual(await state(), stable);
 assert.equal((await read('hooked'))?.crystal.text, 'edited'); assert.equal(await read('failed-insert'), null);
});
