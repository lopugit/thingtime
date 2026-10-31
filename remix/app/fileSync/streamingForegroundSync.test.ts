import assert from 'node:assert/strict';
import test from 'node:test';
import { streamOneWayForegroundSync } from './streamingForegroundSync';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import type { ForegroundSyncInput } from './foregroundSync';
import { parseNativeIndexChangesPage, type NativeIndexChangesPage } from './streamingIndex';
const access = (input: ForegroundSyncInput) => ({ scope, currentScope: input.currentScope });
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};
function page(id: string, entries: NativeIndexChangesPage['changes'][number]['entry'][], after = 0, complete = false): NativeIndexChangesPage {
	const changes = structuredClone(entries).map((entry, i) => ({ sequence: after + i + 1, revision: entry.version, entry }));
	return {
		id,
		generation: id,
		state: complete ? 'complete' : 'running',
		revision: after + changes.length,
		changes,
		nextSequence: after + changes.length,
		hasMore: false
	};
}
function streaming(f: Awaited<ReturnType<typeof foregroundFixture>>): ForegroundSyncInput {
	const input: ForegroundSyncInput = f.input();
	input.inspectLocal = async (path) => structuredClone(f.local.find((row) => row.path === path) ?? null);
	input.scanLocal = async () => {
		throw Error('whole local scan');
	};
	input.inventory = async () => {
		throw Error('whole cloud scan');
	};
	return input;
}
test('a native transport batch wakes the first transfer before later bounded spool chunks persist', { timeout: 60000 }, async () => {
	const f = await foregroundFixture(300), input = streaming(f), first = deferred(), chunks: number[] = [];
	const original = input.journal.pagedRuns.bind(input.journal);
	input.journal = { ...input.journal, pagedRuns: (...args) => {
		const journal = original(...args);
		return { ...journal, appendStreamInput: async (...values) => {
			chunks.push(values[2].length);
			if (values[2][0]?.sequence === 129) { await first.promise; assert.ok(f.creates() > 0); }
			return journal.appendStreamInput(...values);
		} };
	} };
	input.transfer = () => first.resolve();
	input.streamLocalChanges = async function* (id) { yield page(id, f.local, 0, true); };
	await streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
	assert.deepEqual(chunks, [128, 128, 44]); assert.equal(f.creates(), 300); f.journal().close();
});
test('a partial batch spool resumes exactly its durable cursor after a later chunk fails', { timeout: 60000 }, async () => {
	const f = await foregroundFixture(260), input = streaming(f), original = input.journal.pagedRuns.bind(input.journal);
	input.journal = { ...input.journal, pagedRuns: (...args) => {
		const journal = original(...args);
		return { ...journal, appendStreamInput: async (...values) => {
			if (values[2][0]?.sequence === 129) throw Error('spool quota fixture');
			return journal.appendStreamInput(...values);
		} };
	} };
	input.streamLocalChanges = async function* (id) { yield page(id, f.local, 0, true); };
	await assert.rejects(streamOneWayForegroundSync(saved, scope, input, new AbortController().signal), /spool quota/);
	const runs = f.journal().pagedRuns(access(input)), active = (await runs.active())!;
	assert.equal((await runs.streamState(active.spec)).indexedSequence, 128);
	assert.equal((await runs.streamState(active.spec)).sourceTerminal, false);
	await f.reload(); const next = streaming(f);
	next.streamLocalChanges = async function* (id, after) { assert.equal(after, 128); yield page(id, f.local.slice(after), after, true); };
	await streamOneWayForegroundSync(saved, scope, next, new AbortController().signal);
	assert.equal(f.creates(), 260); f.journal().close();
});
test('first eligible mutation confirms while source is still indexing, without publishing a baseline', { timeout: 5000 }, async () => {
	const f = await foregroundFixture(2),
		input = streaming(f),
		first = deferred();
	let finished = false;
	input.streamLocalChanges = async function* (id) {
		yield page(id, [f.local[0]]);
		await first.promise;
		assert.equal(f.creates(), 1);
		assert.equal(finished, false);
		finished = true;
		yield page(id, [f.local[1]], 1, true);
	};
	input.transfer = () => first.resolve();
	await streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
	assert.equal(f.creates(), 2);
	assert.equal(await f.journal().pagedRuns(access(input)).active(), null);
	assert.equal(await f.journal().pagedCheckpoints(access(input)).current(), null);
	f.journal().close();
});
test('lost publication reply reopens with original receipt ID and durable feed cursor', { timeout: 5000 }, async () => {
	const f = await foregroundFixture(),
		input = streaming(f);
	f.lose();
	input.streamLocalChanges = async function* (id, after) {
		yield page(id, [f.local[0]], after, true);
	};
	await assert.rejects(streamOneWayForegroundSync(saved, scope, input, new AbortController().signal), /lost accepted/);
	assert.equal(f.creates(), 1);
	const active = (await f.journal().pagedRuns(access(input)).active())!;
	assert.ok(active.spec.streaming);
	await f.reload();
	const next = streaming(f);
	let offset = -1;
	next.streamLocalChanges = async function* (id, after) {
		offset = after;
		yield page(id, [], after, true);
	};
	await streamOneWayForegroundSync(saved, scope, next, new AbortController().signal);
	assert.equal(f.creates(), 1);
	assert.ok(offset === -1 || offset === 1);
	f.journal().close();
});
test('stale indexed descriptors are skipped and later revisions transfer during the same feed', { timeout: 5000 }, async () => {
	const f = await foregroundFixture(),
		input = streaming(f),
		before = structuredClone(f.local[0]);
	f.local[0].version = '2';
	input.streamLocalChanges = async function* (id) {
		yield page(id, [before]);
		yield page(id, [f.local[0]], 1, true);
	};
	await streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
	assert.equal(f.creates(), 1);
	f.journal().close();
});
test('live device revocation stops both workers and preserves the admitted stream', { timeout: 5000 }, async () => {
	const f = await foregroundFixture(2),
		input = streaming(f);
	let n = 0;
	input.authorizeDevice = async () => {
		if (++n > 3) throw Error('Device access revoked');
	};
	input.streamLocalChanges = async function* (id) {
		yield page(id, f.local, 0, true);
	};
	await assert.rejects(streamOneWayForegroundSync(saved, scope, input, new AbortController().signal), /revoked/);
	assert.equal(f.creates(), 0);
	assert.ok(await f.journal().pagedRuns(access(input)).active());
	f.journal().close();
});
test('native tail frames cannot invent completeness or skip revision sequences', async () => {
	const f = await foregroundFixture(),
		id = crypto.randomUUID(),
		p = page(id, f.local);
	assert.equal(parseNativeIndexChangesPage(p, id, 0).state, 'running');
	for (const invalid of [
		{ ...p, nextSequence: 2 },
		{ ...p, hasMore: true },
		{ ...p, changes: [{ ...p.changes[0], revision: 'wrong' }] }
	])
		assert.throws(() => parseNativeIndexChangesPage(invalid, id, 0));
	f.journal().close();
});

