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
