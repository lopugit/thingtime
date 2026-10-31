import assert from 'node:assert/strict';
import test from 'node:test';
import { captureComponentBindings } from '../../../timeline/componentBindings.ts';
import { mergeComponentVersions } from '../../../timeline/componentMerge.ts';
import { timelineEventThingId } from './repository.ts';
import { createBranchMergeService } from './branchMerge.ts';
import { createVersionContentReader, loadVersionGraph } from './versions.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import { timelineBranchHeadId } from '../../../timeline/branches.ts';
import { parseBranchMergePreview, parseBranchMergeRequest, createBranchMergeProposal } from '../../../timeline/branchMerge.ts';
import { splitTimelineEvent, joinTimelineEvent } from '../../../timeline/records.ts';
import type { TimelineSnapshot, TimelineEntry } from '../../../timeline/contract.ts';

const branchId = 'branch-177abf25-b322-4ac0-9707-a59c36e7bcd5';
const date = '2026-09-27T05:00:00.000Z';
const snapshot = (crystal: any, folderId: string | null = null): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value: { crystal, extended: {}, acl: null, geo: null, tags: [], folderId } });
const entry = (id: string, parentIds: string[], after: TimelineSnapshot) => entryFixture(eventFixture(id, { thingId: 'page', parentIds, after }));
const request = parseBranchMergeRequest({ command: 'preview-branch-merge', branchId, thingId: 'page', eventId: 'incoming', expectedHeadId: 'current', expectedRevision: 2, choices: {} });
function setup(current = { left: 1, right: 0 }, incoming = { left: 0, right: 2 }) {
 const entries = [entry('base', [], snapshot({ left: 0, right: 0 })), entry('current', ['base'], snapshot(current)), entry('incoming', ['base'], snapshot(incoming))];
 const target = { branch: { formatVersion: 1 as const, id: branchId, ownerId: 'user-1', name: 'Experiment', createdAt: date }, head: { formatVersion: 1 as const, id: timelineBranchHeadId(branchId, 'page'), branchId, ownerId: 'user-1', thingId: 'page', eventId: 'current', revision: 2, createdAt: date, updatedAt: date } };
 const reads: string[][] = [];
 const service = createBranchMergeService({ collection: async () => ({ find: (query: any) => ({ toArray: async () => entries.filter(item => query.shareId.$in.includes(timelineEventThingId('user-1', item.event.id))).map(item => ({ timelineEntryBytes: new TextEncoder().encode(JSON.stringify(item)).byteLength })) }) }) as any, branch: async () => target,
  entries: async (_things, owner, ids) => { assert.equal(owner, 'user-1'); reads.push(ids); return entries.filter(item => ids.includes(item.event.id)); },
  nodes: async (_things, owner, ids) => { assert.equal(owner, 'user-1'); return entries.filter(item => ids.includes(item.event.id)).map(item => ({ id: item.event.id, thingId: item.event.thingId, parentIds: item.event.parentIds, afterAdapter: item.event.after?.adapter ?? null })); },
  snapshot: async (_things, owner, eventId) => { assert.equal(owner, 'user-1'); return entries.find(item => item.event.id === eventId)!.event.after; }
 });
 return { service, entries, target, reads };
}

test('branch preview merges independent changes against its exact head without reading or updating the published Thing', async () => {
 const h = setup(); const result = await h.service('user-1', request);
 const preview = parseBranchMergePreview(result.preview, 'user-1', request);
 assert.deepEqual((preview.result.value as any).crystal, { left: 1, right: 2 }); assert.deepEqual(preview.conflicts, []);
 assert.equal(preview.baseEventId, 'base'); assert.equal(h.target.head.eventId, 'current');
 const proposal = createBranchMergeProposal(preview, 'browser-1');
 assert.deepEqual(proposal.event.parentIds, ['current', 'incoming']); assert.equal(proposal.event.branchId, branchId);
 assert.equal(proposal.event.source, 'client'); assert.equal(proposal.event.mode, 'draft'); assert.equal(proposal.event.operation, 'merge');
 assert.equal(proposal.command.eventId, proposal.event.id); assert.equal(proposal.command.expectedRevision, 2);
 const normalized = splitTimelineEvent(proposal.event);
 assert.deepEqual(joinTimelineEvent(normalized.event, normalized.links), proposal.event);
 assert.ok(!('parentIds' in normalized.event), 'Durable records must not embed parent lists');
});

