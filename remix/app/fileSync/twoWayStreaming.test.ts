import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { projectSyncProgress, type SyncProgressDescriptor } from './progressProjection';
import { createJournalSyncProgressSource } from './progressProjection.client';
import { cloudFileSyncEntry, type CloudFile } from './cloudFile';
import { fingerprintSource } from './contentFingerprint';
import type { SyncReceipt } from './execute';
import { saved, scope } from './foregroundSync.fixture';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { sameSyncStamp, type SyncEntry } from './reconcile';
import { streamingFileFixture } from './streamingFile.fixture';
import { INVENTORY_PAGE_ENTRIES } from './inventoryJournal';
import { streamForegroundSync } from './streamingForegroundSync';
import type { NativeIndexChangesPage } from './streamingIndex';
import { SyncVolumeRemounted } from './syncConnectionWait';

const twoWay = { ...saved, configuration: { ...saved.configuration, mode: 'two-way' as const } };
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>(done => { resolve = done; });
	return { promise, resolve };
};
const frame = (id: string, entries: SyncEntry[], after: number, done = false): NativeIndexChangesPage => ({
	id, generation: id, state: done ? 'complete' : 'running', revision: after + entries.length, nextSequence: after + entries.length, hasMore: false,
	changes: entries.map((entry, i) => ({ entry, sequence: after + i + 1, revision: entry.version }))
});
async function fixture(path?: string) {
	const f = await streamingFileFixture(path), input = f.input;
	const read = input.readConfiguration, inspect = input.inspectLocal!;
	const native = new Map<string, SyncEntry>(), downloads = new Map<string, Uint8Array>();
	const receipts = new Map<string, SyncReceipt>();
	let removeSource = false;
	input.readConfiguration = async () => ({ ...((await read()) as object), crystal: twoWay.configuration });
	input.inspectLocal = async path => native.get(path) ?? (removeSource ? null : await inspect(path));
	input.scanLocal = async () => [...(removeSource ? [] : [f.entry()]), ...native.values()];
	input.inventory = async () => ({
		version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root',
		nodes: [...f.files.values()].map(file => ({ kind: 'file', path: file.name, file }))
	});
	input.localTarget = {
		lookup: async op => receipts.has(op.id) ? { status: 'complete', receipt: receipts.get(op.id)! } : { status: 'missing' },
		stage: async (op, binding, source) => {
			assert.equal(op.mutation.kind, 'copy');
			if (op.mutation.source.kind === 'file') assert.ok(source);
			const data = source ? await source.read(0, source.size) : new Uint8Array();
			const entry = { ...op.mutation.source, id: 'local-' + op.mutation.source.id, version: op.id };
			downloads.set(op.id, data);
			return { operationId: op.id, scope: binding, token: op.id, entry };
		},
		publish: async (op, binding, stage) => {
			assert.equal(op.mutation.kind, 'copy');
			assert.ok(sameSyncStamp(await input.inspectLocal!(op.mutation.path), op.mutation.expectedTarget));
			const receipt = { operationId: op.id, scope: binding, entry: stage.entry };
			native.set(stage.entry.path, stage.entry); receipts.set(op.id, receipt); return receipt;
		}
	};
	const putCloud = async (name: string, bytes: number[], version = 'remote-1', id: string = crypto.randomUUID()) => {
		const data = new Uint8Array(bytes), attachmentId = 'remote-' + version;
		const fingerprint = await fingerprintSource({ size: data.length, check() {}, read: async (offset, size) => data.slice(offset, offset + size) });
		const file: CloudFile = { id, revision: version, name, folderId: 'cloud-root', trashed: false, content: { attachmentId, version: 'a'.repeat(64), size: data.length, fingerprint } };
		f.files.set(id, file); f.objects.set(attachmentId, data);
		return cloudFileSyncEntry(file, name);
	};
	const run = (signal = new AbortController().signal) => runPagedForegroundCloudSync(twoWay, scope, input, signal);
	const stream = (signal = new AbortController().signal) => streamForegroundSync(twoWay, scope, input, signal);
	const feeds = (local: SyncEntry[], remote: SyncEntry[], fence: Promise<void> = Promise.resolve()) => {
		input.streamLocalChanges = async function* (id, after) {
			assert.equal(after, 0);
			yield frame(id, local, 0); await fence;
			yield frame(id, [], local.length, true);
		};
		input.streamRemoteChanges = async function* (id, after, _signal, _ready, resume) {
			assert.equal(after, 0);
			await resume!.checkpoint('1', false);
			yield frame(id, remote, 0); await fence;
			await resume!.checkpoint('2', true);
			yield frame(id, [], remote.length, true);
		};
	};
	const access = { scope, currentScope: input.currentScope };
	return { f, input, native, downloads, receipts, putCloud, feeds, run, stream, removeSource: () => { removeSource = true; },
		runs: () => input.journal.pagedRuns(access), checkpoints: () => input.journal.pagedCheckpoints(access) };
}