test(
	'file payload transfers before source completion and A to B to A publishes each revision once and retains final A bytes',
	{ timeout: 5000 },
	async () => {
		const { streamingFileFixture } = await import('./streamingFile.fixture');
		const f = await streamingFileFixture(),
			first = deferred(),
			second = deferred();
		let complete = false,
			transfers = 0;
		f.input.streamLocalChanges = async function* (id) {
			yield page(id, [f.entry()]);
			await first.promise;
			assert.equal(complete, false);
			assert.equal(f.puts(), 1);
			assert.deepEqual([...f.objects.values()][0], new Uint8Array([1, 2, 3]));
			await f.revise([4, 5, 6, 7]);
			yield page(id, [f.entry()], 1);
			await second.promise;
			await f.revise([1, 2, 3], '1');
			yield page(id, [f.entry()], 2);
			complete = true;
			yield page(id, [f.entry()], 3, true);
		};
		f.input.transfer = (value) => {
			if ('kind' in value && value.kind === 'file') {
				if (++transfers === 1) first.resolve();
				else second.resolve();
			}
		};
		await streamOneWayForegroundSync(saved, scope, f.input, new AbortController().signal);
		assert.equal(f.publications(), 3);
		assert.equal(f.puts(), 3);
		assert.equal(f.files.size, 1);
		const live = [...f.files.values()][0];
		assert.deepEqual(f.objects.get(live.content.attachmentId), new Uint8Array([1, 2, 3]));
		f.journal().close();
	}
);

