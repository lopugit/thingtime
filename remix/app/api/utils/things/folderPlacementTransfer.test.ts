import assert from 'node:assert/strict';
import test from 'node:test';
import { lockFolderDestination, MAX_FOLDER_DEPTH } from './folderPlacement';

const now = new Date('2026-09-27T12:00:00Z');
const folder = (shareId: string, folderId: string | null = null) => ({ _id: shareId, shareId, ownerId: 'owner', thingtime: ['folder'], folderId, updatedAt: now });
function harness(rows: any[]) {
  const session = {}; const writes: any[] = [];
  const things = {
    findOne: async (query: any, options: any) => {
      assert.equal(options.session, session);
      return rows.find(row => row.shareId === query.shareId && row.ownerId === query.ownerId) ?? null;
    },
    updateOne: async (query: any, change: any, options: any) => {
      assert.equal(options.session, session); writes.push({ query, change }); return { matchedCount: 1 };
    }
  };
  return { things, session, writes };
}

test('placement writes every ancestor without changing user content or its updatedAt', async () => {
  const h = harness([folder('child', 'parent'), folder('parent')]);
  await lockFolderDestination(h.things, 'owner', 'child', h.session, 'moving');
  assert.deepEqual(h.writes.map(write => write.query._id), ['child', 'parent']);
  assert.deepEqual(h.writes.map(write => Object.keys(write.change.$set)), [['folderMutationToken'], ['folderMutationToken']]);
  const first = h.writes[0].change.$set.folderMutationToken;
  await lockFolderDestination(h.things, 'owner', 'child', h.session, 'moving');
  assert.notEqual(h.writes[2].change.$set.folderMutationToken, first, 'Repeated placements still perform an actual fence write');
  assert.equal(await lockFolderDestination(h.things, 'owner', null, h.session), null);
});

test('a retry re-reads changed ancestry and refuses a new cycle', async () => {
  const rows = [folder('destination', 'ancestor'), folder('ancestor')];
  const h = harness(rows);
  await lockFolderDestination(h.things, 'owner', 'destination', h.session, 'moving');
  rows[1].folderId = 'moving';
  await assert.rejects(lockFolderDestination(h.things, 'owner', 'destination', h.session, 'moving'), /subfolders/);
});

test('missing, foreign, reserved, cyclic and overlong folder chains fail closed', async () => {
  const cases = [[], [{ ...folder('destination'), ownerId: 'other' }], [folder('destination', 'missing')],
    [folder('destination', 'destination')], Array.from({ length: MAX_FOLDER_DEPTH + 1 }, (_, index) => folder(index ? `f${index}` : 'destination', index < MAX_FOLDER_DEPTH ? `f${index + 1}` : null))];
  for (const rows of cases) {
    const h = harness(rows);
    await assert.rejects(lockFolderDestination(h.things, 'owner', 'destination', h.session));
  }
  const h = harness([]);
  await assert.rejects(lockFolderDestination(h.things, 'owner', 'timeline-private', h.session), /Timeline/);
  await assert.rejects(lockFolderDestination(h.things, 'owner', null, null), /transaction/);
});
