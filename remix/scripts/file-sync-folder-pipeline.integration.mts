/** Whole planner/journal/consumer comparison with real isolated Mongo canonical
 * folder/file writes. Native/auth account and S3 provider IO are synthetic,
 * fixed-identical schedules. This is not installed throughput acceptance. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, symlink, realpath, stat } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const directory = process.env.THINGTIME_FILE_SYNC_FOLDER_BATCHES_TEST_DIRECTORY;
assert.ok(
	directory && /^mongodb:\/\/127\.0\.0\.1:28168\/thingtime\?replicaSet=file-sync-folder-batches$/.test(process.env.MONGODB_CONNECTION_STRING || '')
);
const actual = await realpath(directory!);
assert.equal(dirname(actual), await realpath(tmpdir()));
assert.ok(basename(actual).startsWith('thingtime-file-sync-folder-batches-'));
assert.equal((await stat(actual)).mode & 0o077, 0);
const origin = 'http://127.0.0.1:28168';
process.env.APP_URL = origin;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.NODE_ENV = 'test';
const { action: register } = await import('../app/routes/api/v1/auth/register/_register');
const registered = await register({
	request: new Request(origin + '/api/v1/auth/register', {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username: 'pipeline-' + randomUUID().slice(0, 8),
			email: randomUUID() + '@example.invalid',
			password: randomUUID() + '-Fixture!'
		})
	})
} as any);
assert.equal(registered.status, 200);
const owner = (await registered.json()).user.id;
const { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } = await import('../app/api/utils/mongodb/collections');
const { createThing } = await import('../app/api/utils/things/things');
const { cloudFolders, createCloudFolderService } = await import('../app/api/utils/files/folders');
const { createCloudFileService } = await import('../app/api/utils/files/files');
const { createFolderBatchService } = await import('../app/api/utils/files/folderBatches');
const { createFileBatchService } = await import('../app/api/utils/files/batches');
const { readCloudPath } = await import('../app/api/utils/files/inventory');
const { attachmentIdForRequest } = await import('../app/api/utils/attachments/attachments');
const { attachmentContentVersion } = await import('../app/api/utils/attachments/contentFingerprint');
const { thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } = await import('../app/api/utils/storage/storageCore');
const { COLLECTION_SCHEMA_VERSIONS } = await import('../app/schemas/registry');
const { applyUserStorageDelta } = await import('../app/api/utils/storage/userStorage');
const { streamOneWayForegroundSync } = await import('../app/fileSync/streamingForegroundSync');
const { foregroundFixture } = await import('../app/fileSync/foregroundSync.fixture');
const { sameSyncStamp } = await import('../app/fileSync/reconcile');
const { newFileSyncConfiguration } = await import('../app/fileSync/configuration');
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const source = JSON.parse(await readFile(new URL('../app/fileSync/fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0]
	.descriptor.members[0].write.operation.mutation.source;
const raw = createHash('sha256')
	.update(new Uint8Array([1, 2, 3, 4]))
	.digest('hex');
source.fingerprint.sha256 = createHash('sha256').update(Buffer.from(raw, 'hex')).digest('hex');
const things = await getHomeThingsCollection();
// Read the exact baseline from Git into owned disposable scratch, never change
// checkout files. Reuse dependency binaries and canonical current server only.
const baselineRoot = join(actual, 'baseline');
await mkdir(baselineRoot);
const archive = execFileSync('git', ['archive', '84c3b9865c6905a88b40365fdba7517580aa3281', 'remix/app/fileSync'], {
	cwd: resolve(import.meta.dirname, '../..'),
	maxBuffer: 20 * 1024 * 1024
});
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', baselineRoot], { input: archive });
for (const name of ['api', 'docs', 'utils', 'timeline', 'schemas', 'types', 'hooks', 'components', 'lib', 'tests'])
	await symlink(resolve(import.meta.dirname, '../app', name), join(baselineRoot, 'remix/app', name));
await symlink(resolve(import.meta.dirname, '../node_modules'), join(baselineRoot, 'remix/node_modules'));
const baseline = await import(pathToFileURL(join(baselineRoot, 'remix/app/fileSync/streamingForegroundSync.ts')).href);
const baselineFixture = await import(pathToFileURL(join(baselineRoot, 'remix/app/fileSync/foregroundSync.fixture.ts')).href);
async function run(candidate: boolean) {
	const f = await (candidate ? foregroundFixture() : baselineFixture.foregroundFixture()),
		rootId = randomUUID(),
		deviceId = randomUUID(),
		configurationId = randomUUID(),
		date = new Date();
	assert.equal(
		(await createThing(owner, { shareId: rootId, thingtime: ['folder'], crystal: { name: 'PipelineRoot' }, acl: ['tt:user'] }, { id: owner }, null))
			.ok,
		true
	);
	const configuration = {
		...newFileSyncConfiguration({ name: 'Pipeline', deviceId, localRootId: 'native-root', remoteFolderId: rootId }),
		mode: 'backup' as const,
		paused: false
	};
	await things.insertMany([
		{ shareId: configurationId, ownerId: owner, thingtime: ['file-sync'], acl: ['tt:user'], updatedAt: date, crystal: configuration },
		{ shareId: deviceId, ownerId: owner, thingtime: ['device'], updatedAt: date, crystal: {} }
	] as any);
	await (
		await getSessionsCollection()
	).insertOne({
		jti: randomUUID(),
		userId: owner,
		purpose: 'device',
		meta: { deviceId, deviceCredentialHash: createHash('sha256').update(randomUUID()).digest('hex') },
		revokedAt: null,
		expiresAt: new Date(Date.now() + 600000)
	} as any);
	const scope = { origin, ownerId: owner, dataPlane: 'home', rootId: configurationId, deviceId },
		saved = { id: configurationId, updatedAt: date.toISOString(), configuration };
	const dirs = ['Root'];
	for (let i = 1; i < 8; i++) dirs.push(dirs.at(-1)! + '/d' + i);
	for (let i = 0; i < 109; i++) dirs.push(dirs[7] + '/s' + String(i).padStart(3, '0'));
	const folders = dirs.map((path, i) => ({ path, id: 'folder-inode-' + i, version: 'v1', kind: 'folder', size: 0, sha256: null }));
	const files = Array.from({ length: 395 }, (_, i) => ({
		...structuredClone(source),
		path: i === 0 ? 'Root/first.txt' : dirs[8 + ((i - 1) % 109)] + '/f' + i,
		id: 'file-inode-' + i
	}));
	const entries = [folders[0], files[0], ...folders.slice(1), ...files.slice(1)],
		local = new Map(entries.map((e) => [e.path, e]));
	assert.equal(entries.length, 512);
	const intervals: { phase: string; start: number; end: number }[] = [];
	const timed = async <T,>(phase: string, work: () => Promise<T>): Promise<T> => {
		const start = performance.now();
		try {
			return await work();
		} finally {
			assert.ok(intervals.length < 20000, 'bounded timing fixture');
			intervals.push({ phase, start, end: performance.now() });
		}
	};
	const wrapLocal = (target: any): any =>
		new Proxy(target, {
			get(object, property) {
				const value = object[property];
				if (typeof value !== 'function') return value;
				if (['pagedRuns', 'inventory', 'pagedCheckpoints', 'priorities', 'plans', 'jobs', 'reviewDrafts', 'maintenance'].includes(String(property)))
					return (...args: any[]) => wrapLocal(value.apply(object, args));
				if (property === 'close') return value.bind(object);
				return (...args: any[]) => timed('journal', () => Promise.resolve(value.apply(object, args)));
			}
		});
	const controller = new AbortController(),
		timer = setTimeout(() => controller.abort(Error('Whole pipeline deadline')), 150000);
	const counts = {
		native: 0,
		contexts: 0,
		inspect: 0,
		cloud: 0,
		observe: 0,
		folderBatches: [] as number[],
		fileBatches: [] as number[],
		puts: 0,
		files: 0,
		folders: 0
	};
	let indexedComplete = false,
		firstFileBeforeIndex = false,
		resolveFirst!: () => void;
	const firstFile = new Promise<void>((r) => (resolveFirst = r));
	const native = async () => {
		counts.native++;
		await timed('native', async () => {
			await delay(5);
			controller.signal.throwIfAborted();
		});
	};
	const uploads = new Map<string, any>();
	const content = async (id: string) => {
		const doc = await things.findOne({ shareId: id, ownerId: owner });
		assert.ok(doc?.objectVersionId);
		return {
			ok: true as const,
			id,
			uploadId: id,
			version: attachmentContentVersion(id, doc.objectKey, doc.objectVersionId),
			size: 4,
			fingerprint: source.fingerprint
		};
	};
	const fingerprint = async (_viewer: any, id: any) =>
		(await things.findOne({ shareId: String(id), ownerId: owner })) ? content(String(id)) : { ok: false as const, status: 404, error: 'Not ready' };
	const canonicalFiles = createCloudFileService({
		fingerprint,
		transaction: (work) => timed('mongo:file-write', () => withHomeMongoTransaction(work))
	});
	const cloudFiles = {
		...canonicalFiles,
		commit: (...args: Parameters<typeof canonicalFiles.commit>) => timed('canonical:file-commit', () => canonicalFiles.commit(...args))
	};
	const canonicalFolders = createCloudFolderService({ transaction: (work) => timed('mongo:folder-write', () => withHomeMongoTransaction(work)) });
	const folderService = createFolderBatchService({ folders: canonicalFolders });
	const complete = async (_owner: any, input: any) => {
		if (!(await things.findOne({ shareId: input.uploadId }))) {
			const doc: any = {
				shareId: input.uploadId,
				ownerId: owner,
				thingtime: ['attachment'],
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
				crystal: { name: 'fixture.bin', size: 4, contentType: 'application/octet-stream', mediaKind: 'file' },
				extended: null,
				tags: [],
				acl: ['tt:user'],
				attachmentState: 'ready',
				attachmentPurpose: 'file',
				attachmentEnvelopeVersion: 1,
				objectKey: 'objects/' + input.uploadId,
				objectVersionId: 'version-' + input.uploadId,
				objectSizeBytes: 4,
				storageClass: 'content',
				storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
				createdAt: date,
				updatedAt: date
			};
			doc.sizeBytes = thingStorageSizeBytes(doc);
			await timed('provider:staged-metadata', () =>
				withHomeMongoTransaction(async (session) => {
					await applyUserStorageDelta(owner, doc.sizeBytes, session);
					await things.insertOne(doc, { session });
				})
			);
		}
		return { ok: true as const, attachment: {} as any };
	};
	const start = async (_owner: any, input: any) => {
		const id = attachmentIdForRequest(owner, input.requestId);
		uploads.set(id, input);
		return { ok: true as const, upload: { id, partSizeBytes: 8388608, partCount: 1 } as any };
	};
	const sign = async (_owner: any, input: any) => ({
		ok: true as const,
		parts: [
			{
				partNumber: 1,
				url: 'https://provider.invalid/' + input.uploadId,
				expiresAt: new Date(Date.now() + 60000).toISOString(),
				headers: { 'x-amz-checksum-sha256': input.parts[0].checksumSha256 }
			}
		]
	});
	const service = createFileBatchService({
		start,
		sign,
		complete,
		fingerprint,
		ownedUpload: async () => null,
		files: cloudFiles,
		folder: folderService
	});
	const api = async (body: any) => {
		counts.cloud++;
		if (body.phase === 'observe') counts.observe++;
		const r = await timed('control', async () => {
			await delay(2);
			return timed('server:' + body.phase, () => service(owner, origin, body, controller.signal));
		});
		assert.equal(r.ok, true, JSON.stringify(r));
		return r as any;
	};
	const uploaded = () => {
		counts.files++;
		if (!indexedComplete) firstFileBeforeIndex = true;
		resolveFirst();
	};
	const runtime = {
		currentScope: () => scope,
		origin: () => origin,
		requireCapability: async () => {},
		fetch: async (url: any, init: any = {}) => {
			const u = new URL(String(url));
			assert.equal(u.origin, origin);
			const body = init.body ? JSON.parse(String(init.body)) : undefined;
			if (u.pathname === '/api/v1/files/batches') {
				const r = await api(body);
				if (body.phase === 'commit') for (const result of r.results) if (result.status === 'confirmed' && !result.replayed) uploaded();
				if (body.phase === 'folder-commit') counts.folders += r.results.filter((r: any) => r.status === 'confirmed' && !r.replayed).length;
				return Response.json(r);
			}
			counts.cloud++;
			return timed('control', async () => {
				await delay(2);
				let r: any;
				if (u.pathname === '/api/v1/files' && (body?.kind === 'folder' || u.searchParams.has('folderId'))) {
					if (body) {
						r = await timed('canonical:folder-scalar', () => canonicalFolders.create(owner, body));
						if (r.ok && !r.replayed) counts.folders++;
					} else
						r = await timed('server:read', () =>
							canonicalFolders.read(owner, u.searchParams.get('folderId'), u.searchParams.get('operationId') ?? undefined)
						);
				} else if (u.pathname === '/api/v1/files') {
					if (body) {
						r = await cloudFiles.commit(owner, body);
						if (r.ok && !r.replayed) uploaded();
					} else if (u.searchParams.has('rootId'))
						r = await timed('server:path', () => readCloudPath(owner, rootId, u.searchParams.get('path'), controller.signal));
					else r = await cloudFiles.read(owner, u.searchParams.get('id'), u.searchParams.get('operationId') ?? undefined);
				} else if (u.pathname.endsWith('/uploads')) r = await start(owner, body);
				else if (u.pathname.endsWith('/complete')) r = await complete(owner, body);
				else if (u.pathname.endsWith('/content')) r = await content(u.searchParams.get('id')!);
				else throw Error('Unexpected pipeline route');
				return Response.json(r, { status: r.ok ? 200 : r.status });
			});
		}
	};
	const nativeUpload = async (input: any) => {
		counts.fileBatches.push(input.descriptor.members.length);
		await native();
		const probe = await api({ phase: 'prepare', ...input, checksums: [] });
		const prepared = await api({
			phase: 'prepare',
			...input,
			checksums: probe.results.filter((r: any) => r.status === 'source-required').map((r: any) => ({ ordinal: r.ordinal, sha256: raw }))
		});
		const pending = prepared.results.filter((r: any) => r.status === 'prepared');
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(16, pending.length) }, async () => {
				for (;;) {
					const index = next++;
					if (index >= pending.length) return;
					counts.puts++;
					await delay(2);
				}
			})
		);
		const verified = await api({ phase: 'verify', ...input, uploads: pending.map((r: any) => ({ ordinal: r.ordinal, uploadId: r.upload.id })) });
		for (const m of input.descriptor.members) assert.deepEqual(local.get(m.write.operation.mutation.path), m.write.operation.mutation.source);
		return {
			...verified,
			results: input.descriptor.members.map(
				(m: any) => verified.results.find((r: any) => r.ordinal === m.ordinal) ?? prepared.results[m.ordinal] ?? probe.results[m.ordinal]
			),
			payloads: input.descriptor.members.map((m: any) => ({ ordinal: m.ordinal, bytes: pending.some((r: any) => r.ordinal === m.ordinal) ? 4 : 0 }))
		};
	};
	let confirmed = 0;
	const input: any = {
		...f.input(),
		currentScope: () => scope,
		readConfiguration: async () => ({
			id: configurationId,
			updatedAt: date.toISOString(),
			crystal: configuration,
			author: { id: owner },
			thingtime: ['file-sync'],
			acl: ['tt:user']
		}),
		journal: wrapLocal(f.journal()),
		runtime,
		authorizeDevice: async () => {},
		nativeOperationGuards: true,
		authorizeContext: async () => {
			counts.contexts++;
			await native();
			return { network: 'wifi', charging: true };
		},
		inspectLocal: async (path: string) => {
			counts.inspect++;
			await native();
			return local.get(path) ?? null;
		},
		uploadBatch: nativeUpload,
		...(candidate
			? {
					folderBatch: async (input: any) => {
						counts.folderBatches.push(input.ordinals.length);
						await native();
						return {
							ok: true,
							version: 1,
							batchId: input.descriptor.batchId,
							digest: input.digest,
							results: input.ordinals.map((ordinal: number) => {
								const m = input.descriptor.members[ordinal];
								return {
									ordinal,
									status: sameSyncStamp(local.get(m.write.operation.mutation.path), m.write.operation.mutation.source) ? 'validated' : 'failed',
									...(sameSyncStamp(local.get(m.write.operation.mutation.path), m.write.operation.mutation.source)
										? {}
										: { code: 'source-changed', retryable: false })
								};
							})
						};
					}
			  }
			: {}),
		source: async () => ({
			size: 4,
			nativePartSourceChecks: true,
			nativePartPayloadBytes: true,
			check: native,
			verify: native,
			read: async () => {
				throw Error('Expected native part');
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
		progress: (p: any) => {
			confirmed = Math.max(confirmed, p.confirmed ?? 0);
		},
		streamLocalChanges: async function* (id: string, _after: number, signal: AbortSignal) {
			yield {
				id,
				generation: id,
				state: 'running',
				revision: 2,
				nextSequence: 2,
				hasMore: false,
				changes: entries.slice(0, 2).map((entry, i) => ({ sequence: i + 1, revision: entry.version, entry }))
			};
			await Promise.race([firstFile, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
			for (let offset = 2; offset < entries.length; offset += 128) {
				const chunk = entries.slice(offset, offset + 128);
				indexedComplete = offset + chunk.length === entries.length;
				yield {
					id,
					generation: id,
					state: indexedComplete ? 'complete' : 'running',
					revision: offset + chunk.length,
					nextSequence: offset + chunk.length,
					hasMore: false,
					changes: chunk.map((entry, i) => ({ sequence: offset + i + 1, revision: entry.version, entry }))
				};
			}
		}
	};
	const started = performance.now();
	try {
		await (candidate ? streamOneWayForegroundSync : baseline.streamOneWayForegroundSync)(saved, scope, input, controller.signal);
	} finally {
		clearTimeout(timer);
		f.journal().close();
	}
	const elapsedMs = Math.round(performance.now() - started);
	assert.equal(confirmed, 512);
	assert.equal(counts.folders, 117);
	assert.equal(counts.files, 395);
	assert.equal(counts.puts, 395);
	assert.equal(
		(await things.countDocuments({
			ownerId: owner,
			thingtime: ['folder'],
			shareId: { $ne: rootId },
			'crystal.name': { $exists: true },
			folderId: { $ne: null }
		})) >= 117,
		true
	);
	assert.equal(firstFileBeforeIndex, true);
	const union = (rows: typeof intervals) => {
		let total = 0,
			end = started;
		for (const row of [...rows].sort((a, b) => a.start - b.start)) {
			const a = Math.max(started, row.start),
				b = Math.min(started + elapsedMs, row.end);
			if (b > a) {
				total += Math.max(0, b - Math.max(a, end));
				end = Math.max(end, b);
			}
		}
		return total;
	};
	const phases = Object.fromEntries(
		[...new Set(intervals.map((i) => i.phase))].sort().map((phase) => {
			const rows = intervals.filter((i) => i.phase === phase),
				durations = rows.map((i) => i.end - i.start).sort((a, b) => a - b);
			return [
				phase,
				{
					count: rows.length,
					sumMs: Math.round(durations.reduce((n, v) => n + v, 0)),
					unionMs: Math.round(union(rows)),
					p95Ms: Math.round(durations[Math.floor((durations.length - 1) * 0.95)])
				}
			];
		})
	);
	const observed = union(intervals.filter((i) => ['control', 'native', 'journal'].includes(i.phase)));
	return {
		source: candidate ? 'candidate' : '84c3b986',
		elapsedMs,
		counts,
		firstFileBeforeIndex,
		phases,
		unobservedRemainderMs: Math.max(0, Math.round(elapsedMs - observed)),
		timingScope:
			'monotonic interval sums and unions; nested/parallel phases are NOT additive. Journal includes local validation/transaction queue; remainder is unclassified JS/scheduling, not asserted IDB time.'
	};
}
const before = await run(false);
console.log('[pipeline-before] ' + JSON.stringify(before));
const after = await run(true);
console.log('[pipeline-after] ' + JSON.stringify(after));
const proof = {
	fileSyncFolderBatchesProof: {
		scope:
			'real512 planner/journal/consumer and canonical Mongo folder/file CAS/Timeline/storage; synthetic native5ms/provider2ms; no installed claim',
		before,
		after,
		ratio: after.elapsedMs / before.elapsedMs,
		sensitivity: {
			nativeFolderCallMs: 1411,
			source: 'real128-folder Commander/native/host fixture',
			candidateAdjustedMs: after.elapsedMs + after.counts.folderBatches.length * (1411 - 5),
			ratio: (after.elapsedMs + after.counts.folderBatches.length * (1411 - 5)) / before.elapsedMs,
			scope: 'conservative full128 validation cost applied to every candidate folder call; not measured installed throughput'
		}
	}
};
await writeFile('/tmp/sync-folder-whole-pipeline-instrumented-proof.json', JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(proof));
assert.ok(
	after.elapsedMs <= before.elapsedMs / 2,
	'Whole512 canonical Mongo path must materially improve; ' + JSON.stringify({ before: before.elapsedMs, after: after.elapsedMs })
);
process.exit(0);
