import assert from 'node:assert/strict';
import test from 'node:test';
import { bulkThings } from './things';

const doc = { shareId: 'recording', ownerId: 'owner', thingtime: ['attachment'], updatedAt: new Date('2026-09-11T12:00:00Z'), acl: ['tt:user'] };
const collection = async () => ({ findOne: async (query: any) => {
  assert.equal(query.ownerId, 'owner'); assert.equal(query.shareId, 'recording'); return doc;
} }) as any;

for (const kind of ['theme', 'feed-algorithm']) test(`bulk ${kind} moves through the same guarded placement writer`, async () => {
  let moves = 0;
  const result = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'] }, {
    collection: async () => ({ findOne: async () => ({ ...doc, thingtime: [kind] }) }) as any,
    moveRecording: async (owner, id, folder, version) => {
      moves++; assert.deepEqual([owner, id, folder, version], ['owner', 'recording', null, doc.updatedAt.toISOString()]);
      return { id, folderId: folder };
    }
  });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(result.succeeded, 1); assert.equal(moves, 1);
});

test('bulk recording move uses the dedicated writer with the read version', async () => {
  let calls = 0;
  const result = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'], folderId: null }, {
    collection, moveRecording: async (owner, id, folder, version) => {
      calls++; assert.deepEqual([owner, id, folder, version], ['owner', 'recording', null, doc.updatedAt.toISOString()]);
      return { id, folderId: folder };
    }
  });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(calls, 1); assert.equal(result.succeeded, 1); assert.deepEqual(result.results, [{ id: 'recording', ok: true }]);
});

test('bulk recording move reports a per-item failure without leaking store errors', async () => {
  const result = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'] }, {
    collection, moveRecording: async () => { throw new Error('private storage diagnostic'); }
  });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(result.failed, 1); assert.equal(JSON.stringify(result).includes('private storage diagnostic'), false);
});

test('sandboxed token cannot route an ungranted recording to the managed writer', async () => {
  const result = await bulkThings({ id: 'owner', pat: { tokenId: 'restricted', onlyCreatedThings: true, visibility: 'all' } }, { op: 'move', ids: ['recording'] }, {
    collection, moveRecording: async () => { throw new Error('must not enter'); }
  });
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(result.failed, 1); assert.match(result.results[0].error!, /token cannot move/);
});

test('archive bulk moves require explicit first-party owner context and retain the source version', async () => {
  let moves = 0;
  const deps = { collection: async () => ({ findOne: async () => ({ ...doc, thingtime: ['chat-archive'] }) }) as any,
    moveRecording: async (owner: string, id: string, folder: string | null, version?: string) => {
      moves++; assert.deepEqual([owner, id, folder, version], ['owner', 'recording', null, doc.updatedAt.toISOString()]);
      return { id, folderId: folder };
    }
  };
  for (const [viewer, context] of [
    [{ id: 'owner' }, {}], [{ id: 'owner' }, { archiveOwnerId: 'other' }],
    [{ id: 'owner', pat: { tokenId: 'token', onlyCreatedThings: false } }, { archiveOwnerId: 'owner' }]
  ] as const) {
    const result = await bulkThings(viewer, { op: 'move', ids: ['recording'] }, deps, context);
    assert.ok(result.ok); if (result.ok) assert.equal(result.failed, 1);
  }
  assert.equal(moves, 0);
  const moved = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'] }, deps, { archiveOwnerId: 'owner' });
  assert.ok(moved.ok); if (moved.ok) assert.deepEqual(moved.results, [{ id: 'recording', ok: true }]);
  assert.equal(moves, 1);
  const failed = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'] }, {
    ...deps, moveRecording: async () => { throw new Error('private database details'); }
  }, { archiveOwnerId: 'owner' });
  assert.ok(failed.ok); if (failed.ok) assert.equal(failed.failed, 1);
  assert.doesNotMatch(JSON.stringify(failed), /private database details/);
});

test('conditional managed move preserves the caller version and refuses stale snapshots before mutation', async () => {
  let calls = 0;
  const deps = { collection, moveRecording: async (_owner: string, id: string, folderId: string | null, expected?: string) => {
    calls++; assert.equal(expected, doc.updatedAt.toISOString()); return { id, folderId };
  } };
  const fresh = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'], expectedUpdatedAt: doc.updatedAt.toISOString() }, deps);
  assert.ok(fresh.ok); if (fresh.ok) assert.equal(fresh.succeeded, 1);
  const stale = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'], expectedUpdatedAt: new Date(doc.updatedAt.getTime() - 1).toISOString() }, deps);
  assert.ok(stale.ok); if (stale.ok) { assert.equal(stale.failed, 1); assert.equal(stale.results[0].status, 409); }
  assert.equal(calls, 1);
});

test('conditional bulk move rejects ambiguous batches and malformed versions before any storage access', async () => {
  const deps = { collection: async () => { throw Error('Must not reach storage'); } };
  for (const body of [
    { op: 'move', ids: ['a','b'], expectedUpdatedAt: doc.updatedAt.toISOString() },
    ...['copy','delete','share'].map(op => ({ op, ids: ['a'], expectedUpdatedAt: doc.updatedAt.toISOString() })),
    ...[null, '', 123, {}, 'not-a-date'].map(expectedUpdatedAt => ({ op: 'move', ids: ['a'], expectedUpdatedAt }))
  ]) {
    const result = await bulkThings({ id: 'owner' }, body, deps);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 400);
  }
});

test('a managed move race returns a conflict without exposing storage details', async () => {
  const result = await bulkThings({ id: 'owner' }, { op: 'move', ids: ['recording'], expectedUpdatedAt: doc.updatedAt.toISOString() }, {
    collection, moveRecording: async () => { throw Object.assign(Error('private database detail'), { status: 409 }); }
  });
  assert.ok(result.ok); if (result.ok) assert.equal(result.results[0].status, 409);
  assert.doesNotMatch(JSON.stringify(result), /private database detail/);
});
