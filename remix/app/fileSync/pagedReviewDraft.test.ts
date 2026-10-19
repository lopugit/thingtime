import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';
import { INVENTORY_PIN_STORE, INVENTORY_PAGE_BYTES, INVENTORY_PAGE_ENTRIES } from './inventoryJournal';
import { PLAN_PIN_STORE } from './pagedPlanJournal';
import { REVIEW_DRAFT_STORES, type ReviewDraftSpec, type ReviewDraftCursor } from './pagedReviewDraft';
import { type SyncEntry, type SyncScope } from './reconcile';
import { createSyncRun } from './execute';
import { createConflictReviewController } from './conflictReviewController';
import type { PagedConflictReviewResult, PagedConflictReviewSession } from './pagedForegroundReview';

const scope: SyncScope = { origin: 'https://review.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const file = (path: string, side: 'local' | 'remote', version = 'one'): SyncEntry => ({ path, id: side + '-' + path.slice(-100), version,
	kind: 'file', size: 2, sha256: (side === 'local' ? 'a' : 'b').repeat(64) });
const spec = (id = 'draft'): ReviewDraftSpec => ({ id, configuration: newFileSyncConfiguration({ name: 'Files', deviceId: 'device', localRootId: 'local-root', remoteFolderId: 'remote-root' }),
	plan: { id: 'plan-' + id, local: { id: 'local-' + id, source: 'local', generation: 'one' }, remote: { id: 'remote-' + id, source: 'remote', generation: 'one' },
		baseline: { local: { id: 'before-local-' + id, source: 'local', generation: 'one' }, remote: { id: 'before-remote-' + id, source: 'remote', generation: 'one' } },
		policy: { mode: 'two-way', propagateDeletes: false }, excludedPaths: [] } });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'review-drafts', IDBKeyRange), abort = new AbortController(); let current = scope;
	const access = { scope, currentScope: () => current, cleanup: 'foreground' as const, signal: abort.signal };
	return { factory, journal, access, drafts: journal.reviewDrafts(access), plans: journal.plans(access), inventory: journal.inventory(access),
		maintenance: journal.maintenance(access), abort, changeAccount: () => { current = { ...scope, ownerId: 'another' }; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seed(f: Fixture, s: ReviewDraftSpec, count = 270, options: { changed?: boolean; folder?: boolean; long?: boolean } = {}) {
	const paths = Array.from({ length: count }, (_, i) => (options.long ? ('x'.repeat(200) + '/').repeat(18) : '') + 'file-' + String(i).padStart(5, '0'));
	for (const [i, capture] of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote].entries()) {
		const rows = i < 2 ? paths.map(path => file(path, i ? 'remote' : 'local', options.changed && path === paths.at(-1) ? 'two' : 'one')) : [];
		if (options.long && i < 2) for (let depth = 1; depth <= 18; depth++) rows.unshift({
			path: Array(depth).fill('x'.repeat(200)).join('/'), id: 'folder-' + depth, version: 'one', kind: 'folder', size: 0, sha256: null
		});
		if (options.folder && i === 0) rows[0] = { ...rows[0], kind: 'folder', size: 0, sha256: null };
		await f.inventory.begin(capture);
		let offset = 0, ordinal = 0;
		do {
			const entries: SyncEntry[] = []; let bytes = 4096;
			while (offset < rows.length && entries.length < 128) {
				const length = new TextEncoder().encode(JSON.stringify(rows[offset])).length + 1;
				if (bytes + length > INVENTORY_PAGE_BYTES) break;
				entries.push(rows[offset++]); bytes += length;
			}
			await f.inventory.append(capture, { ordinal: ordinal++, entries, ...(offset === rows.length ? { totalEntries: rows.length } : {}) });
		} while (offset < rows.length);
		await f.inventory.seal(capture);
	}
	await f.plans.build(s.plan);
}
async function selectAll(f: Fixture, s: ReviewDraftSpec) {
	let cursor: ReviewDraftCursor | undefined;
	do { const page = await f.drafts.read(s, cursor);
		for (const r of page.rows) await f.drafts.choose(s, r.conflict.path, 'local', r.revision);
		cursor = page.next ?? undefined;
	} while (cursor);
}

test('review indexing, choices and cursor resume across reopen without a whole-list read', async () => {
	let f = await fixture(); const s = spec(); await seed(f, s); await f.drafts.begin(s);
	assert.equal((await f.drafts.step(s)).read, 128);
	await assert.rejects(f.drafts.read(s), /incomplete/);
	f.journal.close(); f = await fixture(f.factory); const p = await f.drafts.build(s);
	assert.equal(p.count, 270); assert.equal(p.phase, 'reviewing');
	const first = await f.drafts.read(s); assert.equal(first.rows.length, 20); assert.ok(first.next);
	await f.drafts.choose(s, first.rows[0].conflict.path, 'remote', 0);
	f.journal.close(); f = await fixture(f.factory);
	assert.equal((await f.drafts.active())?.progress.selected, 1);
	assert.equal((await f.drafts.read(s)).rows[0].from, 'remote');
	assert.equal((await f.drafts.read(s, first.next)).rows[0].conflict.path, 'file-00020');
	await assert.rejects(f.plans.discard(s.plan), /pinned/);
	await assert.rejects(f.inventory.discard(s.plan.local), /pinned/); f.journal.close();
});

test('an active review fences legacy journal mutations until its draft is released', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 2); await f.drafts.build(s);
	const run = createSyncRun({ scope, decisions: [] });
	await assert.rejects(f.journal.persist(run), /Resume the paged sync journal/);
	await f.drafts.release(s); await f.journal.persist(run);
	assert.deepEqual(await f.journal.read(scope), run); f.journal.close();
});