test('verified local remount preserves bidirectional receipts and finishes with fresh sealed agreement', { timeout: 10000 }, async () => {
	const x = await fixture(), uploaded = deferred(), downloaded = deferred();
	const remote = await x.putCloud('download.bin', [5, 6, 7]);
	const both = Promise.all([uploaded.promise, downloaded.promise]).then(() => {});
	x.feeds([x.f.entry()], [remote], both);
	x.input.transfer = event => {
		if ('kind' in event && event.kind === 'file') (event.direction === 'upload' ? uploaded : downloaded).resolve();
	};
	x.input.streamLocalChanges = async function* (id) {
		yield frame(id, [x.f.entry()], 0);
		await both;
		await x.f.revise([1, 2, 3], 'remounted-inode-version');
		throw new SyncVolumeRemounted();
	};
	try {
		await x.run();
		assert.equal(x.f.publications(), 1); assert.equal(x.receipts.size, 1);
		assert.deepEqual([...x.downloads.values()].at(-1), new Uint8Array([5, 6, 7]));
		assert.ok(await x.checkpoints().current());
		assert.equal(await x.runs().active(), null);
	} finally { x.f.journal().close(); }
});

test('new files and one-sided file edits in both directions confirm while both initial feeds remain open; strict seal publishes agreement', { timeout: 10000 }, async () => {
	const x = await fixture();
	let remote = await x.putCloud('download.bin', [5, 6, 7]);
	let previousEarly: SyncProgressDescriptor['run'] | null = null;
	for (let phase = 0; phase < 2; phase++) {
		if (phase) {
			await x.f.revise([11, 12]);
			remote = await x.putCloud(remote.path, [21, 22, 23, 24], 'remote-2', remote.id);
		}
		const firstUpload = deferred(), firstDownload = deferred(), both = Promise.all([firstUpload.promise, firstDownload.promise]).then(() => {});
		let directions = new Set<string>();
		x.feeds([x.f.entry()], [remote], both);
		x.input.transfer = activity => {
			if (!('kind' in activity) || activity.kind !== 'file') return;
			directions.add(activity.direction);
			(activity.direction === 'upload' ? firstUpload : firstDownload).resolve();
		};
		let completed: Parameters<typeof x.input.progress>[0] | undefined;
		let descriptor: SyncProgressDescriptor | undefined;
		x.input.progressSession = value => { descriptor = value; };
		const progress: Parameters<typeof x.input.progress>[0][] = [];
		x.input.progress = value => { progress.push(value); if (value.stage === 'complete') completed = value; };
		const oldHead = await x.checkpoints().current();
		const run = x.run();
		await both;
		assert.deepEqual(directions, new Set(['upload', 'download']));
		assert.equal(x.f.publications(), phase + 1); assert.equal(x.receipts.size, phase + 1);
		assert.deepEqual(await x.checkpoints().current(), oldHead);
		const file = [...x.f.files.values()].find(file => file.name === x.f.entry().path)!;
		assert.deepEqual(x.f.objects.get(file.content.attachmentId), new Uint8Array(phase ? [11, 12] : [1, 2, 3]));
		assert.deepEqual([...x.downloads.values()].at(-1), new Uint8Array(phase ? [21, 22, 23, 24] : [5, 6, 7]));
		const final = await run;
		assert.ok('progress' in final); assert.equal(final.progress.operations, 0);
		assert.equal(completed?.confirmed, 2);
		assert.equal(completed?.total, 2);
		assert.equal(completed?.directions?.upload.confirmed, 1);
		assert.equal(completed?.directions?.download.confirmed, 1);
		assert.ok(progress.some(value => value.stage === 'scanning' && value.confirmed === 2 && value.totalFinal === false));
		const provisional = progress.filter(value => value.indexState === 'complete');
		assert.ok(provisional.length > 0 && provisional.every(value => value.totalFinal === false));
		assert.equal(completed?.totalFinal, true);
		assert.ok(descriptor && !descriptor.run.streaming);
		const open: typeof openSyncJournal = () => openSyncJournal(x.f.factory, 'thingtime-file-sync-v1', IDBKeyRange);
		const tree = await projectSyncProgress(createJournalSyncProgressSource(descriptor, () => scope, open));
		assert.deepEqual([tree.parent.files, tree.parent.operations, tree.parent.confirmed, tree.parent.unchanged], [2, 2, 2, 0]);
		assert.deepEqual(tree.rows.map(row => [row.files, row.operations, row.confirmed]), [[1, 1, 1], [1, 1, 1]]);
		if (previousEarly) await assert.rejects(x.runs().readConfirmed(previousEarly), /changed or is unavailable/);
		previousEarly = await x.runs().earlyProgressSource(descriptor.run);
		assert.ok(previousEarly);
		assert.notDeepEqual(await x.checkpoints().current(), oldHead);
		assert.equal(await x.runs().streamAwaitingReconciliation(), null);
	}
	x.f.journal().close();
});

