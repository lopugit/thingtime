import assert from 'node:assert/strict';
import test from 'node:test';
import { removeTransferChatArchive } from './chatArchiveDeleteTransfer';

const at = new Date('2026-09-12T00:00:00.000Z');
const fixtures = () => [
  { shareId: 'archive', thingtime: ['chat-archive'], targetId: null },
  { shareId: 'person', thingtime: ['chat-archive-participant'], targetId: 'archive' },
  { shareId: 'message', thingtime: ['chat-archive-message'], targetId: 'archive' },
  { shareId: 'reaction', thingtime: ['chat-archive-reaction'], targetId: 'message' }
].map(row => ({ ...row, ownerId: 'owner', archiveRootId: 'archive', archiveVersion: 1, updatedAt: at, acl: ['tt:user'] }));

// Probe the API utility's transaction/cascade dependencies; this is not live
// Mongo/S3 acceptance and does not call a collection outside the API layer.
const harness = () => {
  const state = { rows: fixtures() as any[], prepared: [] as string[], removed: 0, transactions: 0,
    locks: 0, failPrepare: '', unexpectedChild: false, mismatchedDelete: false, lockMatches: 1 };
  let session: object;
  const scoped = (filter: any) => state.rows.filter(row => row.ownerId === filter.ownerId &&
    row.archiveRootId === filter.archiveRootId && row.archiveVersion === filter.archiveVersion);
  const collection = {
    find: (filter: any, options: any) => {
      assert.equal(options.session, session);
      assert.deepEqual(filter, { ownerId: 'owner', archiveRootId: 'archive', archiveVersion: 1 });
      return { limit: (limit: number) => { assert.equal(limit, 1001); return { toArray: async () => scoped(filter).slice(0, limit) }; } };
    },
    findOne: async (filter: any, options: any) => {
      assert.equal(options.session, session);
      if (typeof filter.shareId === 'string') return scoped(filter).find(row => row.shareId === filter.shareId && JSON.stringify(row.thingtime) === JSON.stringify(filter.thingtime)) || null;
      assert.deepEqual(new Set(filter.shareId.$nin), new Set(['archive', 'person', 'message', 'reaction']));
      assert.deepEqual(filter.$or, [{ targetId: { $in: filter.shareId.$nin } }, { parentId: { $in: filter.shareId.$nin } }]);
      return state.unexpectedChild ? { _id: 'remaining-file' } : null;
    },
    updateOne: async (filter: any, update: any, options: any) => {
      assert.equal(options.session, session); assert.equal(update.$set.archiveDeleting, true); state.locks++;
      const root = scoped(filter).find(row => row.shareId === filter.shareId);
      assert.equal(root.updatedAt.getTime(), filter.updatedAt.getTime());
      assert.ok(update.$set.updatedAt > root.updatedAt);
      if (state.lockMatches) Object.assign(root, update.$set);
      return { matchedCount: state.lockMatches };
    }
  };
  const deps: any = {
    custom: () => false, now: () => at, collection: async () => collection,
    transaction: async (work: any) => {
      const before = structuredClone(state.rows); state.transactions++; session = {};
      try { return await work(session); } catch (error) { state.rows = before; throw error; }
    },
    prepare: async ({ shareId, ownerId }: any) => {
      assert.equal(ownerId, 'owner'); state.prepared.push(shareId);
      return shareId === state.failPrepare ? { ok: false, status: 503, error: 'Object cleanup deferred' } : { ok: true };
    },
    remove: async (things: any, filter: any, options: any) => {
      assert.equal(things, collection); assert.equal(options.session, session); assert.equal(options.accountedPlane, 'home');
      assert.equal(filter.ownerId, 'owner'); assert.equal(filter.archiveRootId, 'archive'); assert.equal(filter.archiveVersion, 1);
      state.removed++; const removed = scoped(filter).filter(row => filter.shareId.$in.includes(row.shareId));
      state.rows = state.rows.filter(row => !removed.includes(row));
      return { deletedCount: state.mismatchedDelete ? removed.length - 1 : removed.length };
    }
  };
  return { state, deps };
};

test('archive deletion cleans child objects first then removes/refunds only exact owned archive rows', async () => {
  const { state, deps } = harness();
  state.rows.push({ shareId: 'live-chat', ownerId: 'owner', thingtime: ['chat'] },
    { shareId: 'original-user', ownerId: 'someone', thingtime: ['user'] },
    { shareId: 'personal-emoji', ownerId: 'owner', thingtime: ['custom-emoji'] });
  const result = await removeTransferChatArchive('owner', 'archive', deps);
  assert.deepEqual(result, { ok: true, deleted: 4 });
  assert.deepEqual(state.prepared, ['reaction', 'person', 'message', 'archive']);
  assert.deepEqual(state.rows.map(row => row.shareId), ['live-chat', 'original-user', 'personal-emoji']);
  assert.equal(state.transactions, 2); assert.equal(state.removed, 1);
});

