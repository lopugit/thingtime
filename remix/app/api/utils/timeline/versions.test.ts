import assert from 'node:assert/strict';
import test from 'node:test';
import { createVersionService, loadVersionGraph, parseVersionRequest, versionMergeBase } from './versions.ts';
import { recordedComponentVersions } from './publishedComponents.ts';
import type { TimelineGraphNode } from './repository.ts';
import { TIMELINE_UNDO_LABEL } from '../../../timeline/publishedVersion.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import { StorageMutationError } from '../storage/storageCore.ts';
import type { TimelineEntry, TimelineEvent, TimelineSnapshot } from '../../../timeline/contract.ts';

const node = (id: string, parentIds: string[] = []): TimelineGraphNode => ({ id, parentIds, thingId: 'thing-1', afterAdapter: 'thing-content' });
test('merge bases use the shared DAG, including two-parent versions and partial client caches', async () => {
 const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c']), node('e', ['c'])];
 const graph = await loadVersionGraph(['d', 'e'], 'thing-1', async ids => nodes.filter(item => ids.includes(item.id)));
 assert.equal(versionMergeBase(graph, 'd', 'e').id, 'c');
 assert.equal(versionMergeBase(graph, 'b', 'd').id, 'b');
});
test('missing, foreign and ambiguous ancestors cannot be silently merged', async () => {
 await assert.rejects(loadVersionGraph(['a'], 'thing-1', async () => []), /unavailable/);
 await assert.rejects(loadVersionGraph(['a'], 'thing-1', async () => [{ ...node('a'), thingId: 'other' }]), /unavailable/);
 const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c']), node('e', ['c', 'b']), node('unrelated')];
 const graph = new Map(nodes.map(item => [item.id, item]));
 assert.throws(() => versionMergeBase(graph, 'd', 'e'), /multiple merge bases/);
 assert.throws(() => versionMergeBase(graph, 'a', 'unrelated'), /no shared ancestor/);
});
test('version commands are strict, bounded, and require a replay identity plus preview head', () => {
 const request = { command: 'apply-version', mode: 'restore', eventId: 'source', expectedHeadId: 'current', operationId: '177abf25-b322-4ac0-9707-a59c36e7bcd5' };
 assert.deepEqual(parseVersionRequest(request), request);
 assert.throws(() => parseVersionRequest({ ...request, ownerId: 'other' }), /Invalid/);
 assert.throws(() => parseVersionRequest({ ...request, expectedHeadId: null }), /preview head/);
 assert.throws(() => parseVersionRequest({ ...request, operationId: 'random' }), /UUID/);
 assert.throws(() => parseVersionRequest({ ...request, choices: { field: 'delete' } }), /choices/);
});

const content = (crystal: any, folderId: string | null = null) => ({ crystal, extended: null, tags: [], geo: null, acl: ['tt:user'], folderId });
const full = (crystal: any, folderId: string | null = null): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value: { thingtime: ['data'], ...content(crystal, folderId), targetId: null } });
const placement = (folderId: string | null): TimelineSnapshot => ({ adapter: 'folder-placement', version: 1, value: { folderId } });
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const rejects = async (work: Promise<unknown>, status: number, pattern: RegExp) =>
 assert.rejects(work, (error: any) => error instanceof StorageMutationError && error.status === status && pattern.test(error.message));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