test(
	'only a never-started structurally initial upload migrates; source evidence remains and running receipt IDs are preserved',
	{ timeout: 5000 },
	async () => {
		const { runPagedForegroundCloudSync } = await import('./pagedForegroundSync');
		const f = await foregroundFixture(),
			input: ForegroundSyncInput = f.input();
		input.progress = (value) => {
			if (value.preparation?.phase === 'operations') throw Error('stop before execution');
		};
		await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal), /stop before/);
		const runs = f.journal().pagedRuns(access(input)),
			old = (await runs.active())!;
		assert.equal(old.progress.phase, 'preparing');
		assert.equal(f.creates(), 0);
		assert.equal(await runs.retireUnstartedInitialUpload(old.spec, saved.configuration), true);
		assert.equal(await runs.active(), null);
		assert.equal((await f.journal().inventory(access(input)).read(old.spec.plan.local)).entries.length, 1);
		f.journal().close();
		const uncertain = await foregroundFixture(),
			other: ForegroundSyncInput = uncertain.input();
		uncertain.lose();
		await assert.rejects(runPagedForegroundCloudSync(saved, scope, other, new AbortController().signal), /lost accepted/);
		const uncertainRuns = uncertain.journal().pagedRuns(access(other)),
			pending = (await uncertainRuns.active())!;
		assert.equal(pending.progress.phase, 'running');
		assert.equal(await uncertainRuns.retireUnstartedInitialUpload(pending.spec, saved.configuration), false);
		assert.equal((await uncertainRuns.active())!.spec.id, pending.spec.id);
		uncertain.journal().close();
	}
);

test('download bytes publish while cloud inventory is still producing pages and do not scan the local tree', { timeout: 5000 }, async () => {
	const { streamingFileFixture } = await import('./streamingFile.fixture');
	const f = await streamingFileFixture(),
		published = deferred();
	const download = { ...saved, configuration: { ...saved.configuration, mode: 'download' as const } },
		entry = f.entry();
	const file = {
		id: crypto.randomUUID(),
		revision: 'remote-1',
		name: entry.path,
		folderId: 'cloud-root',
		trashed: false,
		content: { attachmentId: 'remote-original', version: 'a'.repeat(64), size: entry.size, fingerprint: entry.fingerprint! }
	};
	f.files.set(file.id, file);
	f.objects.set('remote-original', new Uint8Array([1, 2, 3]));
	const local = new Map<string, import('./reconcile').SyncEntry>(),
		receipts = new Map<string, import('./execute').SyncReceipt>();
	let finished = false;
	const read = f.input.readConfiguration;
	f.input.readConfiguration = async () => ({ ...((await read()) as object), crystal: download.configuration });
	f.input.inspectLocal = async (path) => local.get(path) ?? null;
	f.input.scanLocal = async () => {
		throw Error('must not wait for local inventory');
	};
	f.input.streamCloudChanges = true;
	f.input.localTarget = {
		lookup: async (op) => (receipts.has(op.id) ? { status: 'complete', receipt: receipts.get(op.id)! } : { status: 'missing' }),
		stage: async (op, binding, source) => {
			assert.equal(op.mutation.kind, 'copy');
			const bytes = await source!.read(0, source!.size);
			assert.deepEqual(bytes, new Uint8Array([1, 2, 3]));
			return { operationId: op.id, scope: binding, token: op.id, entry: { ...entry, id: 'staged', version: 'staged' } };
		},
		publish: async (op, binding, stage) => {
			assert.equal(finished, false);
			local.set(stage.entry.path, stage.entry);
			const receipt = { operationId: op.id, scope: binding, entry: stage.entry };
			receipts.set(op.id, receipt);
			published.resolve();
			return receipt;
		}
	};
	f.input.inventoryPages = async function* () {
		yield {
			version: 1,
			generation: 'cloud-capture',
			ordinal: 0,
			rootId: 'cloud-root',
			rootRevision: 'root',
			nodes: [{ kind: 'file', path: entry.path, file }]
		};
		await published.promise;
		finished = true;
		yield { version: 1, generation: 'cloud-capture', ordinal: 1, rootId: 'cloud-root', rootRevision: 'root', nodes: [], totalEntries: 1 };
	};
	await streamOneWayForegroundSync(download, scope, f.input, new AbortController().signal);
	assert.equal(local.size, 1);
	assert.equal(receipts.size, 1);
	assert.equal(f.puts(), 0);
	f.journal().close();
});

