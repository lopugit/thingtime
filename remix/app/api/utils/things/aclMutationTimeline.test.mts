import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const originals = await import('../mongodb/collections');
const history = await import('../timeline/recordMutation');
const storage = await import('../storage/userStorage');
const subspaces = await import('../subspaces/gate');
const { thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION, StorageMutationError } = await import('../storage/storageCore');
let root: any, rows: any[], captures: any[], reactions: any[], writeFilters: any[], storageDeltas: number[];
let fenceFailure: Error | null = null;
const session = { inTransaction: () => true };
const setPath = (value: any, path: string, next: any) => {
  const parts = path.split('.'), last = parts.pop()!;
  let target = value;
  for (const part of parts) target = target[part] ||= {};
  target[last] = next;
};
const collection = {
  findOne: async (filter: any) => filter.shareId === root.shareId && (!filter.ownerId || filter.ownerId === root.ownerId) ? structuredClone(root) : null,
  deleteMany: async (filter: any) => { rows = rows.filter(row => !(row.targetId === filter.targetId && (filter['crystal.family'] === 'token' ? row.crystal.family === 'token' : row.crystal.family !== 'token'))); },
  insertOne: async (doc: any) => {
    if (doc.thingtime.includes('reaction')) {
      if (reactions.some(row => row.targetId === doc.targetId && row.ownerId === doc.ownerId && row.crystal.emoji === doc.crystal.emoji)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      reactions.push(structuredClone(doc));
    }
    return { insertedId: doc.shareId };
  },
  insertMany: async (values: any[]) => { rows.push(...structuredClone(values)); },
  find: (filter: any) => {
    const found = () => filter.thingtime === 'user' ? [] : filter.shareId?.$in?.includes(root.shareId) ? [structuredClone(root)] : rows.filter(row =>
      (filter.shareId?.$in ? filter.shareId.$in.includes(row.shareId) : filter.$or ? filter.$or.some((entry: any) => entry.targetId === row.targetId) : row.targetId === filter.targetId) && row.crystal.revoked !== true);
    return { project() { return this; }, async toArray() { return found(); }, async *[Symbol.asyncIterator]() { yield* found(); } };
  },
  bulkWrite: async (operations: any[]) => {
    for (const { updateOne: operation } of operations) {
      let row = rows.find(row => row.shareId === operation.filter.shareId);
      if (!row) {
        row = {};
        for (const [path, value] of Object.entries(operation.update.$setOnInsert)) setPath(row, path, structuredClone(value));
        rows.push(row);
      }
      for (const [path, value] of Object.entries(operation.update.$set)) setPath(row, path, structuredClone(value));
    }
  },
  updateOne: async (filter: any, update: any, options: any) => {
    assert.equal(options.session, session);
    writeFilters.push(structuredClone(filter));
    if (filter._id !== root._id && filter.shareId !== root.shareId) return { matchedCount: 0 };
    Object.assign(root, structuredClone(update.$set));
    return { matchedCount: 1 };
  }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  ...originals, ensureThingAclWriteFence: async () => { if (fenceFailure) throw fenceFailure; }, getThingsCollection: async () => collection, getHomeThingsCollection: async () => collection, withMongoTransaction: async (work: any) => work(session)
} });
mock.module(new URL('../timeline/recordMutation.ts', import.meta.url).href, { namedExports: {
  ...history, recordThingMutation: async (_things: any, before: any, after: any, capture: any, active: any) => {
    assert.equal(active, session);
    captures.push({ before: structuredClone(before), after: structuredClone(after), capture });
    return { event: { id: `history-${captures.length}` } };
  }
} });
mock.module(new URL('../storage/userStorage.ts', import.meta.url).href, { namedExports: { ...storage, applyUserStorageDelta: async (_owner: string, delta: number) => { storageDeltas.push(delta); } } });
mock.module(new URL('../subspaces/gate.ts', import.meta.url).href, { namedExports: { ...subspaces, assertSubspaceInteraction: async () => ({ ok: true, rootSubspaceId: null }) } });
const { addThingAclEntries, removeThingAclEntries, createThing, updateThing, readAllTokenAclEntries, withSandboxedThingMutation } = await import(new URL('./things.ts?acl-mutation-timeline', import.meta.url).href);

beforeEach(() => {
  root = { _id: 'mongo-root', shareId: 'root', ownerId: 'owner', schemaVersion: 2, thingtime: ['data'], crystal: {},
    acl: ['tt:user', 'tt:custom'], updatedAt: new Date(), createdAt: new Date() };
  rows = []; captures = []; reactions = []; writeFilters = []; storageDeltas = []; fenceFailure = null;
});