test('lost strict handoff retains the early receipt and a later deletion is reviewed, not copied back', { timeout: 10000 }, async () => {
	const x = await fixture();
	x.feeds([x.f.entry()], []);
	const scan = x.input.scanLocal;
	x.input.scanLocal = async () => { throw Error('Interrupted before strict capture'); };
	await assert.rejects(x.run(), /Interrupted before strict capture/);
	assert.equal(x.f.publications(), 1);
	assert.equal(await x.checkpoints().current(), null);
	const early = await x.runs().streamAwaitingReconciliation(); assert.ok(early);
	x.removeSource(); x.input.scanLocal = scan;
	x.input.streamLocalChanges = async function* () { throw Error('A pending handoff must not start another early scan'); };
	x.input.reviewPagedConflicts = async session => {
		const conflicts = (await session.read()).rows.map(row => row.conflict);
		assert.deepEqual(conflicts.map(c => [c.path, c.reason]), [[x.f.entry().path, 'deletion-disabled']]);
		return { action: 'cancel' };
	};
	await assert.rejects(x.run(), /Conflict review cancelled/);
	assert.equal(x.receipts.size, 0);
	assert.deepEqual(await x.runs().streamAwaitingReconciliation(), early);
	x.f.journal().close();
});

test('both-changed and stale hint paths have no early effects; revoked authority leaves their source cursors durable', { timeout: 10000 }, async () => {
	const x = await fixture();
	x.feeds([x.f.entry()], []);
	await x.run();
	const before = [...x.f.files.values()].find(file => file.name === x.f.entry().path)!;
	await x.f.revise([14, 15]);
	const remote = await x.putCloud(before.name, [71, 72], 'remote-new', before.id);
	const valid = x.f.entry(), stale = { ...valid, version: 'older' };
	x.feeds([stale, valid], [remote]);
	await x.stream();
	assert.equal(x.f.publications(), 1);
	assert.equal(x.receipts.size, 0);
	const controller = new AbortController(), ready = deferred(), revoke = deferred();
	const read = x.input.readConfiguration;
	x.input.readConfiguration = async () => {
		const value = await read();
		return { ...(value as object), updatedAt: '2026-11-05T00:00:00.000Z' };
	};
	x.input.streamLocalChanges = async function* (id, after, signal) {
		yield frame(id, [valid], after);
		await Promise.race([revoke.promise, new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }))]);
	};
	// The separate cancellation check below exercises the abort path even if no
	// entry survives validation; revoked settings are checked before feeds open.
	await assert.rejects(x.stream(controller.signal), /approved|changed|revision/i);
	x.input.readConfiguration = read;
	x.input.progress = value => { if (value.indexed === 1) ready.resolve(); };
	x.input.streamRemoteChanges = async function* (id, after) { yield frame(id, [], after, true); };
	const running = x.stream(controller.signal);
	await ready.promise; controller.abort(new Error('Stopped by fixture')); revoke.resolve();
	await assert.rejects(running, /Stopped by fixture/);
	const active = await x.runs().active(); assert.ok(active);
	assert.equal((await x.runs().streamState(active.spec)).replicaFeeds?.local?.sequence, 1);
	x.f.journal().close();
});

test('a deletion during post-run verification retains the confirmed early baseline instead of restoring the deleted item next run', { timeout: 10000 }, async () => {
	const x = await fixture();
	x.feeds([x.f.entry()], []);
	let scans = 0;
	const scan = x.input.scanLocal;
	x.input.scanLocal = async () => {
		if (++scans === 2) x.removeSource();
		return scan();
	};
	await x.run();
	const head = await x.checkpoints().current(); assert.ok(head);
	const inventory = x.input.journal.inventory({ scope, currentScope: x.input.currentScope });
	assert.deepEqual(await inventory.entriesForPaths(head.baseline.local, [x.f.entry().path]), [x.f.entry()]);
	assert.equal(await x.runs().streamAwaitingReconciliation(), null);
	const remote = [...x.f.files.values()][0];
	x.feeds([], [cloudFileSyncEntry(remote, remote.name)]);
	x.input.reviewPagedConflicts = async session => {
		assert.deepEqual((await session.read()).rows.map(r => r.conflict.reason), ['deletion-disabled']);
		return { action: 'cancel' };
	};
	await assert.rejects(x.run(), /Conflict review cancelled/);
	assert.equal(x.receipts.size, 0);
	x.f.journal().close();
});

test('an accepted upload with a lost reply resumes the original ID and both independent source cursors', { timeout: 10000 }, async () => {
	const x = await fixture(), remote = await x.putCloud('download.bin', [8, 9]);
	const controller = new AbortController();
	const stop = () => new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
	x.feeds([x.f.entry()], [remote], stop());
	const fetch = x.input.runtime.fetch;
	let lostId: string | undefined;
	x.input.runtime.fetch = async (url, init) => {
		const result = await fetch(url, init);
		if (!lostId && new URL(String(url)).pathname === '/api/v1/files' && init?.method === 'POST') {
			lostId = JSON.parse(String(init.body)).operationId;
			// Simulate request cancellation after the canonical server effect.
			controller.abort(new Error('Accepted upload response lost'));
			throw controller.signal.reason;
		}
		return result;
	};
	await assert.rejects(x.stream(controller.signal), /Accepted upload response lost/);
	const active = await x.runs().active(); assert.ok(active && lostId);
	const prior = await x.runs().streamState(active.spec);
	assert.equal(prior.replicaFeeds?.local?.sequence, 1);
	assert.equal(x.f.publications(), 1);
	const queued = await x.runs().find(active.spec, x.f.entry().path);
	assert.equal(queued?.id, lostId); assert.equal(queued?.confirmed, false);
	x.input.runtime.fetch = fetch;
	x.input.streamLocalChanges = async function* (id, after) {
		assert.equal(after, prior.replicaFeeds?.local?.sequence);
		yield frame(id, [], after, true);
	};
	x.input.streamRemoteChanges = async function* (id, after, _signal, _ready, resume) {
		assert.equal(after, prior.replicaFeeds?.remote?.sequence ?? 0);
		assert.equal(resume?.cursor, prior.sourceCursor);
		yield frame(id, after ? [] : [remote], after, true);
	};
	await x.run();
	assert.equal(x.f.publications(), 1);
	assert.equal(x.f.puts(), 1);
	assert.equal(x.receipts.size, 1);
	assert.equal(await x.runs().streamAwaitingReconciliation(), null);
	x.f.journal().close();
});

