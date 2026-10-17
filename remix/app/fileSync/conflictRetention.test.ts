import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { runForegroundCloudSync } from './foregroundSync';
import { executeSyncRun, validateSyncRun } from './execute';
import { fingerprintSource } from './contentFingerprint';
import { newFileSyncConfiguration } from './configuration';
import { fileCommitEventId, fileRetentionEventId } from './fileVersions';
import type { CloudFile } from './cloudFile';
import type { SyncConflictReviewResult } from './conflictResolution';

const scope = { origin: 'https://retain.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'phone', rootId: 'connection' };
async function fixture() {
	const data = new Uint8Array([11, 22, 33]),
		factory = new IDBFactory();
	let sourceReads = 0,
		sourceOpens = 0,
		uploads = 0,
		puts = 0,
		retained = 0,
		publications = 0,
		reviews = 0;
	let localAvailable = true,
		localVersion = 'local-1',
		lost = false;
	const source = () => ({
		size: data.length,
		check: () => {
			if (!localAvailable) throw Error('Device source unavailable');
		},
		read: async (offset: number, length: number) => {
			sourceReads++;
			return data.slice(offset, offset + length);
		}
	});
	const fingerprint = await fingerprintSource(source());
	sourceReads = 0;
	let live: CloudFile = {
		id: randomUUID(),
		revision: 'cloud-1',
		name: 'report.bin',
		folderId: 'cloud-root',
		trashed: false,
		content: { attachmentId: 'cloud-original', version: 'a'.repeat(64), size: data.length, fingerprint: { ...fingerprint, sha256: 'b'.repeat(64) } }
	};
	const original = structuredClone(live);
	const receipts = new Map<string, { body: string; file: CloudFile }>(),
		ready = new Set<string>();
	let journal = await openSyncJournal(factory);
	const saved = {
		id: scope.rootId,
		updatedAt: '2026-10-17T00:00:00.000Z',
		configuration: {
			...newFileSyncConfiguration({
				name: 'Capture',
				deviceId: scope.deviceId,
				localRootId: 'native-root',
				remoteFolderId: 'cloud-root'
			}),
			mode: 'backup' as const,
			paused: false
		}
	};
	let review: () => Promise<SyncConflictReviewResult> = async () => ({ action: 'retain' });
	const runtime = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (input: any, init: any) => {
			const url = new URL(String(input)),
				body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
			if (url.origin === 'https://objects.test') {
				puts++;
				assert.deepEqual(init.body, data);
				return new Response(null);
			}
			assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId);
			assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
			if (url.pathname === '/api/v1/files') {
				if (!body) {
					if (url.searchParams.has('operationId')) {
						const key = `${url.searchParams.get('kind') ?? 'commit'}:${url.searchParams.get('operationId')}`;
						return Response.json({ ok: true, receipt: receipts.has(key) ? { file: receipts.get(key)!.file } : null });
					}
					return Response.json({ ok: true, file: live });
				}
				const isRetention = body.kind === 'retained-version',
					key = `${body.kind ?? 'commit'}:${body.operationId}`,
					prior = receipts.get(key);
				if (prior) {
					assert.equal(prior.body, JSON.stringify(body));
					return Response.json({ ok: true, file: prior.file, replayed: true, ...(isRetention ? { retained: true } : {}) });
				}
				if (body.expectedRevision !== live.revision) return Response.json({ ok: false }, { status: 409 });
				const file = {
					...live,
					revision: await (isRetention ? fileRetentionEventId : fileCommitEventId)(scope.ownerId, live.id, body.operationId),
					content: { attachmentId: body.attachmentId, version: body.contentVersion, size: data.length, fingerprint }
				};
				receipts.set(key, { body: JSON.stringify(body), file });
				if (isRetention) retained++;
				else {
					publications++;
					live = file;
				}
				if (lost) {
					lost = false;
					throw Error('Accepted retention reply lost');
				}
				return Response.json({ ok: true, file, replayed: false, ...(isRetention ? { retained: true } : {}) });
			}
			if (url.pathname === '/api/v1/attachments/uploads') {
				uploads++;
				return Response.json({
					ok: true,
					upload: {
						id: 'upload-' + body.requestId,
						partSizeBytes: fingerprint.partSizeBytes,
						partCount: fingerprint.partCount,
						...(ready.has('upload-' + body.requestId) ? { state: 'ready' } : {})
					}
				});
			}
			if (url.pathname.endsWith('/parts'))
				return Response.json({
					ok: true,
					parts: [{ partNumber: 1, url: 'https://objects.test/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }]
				});
			if (url.pathname.endsWith('/complete')) {
				ready.add(body.uploadId);
				return Response.json({ ok: true });
			}
			if (url.pathname.endsWith('/content'))
				return Response.json({ ok: true, id: url.searchParams.get('id'), version: 'c'.repeat(64), size: data.length, fingerprint });
			throw Error('Unexpected request');
		}
	};
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => ({
			id: saved.id,
			updatedAt: saved.updatedAt,
			author: { id: scope.ownerId },
			thingtime: ['file-sync'],
			acl: ['tt:user'],
			crystal: saved.configuration
		}),
		authorizeDevice: async () => {},
		conditions: async () => ({ network: 'wifi' as const, charging: true }),
		scanLocal: async () => {
			if (!localAvailable) throw Error('Device source unavailable');
			return [{ path: 'report.bin', id: 'native-file', version: localVersion, kind: 'file' as const, size: data.length, sha256: null, fingerprint }];
		},
		inventory: async () => ({
			version: 1 as const,
			complete: true as const,
			rootId: 'cloud-root',
			rootRevision: 'root-1',
			nodes: [{ kind: 'file' as const, path: 'report.bin', file: live }]
		}),
		source: async () => {
			sourceOpens++;
			if (!localAvailable) throw Error('Device source unavailable');
			return source();
		},
		journal,
		runtime,
		progress: () => {},
		reviewConflicts: async () => {
			reviews++;
			return review();
		}
	});
	return {
		saved,
		input,
		original,
		live: () => live,
		journal: () => journal,
		counts: () => ({ sourceReads, sourceOpens, uploads, puts, retained, publications, reviews }),
		lose: () => {
			lost = true;
		},
		removeSource: () => {
			localAvailable = false;
		},
		review: (next: typeof review) => {
			review = next;
		},
		edit: () => {
			localVersion = 'local-2';
		},
		reload: async () => {
			journal.close();
			journal = await openSyncJournal(factory);
		}
	};
}

