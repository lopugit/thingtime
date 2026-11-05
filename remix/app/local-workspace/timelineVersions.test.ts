import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { LocalThings } from './things';
import { LocalTimeline, LOCAL_TIMELINE_OWNER } from './timeline';
import { LocalTimelineVersions } from './timelineVersions';
import { parsePublishedVersionPreview, versionRequestIdentity, type VersionRequest } from '../timeline/publishedVersion';
import { parseTimelineEvent } from '../timeline/contract';
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} },
	scope = { kind: 'anonymous' } as const;
async function fixture(db = new WorkspaceDatabase(new IDBFactory()), activeLease = lease) {
	const things = new LocalThings(db, scope, activeLease),
		history = new LocalTimeline(db, activeLease, 'https://thingtime.example'),
		versions = new LocalTimelineVersions(db, activeLease, things);
	const thing = await things.create({ thingtime: ['data'], crystal: { name: 'Original', left: 1, right: 1 } });
	const head = async (id = thing.id) =>
		(await history.page({ thingId: id, before: null, after: null, limit: 40 })).entries.find((row) => row.event.mode === 'revision')!.event;
	const base = await head();
	const preview = async (eventId: string, mode: VersionRequest['mode'] = 'restore', extra: Partial<VersionRequest> = {}) => {
		const request: VersionRequest = {
			command: 'preview-version',
			mode,
			eventId,
			componentMode: 'recorded',
			choices: {},
			componentChoices: {},
			...extra
		};
		const result = await versions.request(request);
		assert.ok('preview' in result);
		const checked = parsePublishedVersionPreview(result.preview, eventId, (await history.entry(eventId)).entry.event.thingId, request);
		return {
			preview: checked,
			apply: {
				...request,
				command: 'apply-version',
				operationId: randomUUID(),
				expectedHeadId: checked.expectedHeadId,
				expectedComponents: checked.components!.fingerprint,
				...(checked.recovery ? { expectedRecovery: checked.recoveryFingerprint } : {})
			} as VersionRequest
		};
	};
	return { db, things, history, versions, thing, base, head, preview };
}

test('local restore uses the normal writer, canonical hashed request identity and exact retry receipt after later edits', async () => {
	const h = await fixture();
	try {
		await h.things.update({ id: h.thing.id, crystal: { name: 'Edited' } });
		const p = await h.preview(h.base.id),
			result = await h.versions.request(p.apply);
		assert.ok('entry' in result);
		assert.equal((await h.things.get(h.thing.id)).crystal.name, 'Original');
		assert.equal(result.entry.event.operation, 'restore');
		assert.equal(result.entry.event.source, 'api');
		assert.equal(result.entry.event.operationId, createHash('sha256').update(versionRequestIdentity(p.apply)).digest('hex'));
		assert.deepEqual(result.entry.event.parentIds, [p.apply.expectedHeadId, h.base.id]);
		await h.things.update({ id: h.thing.id, crystal: { name: 'Later' } });
		assert.deepEqual(await h.versions.request(p.apply), result);
		assert.equal((await h.things.get(h.thing.id)).crystal.name, 'Later');
		await assert.rejects(h.versions.request({ ...p.apply, mode: 'merge' }), /already used/);
		await assert.rejects(h.versions.request({ ...p.apply, operationId: randomUUID() }), /changed/);
	} finally {
		await h.db.close();
	}
});

test('local undo keeps later independent edits, requires overlapping choices and refuses an already reverted change', async () => {
	const h = await fixture();
	try {
		await h.things.update({ id: h.thing.id, crystal: { left: 2 } });
		const edit = await h.head();
		await h.things.update({ id: h.thing.id, crystal: { right: 2 } });
		const p = await h.preview(edit.id, 'undo'),
			result = await h.versions.request(p.apply);
		assert.ok('entry' in result);
		assert.deepEqual((await h.things.get(h.thing.id)).crystal, { name: 'Original', left: 1, right: 2 });
		assert.equal(result.entry.event.label, 'Undid change');
		assert.equal(result.entry.event.operation, 'restore');
		await assert.rejects(h.preview(edit.id, 'undo'), /Nothing to undo/);
		await h.things.update({ id: h.thing.id, crystal: { left: 3 } });
		const conflict = await h.preview(edit.id, 'undo');
		assert.equal(conflict.preview.conflicts.length, 1);
		await assert.rejects(h.versions.request(conflict.apply), /overlapping/);
		const selected = await h.preview(edit.id, 'undo', { choices: { '["crystal","left"]': 'incoming' } });
		await h.versions.request(selected.apply);
		assert.equal((await h.things.get(h.thing.id)).crystal.left, 1);
	} finally {
		await h.db.close();
	}
});