test('overlaps require explicit review and stale or foreign branch comparisons refuse', async () => {
 const h = setup({ left: 1, right: 0 }, { left: 2, right: 0 });
 const first = (await h.service('user-1', request)).preview;
 assert.deepEqual(first.conflicts.map(item => item.path), [['crystal', 'left']]);
 assert.throws(() => createBranchMergeProposal(first, 'browser'), /resolve/);
 const resolved = await h.service('user-1', { ...request, choices: { '["crystal","left"]': 'incoming' } });
 assert.deepEqual(resolved.preview.conflicts, []); assert.equal((resolved.preview.result.value as any).crystal.left, 2);
 await assert.rejects(h.service('user-1', { ...request, choices: { '["missing"]': 'current' } }), /choices/);
 for (const change of [{ expectedHeadId: 'base' }, { expectedRevision: 1 }]) await assert.rejects(h.service('user-1', { ...request, ...change }), /branch changed/);
 await assert.rejects(h.service('other', request), /not found/);
 await assert.rejects(h.service('user-1', { ...request, eventId: 'current' }), /already/);
 h.entries[2].event.ownerId = 'other'; await assert.rejects(h.service('user-1', request), /unavailable/);
});

test('preview transport validates scope, exact head, content and bounded conflict shapes', async () => {
 const preview = (await setup().service('user-1', request)).preview;
 for (const change of [{ expectedRevision: 1 }, { eventId: 'elsewhere' }, { thingId: 'other' }]) assert.throws(() => parseBranchMergePreview(preview, 'user-1', { ...request, ...change }), /another version/);
 assert.throws(() => parseBranchMergePreview(preview, 'other', request), /another version/);
 assert.throws(() => parseBranchMergePreview({ ...preview, token: 'unwanted' }, 'user-1', request), /Invalid/);
 assert.throws(() => parseBranchMergePreview({ ...preview, result: { ...preview.result, value: { crystal: {} } } }, 'user-1', request), /content/);
 assert.throws(() => parseBranchMergeRequest({ ...request, ownerId: 'other' }), /Invalid/);
 assert.throws(() => parseBranchMergeRequest({ ...request, expectedRevision: 0 }), /Invalid/);
 assert.throws(() => parseBranchMergeRequest({ ...request, choices: { field: 'delete' } }), /Invalid/);
});

test('compact draft ancestry retains latest folder placement and reads only the needed payloads in one batch', async () => {
 const entries = [entry('base', [], snapshot({ title: 'Saved' }, 'old-folder')),
  entry('old-draft', ['base'], { adapter: 'definition-source', version: 1, value: { source: 'invalid obsolete draft' } }),
  entry('move', ['old-draft'], { adapter: 'folder-placement', version: 1, value: { folderId: 'new-folder' } }),
  entry('draft', ['move'], { adapter: 'definition-source', version: 1, value: { source: '{"title":"Latest"}' } })];
 const graph = new Map(entries.map(item => [item.event.id, { id: item.event.id, thingId: 'page', parentIds: item.event.parentIds, afterAdapter: item.event.after!.adapter }]));
 const reads: string[][] = []; const snapshots: string[] = [];
 const content = createVersionContentReader(graph, async ids => { reads.push(ids); return entries.filter(item => ids.includes(item.event.id)); }, async row => { snapshots.push(row.event.id); return row.event.after; });
 assert.deepEqual(JSON.parse(JSON.stringify(await content(entries[3]))), { crystal: { title: 'Latest' }, extended: {}, acl: null, geo: null, tags: [], folderId: 'new-folder' });
 assert.deepEqual(reads, [['move', 'base']]); assert.deepEqual(snapshots, ['base', 'move', 'draft']);
 const move = await content(entries[2]).catch(error => error); assert.match(move.message, /unsupported or incomplete/, 'An invalid current draft still refuses');
});