test('Save versions and ignore retains bytes without changing the live file or sync baseline; repeats reuse receipts', async () => {
	const f = await fixture(),
		progress: string[] = [],
		input = f.input();
	const result = await runForegroundCloudSync(f.saved, scope, { ...input, progress: (p) => progress.push(p.stage) }, new AbortController().signal);
	assert.equal(result.version, 2);
	assert.equal(result.intent, 'retain-conflicts');
	assert.ok(result.operations.every((o) => o.confirmed));
	assert.deepEqual(f.live(), f.original);
	assert.equal(await f.journal().checkpoint(scope), null);
	assert.equal(progress.at(-1), 'retained');
	assert.deepEqual(f.counts(), { sourceReads: 1, sourceOpens: 1, uploads: 1, puts: 1, retained: 1, publications: 0, reviews: 1 });
	await f.reload();
	await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	assert.deepEqual(f.counts(), { sourceReads: 1, sourceOpens: 1, uploads: 1, puts: 1, retained: 1, publications: 0, reviews: 2 });
	assert.equal((await f.journal().read(scope))!.id, result.id);
	// A later explicit winner choice must still see the conflict and perform an ordinary sync.
	f.review(async () => [{ path: 'report.bin', from: 'local' }]);
	const synced = await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	assert.equal(synced.version, 1);
	assert.equal(f.counts().publications, 1);
	assert.notDeepEqual(f.live(), f.original);
	assert.equal((await f.journal().checkpoint(scope))!.runId, synced.id);
	f.journal().close();
});