test('a confirmed early folder creation unlocks its nested file before either source seals', { timeout: 10000 }, async () => {
	const x = await fixture('Local parent/child.bin'), first = deferred();
    x.input.nativeOperationGuards = true;
    x.input.authorizeContext = async () => ({ network: 'wifi', charging: true });
	const parent: SyncEntry = { path: 'Local parent', id: 'native-parent', version: 'parent-version', kind: 'folder', size: 0, sha256: null };
	x.native.set(parent.path, parent);
	const fetch = x.input.runtime.fetch;
	let cloudParent: { id: string; name: string; folderId: string; revision: string } | undefined;
	x.input.runtime.fetch = async (value, init) => {
		const url = new URL(String(value)), params = url.searchParams, body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
		const json = (v: object) => Response.json({ ok: true, ...v });
		if (url.pathname === '/api/v1/files') {
			if (body?.kind === 'folder') {
				if (cloudParent) return json({ folder: cloudParent, replayed: true });
				assert.equal(body.name, parent.path); assert.equal(body.folderId, 'cloud-root');
				cloudParent = { id: body.id, folderId: body.folderId, name: body.name, revision: 'parent-created' };
				return json({ folder: cloudParent, replayed: false });
			}
			if (params.has('folderId')) {
				if (params.has('operationId')) return json({ receipt: cloudParent ?? null });
				return cloudParent ? json({ folder: cloudParent }) : Response.json({ ok: false }, { status: 404 });
			}
			const path = params.get('path');
			if (path === parent.path || path === x.f.entry().path) {
				const child = [...x.f.files.values()].find(file => file.folderId === cloudParent?.id);
				const entry = path === parent.path
					? cloudParent ? { ...parent, id: cloudParent.id, version: cloudParent.revision } : null
					: child ? cloudFileSyncEntry(child, path) : null;
				return json({ observation: { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root', path, entry } });
			}
		}
		return fetch(value, init);
	};
	x.feeds([parent, x.f.entry()], [], first.promise);
	x.input.transfer = activity => {
		if ('kind' in activity && activity.kind === 'file') {
			assert.ok(cloudParent);
			assert.equal([...x.f.files.values()][0].folderId, cloudParent.id);
			first.resolve();
		}
	};
	await x.stream();
	assert.ok(cloudParent);
	assert.equal(x.f.publications(), 1);
	assert.deepEqual([...x.f.objects.values()].at(-1), new Uint8Array([1, 2, 3]));
	x.f.journal().close();
});

test('a cloud folder is published locally before its nested file while both feeds are open', { timeout: 10000 }, async () => {
	const x = await fixture(), first = deferred();
    x.input.nativeOperationGuards = true;
    x.input.authorizeContext = async () => ({ network: 'wifi', charging: true });
	const parent: SyncEntry = { path: 'Cloud parent', id: 'cloud-parent', version: 'parent-version', kind: 'folder', size: 0, sha256: null };
	const original = await x.putCloud('child.bin', [81, 82, 83]);
	const file = x.f.files.get(original.id)!;
	file.folderId = parent.id;
	const child = { ...original, path: parent.path + '/' + file.name };
	const fetch = x.input.runtime.fetch;
	x.input.runtime.fetch = async (value, init) => {
		const url = new URL(String(value)), path = url.searchParams.get('path');
		if (url.pathname === '/api/v1/files' && (path === parent.path || path === child.path)) {
			return Response.json({ ok: true, observation: {
				version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root', path, entry: path === parent.path ? parent : child
			} });
		}
		return fetch(value, init);
	};
	x.feeds([], [parent, child], first.promise);
	x.input.transfer = activity => {
		if ('kind' in activity && activity.kind === 'file') {
			assert.equal(x.native.get(parent.path)?.kind, 'folder');
			assert.equal(x.native.get(child.path)?.kind, 'file');
			first.resolve();
		}
	};
	await x.stream();
	assert.equal(x.receipts.size, 2);
	assert.deepEqual([...x.downloads.values()].at(-1), new Uint8Array([81, 82, 83]));
	x.f.journal().close();
});

test('a first guarded publication rejected after staging yields to strict reconciliation without a second write', { timeout: 10000 }, async () => {
	const x = await fixture(), fetch = x.input.runtime.fetch;
	x.feeds([x.f.entry()], []);
	let attempts = 0;
	x.input.runtime.fetch = async (url, init) => {
		if (new URL(String(url)).pathname === '/api/v1/files' && init?.method === 'POST') {
			attempts++;
			const body = JSON.parse(String(init.body));
			assert.deepEqual(body.syncDestination, { rootId: 'cloud-root', path: x.f.entry().path });
			await x.putCloud(x.f.entry().path, [71, 77], 'other-client');
			return Response.json({ ok: false, code: 'sync_destination_changed' }, { status: 409 });
		}
		return fetch(url, init);
	};
	x.input.reviewPagedConflicts = async session => {
		assert.deepEqual((await session.read()).rows.map(r => r.conflict.reason), ['both-changed']);
		return { action: 'cancel' };
	};
	await assert.rejects(x.run(), /Conflict review cancelled/);
	assert.equal(attempts, 1);
	assert.equal(x.f.publications(), 0);
	assert.equal(x.receipts.size, 0);
	x.f.journal().close();
});

test('a changed root cannot release receipts needed by an interrupted strict run', { timeout: 10000 }, async () => {
	const x = await fixture();
	x.feeds([x.f.entry()], []);
	let scans = 0;
	const scan = x.input.scanLocal;
	x.input.scanLocal = async () => {
		if (++scans === 2) throw Error('Interrupted checkpoint');
		return scan();
	};
	await assert.rejects(x.run(), /Interrupted checkpoint/);
	const early = await x.runs().streamAwaitingReconciliation();
	const strict = await x.runs().active();
	assert.equal(strict?.spec.plan.earlyRunId, early?.id); assert.ok(early && strict);
	const original = x.input.readConfiguration;
	const changed = { ...twoWay, configuration: { ...twoWay.configuration, localRootId: 'other-native-root' } };
	x.input.readConfiguration = async () => ({ ...((await original()) as object), crystal: changed.configuration });
	await assert.rejects(runPagedForegroundCloudSync(changed, scope, x.input, new AbortController().signal), /unfinished transfer belongs to different settings/);
	assert.deepEqual(await x.runs().streamAwaitingReconciliation(), early);
	x.input.readConfiguration = original; x.input.scanLocal = scan;
	await x.run();
	assert.equal(x.f.publications(), 1);
	assert.equal(await x.runs().streamAwaitingReconciliation(), null);
	x.f.journal().close();
});

test('ignoring a newly confirmed path before strict handoff does not erase its confirmed agreement', { timeout: 10000 }, async () => {
	const x = await fixture();
	x.feeds([x.f.entry()], []);
	await x.stream();
	x.removeSource();
	const read = x.input.readConfiguration;
	const ignored = { ...twoWay, configuration: { ...twoWay.configuration, excludedPaths: [x.f.entry().path] } };
	x.input.readConfiguration = async () => ({ ...((await read()) as object), crystal: ignored.configuration });
	await runPagedForegroundCloudSync(ignored, scope, x.input, new AbortController().signal);
	const head = await x.checkpoints().current(); assert.ok(head);
	const inventory = x.input.journal.inventory({ scope, currentScope: x.input.currentScope });
	assert.deepEqual(await inventory.entriesForPaths(head.baseline.local, [x.f.entry().path]), [x.f.entry()]);
	assert.equal(x.receipts.size, 0);
	x.f.journal().close();
});

test('a destination renamed after preparation is deferred using the exact path before another upload starts', { timeout: 10000 }, async () => {
	const x = await fixture();
	x.feeds([x.f.entry()], []); await x.run();
	await x.f.revise([31, 32]);
	x.feeds([x.f.entry()], []);
	const fetch = x.input.runtime.fetch;
	let renamed = false;
	x.input.runtime.fetch = async (url, init) => {
		const parsed = new URL(String(url));
		if (!renamed && parsed.pathname === '/api/v1/files' && parsed.searchParams.has('operationId')) {
			renamed = true;
			[...x.f.files.values()][0].name = 'Moved.bin';
		}
		return fetch(url, init);
	};
	await x.stream();
	assert.ok(renamed);
	assert.equal(x.f.puts(), 1);
	assert.equal(x.f.publications(), 1);
	x.f.journal().close();
});

test('a source changed during staging leaves no uncertain publication and strict reconciliation copies the new bytes', { timeout: 10000 }, async () => {
	const x = await fixture(), source = x.input.source;
	x.feeds([x.f.entry()], []);
	let stageChanged = false;
	x.input.source = async entry => {
		const opened = await source(entry);
		return { ...opened, verify: async () => {
			if (!stageChanged) {
				stageChanged = true;
				await x.f.revise([44, 45, 46]);
				throw Error('Source changed after staging');
			}
		} };
	};
	await x.run();
	assert.ok(stageChanged);
	assert.equal(x.f.puts(), 2);
	assert.equal(x.f.publications(), 1);
	const file = [...x.f.files.values()][0];
	assert.deepEqual(x.f.objects.get(file.content.attachmentId), new Uint8Array([44, 45, 46]));
	assert.ok(await x.checkpoints().current());
	x.f.journal().close();
});

async function folderEchoFixture(options: { first?: 'local' | 'remote'; guarded?: boolean; change?: boolean; pause?: boolean; remove?: boolean; removeFirst?: boolean; child?: boolean; interrupt?: boolean; scopeChange?: boolean; fillers?: number; echoFillers?: boolean; queued?: boolean } = {}) {
    const x = await fixture('Matched/child.bin'), path = 'Matched', first = options.first ?? 'local';
    let left: SyncEntry | null = { path, id: 'native-folder', version: 'local-folder-v1', kind: 'folder', size: 0, sha256: null };
    let right: SyncEntry | null = { ...left, id: 'cloud-folder', version: 'cloud-folder-v1' };
    const hints = { local: structuredClone(left), remote: structuredClone(right) }, firstDone = deferred(), bothDone = deferred();
    let preparedHints = 0, appended = 0, contexts = 0, localReads = 0, cloudReads = 0, childReads = 0, paused = false, activeScope = true, interrupted = options.interrupt;
    const wait = async (promise: Promise<void>, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
            const abort = () => { signal?.removeEventListener('abort', abort); reject(signal?.reason); };
            signal?.addEventListener('abort', abort, { once: true });
            promise.then(() => { signal?.removeEventListener('abort', abort); resolve(); }, reject);
            if (signal?.aborted) abort();
        });
    };
    const configuration = x.input.readConfiguration, inspect = x.input.inspectLocal!, fetch = x.input.runtime.fetch;
    x.input.nativeOperationGuards = options.guarded === false ? undefined : true;
    x.input.currentScope = () => activeScope ? scope : { ...scope, ownerId: 'different-owner' };
    x.input.authorizeContext = async () => { contexts++; return { network: 'wifi', charging: true }; };
    x.input.readConfiguration = async () => ({ ...((await configuration()) as object), crystal: { ...twoWay.configuration, paused } });
    x.input.inspectLocal = async candidate => {
        if (candidate === path) { localReads++; return structuredClone(left); }
        if (candidate.startsWith('Filler-')) return { path: candidate, id: 'native-' + candidate, version: 'native-folder-v1', kind: 'folder', size: 0, sha256: null };
        if (candidate === x.f.entry().path) childReads++;
        return inspect(candidate);
    };
    x.input.runtime.fetch = async (target, init) => {
        const url = new URL(String(target));
        const requested = url.searchParams.get('path');
        if (url.pathname === '/api/v1/files' && requested?.startsWith('Filler-')) return Response.json({ ok: true, observation: { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root', path: requested, entry: { path: requested, id: 'cloud-' + requested, version: 'cloud-folder-v1', kind: 'folder', size: 0, sha256: null } } });
        if (url.pathname === '/api/v1/files' && requested === path) {
            cloudReads++;
            return Response.json({ ok: true, observation: { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root', path, entry: structuredClone(right) } });
        }
        return fetch(target, init);
    };
    const queued = deferred(); let appendedFeeds = 0, firstFolderReads: number | undefined, queuedSelected = false;
    const pagedRuns = x.input.journal.pagedRuns.bind(x.input.journal);
    x.input.journal = { ...x.input.journal, pagedRuns: (...args) => {
        const runs = pagedRuns(...args);
        return { ...runs, nextStreamInput: async (...args) => {
            if (options.queued) await queued.promise;
            if (options.queued && !queuedSelected) {
                queuedSelected = true;
                if (options.pause) paused = true;
                if (options.scopeChange) activeScope = false;
                if (options.remove) { left = null; right = null; }
            }
            return runs.nextStreamInput(...args);
        }, appendReplicaStreamInput: async (...args) => {
            const result = await runs.appendReplicaStreamInput(...args);
            if (++appendedFeeds === 2) queued.resolve();
            return result;
        }, appendStream: async (...args) => {
            const result = await runs.appendStream(...args); preparedHints++;
            if (args[1].entry.path === path && firstFolderReads === undefined) firstFolderReads = localReads;
            if (args[1].entry.path === path) { if (++appended === 1 && !options.fillers) firstDone.resolve(); if (appended === 2) bothDone.resolve(); }
            if (options.fillers && args[1].entry.path === 'Filler-' + (options.fillers - 1)) firstDone.resolve();
            return result;
        } };
    } };
    const feed = async function* (side: 'local' | 'remote', id: string, after: number, signal?: AbortSignal) {
        if (side !== first && !options.queued) {
            await wait(firstDone.promise, signal);
            if (interrupted) await wait(new Promise<void>(() => {}), signal);
            if (options.pause) paused = true;
            if (options.scopeChange) activeScope = false;
            if (options.remove) { if (side === 'remote') right = null; else left = null; }
            if (options.removeFirst) { if (first === 'remote') right = null; else left = null; }
            if (options.change) {
                const changed = { ...hints[side], version: 'changed-folder' };
                if (side === 'remote') right = changed; else left = changed;
                hints[side] = changed;
            }
        }
        if (!after) {
            yield frame(id, [hints[side]], 0);
            if (options.fillers && (side === first || options.echoFillers)) yield frame(id, Array.from({ length: options.fillers }, (_, i) => ({ path: 'Filler-' + i, id: side === 'local' ? 'native-Filler-' + i : 'cloud-Filler-' + i, version: side === 'local' ? 'native-folder-v1' : 'cloud-folder-v1', kind: 'folder', size: 0, sha256: null })), 1);
        }
        if (side === first && interrupted) { await wait(firstDone.promise, signal); throw Error('Interrupted after first folder observation'); }
        await wait(bothDone.promise, signal);
        let sequence = Math.max(after, 1 + (side === first || options.echoFillers ? options.fillers ?? 0 : 0));
        if (side === 'local' && options.child) { yield frame(id, [x.f.entry()], sequence++); }
        yield frame(id, [], sequence, true);
    };
    x.input.streamLocalChanges = (id, after, signal) => feed('local', id, after, signal);
    x.input.streamRemoteChanges = (id, after, signal) => feed('remote', id, after, signal);
    return { ...x, preparedHints: () => preparedHints, firstFolderReads: () => firstFolderReads, stats: () => ({ contexts, localReads, cloudReads, childReads }), resume: () => { interrupted = false; } };
}
test('queued opposite folder hints defer the initial folder without network observations or checkpoint authority', { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ queued: true, child: true }); await x.stream();
    assert.equal(x.firstFolderReads(), 0);
    assert.equal(x.preparedHints(), 3);
    assert.equal(x.stats().childReads, 0, 'A paired hint cannot supply parent authority');
    assert.equal(x.f.publications(), 0); assert.equal(x.receipts.size, 0); assert.equal(await x.checkpoints().current(), null);
    x.input.streamLocalChanges = undefined; x.input.streamRemoteChanges = undefined;
    x.input.scanLocal = async () => { throw Error('Fresh strict inventory requested'); };
    await assert.rejects(x.run(), /Fresh strict inventory requested/);
    assert.equal(await x.checkpoints().current(), null);
    x.f.journal().close();
    const legacy = await folderEchoFixture({ queued: true, guarded: false }); await legacy.stream();
    assert.equal(legacy.firstFolderReads(), 1, 'Legacy preparation retains fresh observations');
    legacy.f.journal().close();
});
test('queued folder deferral cannot hide removal, paused effects or a changed owner', { timeout: 10000 }, async () => {
    const removed = await folderEchoFixture({ queued: true, remove: true, child: true }); await removed.stream();
    assert.equal(removed.firstFolderReads(), 0); assert.equal(removed.stats().childReads, 0);
    assert.equal(removed.f.publications(), 0); assert.equal(removed.receipts.size, 0); assert.equal(await removed.checkpoints().current(), null);
    removed.input.streamLocalChanges = undefined; removed.input.streamRemoteChanges = undefined;
    removed.input.scanLocal = async () => { throw Error('Fresh strict inventory after removal'); };
    await assert.rejects(removed.run(), /Fresh strict inventory after removal/); removed.f.journal().close();
    for (const options of [{ pause: true }, { scopeChange: true }]) {
        const x = await folderEchoFixture({ queued: true, ...options });
        await assert.rejects(x.stream(), /Sync configuration or device approval changed|Sync context changed/);
        assert.equal(x.f.publications(), 0); assert.equal(x.receipts.size, 0);
        x.f.journal().close();
    }
});
for (const first of ['local', 'remote'] as const) test(`guarded no-op folder ${first} echo avoids repeated policy and point reads`, { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ first }); await x.stream();
    assert.deepEqual(x.stats(), { contexts: 2, localReads: 1, cloudReads: 1, childReads: 0 });
    assert.equal(x.f.publications(), 0); assert.equal(x.receipts.size, 0); assert.equal(await x.checkpoints().current(), null);
    x.f.journal().close();
});
test('legacy echoes and changed guarded stamps retain fresh preparation checks', { timeout: 10000 }, async () => {
    for (const options of [{ guarded: false }, { change: true }]) {
        const x = await folderEchoFixture(options); await x.stream();
        assert.equal(x.stats().localReads, 2); assert.equal(x.stats().cloudReads, 2); assert.ok(x.stats().contexts >= 3);
        assert.equal(x.f.publications(), 0); x.f.journal().close();
    }
});
test('stale folder echo cannot authorize a child or hide a fresh strict scan', { timeout: 10000 }, async () => {
    for (const options of [{ remove: true }, { removeFirst: true }]) {
        const x = await folderEchoFixture({ ...options, child: true }); await x.stream();
        assert.equal(x.stats().localReads, 1); assert.equal(x.stats().cloudReads, 1); assert.equal(x.stats().childReads, 0);
        assert.equal(x.f.publications(), 0); assert.equal(x.receipts.size, 0); assert.equal(await x.checkpoints().current(), null);
        x.input.streamLocalChanges = undefined; x.input.streamRemoteChanges = undefined;
        x.input.scanLocal = async () => { throw Error('Fresh strict inventory requested'); };
        await assert.rejects(x.run(), /Fresh strict inventory requested/);
        assert.equal(await x.checkpoints().current(), null); x.f.journal().close();
    }
});
test('paused duplicate hint has no effect and strict seal requires current policy', { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ pause: true }); await x.stream();
    assert.equal(x.stats().localReads, 1); assert.equal(x.stats().cloudReads, 1); assert.equal(x.f.publications(), 0);
    await assert.rejects(x.run(), /paused|changed|approved|revision/i);
    assert.equal(await x.checkpoints().current(), null); x.f.journal().close();
});
test('changed hint after pause refuses fresh preparation before point reads', { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ pause: true, change: true });
    await assert.rejects(x.stream(), /paused|changed|approved|revision/i);
    assert.equal(x.stats().localReads, 1); assert.equal(x.stats().cloudReads, 1); assert.equal(x.f.publications(), 0);
    x.f.journal().close();
});
test('interruption discards transient folder observations and resume rechecks replicas', { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ interrupt: true });
    await assert.rejects(x.stream(), /Interrupted after first folder observation/);
    x.resume(); await x.stream();
    assert.equal(x.stats().localReads, 2); assert.equal(x.stats().cloudReads, 2); assert.equal(x.f.publications(), 0);
    x.f.journal().close();
});