test('row revisions prevent stale concurrent overwrites; clearing choices updates readiness', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 2); await f.drafts.build(s);
	const results = await Promise.allSettled([f.drafts.choose(s, 'file-00000', 'local', 0), f.drafts.choose(s, 'file-00000', 'remote', 0)]);
	assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
	const chosen = (await f.drafts.read(s)).rows[0]; assert.equal(chosen.revision, 1);
	assert.equal((await f.drafts.choose(s, chosen.conflict.path, null, 1)).progress.selected, 0);
	await assert.rejects(f.drafts.seal(s, 'resolve', (await f.drafts.active())!.progress.revision), /incomplete/);
	await assert.rejects(f.drafts.choose(s, 'FILE-00000', 'local', 2), /changed/);
	await assert.rejects(f.drafts.choose(s, 'missing', 'local', 0), /Invalid saved/); f.journal.close();
});

test('sealed choices import in bounded pages and fresh-plan preparation rejects changed versions', async () => {
	for (const changed of [false, true]) {
		const f = await fixture(), s = spec(); await seed(f, s); await f.drafts.build(s); await selectAll(f, s);
		const revision = (await f.drafts.active())!.progress.revision;
		await assert.rejects(f.drafts.seal(s, 'resolve', revision - 1), /changed/);
		await f.drafts.seal(s, 'resolve', revision);
		await assert.rejects(f.drafts.choose(s, 'file-00000', 'remote', 1), /not editable/);
		const fresh = spec('fresh'); await seed(f, fresh, 270, { changed });
		const runs = f.journal.pagedRuns(f.access), run = { id: 'run', plan: fresh.plan, configuration: fresh.configuration, review: { id: s.id, kind: 'resolve' as const, count: 270 } };
		await runs.begin(run); let cursor: ReviewDraftCursor | undefined, ordinal = 0;
		do { const page = await f.drafts.sealedRows(s, cursor); assert.ok(page.rows.length <= INVENTORY_PAGE_ENTRIES);
			await runs.appendReview(run, { ordinal: ordinal++, rows: page.rows, complete: !page.next }); cursor = page.next ?? undefined;
		} while (cursor);
		await f.drafts.release(s); await f.maintenance.collect();
		if (changed) { await assert.rejects(runs.prepare(run), /changed/); await assert.rejects(runs.start(run), /incomplete/); }
		else assert.equal((await runs.prepare(run)).operations, 270);
		assert.equal((await runs.begin(run)).confirmed, 0); f.journal.close();
	}
});

test('retention preserves both files without choices, while folders remain visible and blocked', async () => {
	for (const folder of [false, true]) {
		const f = await fixture(), s = spec(); await seed(f, s, 2, { folder }); const p = await f.drafts.build(s);
		assert.equal(p.blocked, Number(folder)); assert.equal(p.retentionBlocked, Number(folder));
		if (folder) {
			assert.equal((await f.drafts.read(s)).rows[0].conflict.local?.kind, 'folder');
			await assert.rejects(f.drafts.choose(s, 'file-00000', 'remote', 0), /needs changes/);
			await assert.rejects(f.drafts.seal(s, 'retain', p.revision), /source-folder/);
		} else {
			await f.drafts.seal(s, 'retain', p.revision);
			assert.deepEqual((await f.drafts.sealedRows(s)).rows.map(r => r.from), ['local', 'local']);
		}
		f.journal.close();
	}
});