test('deferred object cleanup retains all history and deleting root for an idempotent retry', async () => {
  const { state, deps } = harness(); state.failPrepare = 'message';
  await assert.rejects(removeTransferChatArchive('owner', 'archive', deps), error => (error as any).status === 503);
  assert.equal(state.rows.length, 4); assert.equal(state.rows[0].archiveDeleting, true); assert.equal(state.removed, 0);
  state.failPrepare = '';
  assert.deepEqual(await removeTransferChatArchive('owner', 'archive', deps), { ok: true, deleted: 4 });
  assert.deepEqual(await removeTransferChatArchive('owner', 'archive', deps), { ok: true, deleted: 0 });
  assert.equal(state.removed, 1);
});

test('ambiguous object errors and unexpected remaining children never remove the history anchor', async () => {
  for (const mode of ['throw', 'child']) {
    const { state, deps } = harness();
    if (mode === 'throw') deps.prepare = async () => { throw new Error('Object deletion response lost'); };
    else state.unexpectedChild = true;
    await assert.rejects(removeTransferChatArchive('owner', 'archive', deps), /response lost|still has children/);
    assert.equal(state.rows.length, 4); assert.equal(state.rows[0].archiveDeleting, true); assert.equal(state.removed, 0);
  }
});

test('foreign and live chat roots cannot drive an archive cascade', async () => {
  for (const mode of ['foreign', 'live', 'missing']) {
    const { state, deps } = harness();
    if (mode === 'foreign') for (const row of state.rows) row.ownerId = 'someone-else';
    if (mode === 'live') state.rows = [{ shareId: 'archive', ownerId: 'owner', thingtime: ['chat'] }];
    if (mode === 'missing') state.rows = [];
    const before = structuredClone(state.rows);
    assert.deepEqual(await removeTransferChatArchive('owner', 'archive', deps), { ok: true, deleted: 0 });
    assert.deepEqual(state.rows, before); assert.deepEqual(state.prepared, []); assert.equal(state.removed, 0);
  }
});

test('malformed archive scope and missing root retain recoverable rows without object cleanup', async () => {
  for (const mode of ['missing-root', 'live-row', 'app-row', 'oversized']) {
    const { state, deps } = harness();
    if (mode === 'missing-root') state.rows.shift();
    if (mode === 'live-row') state.rows[1].thingtime = ['user'];
    if (mode === 'app-row') state.rows[1].appId = 'app';
    if (mode === 'oversized') while (state.rows.length < 1001) state.rows.push({ ...state.rows[1], shareId: `person-${state.rows.length}` });
    const before = structuredClone(state.rows);
    await assert.rejects(removeTransferChatArchive('owner', 'archive', deps), /invariant|root is missing/);
    assert.deepEqual(state.rows, before); assert.deepEqual(state.prepared, []); assert.equal(state.removed, 0);
  }
});

test('lost root fence and incomplete accounted deletion roll back their transaction', async () => {
  for (const mode of ['fence', 'delete']) {
    const { state, deps } = harness();
    if (mode === 'fence') state.lockMatches = 0; else state.mismatchedDelete = true;
    await assert.rejects(removeTransferChatArchive('owner', 'archive', deps), /changed/);
    assert.equal(state.rows.length, 4);
    assert.equal(!!state.rows[0].archiveDeleting, mode === 'delete');
  }
});

test('new rows appearing during object cleanup fail closed instead of silently deleting extra history', async () => {
  const { state, deps } = harness(); const prepare = deps.prepare;
  deps.prepare = async (root: any) => {
    if (root.shareId === 'archive') state.rows.push({ ...state.rows[1], shareId: 'unexpected-person' });
    return prepare(root);
  };
  await assert.rejects(removeTransferChatArchive('owner', 'archive', deps), /changed during cleanup/);
  assert.equal(state.rows.length, 5); assert.equal(state.removed, 0);
});

test('invalid identity and custom endpoint requests never enter home storage', async () => {
  const { state, deps } = harness();
  await assert.rejects(removeTransferChatArchive('', 'archive', deps));
  await assert.rejects(removeTransferChatArchive('owner', 'bad id', deps));
  deps.custom = () => true;
  await assert.rejects(removeTransferChatArchive('owner', 'archive', deps), /home Thingtime library/);
  assert.equal(state.transactions, 0); assert.deepEqual(state.prepared, []);
});

test('a concurrent completed archive deletion is idempotent and never double-refunds rows', async () => {
  const { state, deps } = harness(); const prepare = deps.prepare;
  deps.prepare = async (root: any) => {
    const result = await prepare(root);
    if (root.shareId === 'archive') state.rows = []; // Other remover committed.
    return result;
  };
  assert.deepEqual(await removeTransferChatArchive('owner', 'archive', deps), { ok: true, deleted: 0 });
  assert.equal(state.removed, 0);
});