/** Default line: v1 creates {a:1,b:1}, v2 edits a, v3 edits b; the live Thing is v3. */
function harness(options: { thingtime?: string[]; events?: Record<string, Partial<TimelineEvent>>; crystal?: any; folderId?: string | null; head?: string; recorded?: typeof recordedComponentVersions } = {}) {
 const events = new Map<string, TimelineEntry>(); let position = 10;
 const add = (id: string, overrides: Partial<TimelineEvent>) => events.set(id, entryFixture(eventFixture(id, { thingId: 'thing-1', source: 'api', clientId: null, mode: 'revision', operation: 'update', label: 'Edited Thing', ...overrides }), ++position));
 add('v1', { operation: 'create', label: 'Created Thing', before: null, after: full({ a: 1, b: 1 }) });
 add('v2', { parentIds: ['v1'], before: full({ a: 1, b: 1 }), after: full({ a: 2, b: 1 }) });
 add('v3', { parentIds: ['v2'], before: full({ a: 2, b: 1 }), after: full({ a: 2, b: 2 }) });
 for (const [id, overrides] of Object.entries(options.events ?? {})) add(id, overrides);
 const doc: any = { _id: 'db-thing', shareId: 'thing-1', ownerId: 'user-1', thingtime: options.thingtime ?? ['data'], timelineHeadId: options.head ?? 'v3', updatedAt: new Date('2026-10-13T09:00:00.000Z'), crystal: options.crystal ?? { a: 2, b: 2 }, extended: null, tags: [], acl: ['tt:user'], folderId: options.folderId ?? null, targetId: null, geo: null };
 const updates: { input: any; capture: any }[] = []; const reads: string[][] = [];
 const service = createVersionService({
  collection: async () => ({ findOne: async () => null }) as any,
  find: async (shareId, viewer) => shareId === doc.shareId && viewer.id === doc.ownerId ? doc : null,
  update: async (viewer, shareId, input: any, options: any) => {
   assert.deepEqual(viewer, { id: 'user-1' }); assert.equal(shareId, 'thing-1'); assert.equal(options.replaceCrystal, true);
   assert.equal(options.expectedUpdatedAt, doc.updatedAt.toISOString()); assert.equal(options.timeline.expectedHeadId, doc.timelineHeadId);
   const capture = options.timeline.capture; updates.push({ input: plain(input), capture });
   add(capture.id, { operationId: capture.operationId, actorId: capture.actorId, source: capture.source, operation: capture.operation, label: capture.label, parentIds: capture.parentIds, before: full(doc.crystal, doc.folderId), after: full(plain(input.crystal), input.folderId) });
   doc.crystal = plain(input.crystal); doc.folderId = input.folderId; doc.timelineHeadId = capture.id; doc.updatedAt = new Date(doc.updatedAt.getTime() + 1000);
   return { ok: true, thing: {} as any, post: null };
  },
  create: async () => { throw new Error('undo never creates a Thing'); },
  transaction: async work => work({ inTransaction: () => true }),
  entries: async (_things, ownerId, ids) => { reads.push(ids); return ids.flatMap(id => { const entry = events.get(id); return entry && entry.event.ownerId === ownerId ? [entry] : []; }); },
  nodes: async (_things, ownerId, ids) => ids.flatMap(id => { const entry = events.get(id); return entry && entry.event.ownerId === ownerId ? [{ id, thingId: entry.event.thingId, parentIds: entry.event.parentIds, afterAdapter: entry.event.after?.adapter ?? null } satisfies TimelineGraphNode] : []; }),
  snapshot: async (_things, _ownerId, _eventId, _side, snapshot) => snapshot,
  deleted: async () => { throw new Error('undo never recovers a deleted Thing'); },
  recorded: options.recorded ?? (async (_things, _ownerId, sources) => sources.map(() => ({}))),
  live: async () => ({ current: {}, result: {}, fingerprint: 'f'.repeat(64) })
 });
 return { service, doc, events, updates, reads };
}
const preview = (eventId = 'v2', extra: Record<string, unknown> = {}) => ({ command: 'preview-version' as const, mode: 'undo' as const, eventId, ...extra });
const apply = (n: number, eventId = 'v2', extra: Record<string, unknown> = {}) => ({ command: 'apply-version' as const, mode: 'undo' as const, eventId, expectedHeadId: 'v3', operationId: uuid(n), ...extra });

