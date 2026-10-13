import assert from 'node:assert/strict';
import test from 'node:test';
import { createBranchCheckoutService } from './branchCheckout.ts';
import { branchCheckoutRequest, parseBranchCheckoutRequest, parseBranchCheckout, branchCrystalSnapshot, branchEditableSnapshot, branchEditCommand } from '../../../timeline/branchCheckout.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import { timelineBranchHeadId } from '../../../timeline/branches.ts';
import type { TimelineSnapshot } from '../../../timeline/contract.ts';
const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const date = '2026-09-27T05:00:00.000Z';
const content = (crystal: any, folderId: string | null = null): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value: { crystal, extended: {}, tags: [], geo: null, acl: null, folderId } });
function setup() {
 const entry = entryFixture(eventFixture('base', { thingId: 'page', after: content({ title: 'Original', flag: false, amount: 0 }) }));
 const entries = [entry];
 const target = { branch: { formatVersion: 1 as const, id: branchId, ownerId: 'user-1', name: 'Experiment', createdAt: date }, head: { formatVersion: 1 as const, id: timelineBranchHeadId(branchId, 'page'), branchId, ownerId: 'user-1', thingId: 'page', eventId: 'base', revision: 1, createdAt: date, updatedAt: date } };
 const calls: string[] = [];
 const service = createBranchCheckoutService({ collection: async () => ({}) as any, branch: async () => target,
  entries: async (_things, owner, ids) => { assert.equal(owner, 'user-1'); calls.push(...ids); return entries.filter(item => ids.includes(item.event.id)); },
  nodes: async (_things, owner, ids) => { assert.equal(owner, 'user-1'); return entries.filter(item => ids.includes(item.event.id)).map(item => ({ id: item.event.id, thingId: item.event.thingId, parentIds: item.event.parentIds, afterAdapter: item.event.after?.adapter ?? null })); },
  snapshot: async (_things, owner, id) => { assert.equal(owner, 'user-1'); return entries.find(item => item.event.id === id)!.event.after; }
 });
 return { service, entries, target, calls };
}
test('checkout materializes the exact branch without borrowing published content or changing canonical entries', async () => {
 const h = setup(), request = branchCheckoutRequest(h.target);
 const checked = parseBranchCheckout((await h.service('user-1', request)).checkout, 'user-1', request);
 assert.deepEqual(checked.entry, h.entries[0]); assert.deepEqual(JSON.parse(JSON.stringify(checked.snapshot)), h.entries[0].event.after);
 const edited = branchCrystalSnapshot(checked.snapshot, { title: 'Draft', flag: false, amount: 0, empty: '', nil: null });
 assert.deepEqual((edited.value as any).crystal, { amount: 0, empty: '', flag: false, nil: null, title: 'Draft' });
 assert.equal((checked.snapshot.value as any).crystal.title, 'Original');
 assert.equal(branchEditCommand(h.target, 'new-draft').expectedRevision, 1);
 assert.deepEqual(h.calls, ['base']); assert.equal(h.target.head.eventId, 'base');
});
test('checkout reconstructs a definition after a folder move from historical ancestors', async () => {
 const h = setup();
 h.entries.push(entryFixture(eventFixture('move', { thingId: 'page', parentIds: ['base'], after: { adapter: 'folder-placement', version: 1, value: { folderId: 'moved-folder' } } })));
 h.entries.push(entryFixture(eventFixture('draft', { thingId: 'page', parentIds: ['move'], after: { adapter: 'definition-source', version: 1, value: { source: '{"title":"Recovered"}' } } })));
 h.target.head.eventId = 'draft';
 const checked = parseBranchCheckout((await h.service('user-1', branchCheckoutRequest(h.target))).checkout, 'user-1', branchCheckoutRequest(h.target));
 assert.equal((checked.snapshot.value as any).folderId, 'moved-folder'); assert.equal((checked.snapshot.value as any).crystal.title, 'Recovered');
 assert.deepEqual(checked.entry, h.entries[2]);
});
test('checkout refuses stale heads, other owners, missing versions and foreign Thing ancestry', async () => {
 const h = setup(), request = branchCheckoutRequest(h.target);
 await assert.rejects(h.service('user-1', { ...request, expectedRevision: 2 }), /changed/);
 await assert.rejects(h.service('user-1', { ...request, expectedHeadId: 'old' }), /changed/);
 h.target.branch.ownerId = 'other'; await assert.rejects(h.service('user-1', request), /not found/); h.target.branch.ownerId = 'user-1';
 h.entries[0].event.thingId = 'other'; await assert.rejects(h.service('user-1', request), /unavailable/);
 h.entries.length = 0; await assert.rejects(h.service('user-1', request), /unavailable/);
});
test('checkout transport validates exact source identity, complete content, bounds and command fields', async () => {
 const h = setup(), request = branchCheckoutRequest(h.target), result = (await h.service('user-1', request)).checkout;
 for (const patch of [{ extra: true }, { expectedRevision: 0 }, { branchId: 'main' }, { thingId: '' }]) assert.throws(() => parseBranchCheckoutRequest({ ...request, ...patch }));
 assert.throws(() => parseBranchCheckout(result, 'other', request));
 assert.throws(() => parseBranchCheckout({ ...result, head: { ...result.head, revision: 2 } }, 'user-1', request));
 assert.throws(() => parseBranchCheckout({ ...result, snapshot: { ...result.snapshot, value: { crystal: {} } } }, 'user-1', request));
 assert.throws(() => branchCrystalSnapshot(result.snapshot, { huge: 'x'.repeat(4 * 1024 * 1024) }));
});


test('cached canonical revisions retain their envelope while editing projects only supported fields', () => {
 const original = { ...content({ count: 0 }), value: { ...(content({ count: 0 }).value as any), thingtime: ['data'], targetId: null } };
 const projected = branchEditableSnapshot(original);
 assert.deepEqual(Object.keys(projected.value as object).sort(), ['acl', 'crystal', 'extended', 'folderId', 'geo', 'tags']);
 assert.deepEqual((original.value as any).thingtime, ['data']);
 assert.equal((projected.value as any).crystal.count, 0);
});
