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
