import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, appendLocalTimeline, LOCAL_TIMELINE_OWNER } from './timeline';
import { LocalTimelineVersions } from './timelineVersions';
import { parseTimelineEntry, parseTimelineEvent, TIMELINE_EVENT_MAX_BYTES } from '../timeline/contract';
import { createExportVersionService } from '../api/utils/timeline/exportVersion';
import { timelineExportRecord } from '../components/Timeline/timelineExportDownload';
const scope = { kind: 'anonymous' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const now = '2026-10-16T04:00:00.000Z';
async function fixture() {
	const factory = new IDBFactory(),
		db = new WorkspaceDatabase(factory),
		things = new LocalThings(db, scope, lease),
		history = new LocalTimeline(db, lease, 'https://thingtime.example', () => now);
	const thing = await things.create({ thingtime: ['data'], crystal: { name: 'Original', value: 1 } });
	const head = async (id = thing.id) =>
		(await history.page({ thingId: id, before: null, after: null, limit: 40 })).entries.find((row) => row.event.mode === 'revision')!;
	const original = await head();
	return { factory, db, things, history, thing, head, original };
}

test('History export matches the account archive contract, keeps the selected content/name/notes and performs no writes', async () => {
	const h = await fixture();
	try {
		await h.things.update({ id: h.thing.id, crystal: { name: 'Live changed', value: 2 } });
		await h.history.note({
			command: 'add-note',
			operationId: randomUUID(),
			eventId: h.original.event.id,
			thingId: h.thing.id,
			text: 'Keep the earlier content.'
		});
		await h.history.nameVersion({
			command: 'name-version',
			operationId: randomUUID(),
			eventId: h.original.event.id,
			thingId: h.thing.id,
			name: 'Original checkpoint',
			expectedRevision: 0
		});
		const before = await h.history.page({ thingId: null, before: null, after: null, limit: 40 }),
			saved = await h.history.entry(h.original.event.id);
		const result = await h.history.exportVersion(h.original.event.id);
		const server = createExportVersionService({
			collection: async () => ({} as any),
			entries: async () => [h.original],
			snapshot: async (_db, _owner, _id, side) => h.original.event[side],
			notes: async () => saved.notes,
			names: async () => saved.names,
			now: () => new Date(now)
		});
		assert.deepEqual(result.export, await server(LOCAL_TIMELINE_OWNER, h.original.event.id));
		assert.deepEqual(Object.keys(result.export), ['formatVersion', 'exportedAt', 'event', 'receipt', 'content', 'notes', 'name']);
		assert.equal((result.export.content.value as any).crystal.name, 'Original');
		assert.equal(result.export.name?.name, 'Original checkpoint');
		assert.equal(result.export.notes[0].text, 'Keep the earlier content.');
		assert.deepEqual(parseTimelineEntry({ event: result.export.event, receipt: result.export.receipt }), h.original);
		assert.deepEqual(timelineExportRecord(result, h.original.event), JSON.parse(JSON.stringify(result.export)));
		assert.deepEqual(await h.history.page({ thingId: null, before: null, after: null, limit: 40 }), before);
		assert.equal((await h.things.get(h.thing.id)).crystal.value, 2);
	} finally {
		await h.db.close();
	}
});

test('compact folder revisions export recorded ancestry, and deletion exports its before image after a cold reopen', async () => {
	const h = await fixture();
	try {
		const moved = parseTimelineEvent({
			...h.original.event,
			id: randomUUID(),
			operationId: randomUUID(),
			operation: 'update',
			before: h.original.event.after,
			parentIds: [h.original.event.id],
			after: { adapter: 'folder-placement', version: 1, value: { folderId: 'old-folder' } }
		});
		await h.db.transaction(scope, 'readwrite', lease, (tx) => appendLocalTimeline(tx, moved));
		await h.things.update({ id: h.thing.id, crystal: { name: 'Later' } });
		const movedExport = await h.history.exportVersion(moved.id);
		assert.equal((movedExport.export.content.value as any).folderId, 'old-folder');
		assert.equal((movedExport.export.content.value as any).crystal.name, 'Original');
		await h.things.remove([h.thing.id]);
		const gone = await h.head();
		await h.db.close();
		const reopened = new WorkspaceDatabase(h.factory);
		try {
			const exported = await new LocalTimeline(reopened, lease, 'https://thingtime.example').exportVersion(gone.event.id);
			assert.equal(exported.export.event.after, null);
			assert.equal((exported.export.content.value as any).crystal.name, 'Later');
		} finally {
			await reopened.close();
		}
	} finally {
		await h.db.close();
	}
});

test('draft content exports while missing, invalid and effect versions refuse; scope retirement and cancellation cannot return an archive', async () => {
	const h = await fixture();
	try {
		await assert.rejects(h.history.exportVersion('missing'), /not stored/);
		await assert.rejects(h.history.exportVersion('bad\nidentifier'), /Invalid/);
		const draft = parseTimelineEvent({
			...h.original.event,
			id: randomUUID(),
			operationId: randomUUID(),
			mode: 'draft',
			parentIds: [h.original.event.id]
		});
		await h.history.push(draft);
		const draftExport = await h.history.exportVersion(draft.id);
		assert.deepEqual(draftExport.export.event, draft);
		assert.equal(draftExport.export.content.adapter, 'thing-content');
		assert.ok(draftExport.export.receipt, 'The isolated local authority retains its own receipt');
		const named = await h.history.nameVersion({
			command: 'name-version',
			operationId: randomUUID(),
			eventId: h.original.event.id,
			thingId: h.thing.id,
			name: 'Name effect',
			expectedRevision: 0
		});
		await assert.rejects(h.history.exportVersion(named.entry!.event.id), /Only saved/);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(h.history.exportVersion(h.original.event.id, controller.signal), /abort/i);
		const retired = new LocalTimeline(
			h.db,
			{
				assertCurrent() {
					throw new Error('Retired workspace');
				},
				onInvalidate: () => () => {}
			},
			'https://thingtime.example'
		);
		await assert.rejects(retired.exportVersion(h.original.event.id), /Retired workspace/);
	} finally {
		await h.db.close();
	}
});

test('missing compact ancestry refuses instead of exporting current content', async () => {
	const h = await fixture();
	try {
		const moved = parseTimelineEvent({
			...h.original.event,
			id: randomUUID(),
			operationId: randomUUID(),
			operation: 'update',
			before: h.original.event.after,
			parentIds: [h.original.event.id],
			after: { adapter: 'folder-placement', version: 1, value: { folderId: null } }
		});
		await h.db.transaction(scope, 'readwrite', lease, async (tx) => {
			await appendLocalTimeline(tx, moved);
			await tx.delete('timeline-events', h.original.event.id);
		});
		await assert.rejects(h.history.exportVersion(moved.id), /Earlier versions are unavailable/);
		assert.equal((await h.things.get(h.thing.id)).crystal.name, 'Original');
	} finally {
		await h.db.close();
	}
});

test('serialized archive size is bounded even when the retained event fits', async () => {
	const h = await fixture();
	try {
		const large = parseTimelineEvent({
			...h.original.event,
			id: randomUUID(),
			operationId: randomUUID(),
			after: { ...h.original.event.after!, value: { ...(h.original.event.after!.value as any), crystal: { text: 'a'.repeat(2200000) } } }
		});
		assert.ok(new TextEncoder().encode(JSON.stringify(large)).length < TIMELINE_EVENT_MAX_BYTES);
		await h.db.transaction(scope, 'readwrite', lease, (tx) => appendLocalTimeline(tx, large));
		await assert.rejects(
			h.history.exportVersion(large.id),
			(error: any) => error.status === 413 && /remains retained in this device/.test(error.message)
		);
		assert.equal((await h.history.entry(large.id)).entry.event.id, large.id);
	} finally {
		await h.db.close();
	}
});

test('a historical page restores recorded components and round-trips through normal portable export/import with independent identities', async () => {
	const h = await fixture(),
		targetDb = new WorkspaceDatabase(new IDBFactory());
	try {
		const component = await h.things.create({
			thingtime: ['component'],
			crystal: { name: 'Card', componentKey: 'export-card', version: 1, render: { tag: 'p', children: 'Original recorded text' } }
		});
		const page = await h.things.create({
			thingtime: ['webpage'],
			crystal: { name: 'Historical page', blocks: [{ id: 'body', type: 'component', component: component.id }] }
		});
		const original = await h.head(page.id);
		await h.things.update({ id: component.id, crystal: { render: { tag: 'p', children: 'Changed live text' } } });
		await h.things.update({ id: page.id, crystal: { name: 'Current page' } });
		const archive = await h.history.exportVersion(original.event.id);
		assert.deepEqual(archive.export.event.dependencies, original.event.dependencies, 'history archives preserve canonical dependency references');
		const versions = new LocalTimelineVersions(h.db, lease, h.things);
		const preview = await versions.request({ command: 'preview-version', mode: 'restore', eventId: original.event.id, componentMode: 'recorded' });
		assert.ok('preview' in preview);
		await versions.request({
			command: 'apply-version',
			mode: 'restore',
			eventId: original.event.id,
			componentMode: 'recorded',
			operationId: randomUUID(),
			expectedHeadId: preview.preview.expectedHeadId,
			expectedComponents: preview.preview.components!.fingerprint
		});
		const bundle = await h.things.export([page.id]);
		assert.equal(bundle.manifest.things.length, 2);
		const target = new LocalThings(targetDb, scope, lease),
			imported = await target.import(bundle.manifest, null, bundle.files);
		const copied = await target.get(imported.idMap[page.id]),
			ref = (copied.crystal.blocks as any[])[0].component;
		assert.notEqual(copied.id, page.id);
		assert.notEqual(ref, component.id);
		assert.equal(((await target.get(ref)).crystal.render as any).children, 'Original recorded text');
		assert.equal(((await h.things.get(component.id)).crystal.render as any).children, 'Changed live text');
	} finally {
		await h.db.close();
		await targetDb.close();
	}
});