test('undoing a middle edit keeps the later edit of another property and commits a restore labelled Undid change with both parents', async () => {
 const h = harness();
 const result = await h.service('user-1', preview());
 assert.ok('preview' in result); const p = result.preview;
 assert.equal(p.mode, 'undo'); assert.equal(p.baseEventId, 'v2', 'the undone event is the merge base'); assert.equal(p.expectedHeadId, 'v3');
 assert.deepEqual(plain(p.incoming.value), content({ a: 1, b: 1 }), 'incoming is the edit’s before-state'); assert.deepEqual(plain(p.current!.value), content({ a: 2, b: 2 }));
 assert.deepEqual(plain(p.result.value), content({ a: 1, b: 2 })); assert.deepEqual(p.conflicts, []);
 assert.ok(!('thingtime' in p) && !('components' in p));
 const withComponents = (await h.service('user-1', preview('v2', { componentMode: 'current', componentChoices: {} }))) as any;
 assert.deepEqual(withComponents.preview.thingtime, ['data']); assert.equal(withComponents.preview.components.fingerprint, 'f'.repeat(64));
 const applied = await h.service('user-1', apply(1));
 assert.ok('entry' in applied);
 assert.equal(applied.entry.event.id, `version-${uuid(1)}`); assert.equal(applied.entry.event.operation, 'restore', 'no new operation value'); assert.equal(applied.entry.event.label, TIMELINE_UNDO_LABEL);
 assert.deepEqual(applied.entry.event.parentIds, ['v3', 'v2']); assert.equal(applied.entry.event.source, 'api'); assert.equal(applied.entry.event.mode, 'revision');
 assert.equal(h.updates.length, 1); assert.deepEqual(h.updates[0].input, content({ a: 1, b: 2 })); assert.deepEqual(h.doc.crystal, { a: 1, b: 2 });
 assert.deepEqual(await h.service('user-1', apply(1)), applied, 'an exact retry returns the original receipt'); assert.equal(h.updates.length, 1);
 await rejects(h.service('user-1', apply(1, 'v3')), 409, /already used for another version request/);
 await rejects(h.service('user-1', apply(2)), 409, /changed after the version preview/);
 const head = await h.service('user-1', apply(3, 'v3', { expectedHeadId: `version-${uuid(1)}` }));
 assert.ok('entry' in head);
 assert.deepEqual(head.entry.event.parentIds, [`version-${uuid(1)}`, 'v3']); assert.deepEqual(h.doc.crystal, { a: 1, b: 1 }, 'undoing the later edit afterwards reverts b too');
});

test('an overlapping later edit needs a choice: apply refuses without it, incoming reverts it, arrays stay atomic and stale choices refuse', async () => {
 const h = harness({ events: {
  v2: { parentIds: ['v1'], before: full({ a: 1, b: 1 }), after: full({ a: 2, b: 1, list: [1, 2] }) },
  v3: { parentIds: ['v2'], before: full({ a: 2, b: 1, list: [1, 2] }), after: full({ a: 3, b: 1, list: [1, 2, 3] }) }
 }, crystal: { a: 3, b: 1, list: [1, 2, 3] } });
 const first = (await h.service('user-1', preview()) as any).preview;
 assert.deepEqual(first.conflicts.map((conflict: any) => conflict.path), [['crystal', 'a'], ['crystal', 'list']]);
 assert.deepEqual(first.conflicts[0], { path: ['crystal', 'a'], base: { present: true, value: 2 }, current: { present: true, value: 3 }, incoming: { present: true, value: 1 } });
 await rejects(h.service('user-1', apply(1)), 409, /Choose which overlapping changes/); assert.equal(h.updates.length, 0);
 const choices = { '["crystal","a"]': 'incoming', '["crystal","list"]': 'incoming' };
 const chosen = (await h.service('user-1', preview('v2', { choices })) as any).preview;
 assert.deepEqual(chosen.conflicts, []); assert.deepEqual(plain(chosen.result.value.crystal), { a: 1, b: 1 });
 const applied = await h.service('user-1', apply(2, 'v2', { choices }));
 assert.ok('entry' in applied); assert.deepEqual(h.doc.crystal, { a: 1, b: 1 }); assert.equal(applied.entry.event.label, TIMELINE_UNDO_LABEL);
 await rejects(h.service('user-1', preview('v2', { choices: { '["missing"]': 'current' } })), 422, /no longer valid/);
});