test('maintenance preserves active drafts and removes released rows in bounded transactions', async () => {
	const f = await fixture(), s = spec(); await seed(f, s); await f.drafts.build(s);
	await f.drafts.choose(s, 'file-00000', 'local', 0); await f.maintenance.collect();
	assert.equal((await f.drafts.active())?.progress.selected, 1);
	await assert.rejects(f.drafts.begin(spec('second')), /existing conflict review/);
	await f.drafts.release(s); await assert.rejects(f.drafts.begin(s), /already used/);
	let deleted = 0; await f.maintenance.collect(p => { assert.ok(p.deleted <= 128); deleted += p.deleted; });
	assert.ok(deleted > 270); assert.equal(await f.drafts.active(), null);
	await assert.rejects(f.drafts.read(s), /no longer active/); f.journal.close();
});

test('byte-bounded pages cover long-path conflicts without skipping any rows', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 130, { long: true }); await f.drafts.build(s);
	let cursor: ReviewDraftCursor | undefined, seen = 0;
	do { const page = await f.drafts.read(s, cursor, 128);
		assert.ok(page.rows.length < 128); assert.ok(new TextEncoder().encode(JSON.stringify(page.rows)).length < INVENTORY_PAGE_BYTES);
		seen += page.rows.length; cursor = page.next ?? undefined;
	} while (cursor);
	assert.equal(seen, 130); f.journal.close();
});

test('cancellation, account changes and forged cross-draft cursors refuse all access', async () => {
	for (const change of ['account', 'abort'] as const) {
		const f = await fixture(), s = spec(); await seed(f, s, 21); await f.drafts.build(s);
		const page = await f.drafts.read(s); assert.ok(page.next);
		await assert.rejects(f.drafts.read(s, { ...page.next, instance: 'different' }), /cursor changed/);
		await assert.rejects(f.drafts.read(s, { ...page.next, scope: { ...scope, ownerId: 'other' } }), /cursor/);
		await assert.rejects(f.drafts.read(s, undefined, 129), /page limit/);
		if (change === 'account') f.changeAccount(); else f.abort.abort();
		await assert.rejects(f.drafts.read(s)); await assert.rejects(f.drafts.choose(s, 'file-00000', 'local', 0));
		await assert.rejects(f.drafts.release(s)); f.journal.close();
	}
});

test('quota failure rolls back a choice and its aggregate without losing the review', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 2); await f.drafts.build(s);
	const put = IDBObjectStore.prototype.put;
	IDBObjectStore.prototype.put = function(...args: Parameters<typeof put>) {
		if (this.name === REVIEW_DRAFT_STORES[0]) throw new DOMException('Full', 'QuotaExceededError');
		return put.apply(this, args);
	};
	try { await assert.rejects(f.drafts.choose(s, 'file-00000', 'local', 0), /Full/); }
	finally { IDBObjectStore.prototype.put = put; }
	assert.equal((await f.drafts.active())?.progress.selected, 0);
	assert.equal((await f.drafts.read(s)).rows[0].revision, 0); f.journal.close();
});

test('schema upgrade preserves an existing version-nine legacy run', async () => {
	const factory = new IDBFactory(), run = createSyncRun({ scope, decisions: [] });
	const old = await new Promise<IDBDatabase>((resolve, reject) => {
		const r = factory.open('review-drafts', 9); r.onupgradeneeded = () => { r.result.createObjectStore('runs'); r.result.createObjectStore('checkpoints'); };
		r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
	});
	const { syncScopeKey } = await import('./reconcile');
	await new Promise<void>((resolve, reject) => { const tx = old.transaction('runs', 'readwrite');
		tx.objectStore('runs').put(run, syncScopeKey(scope)); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
	}); old.close();
	const f = await fixture(factory); assert.deepEqual(await f.journal.read(scope), run);
	const s = spec(); await seed(f, s, 2); assert.equal((await f.drafts.build(s)).count, 2); f.journal.close();
});