test('folder observation window eviction falls back to fresh reads without limiting the feed', { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ fillers: INVENTORY_PAGE_ENTRIES }); await x.stream();
    assert.equal(x.stats().localReads, 2); assert.equal(x.stats().cloudReads, 2);
    assert.equal(x.stats().contexts, INVENTORY_PAGE_ENTRIES + 3); assert.equal(x.f.publications(), 0); assert.equal(x.receipts.size, 0);
    x.f.journal().close();
});

test('account scope change cannot consume a prior folder observation', { timeout: 10000 }, async () => {
    const x = await folderEchoFixture({ scopeChange: true });
    await assert.rejects(x.stream(), /context changed|changed/i);
    assert.equal(x.stats().localReads, 1); assert.equal(x.stats().cloudReads, 1); assert.equal(x.f.publications(), 0);
    x.f.journal().close();
});

test('same-order folder feeds larger than the observation window retain complete progress and report effectiveness', { timeout: 10000 }, async context => {
    const pairs = INVENTORY_PAGE_ENTRIES + 1, x = await folderEchoFixture({ fillers: INVENTORY_PAGE_ENTRIES, echoFillers: true });
    const streamed = await x.stream(); assert.ok(streamed);
    assert.equal(x.preparedHints(), pairs * 2);
    assert.equal(x.f.publications(), 0); assert.equal(x.receipts.size, 0); assert.equal(await x.checkpoints().current(), null);
    context.diagnostic(JSON.stringify({ folderEchoWindowEffectiveness: { pairs, window: INVENTORY_PAGE_ENTRIES, guardedContexts: x.stats().contexts, scalarContexts: pairs * 2 + 1, scope: 'synthetic no-op orchestration diagnostic; not HTTP or installed throughput; poor effectiveness is reported rather than required' } }));
    x.f.journal().close();
});