test('owner incremental ACL changes capture complete before-images in the same transaction', async () => {
  assert.equal((await addThingAclEntries({ id: 'owner' }, 'root', ['tt:user/bob'])).ok, true);
  assert.equal(captures.length, 1);
  assert.deepEqual(captures[0].before.acl, ['tt:user', 'tt:custom']);
  assert.equal(captures[0].before.aclGeneration, undefined);
  assert.equal((await removeThingAclEntries({ id: 'owner' }, 'root', ['tt:user/bob'])).ok, true);
  assert.equal(captures.length, 2);
  assert.deepEqual(captures[1].before.acl, ['tt:user', 'tt:custom', 'tt:user/bob']);
  assert.equal(root.aclEntryCount, 0);
});

test('bounded reporting control grants can explicitly suppress content Timeline snapshots', async () => {
  const result = await addThingAclEntries({ id: 'owner' }, 'root', ['tt:user/character'], { captureTimeline: false, refuseRevoked: true });
  assert.equal(result.ok, true);
  assert.equal(rows.length, 1);
  assert.equal(root.aclEntryCount, 1);
  assert.equal(captures.length, 0);
});

test('canonical owner mutation accepts more than32 token grants as a distinct private family', async () => {
  const entries = Array.from({ length: 80 }, (_, i) => `tt:token/token-${i}`);
  const result = await addThingAclEntries({ id: 'owner' }, 'root', entries, { family: 'token' });
  assert.equal(result.ok, true);
  assert.deepEqual(root.tokenAcl, []);
  assert.equal(root.tokenAclEntryCount, 80);
  assert.equal(rows.length, 80);
  assert.ok(rows.every(row => row.crystal.family === 'token'));
  assert.deepEqual(await readAllTokenAclEntries((result as any).doc, session), entries);
  assert.deepEqual(root.acl, ['tt:user', 'tt:custom']);
  assert.equal(captures.length, 0, 'private token grants never enter content snapshots');
});

test('canonical create stores seeded token grants relationally and keeps them out of snapshots', async () => {
  const entries = Array.from({ length: 40 }, (_, i) => `tt:token/token-${i}`);
  const result = await createThing('owner', { thingtime: ['data'], crystal: { value: 'fixture' }, tokenAcl: entries }, { id: 'owner' }, null,
    { transaction: { session, afterCommit: () => {} } });
  assert.equal(result.ok, true);
  const doc = (result as any).doc;
  assert.deepEqual(doc.tokenAcl, []);
  assert.equal(doc.tokenAclEntryCount, 40);
  assert.deepEqual(await readAllTokenAclEntries(doc, session), entries);
  assert.doesNotMatch(JSON.stringify(history.thingContentSnapshotValue(doc)), /tokenAcl|tt:token/);
});

test('canonical reaction creation exceeds both former user and target type caps while preserving uniqueness', async () => {
  const viewer = { id: 'owner', username: 'owner', friendIds: new Set<string>(), groupIds: new Set<string>(), subspaceRoles: new Map(), extAccountIds: new Set<string>() };
  for (let index = 0; index < 120; index++) {
    const result = await createThing('owner', { thingtime: ['reaction'], targetId: root.shareId, crystal: { emoji: '😀'.repeat(index + 1) } }, viewer, null,
      { transaction: { session, afterCommit: () => {} } });
    assert.equal(result.ok, true, `reaction ${index}: ${JSON.stringify(result)}`);
  }
  assert.equal(reactions.length, 120);
  const duplicate = await createThing('owner', { thingtime: ['reaction'], targetId: root.shareId, crystal: { emoji: '😀' } }, viewer, null,
    { transaction: { session, afterCommit: () => {} } });
  assert.equal(duplicate.ok, false);
  assert.equal((duplicate as any).status, 409);
  assert.equal(reactions.length, 120);
});

test('sandbox mutation holds the authority root in its transaction and rejects a stale grant', async () => {
  const viewer = { id: 'owner', pat: { tokenId: 'sandbox', onlyCreatedThings: true, visibility: 'all' as const } };
  root.tokenAcl = ['tt:token/sandbox'];
  const before = structuredClone(root);
  let calls = 0;
  assert.equal(await withSandboxedThingMutation(viewer, before, async active => { assert.equal(active, session); calls++; return 'written'; }), 'written');
  assert.match(root.tokenGrantFence, /^[0-9a-f-]{36}$/);
  root.tokenAcl = [];
  await assert.rejects(withSandboxedThingMutation(viewer, before, async () => { calls++; }), (error: any) => error.status === 403);
  assert.equal(calls, 1, 'a pre-revocation document cannot authorize another mutation');
});