test('lost accepted retention recovers after IDB reopen and device-source loss without scanning, rereading or reuploading', async () => {
	const f = await fixture();
	f.lose();
	await assert.rejects(runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal), /reply lost/);
	const before = f.counts(),
		pending = await f.journal().read(scope);
	assert.equal(pending!.version, 2);
	assert.equal(pending!.operations[0].confirmed, false);
	f.removeSource();
	await f.reload();
	const done = await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	assert.equal(done.id, pending!.id);
	assert.ok(done.operations.every((o) => o.confirmed));
	assert.deepEqual(f.counts(), before);
	assert.deepEqual(f.live(), f.original);
	assert.equal(await f.journal().checkpoint(scope), null);
	f.journal().close();
});

test('capture persists before upload and refuses a changed review', async () => {
	const f = await fixture(),
		input = f.input();
	await assert.rejects(
		runForegroundCloudSync(
			f.saved,
			scope,
			{
				...input,
				journal: {
					...input.journal,
					persist: async () => {
						throw Error('Journal disk full');
					}
				}
			},
			new AbortController().signal
		),
		/disk full/
	);
	assert.equal(f.counts().uploads, 0);
	assert.equal(f.counts().retained, 0);
	f.review(async () => {
		f.edit();
		return { action: 'retain' };
	});
	await assert.rejects(runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal), /changed/);
	assert.equal(await f.journal().read(scope), null);
	assert.equal(f.counts().uploads, 0);
	f.journal().close();
});

test('retention runs cannot be interpreted as sync writes or complete a sync baseline', async () => {
	const f = await fixture();
	f.lose();
	await assert.rejects(runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal), /reply lost/);
	const saved = (await f.journal().read(scope))!;
	let effects = 0;
	await assert.rejects(
		executeSyncRun(saved, {
			persist: async () => {
				effects++;
			}
		} as any),
		/different executors/
	);
	assert.equal(effects, 0);
	assert.throws(() => validateSyncRun({ ...saved, version: 1 }), /Invalid persisted/);
	assert.throws(() => validateSyncRun({ ...saved, intent: undefined }), /Invalid persisted/);
	await assert.rejects(f.journal().persist({ ...saved, version: 1, intent: undefined }), /cannot change/);
	const done = await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	await assert.rejects(
		f.journal().complete({ version: 1, runId: done.id, localRootId: 'native-root', remoteFolderId: 'cloud-root', baseline: { scope, entries: [] } }),
		/fully confirmed/
	);
	assert.equal(await f.journal().checkpoint(scope), null);
	f.journal().close();
});

test('capture cancellation and account/configuration changes during review refuse uploads', async () => {
	for (const failure of ['cancel', 'account', 'configuration'] as const) {
		const f = await fixture(),
			abort = new AbortController(),
			input = f.input();
		let changed = false;
		f.review(async () => {
			changed = true;
			if (failure === 'cancel') abort.abort(Error('Capture cancelled'));
			return { action: 'retain' };
		});
		await assert.rejects(
			runForegroundCloudSync(
				f.saved,
				scope,
				{
					...input,
					currentScope: () => (changed && failure === 'account' ? { ...scope, ownerId: 'another-account' } : scope),
					readConfiguration: async () => {
						const value = await input.readConfiguration();
						return changed && failure === 'configuration'
							? { ...value, updatedAt: '2026-10-18T00:00:00.000Z', crystal: { ...value.crystal, paused: true } }
							: value;
					}
				},
				abort.signal
			)
		);
		assert.equal(f.counts().uploads, 0);
		assert.equal(f.counts().retained, 0);
		assert.deepEqual(f.live(), f.original);
		assert.equal(await f.journal().read(scope), null);
		f.journal().close();
	}
});