// A journal-only ancestor refusal cannot become authority for a later hint.
for (const guarded of [false, true]) test(`missing ancestor defers before guarded policy work: ${guarded}`, async () => {
    const x = await fixture('Missing/child.bin');
    let contexts = 0, reads = 0;
    x.input.nativeOperationGuards = guarded ? true : undefined;
    x.input.authorizeContext = async () => { contexts++; return { network: 'wifi', charging: true }; };
    x.input.inspectLocal = async () => { reads++; throw Error('Deferred hint must not inspect'); };
    x.feeds([x.f.entry()], []);
    await x.stream();
    assert.equal(contexts, guarded ? 1 : 2);
    assert.equal(reads, 0);
    assert.equal(x.f.publications(), 0);
    assert.equal(await x.checkpoints().current(), null);
    x.f.journal().close();
});

for (const change of ['pause', 'remove', 'revision'] as const) test(`deferred ancestor cannot bypass subsequent ${change} policy`, async () => {
    const x = await fixture();
    let altered = false, reads = 0;
    const read = x.input.readConfiguration;
    x.input.nativeOperationGuards = true;
    x.input.readConfiguration = async () => {
        if (altered && change === 'remove') return null;
        const current = await read() as any;
        return altered ? { ...current, crystal: { ...current.crystal, ...(change === 'pause' ? { paused: true } : { remoteFolderId: 'changed-root' }) } } : current;
    };
    x.input.inspectLocal = async () => { reads++; throw Error('Changed policy must precede point reads'); };
    const original = x.input.journal.pagedRuns.bind(x.input.journal);
    x.input.journal = { ...x.input.journal, pagedRuns: (...args) => {
        const runs = original(...args);
        return { ...runs, appendStream: async (...values) => {
            const result = await runs.appendStream(...values);
            if (values[1].entry.path === 'Missing/hint') altered = true;
            return result;
        } };
    } };
    x.feeds([{ ...x.f.entry(), path: 'Missing/hint' }, x.f.entry()], []);
    await assert.rejects(x.stream(), /configuration|changed|approved|revision/i);
    assert.equal(reads, 0);
    assert.equal(x.f.publications(), 0);
    assert.equal(x.receipts.size, 0);
    assert.equal(await x.checkpoints().current(), null);
    x.f.journal().close();
});