test(
	'a blocked download does not hold the cloud snapshot open: all source pages spool durably before transfers drain',
	{ timeout: 30000 },
	async () => {
		const f = await foregroundFixture(129),
			input: ForegroundSyncInput = f.input(),
			spooled = deferred(),
			release = deferred();
		const download = { ...saved, configuration: { ...saved.configuration, mode: 'download' as const } },
			read = input.readConfiguration;
		input.readConfiguration = async () => ({ ...((await read()) as object), crystal: download.configuration });
		for (const row of f.local) f.rows.set(row.id, { id: row.id, name: row.path, revision: 'remote', folderId: 'cloud-root' });
		const local = new Map<string, import('./reconcile').SyncEntry>();
		input.inspectLocal = async (path) => local.get(path) ?? null;
		input.scanLocal = async () => {
			throw Error('local full scan must not gate download');
		};
		input.streamCloudChanges = true;
		let snapshotClosed = false,
			first = true;
		input.inventoryPages = async function* () {
			try {
				for (let offset = 0; offset < f.local.length; offset += 128) {
					yield {
						version: 1,
						generation: 'snapshot',
						ordinal: offset / 128,
						rootId: 'cloud-root',
						rootRevision: 'root',
						nodes: f.local
							.slice(offset, offset + 128)
							.map((row) => ({ kind: 'folder' as const, path: row.path, id: row.id, revision: 'remote', folderId: 'cloud-root' })),
						...(offset + 128 >= f.local.length ? { totalEntries: f.local.length } : {})
					};
				}
			} finally {
				snapshotClosed = true;
			}
		};
		input.progress = (value) => {
			if (value.indexed === f.local.length) spooled.resolve();
		};
		input.localTarget = {
			lookup: async () => ({ status: 'missing' }),
			stage: async (op, binding) => {
				assert.equal(op.mutation.kind, 'copy');
				if (op.mutation.kind !== 'copy') throw Error('copy');
				return { operationId: op.id, scope: binding, token: op.id, entry: { ...op.mutation.source, id: op.id, version: 'staged' } };
			},
			publish: async (op, binding, stage) => {
				if (first) {
					first = false;
					await release.promise;
				}
				local.set(stage.entry.path, stage.entry);
				return { operationId: op.id, scope: binding, entry: stage.entry };
			}
		};
		const running = streamOneWayForegroundSync(download, scope, input, new AbortController().signal);
		await spooled.promise;
		const runs = f.journal().pagedRuns(access(input)),
			active = (await runs.active())!,
			status = await runs.streamState(active.spec);
		assert.equal(status.indexedSequence, 129);
		assert.equal(status.sourceTerminal, true);
		assert.equal(active.progress.confirmed, 0);
		assert.ok(status.sequence < 129);
		// The transport generator is closed on terminal import, independently of the held publication.
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(snapshotClosed, true);
		release.resolve();
		await running;
		assert.equal(local.size, 129);
		f.journal().close();
	}
);

