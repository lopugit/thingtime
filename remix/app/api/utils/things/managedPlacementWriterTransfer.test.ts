import assert from 'node:assert/strict';
import test from 'node:test';
import { moveManagedContent } from './managedPlacement';

const time = new Date('2026-09-11T12:00:00Z');
const source = () => ({ shareId: 'recording', ownerId: 'owner', thingtime: ['attachment'], updatedAt: time,
  attachmentState: 'ready', attachmentPurpose: 'recording', objectVersionId: 'immutable', acl: ['tt:user'] });
const folder = () => ({ shareId: 'folder', ownerId: 'owner', thingtime: ['folder'], updatedAt: time });
const harness = () => {
  const session = {}; const writes: any[] = [];
  const state = { source: source() as any, folder: folder() as any, sourceMatches: 1, folderMatches: 1, custom: false, commits: 0, rollbacks: 0 };
  const deps = {
    customEndpoint: () => state.custom,
    now: () => time,
    transaction: async (work: any) => { try { const result = await work(session); state.commits++; return result; }
      catch (error) { state.rollbacks++; throw error; } },
    collection: async () => ({
      findOne: async (query: any, options: any) => { assert.equal(options.session, session); assert.equal(query.ownerId, 'owner');
        return query.shareId === 'recording' ? state.source : state.folder; },
      updateOne: async (query: any, update: any, options: any) => { assert.equal(options.session, session);
        writes.push({ query, update }); return { matchedCount: query.shareId === 'recording' ? state.sourceMatches : state.folderMatches }; }
    })
  } as any;
  return { deps, state, writes };
};

test('managed writer locks destination and CAS-updates only placement in one home transaction', async () => {
  const h = harness(); const before = structuredClone(h.state.source);
  assert.deepEqual(await moveManagedContent('owner', 'recording', 'folder', time.toISOString(), h.deps), { id: 'recording', folderId: 'folder' });
  assert.equal(h.state.commits, 1); assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].query.shareId, 'folder');
  assert.deepEqual(Object.keys(h.writes[0].update.$set), ['updatedAt']);
  assert.equal(h.writes[0].update.$set.updatedAt.getTime(), time.getTime() + 1);
  assert.deepEqual(h.writes[1].query, { shareId: 'recording', ownerId: 'owner', thingtime: ['attachment'], updatedAt: time });
  assert.deepEqual(h.writes[1].update, { $set: { folderId: 'folder', updatedAt: new Date(time.getTime() + 1) } });
  assert.deepEqual(h.state.source, before);
});

test('root placement does not touch a destination and custom endpoints never enter the writer', async () => {
  const h = harness(); await moveManagedContent('owner', 'recording', null, undefined, h.deps);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].update.$set.folderId, null);
  h.state.custom = true; await assert.rejects(moveManagedContent('owner', 'recording', 'folder', undefined, h.deps), /home/);
  assert.equal(h.state.commits, 1);
});

test('missing/stale/transient sources and missing destinations fail before writes', async () => {
  for (const mutate of [(h: any) => { h.state.source = null; }, (h: any) => { h.state.folder = null; },
    (h: any) => { h.state.source.attachmentState = 'deleting'; },
    (h: any) => { h.state.source.updatedAt = new Date(time.getTime() + 1); }]) {
    const h = harness(); mutate(h);
    await assert.rejects(moveManagedContent('owner', 'recording', 'folder', time.toISOString(), h.deps));
    assert.equal(h.writes.length, 0); assert.equal(h.state.rollbacks, 1);
  }
});

test('folder or source CAS failure rejects the whole transaction, never reports a move', async () => {
  for (const field of ['folderMatches', 'sourceMatches'] as const) {
    const h = harness(); h.state[field] = 0;
    await assert.rejects(moveManagedContent('owner', 'recording', 'folder', undefined, h.deps), /changed/);
    assert.equal(h.state.commits, 0); assert.equal(h.state.rollbacks, 1);
    assert.equal(h.writes.length, field === 'folderMatches' ? 1 : 2);
  }
});

test('archive move rechecks root state in the transaction and never rewrites history rows', async () => {
  const h = harness();
  h.state.source = { shareId: 'recording', ownerId: 'owner', thingtime: ['chat-archive'], updatedAt: time,
    archiveVersion: 1, archiveRootId: 'recording', crystal: { selfParticipantId: 'self' }, acl: ['tt:user'] };
  const before = structuredClone(h.state.source);
  await moveManagedContent('owner', 'recording', 'folder', time.toISOString(), h.deps);
  assert.deepEqual(h.state.source, before);
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[1].query, { shareId: 'recording', ownerId: 'owner', thingtime: ['chat-archive'], updatedAt: time });
  assert.deepEqual(h.writes[1].update, { $set: { folderId: 'folder', updatedAt: new Date(time.getTime() + 1) } });
  h.state.source.archiveDeleting = true;
  await assert.rejects(moveManagedContent('owner', 'recording', 'folder', undefined, h.deps), /complete archive/);
  assert.equal(h.writes.length, 2);
});
