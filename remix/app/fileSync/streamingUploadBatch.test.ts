import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { streamOneWayForegroundSync } from './streamingForegroundSync';
import { createFileBatchService } from '../api/utils/files/batches';
import { attachmentIdForRequest } from '../api/utils/attachments/attachments';
import type { ForegroundSyncInput } from './foregroundSync';
import type { SyncEntry } from './reconcile';
import type { NativeUploadBatch, UploadBatchContent } from './uploadBatch';

const seed = JSON.parse(readFileSync(new URL('./fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0].descriptor.members[0].write
	.operation.mutation.source;
const payload = new Uint8Array([1, 2, 3, 4]),
	raw = createHash('sha256').update(payload).digest('hex');
seed.fingerprint.sha256 = createHash('sha256').update(Buffer.from(raw, 'hex')).digest('hex');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => (resolve = r));
	return { promise, resolve };
};

async function run(count: number, bulk: boolean, firstBeforeCompletion = false, nested = false) {
	const f = await foregroundFixture(),
		controller = new AbortController(),
		timer = setTimeout(() => controller.abort(Error('Isolated streaming batch test deadline')), 30000),
		firstCommit = deferred(),
		allPrepared = deferred();
	const entries: SyncEntry[] = Array.from({ length: count }, (_, i) => ({
		...structuredClone(seed),
		path: `${nested ? 'Parent/' : ''}f${i}`,
		id: `inode-${i}`
	}));
	const wait = (promise: Promise<void>, signal = controller.signal) => {
		if (signal.aborted) throw signal.reason;
		return Promise.race([promise, new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
	};
	const local = new Map(entries.map((e) => [e.path, e])),
		files = new Map<string, any>(),
		uploads = new Map<string, any>(),
		ready = new Set<string>();
	let sourceComplete = false,
		first = true,
		activePut = 0;
	const counts = { native: 0, contexts: 0, inspections: 0, bulkCalls: 0, cloud: 0, observes: 0, puts: 0, maxPut: 0, confirmed: 0 };
	const native = async () => {
		counts.native++;
		await delay(5);
	};
	const content = (uploadId: string) => ({ uploadId, version: 'b'.repeat(64), size: 4, fingerprint: seed.fingerprint });
	const commit = async (body: any) => {
		const old = files.get(body.id);
		if (old) return { ok: true as const, file: old, replayed: true };
		const file = {
			id: body.id,
			revision: 'r1',
			name: body.name,
			folderId: body.folderId,
			trashed: false,
			content: { attachmentId: body.attachmentId, version: body.contentVersion, size: 4, fingerprint: seed.fingerprint }
		};
		files.set(body.id, file);
		counts.confirmed++;
		firstCommit.resolve();
		return { ok: true as const, file, replayed: false };
	};
	const parent = { kind: 'folder' as const, path: 'Parent', id: 'cloud-parent', revision: 'r1', folderId: 'cloud-root' };
	const service = createFileBatchService({
		authorize: async () => {},
		charge: async () => true,
		observe: async (_owner, _root, paths) => ({
			ok: true,
			version: 1,
			observations: paths.map((path) => ({
				path,
				node: path === 'Parent' && nested ? parent : null,
				parent: path.includes('/') && nested ? parent : null
			}))
		}),
		ownedUpload: async () => null,
		start: async (_owner, input: any) => {
			const id = attachmentIdForRequest(scope.ownerId, input.requestId);
			uploads.set(id, input);
			return { ok: true, upload: { id, partSizeBytes: 8388608, partCount: 1 } };
		},
		sign: async (_owner, input: any) => ({
			ok: true,
			parts: [
				{
					partNumber: 1,
					url: `https://storage.test/${input.uploadId}`,
					expiresAt: '2026-10-22T00:00:00.000Z',
					headers: { 'x-amz-checksum-sha256': input.parts[0].checksumSha256 }
				}
			]
		}),
		complete: async (_owner, input: any) => {
			ready.add(input.uploadId);
			return { ok: true, attachment: {} };
		},
		fingerprint: async (_viewer, id: any) => (ready.has(id) ? { ok: true, id, ...content(id) } : { ok: false, status: 404, error: 'Not ready' }),
		files: {
			readReceipts: async (_owner: string, rows: any[]) => ({
				ok: true,
				receipts: rows.map((r) => (files.has(r.id) ? { file: files.get(r.id) } : null))
			}),
			read: async (_owner: string, id: string) => ({ ok: true, receipt: files.has(id) ? { file: files.get(id) } : null }),
			commit: async (_owner: string, body: any) => commit(body)
		} as any
	});
	const api = async (body: any) => {
		counts.cloud++;
		if (body.phase === 'observe') counts.observes++;
		await delay(2);
		const result = await service(scope.ownerId, scope.origin, body, controller.signal);
		assert.equal(result.ok, true, JSON.stringify(result));
		return result as any;
	};
	const nativeBatch: NativeUploadBatch = async (input, _callbacks, signal) => {
		counts.bulkCalls++;
		await native();
		if (firstBeforeCompletion) assert.equal(sourceComplete, false);
		const probe = await api({ phase: 'prepare', ...input, checksums: [] });
		if (first && !firstBeforeCompletion) {
			first = false;
			await wait(allPrepared.promise, signal);
		}
		const checksums = probe.results.filter((r: any) => r.status === 'source-required').map((r: any) => ({ ordinal: r.ordinal, sha256: raw }));
		const prepared = await api({ phase: 'prepare', ...input, checksums });
		const pending = prepared.results.filter((r: any) => r.status === 'prepared');
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(16, pending.length) }, async () => {
				for (;;) {
					const i = next++;
					if (i === pending.length || i > pending.length) return;
					activePut++;
					counts.maxPut = Math.max(counts.maxPut, activePut);
					counts.puts++;
					await delay(2);
					activePut--;
				}
			})
		);
		const verified = await api({ phase: 'verify', ...input, uploads: pending.map((r: any) => ({ ordinal: r.ordinal, uploadId: r.upload.id })) });
		return {
			...verified,
			results: input.descriptor.members.map(
				({ ordinal }) => verified.results.find((r: any) => r.ordinal === ordinal) ?? prepared.results[ordinal] ?? probe.results[ordinal]
			),
			payloads: input.descriptor.members.map(({ ordinal }) => ({ ordinal, bytes: pending.some((r: any) => r.ordinal === ordinal) ? 4 : 0 }))
		};
	};
	const base = f.input();
	const input: ForegroundSyncInput = {
		...base,
		nativeOperationGuards: true,
		authorizeContext: async () => {
			counts.contexts++;
			await native();
			return { network: 'wifi', charging: true };
		},
		inspectLocal: async (path) => {
			counts.inspections++;
			await native();
			return local.get(path) ?? null;
		},
		...(bulk ? { uploadBatch: nativeBatch } : {}),
		source: async (entry) => ({
			size: entry.size,
			nativePartSourceChecks: true,
			nativePartPayloadBytes: true,
			check: native,
			verify: native,
			read: async () => {
				throw Error('Native part path expected');
			},
			uploadPart: async () => {
				await native();
				await native();
				counts.puts++;
				await delay(2);
				await native();
				return { sha256: raw, payloadBytes: 4 };
			}
		}),
		progress: (progress) => {
			if (progress.total === count) allPrepared.resolve();
		},
		streamLocalChanges: async function* (id, _after, signal) {
			if (firstBeforeCompletion) {
				yield {
					id,
					generation: id,
					state: 'running',
					revision: 1,
					nextSequence: 1,
					hasMore: false,
					changes: [{ sequence: 1, revision: entries[0].version, entry: entries[0] }]
				};
				await wait(firstCommit.promise, signal);
				sourceComplete = true;
				yield { id, generation: id, state: 'complete', revision: 1, nextSequence: 1, hasMore: false, changes: [] };
			} else {
				sourceComplete = true;
				yield {
					id,
					generation: id,
					state: 'complete',
					revision: count,
					nextSequence: count,
					hasMore: false,
					changes: entries.map((entry, i) => ({ sequence: i + 1, revision: entry.version, entry }))
				};
			}
		},
		runtime: {
			...base.runtime,
			fetch: async (url, init) => {
				const target = new URL(String(url)),
					body = init?.body ? JSON.parse(String(init.body)) : undefined;
				if (target.pathname === '/api/v1/files/batches') return Response.json(await api(body));
				counts.cloud++;
				await delay(2);
				if (target.pathname === '/api/v1/files') {
					if (body) return Response.json(await commit(body));
					if (target.searchParams.has('rootId'))
						return Response.json({
							ok: true,
							observation: {
								version: 1,
								complete: true,
								rootId: 'cloud-root',
								rootRevision: 'r1',
								path: target.searchParams.get('path'),
								entry:
									nested && target.searchParams.get('path') === 'Parent'
										? { path: 'Parent', kind: 'folder', id: 'cloud-parent', version: 'r1', size: 0, sha256: null }
										: null
							}
						});
					const id = target.searchParams.get('id')!;
					if (target.searchParams.has('operationId')) return Response.json({ ok: true, receipt: files.has(id) ? { file: files.get(id) } : null });
					return files.has(id) ? Response.json({ ok: true, file: files.get(id) }) : Response.json({ ok: false }, { status: 404 });
				}
				if (target.pathname.endsWith('/uploads')) {
					const id = attachmentIdForRequest(scope.ownerId, body.requestId);
					uploads.set(id, body);
					return Response.json({ ok: true, upload: { id, partSizeBytes: 8388608, partCount: 1 } });
				}
				if (target.pathname.endsWith('/complete')) return Response.json({ ok: true });
				if (target.pathname.endsWith('/content')) {
					const id = target.searchParams.get('id')!;
					return Response.json({ ok: true, id, ...content(id) });
				}
				throw Error('Unexpected isolated route');
			}
		}
	};
	const started = performance.now();
	try {
		await streamOneWayForegroundSync(saved, scope, input, controller.signal);
	} finally {
		clearTimeout(timer);
		writeFileSync('/tmp/batch-stream-debug.json', JSON.stringify(counts));
		f.journal().close();
	}
	assert.equal(files.size, count);
	assert.equal(counts.confirmed, count);
	assert.equal(counts.puts, count);
	return { ...counts, elapsedMs: performance.now() - started };
}