test('recreated capture IDs cannot rebind a reviewed plan to a new inventory instance', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 2);
	await f.inventory.discard(s.plan.local); await f.inventory.begin(s.plan.local);
	await f.inventory.append(s.plan.local, { ordinal: 0, entries: [file('file-00000', 'local')], totalEntries: 1 });
	await f.inventory.seal(s.plan.local);
	await assert.rejects(f.drafts.begin(s), /inventory changed/); assert.equal(await f.drafts.active(), null); f.journal.close();
});

test('active review protects inputs even with damaged pin indexes and rejects cursors after ID reuse', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 21); await f.drafts.build(s);
	const first = await f.drafts.read(s); assert.ok(first.next);
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const r = f.factory.open('review-drafts'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
	});
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction([PLAN_PIN_STORE, INVENTORY_PIN_STORE], 'readwrite');
		tx.objectStore(PLAN_PIN_STORE).clear(); tx.objectStore(INVENTORY_PIN_STORE).clear();
		tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
	}); db.close();
	await f.maintenance.collect(); assert.equal((await f.drafts.read(s)).progress.count, 21);
	await f.drafts.release(s); await f.maintenance.collect(); await seed(f, s, 21); await f.drafts.build(s);
	await assert.rejects(f.drafts.read(s, first.next), /cursor changed/); f.journal.close();
});

test('bidirectional keyset pages recover choices after reopen without retaining cursor history', async () => {
	let f = await fixture(); const s = spec(); await seed(f, s, 83); await f.drafts.build(s);
	let page = await f.drafts.read(s); assert.equal(page.start, 0); assert.equal(page.previous, null);
	while (page.next) page = await f.drafts.read(s, page.next);
	assert.equal(page.start, 80); assert.equal(page.rows.length, 3);
	await f.drafts.choose(s, 'file-00079', 'remote', 0);
	f.journal.close(); f = await fixture(f.factory);
	page = await f.drafts.read(s, page.previous!);
	assert.equal(page.start, 60); assert.equal(page.rows.at(-1)!.conflict.path, 'file-00079');
	assert.equal(page.rows.at(-1)!.from, 'remote');
	assert.equal((await f.drafts.read(s, page.next!)).start, 80);
	while (page.previous) page = await f.drafts.read(s, page.previous);
	assert.equal(page.start, 0); assert.equal(page.rows[0].conflict.path, 'file-00000');
	assert.equal(page.rows.length, 20); f.journal.close();
});

test('backwards pages honor byte bounds, ascending row order and complete coverage', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 130, { long: true }); await f.drafts.build(s);
	let page = await f.drafts.read(s, undefined, 128);
	while (page.next) page = await f.drafts.read(s, page.next, 128);
	let count = page.rows.length;
	while (page.previous) {
		const previousEnd = page.start;
		page = await f.drafts.read(s, page.previous, 128);
		assert.equal(page.start + page.rows.length, previousEnd);
		assert.ok(page.rows.length < 128);
		assert.ok(new TextEncoder().encode(JSON.stringify(page.rows)).length < INVENTORY_PAGE_BYTES);
		assert.deepEqual(page.rows.map(r => r.conflict.path), page.rows.map(r => r.conflict.path).sort());
		count += page.rows.length;
	}
	assert.equal(count, 130); f.journal.close();
});

test('backwards cursors reject wrong identities, counts, directions and run-import use', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 21); await f.drafts.build(s);
	const first = await f.drafts.read(s), last = await f.drafts.read(s, first.next!), token = last.previous!;
	for (const bad of [{ ...token, instance: 'different' }, { ...token, read: 0 }, { ...token, read: 22 },
		{ ...token, scope: { ...scope, rootId: 'another' } }, { ...token, direction: 'sideways' }]) {
		await assert.rejects(f.drafts.read(s, bad as ReviewDraftCursor), /cursor|page limit/);
	}
	await assert.rejects(f.drafts.read(s, { ...token, read: 19 }), /declared count/);
	await f.drafts.seal(s, 'retain', (await f.drafts.active())!.progress.revision);
	await assert.rejects(f.drafts.sealedRows(s, token), /forward pages/);
	await f.drafts.release(s); await assert.rejects(f.drafts.read(s, token), /no longer active/); f.journal.close();
});

function controllerFor(f: Fixture, s: ReviewDraftSpec, complete: (result: PagedConflictReviewResult) => void,
	wrap: (session: PagedConflictReviewSession) => PagedConflictReviewSession = session => session) {
	return createConflictReviewController(wrap({ read: cursor => f.drafts.read(s, cursor),
		choose: (path, from, revision) => f.drafts.choose(s, path, from, revision) }), complete);
}

