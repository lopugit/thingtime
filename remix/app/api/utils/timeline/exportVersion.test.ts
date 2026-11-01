import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportVersionService } from './exportVersion.ts';
import { entryFixture, eventFixture } from '../../../timeline/testFixtures.ts';
import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../../../timeline/snapshotParts.ts';
import { StorageMutationError } from '../storage/storageCore.ts';
import type { TimelineEntry, TimelineEvent, TimelineSnapshot } from '../../../timeline/contract.ts';
import type { TimelineNote } from '../../../timeline/notes.ts';
import type { TimelineVersionName } from '../../../timeline/versionNames.ts';

const content = (crystal: any, folderId: string | null = null) => ({ crystal, extended: null, tags: [], geo: null, acl: ['tt:user'], folderId });
const full = (crystal: any, folderId: string | null = null): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value: { thingtime: ['data'], ...content(crystal, folderId), targetId: null } });
const placement = (folderId: string | null): TimelineSnapshot => ({ adapter: 'folder-placement', version: 1, value: { folderId } });
const parts = (eventId: string, bytes: number): TimelineSnapshot => ({ adapter: TIMELINE_SNAPSHOT_PARTS_ADAPTER, version: 1, value: { eventId, side: 'after', partCount: Math.ceil(bytes / 65536), characters: bytes, bytes, retainedBytes: bytes - 100, sha256: 'a'.repeat(64) } });
const note: TimelineNote = { formatVersion: 1, id: 'note-177abf25-b322-4ac0-9707-a59c36e7bcd5', ownerId: 'user-1', eventId: 'base', thingId: 'thing-1', author: 'owner', text: 'Keep this one.', createdAt: '2026-10-13T09:30:00.000Z' };
const named: TimelineVersionName = { formatVersion: 1, id: 'base/name', ownerId: 'user-1', eventId: 'base', thingId: 'thing-1', name: 'Launch copy', revision: 1, createdAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z' };
const rejects = async (work: Promise<unknown>, status: number, pattern: RegExp) =>
	assert.rejects(work, (error: any) => error instanceof StorageMutationError && error.status === status && pattern.test(error.message));

function harness() {
	const events = new Map<string, TimelineEntry>(); let position = 10;
	const add = (id: string, overrides: Partial<TimelineEvent>) => events.set(id, entryFixture(eventFixture(id, { thingId: 'thing-1', source: 'api', clientId: null, mode: 'revision', operation: 'update', label: 'Edited Thing', ...overrides }), ++position));
	add('base', { operation: 'create', label: 'Created Thing', before: null, after: full({ title: 'Saved' }, 'old-folder') });
	add('move', { parentIds: ['base'], label: 'Moved Thing', before: placement('old-folder'), after: placement('new-folder') });
	add('gone', { operation: 'delete', label: 'Deleted Thing', parentIds: ['move'], before: full({ title: 'Gone' }, 'new-folder'), after: null });
	add('draft', { source: 'client', clientId: 'browser-1', mode: 'draft', parentIds: ['move'], before: full({ title: 'Saved' }), after: full({ title: 'Draft' }) });
	add('effect', { mode: 'effect', operation: 'effect', label: 'Named version', before: null, after: { adapter: 'timeline-version-name', version: 1, value: {} } });
	add('huge', { parentIds: ['move'], before: full({ title: 'Saved' }), after: parts('huge', 5 * 1024 * 1024) });
	add('big', { parentIds: ['move'], before: full({ title: 'Saved' }), after: parts('big', 1000) });
	const reads: string[][] = []; const nodeReads: string[][] = []; const snapshots: string[] = [];
	const service = createExportVersionService({
		collection: async () => ({}) as any,
		entries: async (_things, ownerId, ids) => { reads.push(ids); return ids.flatMap(id => { const entry = events.get(id); return entry && entry.event.ownerId === ownerId ? [entry] : []; }); },
		nodes: async (_things, ownerId, ids) => { nodeReads.push(ids); return ids.flatMap(id => { const entry = events.get(id); return entry && entry.event.ownerId === ownerId ? [{ id, thingId: entry.event.thingId, parentIds: entry.event.parentIds, afterAdapter: entry.event.after?.adapter ?? null }] : []; }); },
		snapshot: async (_things, _ownerId, eventId, side, snapshot) => { snapshots.push(`${eventId}/${side}`); return snapshot?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER ? full({ title: 'Reassembled' }) : snapshot; },
		notes: async (_things, ownerId, ids) => ownerId === 'user-1' && ids.includes('base') ? [note] : [],
		names: async (_things, ownerId, ids) => ownerId === 'user-1' && ids.includes('base') ? [named] : [],
		now: () => new Date('2026-10-13T10:05:00.000Z')
	});
	return { service, events, reads, nodeReads, snapshots };
}

test('an export is the immutable event and receipt, its six restorable keys, its notes and its name', async () => {
	const h = harness(); const result = await h.service('user-1', 'base');
	assert.ok(result);
	assert.deepEqual(Object.keys(result), ['formatVersion', 'exportedAt', 'event', 'receipt', 'content', 'notes', 'name']);
	assert.equal(result.formatVersion, 1); assert.equal(result.exportedAt, '2026-10-13T10:05:00.000Z');
	assert.deepEqual(result.event, h.events.get('base')!.event); assert.deepEqual(result.receipt, h.events.get('base')!.receipt);
	assert.deepEqual(JSON.parse(JSON.stringify(result.content)), { adapter: 'thing-content', version: 1, value: content({ title: 'Saved' }, 'old-folder') });
	assert.ok(!('thingtime' in (result.content.value as any)) && 'thingtime' in (result.event.after!.value as any), 'the raw event keeps thingtime; the content carries only restorable keys');
	assert.deepEqual(result.notes, [note]); assert.deepEqual(result.name, named);
	assert.deepEqual(h.nodeReads, [], 'a full version needs no ancestry');
});

test('compact versions resolve through their saved ancestor and deletions export their before-image', async () => {
	const h = harness();
	const moved = await h.service('user-1', 'move');
	assert.deepEqual(JSON.parse(JSON.stringify(moved!.content.value)), content({ title: 'Saved' }, 'new-folder'));
	assert.deepEqual(h.nodeReads, [['move'], ['base']]); assert.ok(h.reads.some(ids => ids.includes('base')));
	assert.equal(moved!.name, null); assert.deepEqual(moved!.notes, []);
	const gone = await h.service('user-1', 'gone');
	assert.deepEqual(JSON.parse(JSON.stringify(gone!.content.value)), content({ title: 'Gone' }, 'new-folder'));
	assert.equal(gone!.event.after, null); assert.deepEqual(h.snapshots.filter(item => item.startsWith('gone')), ['gone/before']);
});

test('unknown or foreign versions are null; drafts and effects refuse; oversized retained parts refuse before any part is read', async () => {
	const h = harness();
	assert.equal(await h.service('user-1', 'missing'), null); assert.equal(await h.service('other', 'base'), null);
	await rejects(h.service('user-1', 'draft'), 422, /Only saved versions can be exported/);
	await rejects(h.service('user-1', 'effect'), 422, /Only saved versions can be exported/);
	await rejects(h.service('user-1', 'huge'), 413, /too large to export in one file/);
	assert.deepEqual(h.snapshots, [], 'no snapshot part is reassembled for a refused export');
	const big = await h.service('user-1', 'big');
	assert.deepEqual(JSON.parse(JSON.stringify(big!.content.value)), content({ title: 'Reassembled' }));
	assert.deepEqual(h.snapshots, ['big/after']);
});