test('local current-content merge shares canonical three-way rules and preserves both saved parents', async () => {
	const h = await fixture();
	try {
		await h.things.update({ id: h.thing.id, crystal: { left: 2 } });
		const current = await h.head();
		const draft = parseTimelineEvent({
			...h.base,
			id: randomUUID(),
			operationId: randomUUID(),
			mode: 'draft',
			operation: 'update',
			parentIds: [h.base.id],
			before: h.base.after,
			after: { ...h.base.after!, value: { ...(h.base.after!.value as any), crystal: { name: 'Original', left: 1, right: 3 } } }
		});
		await h.history.push(draft);
		const p = await h.preview(draft.id, 'merge');
		const result = await h.versions.request(p.apply);
		assert.ok('entry' in result);
		assert.deepEqual(result.entry.event.parentIds, [current.id, draft.id]);
		assert.deepEqual((await h.things.get(h.thing.id)).crystal, { name: 'Original', left: 2, right: 3 });
	} finally {
		await h.db.close();
	}
});

async function pageFixture(h: Awaited<ReturnType<typeof fixture>>) {
	const component = await h.things.create({
		thingtime: ['component'],
		crystal: { name: 'Reusable card', componentKey: 'restore-card', version: 1, render: { tag: 'p', children: 'Recorded original' } }
	});
	const page = await h.things.create({
		thingtime: ['webpage'],
		crystal: { name: 'Original page', blocks: [{ id: 'card', type: 'component', component: component.id }] }
	});
	const original = await h.head(page.id);
	await h.things.update({ id: component.id, crystal: { render: { tag: 'p', children: 'Live edited' } } });
	await h.things.update({ id: page.id, crystal: { name: 'Edited page' } });
	return { component, page, original };
}

test('recorded page restore creates independently validated components, remaps refs, captures dependencies and survives cold reload', async () => {
	const factory = new IDBFactory(),
		h = await fixture(new WorkspaceDatabase(factory));
	try {
		const f = await pageFixture(h),
			p = await h.preview(f.original.id);
		assert.equal(p.preview.components!.copyCount, 1);
		const result = await h.versions.request(p.apply);
		assert.ok('entry' in result);
		const page = await h.things.get(f.page.id),
			ref = (page.crystal.blocks as any[])[0].component;
		assert.notEqual(ref, f.component.id);
		assert.match(ref, /^restored-/);
		const copy = await h.things.get(ref);
		assert.equal((copy.crystal.render as any).children, 'Recorded original');
		assert.equal(((await h.things.get(f.component.id)).crystal.render as any)?.children, 'Live edited');
		assert.equal(result.entry.event.dependencies.length, 1);
		const captures = await h.history.componentBindings(result.entry.event.id);
		assert.equal(captures.entries.length, 1);
		assert.deepEqual(await h.versions.request(p.apply), result);
		assert.equal((await h.things.snapshot()).filter((row) => row.id.startsWith('restored-')).length, 1);
		await h.db.close();
		const reopenedDb = new WorkspaceDatabase(factory);
		try {
			const reopened = new LocalTimelineVersions(reopenedDb, lease);
			assert.deepEqual(await reopened.request(p.apply), result);
			assert.equal((await new LocalThings(reopenedDb, scope, lease).get(ref)).crystal.componentKey, ref);
		} finally {
			await reopenedDb.close();
		}
	} finally {
		await h.db.close();
	}
});