test('review controller keeps one page, saves immediately and rejects off-page or stale choices', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 45); await f.drafts.build(s);
	const results: PagedConflictReviewResult[] = [], c = controllerFor(f, s, result => results.push(result));
	const snapshots: number[] = [], unsubscribe = c.subscribe(() => snapshots.push(c.getSnapshot().page?.rows.length ?? 0));
	await c.reload(); const initial = c.getSnapshot(); assert.equal(initial.page!.start, 0);
	assert.equal(Reflect.set(initial.page!.rows[0], 'from', 'remote'), false);
	await c.choose('file-00000', 'remote', 0);
	assert.equal((await f.drafts.read(s)).rows[0].from, 'remote');
	await assert.rejects(c.choose('file-00000', 'local', 0), /changed/);
	await c.reload(); await c.next(); assert.equal(c.getSnapshot().page!.start, 20);
	await assert.rejects(c.choose('file-00000', 'local', 1), /changed/);
	await c.previous(); assert.equal(c.getSnapshot().page!.rows[0].from, 'remote');
	assert.ok(snapshots.every(n => n <= 20)); assert.equal(initial.page!.rows[0].from, null);
	unsubscribe(); c.dispose(); assert.deepEqual(results, []);
	assert.equal(c.getSnapshot().page, null); assert.equal((await f.drafts.active())!.progress.selected, 1); f.journal.close();
});

test('review controller refuses duplicate work and ignores a late load after disposal', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 21); await f.drafts.build(s);
	let resume!: () => void; const gate = new Promise<void>(resolve => { resume = resolve; });
	let readStarted!: () => void; const started = new Promise<void>(resolve => { readStarted = resolve; });
	const c = controllerFor(f, s, () => assert.fail('Disposed controller completed'), session => ({ ...session,
		read: async cursor => { const page = await session.read(cursor); readStarted(); await gate; return page; } }));
	const pending = c.reload(); await started;
	await assert.rejects(c.reload(), /Wait for/); assert.throws(() => c.cancel(), /Wait for/);
	c.dispose(); resume(); await assert.rejects(pending, /no longer open/);
	assert.deepEqual(c.getSnapshot(), { page: null, error: null, busy: false, closed: true });
	assert.equal((await f.drafts.active())!.progress.phase, 'reviewing'); f.journal.close();
});

test('review controller refuses stale approval and only completes once with the reviewed revision', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, 2); await f.drafts.build(s);
	const results: PagedConflictReviewResult[] = [], c = controllerFor(f, s, result => results.push(result));
	await c.reload(); await c.choose('file-00000', 'local', 0); await c.choose('file-00001', 'local', 0);
	await f.drafts.choose(s, 'file-00001', 'remote', 1);
	await assert.rejects(c.finish('resolve'), /Saved choices changed/); assert.deepEqual(results, []);
	assert.equal(c.getSnapshot().page!.rows[1].from, 'remote');
	await assert.rejects(c.finish('resolve'), /Reload this review/);
	await c.reload(); const revision = c.getSnapshot().page!.progress.revision;
	await c.finish('resolve'); assert.deepEqual(results, [{ action: 'resolve', revision }]);
	await assert.rejects(c.finish('retain'), /no longer open/); assert.throws(() => c.cancel(), /no longer open/);
	assert.equal(c.getSnapshot().page, null); f.journal.close();
});

test('review controller preserves the page on read failure and gates incomplete or blocked approval', async () => {
	for (const folder of [false, true]) {
		const f = await fixture(), s = spec(); await seed(f, s, 21, { folder }); await f.drafts.build(s);
		let failure = false; const results: PagedConflictReviewResult[] = [];
		const c = controllerFor(f, s, result => results.push(result), session => ({ ...session,
			read: cursor => failure ? Promise.reject(Error('Storage unavailable')) : session.read(cursor) }));
		await c.reload(); const page = c.getSnapshot().page;
		failure = true; await assert.rejects(c.next(), /Storage unavailable/); assert.equal(c.getSnapshot().page, page);
		failure = false; await c.reload(); await assert.rejects(c.finish('resolve'), /incomplete/);
		await c.reload();
		if (folder) { await assert.rejects(c.finish('retain'), /source folders/); c.cancel(); assert.deepEqual(results, [{ action: 'cancel' }]); }
		else { await c.finish('retain'); assert.deepEqual(results, [{ action: 'retain', revision: page!.progress.revision }]); }
		f.journal.close();
	}
});