test('live cloud download transfers updates and new paths during traversal, then ignores a stale snapshot row', { timeout: 10000 }, async () => {
	const { streamingFileFixture } = await import('./streamingFile.fixture');
	const { readCloudIndexChanges } = await import('./cloudIndexChanges.client');
	const { cloudFileSyncEntry } = await import('./cloudFile');
	const f = await streamingFileFixture(),
		firstPublished = deferred(),
		updatesPublished = deferred();
	const download = { ...saved, configuration: { ...saved.configuration, mode: 'download' as const } };
	const original = {
		id: crypto.randomUUID(),
		revision: 'remote-1',
		name: 'first.bin',
		folderId: 'cloud-root',
		trashed: false,
		content: { attachmentId: 'original', version: 'a'.repeat(64), size: 3, fingerprint: f.entry().fingerprint! }
	};
	f.files.set(original.id, original);
	f.objects.set('original', new Uint8Array([1, 2, 3]));
	await f.revise([4, 5, 6]);
	const revised = {
		...original,
		revision: 'remote-2',
		content: { ...original.content, attachmentId: 'revised', fingerprint: f.entry().fingerprint! }
	};
	const added = { ...revised, id: crypto.randomUUID(), name: 'new.bin', content: { ...revised.content, attachmentId: 'new' } };
	f.objects.set('revised', new Uint8Array([4, 5, 6]));
	f.objects.set('new', new Uint8Array([4, 5, 6]));
	const local = new Map<string, import('./reconcile').SyncEntry>(),
		receipts = new Map<string, import('./execute').SyncReceipt>();
	const published: [string, number[]][] = [],
		staged = new Map<string, Uint8Array>();
	let snapshotFinished = false;
	const read = f.input.readConfiguration;
	f.input.readConfiguration = async () => ({ ...((await read()) as object), crystal: download.configuration });
	f.input.inspectLocal = async (path) => local.get(path) ?? null;
	f.input.localTarget = {
		lookup: async (op) => (receipts.has(op.id) ? { status: 'complete', receipt: receipts.get(op.id)! } : { status: 'missing' }),
		stage: async (op, binding, source) => {
			if (op.mutation.kind !== 'copy') throw Error('copy');
			staged.set(op.id, await source!.read(0, source!.size));
			return { operationId: op.id, scope: binding, token: op.id, entry: { ...op.mutation.source, id: 'local-' + op.id, version: 'local-' + op.id } };
		},
		publish: async (op, binding, stage) => {
			assert.equal(snapshotFinished, false);
			published.push([stage.entry.path, [...staged.get(op.id)!]]);
			local.set(stage.entry.path, stage.entry);
			const receipt = { operationId: op.id, scope: binding, entry: stage.entry };
			receipts.set(op.id, receipt);
			if (published.length === 1) {
				f.files.set(revised.id, revised);
				f.files.set(added.id, added);
				firstPublished.resolve();
			}
			if (published.length === 3) updatesPublished.resolve();
			return receipt;
		}
	};
	const runtime = {
		...f.input.runtime,
		fetch: async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const url = new URL(String(target));
			if (!url.searchParams.has('changes')) return f.input.runtime.fetch(target, init);
			const after = url.searchParams.get('after');
			if (after === '10') await firstPublished.promise;
			if (after === '12') await updatesPublished.promise;
			return Response.json({
				ok: true,
				feed: {
					version: 1,
					rootId: 'cloud-root',
					rootRevision: 'root',
					cursor: after === null ? 10 : 12,
					changes:
						after === '10'
							? [
									{ position: 11, entry: cloudFileSyncEntry(revised, revised.name), subtree: null },
									{ position: 12, entry: cloudFileSyncEntry(added, added.name), subtree: null }
							  ]
							: [],
					hasMore: false
				}
			});
		}
	};
	f.input.streamRemoteChanges = (id, after, signal, ready, resume) =>
		readCloudIndexChanges(
			scope,
			'cloud-root',
			{
				...runtime,
				signal,
				snapshot: async function* () {
					yield {
						version: 1,
						generation: 'snapshot',
						ordinal: 0,
						rootId: 'cloud-root',
						rootRevision: 'root',
						nodes: [{ kind: 'file', path: original.name, file: original }]
					};
					await updatesPublished.promise;
					yield {
						version: 1,
						generation: 'snapshot',
						ordinal: 1,
						rootId: 'cloud-root',
						rootRevision: 'root',
						nodes: [{ kind: 'file', path: original.name, file: original }],
						totalEntries: 2
					};
					snapshotFinished = true;
				}
			},
			id,
			after,
			ready!,
			resume!
		);
	const completed = await streamOneWayForegroundSync(download, scope, f.input, new AbortController().signal);
	assert.deepEqual(published, [
		['first.bin', [1, 2, 3]],
		['first.bin', [4, 5, 6]],
		['new.bin', [4, 5, 6]]
	]);
	assert.equal(receipts.size, 3);
	assert.ok(completed);
	const retained = await f.journal().pagedRuns(access(f.input)).streamEntries(completed);
	assert.equal(retained.entries.find((row) => row.path === 'first.bin')?.version, 'remote-2');
	f.journal().close();
});