test('changed components are refused even with an unchanged page head, and choosing current definitions makes no copies', async () => {
	const h = await fixture();
	try {
		const f = await pageFixture(h),
			stale = await h.preview(f.original.id);
		await h.things.update({ id: f.component.id, crystal: { render: { tag: 'p', children: 'Changed after review' } } });
		await assert.rejects(h.versions.request(stale.apply), /component changed/);
		const p = await h.preview(f.original.id, 'restore', { componentMode: 'current' });
		assert.equal(p.preview.components!.copyCount, 0);
		await h.versions.request(p.apply);
		assert.equal((await h.things.get(f.page.id)).crystal.blocks?.[0]?.component, f.component.id);
		assert.equal((await h.things.snapshot()).filter((row) => row.id.startsWith('restored-')).length, 0);
	} finally {
		await h.db.close();
	}
});

test('deleted local Things recover their original identity privately and fall back from a removed folder', async () => {
	const h = await fixture();
	try {
		const folder = await h.things.create({ thingtime: ['folder'], crystal: { name: 'Folder' } });
		await h.things.update({ id: h.thing.id, folderId: folder.id });
		await h.things.remove([h.thing.id]);
		const deleted = await h.head();
		await h.things.remove([folder.id]);
		const p = await h.preview(deleted.id, 'restore', { recover: true });
		assert.equal(p.preview.current, null);
		assert.equal((p.preview.result.value as any).folderId, null);
		assert.deepEqual((p.preview.result.value as any).acl, ['tt:user']);
		const result = await h.versions.request(p.apply);
		assert.ok('entry' in result);
		assert.equal(result.entry.event.operation, 'create');
		assert.equal((await h.things.get(h.thing.id)).crystal.name, 'Original');
		assert.deepEqual(await h.versions.request(p.apply), result);
	} finally {
		await h.db.close();
	}
});

class FailingDatabase extends WorkspaceDatabase {
	failVersion = false;
	abortVersion: AbortController | null = null;
	override transaction<T>(scope: WorkspaceScope, mode: IDBTransactionMode, lease: WorkspaceLease, run: (tx: WorkspaceTransaction) => Promise<T>) {
		return super.transaction(scope, mode, lease, (tx) =>
			run({
				...tx,
				put: async (collection, id, value) => {
					if (this.abortVersion && collection === 'timeline-events' && id.startsWith('version-')) {
						this.abortVersion.abort();
						this.abortVersion = null;
					}
					if (this.failVersion && collection === 'timeline-events' && id.startsWith('version-')) throw new Error('Injected receipt failure');
					await tx.put(collection, id, value);
				}
			})
		);
	}
}
test('failed component-copy receipts roll back every new copy and page update', async () => {
	const db = new FailingDatabase(new IDBFactory()),
		h = await fixture(db);
	try {
		const f = await pageFixture(h),
			p = await h.preview(f.original.id),
			before = await h.things.snapshot();
		db.failVersion = true;
		await assert.rejects(h.versions.request(p.apply), /Injected receipt/);
		assert.deepEqual(await h.things.snapshot(), before);
		db.failVersion = false;
		await h.versions.request(p.apply);
		assert.equal((await h.things.get(f.page.id)).crystal.name, 'Original page');
	} finally {
		await db.close();
	}
});

test('unsupported histories, invalid choices, aborted and retired editors do not mutate content', async () => {
	let retired = false;
	const activeLease = {
		assertCurrent() {
			if (retired) throw new Error('Workspace changed');
		},
		onInvalidate: () => () => {}
	};
	const h = await fixture(undefined, activeLease);
	try {
		const before = await h.things.snapshot();
		await assert.rejects(h.preview('missing'), /Version not found/);
		await assert.rejects(h.preview(h.base.id, 'undo'), /Only a saved edit/);
		await assert.rejects(h.preview(h.base.id, 'restore', { choices: { x: 'incoming' } }), /Restores do not accept/);
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(h.versions.request({ command: 'preview-version', mode: 'restore', eventId: h.base.id }, controller.signal));
		retired = true;
		await assert.rejects(h.preview(h.base.id), /Workspace changed/);
		retired = false;
		assert.deepEqual(await h.things.snapshot(), before);
	} finally {
		await h.db.close();
	}
});

