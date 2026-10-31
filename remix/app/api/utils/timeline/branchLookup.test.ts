import assert from 'node:assert/strict';
import test from 'node:test';
import { toBin } from '../auth/binary.ts';
import { readTimelineBranchEntry, timelineBranchThingId, timelineBranchHeadThingId } from './branches.ts';
import { TIMELINE_BRANCH_KIND, TIMELINE_BRANCH_HEAD_KIND, timelineBranchHeadId } from '../../../timeline/branches.ts';

const ownerId = 'owner'; const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const time = '2026-09-28T00:00:00.000Z';
const branch = { formatVersion: 1, id: branchId, ownerId, name: 'Experiment', createdAt: time };
const head = (thingId: string) => ({ formatVersion: 1, id: timelineBranchHeadId(branchId, thingId), ownerId, branchId, thingId, eventId: `event-${thingId}`, revision: 3, createdAt: time, updatedAt: time });
const branchDoc = () => ({ shareId: timelineBranchThingId(ownerId, branchId), ownerId, thingtime: [TIMELINE_BRANCH_KIND], crystal: { name: branch.name }, timelineBranchVersion: 1, secure: toBin(JSON.stringify(branch)) });
const headDoc = (thingId: string) => ({ shareId: timelineBranchHeadThingId(ownerId, branchId, thingId), ownerId, thingtime: [TIMELINE_BRANCH_HEAD_KIND], parentId: timelineBranchThingId(ownerId, branchId), targetId: thingId, branchRevision: 3, timelineBranchVersion: 1, secure: toBin(JSON.stringify(head(thingId))) });
function collection(docs: any[]) {
 const reads: any[] = [];
 return { reads, findOne: async (query: any) => { reads.push(query); return docs.find(doc => doc.ownerId === query.ownerId && doc.shareId === query.shareId && doc.thingtime.includes(query.thingtime)) ?? null; } };
}
test('exact branch membership uses two owner-scoped identity reads, with one separate head per Thing', async () => {
 const things = collection([branchDoc(), headDoc('page'), headDoc('component')]);
 for (const thingId of ['page', 'component']) {
  assert.deepEqual(await readTimelineBranchEntry(things, ownerId, branchId, thingId), { branch, head: head(thingId) });
 }
 assert.equal(things.reads.length, 4);
 assert.deepEqual(things.reads[0], { ownerId, thingtime: TIMELINE_BRANCH_KIND, shareId: timelineBranchThingId(ownerId, branchId) });
 assert.deepEqual(things.reads[1], { ownerId, thingtime: TIMELINE_BRANCH_HEAD_KIND, shareId: timelineBranchHeadThingId(ownerId, branchId, 'page') });
 assert.equal(await readTimelineBranchEntry(things, 'another-owner', branchId, 'page'), null);
 assert.equal(await readTimelineBranchEntry(things, ownerId, branchId, 'absent'), null);
 assert.equal(await readTimelineBranchEntry(collection([headDoc('page')]), ownerId, branchId, 'page'), null);
});
test('a malformed persisted branch envelope cannot impersonate another Thing or return private root fields', async () => {
 const document = { ...headDoc('page'), rootSecret: 'must-not-project' };
 const result = await readTimelineBranchEntry(collection([{ ...branchDoc(), rootSecret: 'must-not-project' }, document]), ownerId, branchId, 'page');
 assert.deepEqual(result, { branch, head: head('page') });
 document.secure = toBin(JSON.stringify(head('component')));
 await assert.rejects(readTimelineBranchEntry(collection([branchDoc(), document]), ownerId, branchId, 'page'), /envelope/);
});