test('bulk first eligible file confirms before source completion without preparatory native inspect', async () => {
	const result = await run(1, true, true);
	assert.equal(result.bulkCalls, 1);
	assert.equal(result.inspections, 0);
	assert.equal(result.observes, 1);
});

test('complete256file streaming path prepares while first batch is held and uses bounded metadata and payload batches', async () => {
	const result = await run(256, true);
	assert.equal(result.bulkCalls, 2);
	assert.equal(result.inspections, 0);
	assert.ok(result.maxPut <= 16);
	assert.ok(result.observes <= 4);
	writeFileSync(
		'/tmp/sync-small-file-batch-streaming-proof.json',
		JSON.stringify({ scope: 'real planner/journal/consumer/backend batch service; synthetic native, auth and storage', result }, null, 2)
	);
});

test('controlled complete-file comparison removes per-file native and metadata amplification', async () => {
	const before = await run(32, false, false, true),
		after = await run(32, true, false, true);
	assert.equal(before.inspections, 64);
	assert.equal(after.inspections, 0);
	assert.ok(after.native < before.native / 10);
	assert.ok(after.cloud < before.cloud / 5);
	assert.ok(after.elapsedMs < before.elapsedMs / 2, 'controlled5ms native /2ms API delays should produce a material complete-path reduction');
	writeFileSync(
		'/tmp/sync-small-file-batch-controlled-proof.json',
		JSON.stringify(
			{ scope: 'controlled real streaming planner/journal/executor and batch service; synthetic IO5ms native/2msAPI', before, after },
			null,
			2
		)
	);
});