test('compact materialization refuses missing, duplicate, foreign, unsupported, cyclic and ambiguous ancestry', async () => {
 const base = entry('base', [], snapshot({ title: 'Saved' }));
 const draft = entry('draft', ['base'], { adapter: 'definition-source', version: 1, value: { source: '{}' } });
 const nodes = [base, draft].map(item => ({ id: item.event.id, thingId: 'page', parentIds: item.event.parentIds, afterAdapter: item.event.after!.adapter }));
 const graph = new Map(nodes.map(node => [node.id, node]));
 const resolve = (read: (ids: string[]) => Promise<TimelineEntry[]>) => createVersionContentReader(graph, read, async item => item.event.after)(draft);
 await assert.rejects(resolve(async () => []), /unavailable/);
 await assert.rejects(resolve(async () => [{ ...base, event: { ...base.event, ownerId: 'other' } }]), /unavailable/);
 await assert.rejects(loadVersionGraph(['base', 'draft'], 'page', async () => [nodes[0], nodes[0]]), /unavailable/);
 graph.get('draft')!.parentIds = ['draft']; await assert.rejects(resolve(async () => [base]), /cyclic/);
 graph.get('draft')!.parentIds = ['base', 'other']; await assert.rejects(resolve(async () => [base]), /unambiguous/);
 graph.get('draft')!.afterAdapter = 'theme-content'; await assert.rejects(resolve(async () => [base]), /unambiguous/);
});


test('component-aware branch preview retains definitions and folder-source links without rewriting any version', async () => {
 const h = setup(); const page = { blocks: [{ id: 'card', type: 'component', component: 'card' }] };
 const definitions = ['Old', 'Current', 'Incoming'];
 for (let index = 0; index < 3; index++) {
  const version = h.entries[index]; version.event.after = snapshot(page);
  const captured = captureComponentBindings(version.event, { card: { id: 'card-id', crystal: { render: { tag: 'h2', children: definitions[index] } } } }, [], () => `capture-${index}`);
  version.event.dependencies = captured.dependencies; h.entries.push(...captured.events.map(event => entryFixture(event)));
 }
 await assert.rejects(h.service('user-1', request), /Update this client/);
 const optIn = { ...request, componentChoices: {} };
 const first = parseBranchMergePreview((await h.service('user-1', optIn)).preview, 'user-1', optIn);
 assert.equal(first.components!.entries.length, 3); assert.equal(mergeComponentVersions(first.components!, first.result).conflicts.length, 1);
 assert.throws(() => createBranchMergeProposal(first, 'browser'), /resolve/);
 const choice = { ...optIn, componentChoices: { '["card"]': 'incoming' as const } };
 const chosen = parseBranchMergePreview((await h.service('user-1', choice)).preview, 'user-1', choice);
 assert.deepEqual(createBranchMergeProposal(chosen, 'browser').event.dependencies, h.entries[2].event.dependencies);
 await assert.rejects(h.service('user-1', { ...optIn, componentChoices: { '["unknown"]': 'current' } }), /choices/);
 h.entries.push(entry('move', ['incoming'], { adapter: 'folder-placement', version: 1, value: { folderId: 'new-folder' } }));
 const movedRequest = { ...choice, eventId: 'move' };
 const moved = parseBranchMergePreview((await h.service('user-1', movedRequest)).preview, 'user-1', movedRequest);
 assert.equal((moved.result.value as any).folderId, 'new-folder');
 assert.deepEqual(createBranchMergeProposal(moved, 'browser').event.dependencies, h.entries[2].event.dependencies);
 assert.equal(h.target.head.eventId, 'current');
 assert.throws(() => parseBranchMergePreview(chosen, 'user-1', { ...choice, componentChoices: {} }), /choices/);
});

test('combined preview refuses dense versions before returning a response the client cannot decode', async () => {
 const content = { left: 1, right: 0, rows: Array(70_000).fill(0) };
 const h = setup(content, content);
 for (const options of [request, { ...request, componentChoices: {} }]) {
  await assert.rejects(h.service('user-1', options), (error: any) => error.status === 413 && /too large to preview/.test(error.message));
 }
 assert.equal(h.target.head.eventId, 'current');
});