test('canonical content edits preserve the legacy fence and generic payloads cannot forge protected baselines', async () => {
  assert.equal((await addThingAclEntries({ id: 'owner' }, 'root', ['tt:user/bob'], { captureTimeline: false })).ok, true);
  root.storageClass = 'content'; root.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION;
  root.sizeBytes = thingStorageSizeBytes({ crystal: root.crystal, extended: null, tags: [] });
  const before = structuredClone(root);
  const result = await updateThing({ id: 'owner' }, root.shareId, { crystal: { text: 'edited', aclWriteFenceAfter: 'ordinary data' }, aclBaseline: ['tt:all'], aclBaselineVersion: 999, aclWriteFenceAfter: new Date('2099-01-01') } as any);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(root.acl, before.acl);
  assert.deepEqual(root.aclBaseline, before.aclBaseline);
  assert.equal(root.aclBaselineVersion, 1);
  assert.equal(root.aclRevision, before.aclRevision);
  assert.deepEqual(root.aclWriteFenceAfter, before.aclWriteFenceAfter);
  assert.equal(root.crystal.aclWriteFenceAfter, 'ordinary data');
  assert.equal((result as any).thing.aclWriteFenceAfter, undefined);
  assert.deepEqual((result as any).thing.acl, ['tt:user', 'tt:custom', 'tt:user/bob']);
  assert.equal((result as any).thing.aclBaseline, undefined);
  assert.equal((result as any).thing.aclBaselineVersion, undefined);
});


(['audience', 'token'] as const).forEach(family => test(`ordinary edits atomically upgrade a pre-floor ${family} root without changing grants or storage`, async () => {
  const entry = family === 'audience' ? 'tt:user/legacy-member' : 'tt:token/legacy-token';
  assert.equal((await addThingAclEntries({ id: 'owner' }, 'root', [entry], { family, captureTimeline: false })).ok, true);
  // Synthetic first-release envelope; the real mixed-runtime acceptance suite
  // creates the same format through the actual predecessor API.
  delete root.aclWriteFenceAfter;
  root.updatedAt = new Date('2099-01-01T00:00:00.000Z');
  root.storageClass = 'content'; root.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION;
  root.sizeBytes = thingStorageSizeBytes({ crystal: root.crystal, extended: null, tags: [] });
  const before = structuredClone(root), beforeRows = structuredClone(rows);
  writeFilters = []; storageDeltas = [];
  const result = await updateThing({ id: 'owner' }, root.shareId, { crystal: {} }, { expectedUpdatedAt: before.updatedAt.toISOString() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(root.aclWriteFenceAfter.getTime(), before.updatedAt.getTime() + 1);
  assert.equal(root.updatedAt.getTime(), root.aclWriteFenceAfter.getTime());
  assert.equal(root.aclRevision, before.aclRevision); assert.equal(root.aclGeneration, before.aclGeneration);
  assert.equal(root.tokenAclRevision, before.tokenAclRevision); assert.equal(root.tokenAclGeneration, before.tokenAclGeneration);
  assert.deepEqual(root.acl, before.acl); assert.deepEqual(root.tokenAcl, before.tokenAcl); assert.deepEqual(rows, beforeRows);
  assert.equal(root.sizeBytes, before.sizeBytes); assert.deepEqual(storageDeltas, []);
  assert.deepEqual(writeFilters[0].aclWriteFenceAfter, { $exists: false });
  assert.deepEqual(writeFilters[0].updatedAt, before.updatedAt, 'original business timestamp CAS remains intact');
  assert.equal((result as any).thing.updatedAt, root.updatedAt.toISOString());
  assert.equal((result as any).thing.aclWriteFenceAfter, undefined);
}));


test('legacy floor upgrade refuses an unavailable storage fence before content or ledger changes', async () => {
  assert.equal((await addThingAclEntries({ id: 'owner' }, 'root', ['tt:user/member'], { captureTimeline: false })).ok, true);
  delete root.aclWriteFenceAfter;
  const before = structuredClone(root), beforeRows = structuredClone(rows);
  writeFilters = []; storageDeltas = [];
  fenceFailure = new StorageMutationError(503, 'storage_invariant', 'Storage fence is unavailable');
  const result = await updateThing({ id: 'owner' }, root.shareId, { crystal: { text: 'must not save' } });
  assert.equal(result.ok, false); assert.equal((result as any).status, 503);
  assert.deepEqual(root, before); assert.deepEqual(rows, beforeRows);
  assert.deepEqual(writeFilters, []); assert.deepEqual(storageDeltas, []);
});
