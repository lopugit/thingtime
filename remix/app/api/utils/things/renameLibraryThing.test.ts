import assert from 'node:assert/strict';
import test from 'node:test';
import { renameLibraryThing } from './renameLibraryThing';
import { thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
const now = new Date('2026-09-21T12:00:00Z');
const input = { actorKind: 'user', accountKind: 'user', ownerId: 'owner', sameOrigin: true, id: 'library-thing', title: 'New display title', expectedUpdatedAt: now.toISOString() };
function harness(kind = 'theme') {
  const row: any = { _id: 'db-id', shareId: input.id, ownerId: input.ownerId, thingtime: [kind], updatedAt: now,
    crystal: { name: 'Original source name', payload: { preserved: true } }, acl: ['tt:user'], tags: [], extended: null,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
    ...(kind === 'chat-archive' ? { archiveRootId: input.id, archiveVersion: 1 } : {}) };
  row.sizeBytes = thingStorageSizeBytes(row);
  const writes: any[] = [], deltas: number[] = [];
  const state = { row, matches: 1, commits: 0, rollbacks: 0, custom: false };
  const session = {};
  const deps: any = { custom: () => state.custom, now: () => now,
    transaction: async (work: any) => { try { const result = await work(session); state.commits++; return result; } catch (error) { state.rollbacks++; throw error; } },
    storageDelta: async (owner: string, delta: number, tx: any) => { assert.equal(owner, input.ownerId); assert.equal(tx, session); deltas.push(delta); },
    collection: async () => ({ findOne: async (query: any, options: any) => { assert.equal(query.ownerId, input.ownerId); assert.equal(options.session, session); return state.row; },
      updateOne: async (query: any, update: any, options: any) => { assert.equal(options.session, session); writes.push({ query, update }); return { matchedCount: state.matches }; } }) };
  return { deps, state, writes, deltas };
}
test('managed library renames change display metadata with quota and version fences, preserving payload/history', async () => {
  for (const kind of ['theme', 'feed-algorithm', 'custom-emoji', 'chat-archive']) {
    const h = harness(kind), before = structuredClone(h.state.row);
    const result = await renameLibraryThing(input, h.deps);
    assert.equal(result.ok, true);
    assert.deepEqual(h.state.row, before);
    assert.deepEqual(Object.keys(h.writes[0].update.$set), ['crystal.title', 'sizeBytes', 'updatedAt']);
    assert.equal(h.writes[0].query.ownerId, input.ownerId); assert.equal(h.writes[0].query.updatedAt, now);
    assert.equal(h.writes[0].query.sizeBytes, before.sizeBytes);
    assert.equal(h.writes[0].update.$set['crystal.title'], input.title);
    assert.equal(h.deltas[0], h.writes[0].update.$set.sizeBytes - before.sizeBytes);
    assert.equal(h.state.commits, 1);
  }
});
test('PAT/app/service/cross-origin/custom-plane or invalid-name renames never touch storage', async () => {
  for (const patch of [{ actorKind: 'pat' }, { actorKind: 'app' }, { accountKind: 'service' }, { sameOrigin: false }, { title: '' }, { title: 'x'.repeat(121) }, { expectedUpdatedAt: 'invalid' }]) {
    const h = harness(); assert.equal((await renameLibraryThing({ ...input, ...patch }, h.deps)).ok, false); assert.equal(h.state.commits, 0); assert.deepEqual(h.writes, []);
  }
  const h = harness(); h.state.custom = true; assert.equal((await renameLibraryThing(input, h.deps)).ok, false); assert.equal(h.state.commits, 0);
});
test('foreign/namespace/transient/history rows and stale versions remain unmodified', async () => {
  for (const patch of [{ ownerId: 'other' }, { thingtime: ['user'] }, { thingtime: ['theme', 'data'] }, { appId: 'app' }, { sandbox: true }, { targetId: 'parent' }, { sizeBytes: 0 }, { updatedAt: new Date(0) }]) {
    const h = harness(); Object.assign(h.state.row, patch); assert.equal((await renameLibraryThing(input, h.deps)).ok, false); assert.deepEqual(h.writes, []); assert.deepEqual(h.deltas, []);
  }
  for (const patch of [{ archiveVersion: 2 }, { archiveRootId: 'other' }, { archiveDeleting: true }]) {
    const h = harness('chat-archive'); Object.assign(h.state.row, patch); assert.equal((await renameLibraryThing(input, h.deps)).ok, false); assert.deepEqual(h.writes, []);
  }
});
test('a concurrent managed rename rolls back its quota delta and returns conflict', async () => {
  const h = harness(); h.state.matches = 0;
  assert.deepEqual(await renameLibraryThing(input, h.deps), { ok: false, status: 409, error: 'Thing changed; refresh before renaming' });
  assert.equal(h.state.commits, 0); assert.equal(h.state.rollbacks, 1);
});