test('undoing a folder move returns to the earlier folder with the crystal of the saved ancestor while keeping the later content edit', async () => {
 const h = harness({ events: {
  v1: { operation: 'create', label: 'Created Thing', before: null, after: full({ a: 1 }, 'folder-a') },
  v2: { parentIds: ['v1'], label: 'Moved Thing', before: placement('folder-a'), after: placement('folder-b') },
  v3: { parentIds: ['v2'], before: full({ a: 1 }, 'folder-b'), after: full({ a: 9 }, 'folder-b') }
 }, crystal: { a: 9 }, folderId: 'folder-b' });
 const p = (await h.service('user-1', preview()) as any).preview;
 assert.deepEqual(plain(p.incoming.value), content({ a: 1 }, 'folder-a')); assert.deepEqual(plain(p.result.value), content({ a: 9 }, 'folder-a')); assert.deepEqual(p.conflicts, []);
 assert.ok(h.reads.some(ids => ids.includes('v1')), 'the saved ancestor supplies the crystal');
 const applied = await h.service('user-1', apply(1));
 assert.ok('entry' in applied); assert.equal(h.doc.folderId, 'folder-a'); assert.deepEqual(h.doc.crystal, { a: 9 });
});

test('only a saved update with both snapshots can be undone, and an already reverted edit refuses without writing', async () => {
 const h = harness({ events: {
  draft: { source: 'client', clientId: 'browser-1', mode: 'draft', parentIds: ['v3'], before: full({ a: 2, b: 2 }), after: full({ a: 5, b: 2 }) },
  gone: { operation: 'delete', label: 'Deleted Thing', parentIds: ['v3'], before: full({ a: 2, b: 2 }), after: null },
  effect: { mode: 'effect', operation: 'effect', label: 'Named version', parentIds: [], before: null, after: { adapter: 'timeline-version-name', version: 1, value: {} } }
 } });
 for (const id of ['v1', 'draft', 'gone', 'effect']) await rejects(h.service('user-1', preview(id)), 422, /Only a saved edit can be undone/);
 await rejects(h.service('user-1', preview('missing')), 404, /Version not found/);
 await rejects(h.service('other', preview()), 404, /Version not found/);
 assert.equal(h.updates.length, 0);
 const reverted = harness({ events: { v3: { parentIds: ['v2'], operation: 'restore', label: 'Restored earlier version', before: full({ a: 2, b: 1 }), after: full({ a: 1, b: 1 }) } }, crystal: { a: 1, b: 1 } });
 await rejects(reverted.service('user-1', preview()), 409, /already reverted/);
 await rejects(reverted.service('user-1', apply(1)), 409, /already reverted/);
 assert.equal(reverted.updates.length, 0); assert.equal(reverted.events.has(`version-${uuid(1)}`), false);
});

test('page versions with recorded dependencies resolve their parent crystal source, need one parent, and surface the non-component refusal', async () => {
 const dependencies = [{ thingId: 'other-thing', eventId: 'x' }];
 const h = harness({ thingtime: ['webpage'], events: { v2: { parentIds: ['v1'], dependencies, before: full({ a: 1, b: 1 }), after: full({ a: 2, b: 1 }) } }, recorded: recordedComponentVersions });
 await rejects(h.service('user-1', preview()), 409, /Update this client/);
 await rejects(h.service('user-1', preview('v2', { componentMode: 'current', componentChoices: {} })), 422, /dependencies this comparison cannot yet restore/);
 assert.ok(h.reads.some(ids => ids.includes('v1') && ids.includes('v2')), 'the parent and the edit are the two component sources');
 const twoParents = harness({ thingtime: ['webpage'], events: { v2: { parentIds: ['v1', 'v0'], dependencies, before: full({ a: 1, b: 1 }), after: full({ a: 2, b: 1 }) } } });
 await rejects(twoParents.service('user-1', preview('v2', { componentMode: 'current', componentChoices: {} })), 422, /not available for this page version yet/);
 const orphan = harness({ thingtime: ['webpage'], events: { v2: { parentIds: ['v0'], dependencies, before: full({ a: 1, b: 1 }), after: full({ a: 2, b: 1 }) } } });
 await rejects(orphan.service('user-1', preview('v2', { componentMode: 'current', componentChoices: {} })), 409, /earlier version is unavailable/);
 assert.equal(h.updates.length + twoParents.updates.length + orphan.updates.length, 0);
});