test('two concurrent restore submissions replay one receipt and a later stale operation cannot overwrite it', async () => {
	const h = await fixture();
	try {
		await h.things.update({ id: h.thing.id, crystal: { name: 'Edited' } });
		const p = await h.preview(h.base.id);
		const results = await Promise.all([h.versions.request(p.apply), new LocalTimelineVersions(h.db, lease).request(p.apply)]);
		assert.deepEqual(results[0], results[1]);
		await assert.rejects(h.versions.request({ ...p.apply, operationId: randomUUID() }), /changed/);
		assert.equal(
			(await h.history.page({ thingId: h.thing.id, before: null, after: null, limit: 40 })).entries.filter((row) => row.event.operation === 'restore')
				.length,
			1
		);
	} finally {
		await h.db.close();
	}
});

test('component changes between planning and commit are fenced before any copy is created', async () => {
	const h = await fixture();
	try {
		const f = await pageFixture(h),
			p = await h.preview(f.original.id),
			originalWriter = h.things.versionTransaction.bind(h.things);
		h.things.versionTransaction = async (run, signal) => {
			await h.things.update({ id: f.component.id, crystal: { render: { tag: 'p', children: 'Concurrent component edit' } } });
			return originalWriter(run, signal);
		};
		await assert.rejects(h.versions.request(p.apply), /component changed/);
		assert.equal((await h.things.get(f.page.id)).crystal.name, 'Edited page');
		assert.equal((await h.things.snapshot()).filter((row) => row.id.startsWith('restored-')).length, 0);
	} finally {
		await h.db.close();
	}
});

test('missing recorded definitions require current mode and unsupported dependency kinds remain refused', async () => {
	const h = await fixture();
	try {
		const f = await pageFixture(h);
		const draft = parseTimelineEvent({
			...f.original,
			id: randomUUID(),
			operationId: randomUUID(),
			mode: 'draft',
			parentIds: [f.original.id],
			dependencies: []
		});
		await h.history.push(draft);
		const p = await h.preview(draft.id);
		assert.equal(p.preview.components!.missing.length, 1);
		await assert.rejects(h.versions.request(p.apply), /not recorded/);
		const current = await h.preview(draft.id, 'restore', { componentMode: 'current' });
		await h.versions.request(current.apply);
		const unsupported = parseTimelineEvent({
			...draft,
			id: randomUUID(),
			operationId: randomUUID(),
			dependencies: [{ thingId: h.thing.id, eventId: h.base.id }]
		});
		await h.history.push(unsupported);
		await assert.rejects(h.preview(unsupported.id), /dependencies/);
	} finally {
		await h.db.close();
	}
});

test('abort during receipt capture rolls back page, copied components and history together', async () => {
	const db = new FailingDatabase(new IDBFactory()),
		h = await fixture(db);
	try {
		const f = await pageFixture(h),
			p = await h.preview(f.original.id),
			before = await h.things.snapshot();
		const historyBefore = await h.history.page({ thingId: f.page.id, before: null, after: null, limit: 40 });
		const controller = (db.abortVersion = new AbortController());
		await assert.rejects(h.versions.request(p.apply, controller.signal));
		assert.deepEqual(await h.things.snapshot(), before);
		assert.deepEqual(await h.history.page({ thingId: f.page.id, before: null, after: null, limit: 40 }), historyBefore);
	} finally {
		await db.close();
	}
});

test('a retained draft cannot bypass normal page validation when restored', async () => {
	const h = await fixture();
	try {
		const f = await pageFixture(h);
		const draft = parseTimelineEvent({
			...f.original,
			id: randomUUID(),
			operationId: randomUUID(),
			mode: 'draft',
			parentIds: [f.original.id],
			dependencies: [],
			after: { ...f.original.after!, value: { ...(f.original.after!.value as any), crystal: { name: 'Malformed', blocks: 'not blocks' } } }
		});
		await h.history.push(draft);
		const p = await h.preview(draft.id, 'restore', { componentMode: 'current' }),
			before = await h.things.snapshot();
		await assert.rejects(h.versions.request(p.apply));
		assert.deepEqual(await h.things.snapshot(), before);
	} finally {
		await h.db.close();
	}
});
