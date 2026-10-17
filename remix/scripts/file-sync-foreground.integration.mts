import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authCookie } from '../app/api/utils/auth/authCookie';
import { prepareCloudFolderBackup, resumeCloudFolderBackup } from '../app/api/utils/backups/cloudFolderBackup';
import { createCloudDownloadSource } from '../app/fileSync/cloudDownloadSource';
// Opt-in real cloud/API acceptance. Native grants/conditions are explicit test
// adapters; browser and native UI acceptance is tracked separately.
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_FORMAT, type BackupItem } from '../app/backups/manifest';
import { openLocalBackupStore } from '../app/api/utils/backups/localBackupStore';
import {
	prepareBackup,
	captureBackup,
	sealBackup,
	copySealedBackup,
	verifySealedBackup,
	openBackupItem
} from '../app/api/utils/backups/portableBackup';
import { randomUUID, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { runForegroundCloudSync } from '../app/fileSync/foregroundSync';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { parseCloudInventory } from '../app/fileSync/cloudInventory';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
const fixturePath = process.argv[2];
if (!fixturePath || (await stat(fixturePath)).mode & 0o077) throw Error('Pass a mode-0600 disposable fixture');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')),
	base = new URL(fixture.base);
assert.equal(base.protocol, 'http:');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
assert.equal(base.origin, fixture.base);
const cookies = new Map<string, string>();
const sessionFetch: typeof fetch = async (url, init = {}) => {
	const target = new URL(String(url), base),
		headers = new Headers(init.headers);
	if (target.origin === base.origin && init.credentials !== 'omit') {
		headers.set('Cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
		headers.set('Origin', base.origin);
	}
	const result = await fetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000) });
	if (target.origin === base.origin && init.credentials !== 'omit')
		for (const h of result.headers.getSetCookie()) {
			const pair = h.split(';')[0],
				i = pair.indexOf('=');
			cookies.set(pair.slice(0, i), pair.slice(i + 1));
		}
	return result;
};
async function api(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const result = await sessionFetch(new URL(path, base), {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	assert.equal(result.status, 200, path.split('?')[0]);
	return result.json();
}
const deviceId = 'foreground-acceptance',
	localRootId = randomUUID(),
	factory = new IDBFactory();
let journal = await openSyncJournal(factory);
let rootId: string | null = null,
	configurationId: string | null = null,
	file: any = null,
	lost = true,
	failCheckpoint = true,
	puts = 0,
	bytes = process.argv.includes('--large-download') ? new Uint8Array(17 * 1024 * 1024 + 17).fill(13) : new Uint8Array([1, 2, 3, 4]),
	version = 'local-1';
const source = () => ({ size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length), check: () => {} });
await api('/api/v1/login', { username: fixture.username, password: fixture.password });
try {
	assert.equal((await api('/api/v1/auth/me')).user.id, fixture.userId);
	rootId = (await api('/api/v1/things', { thingtime: ['folder'], crystal: { name: 'Foreground sync acceptance ' + randomUUID() } })).thing.id;
	const configuration = {
		...newFileSyncConfiguration({ name: 'Foreground acceptance', deviceId, localRootId, remoteFolderId: rootId! }),
		mode: 'backup',
		paused: false
	};
	const row = (await api('/api/v1/things', { thingtime: ['file-sync'], crystal: configuration })).thing;
	configurationId = row.id;
	const saved = readOwnedFileSyncConfiguration(row, fixture.userId),
		scope = { origin: base.origin, ownerId: fixture.userId, dataPlane: 'home', deviceId, rootId: row.id };
	const runtime = {
		currentScope: () => scope,
		origin: () => base.origin,
		requireCapability: async (feature: string, minimum: string) => {
			const m = await api('/.well-known/thingtime-capabilities.json');
			assert.ok(capabilitySatisfies(m.features[feature]?.version, minimum));
		},
		fetch: async (url: any, init: any) => {
			if (init?.method === 'PUT') puts++;
			const result = await sessionFetch(url, init);
			if (new URL(String(url)).pathname === '/api/v1/files' && init?.method === 'POST' && result.ok && lost) {
				lost = false;
				await result.body?.cancel();
				throw Error('Lost accepted commit');
			}
			return result;
		}
	};
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => (await api('/api/v1/things?id=' + row.id)).thing,
		authorizeDevice: async () => {},
		conditions: async () => ({ network: 'wifi' as const, charging: true }),
		scanLocal: async () => [
			{
				path: 'sample.bin',
				id: 'local-file',
				version,
				kind: 'file' as const,
				size: bytes.length,
				sha256: null,
				fingerprint: await fingerprintSource(source())
			}
		],
		inventory: async () => parseCloudInventory((await api('/api/v1/files?rootId=' + rootId)).inventory, rootId!),
		source: async () => source(),
		journal: {
			...journal,
			complete: async (value: any) => {
				if (failCheckpoint) {
					failCheckpoint = false;
					throw Error('Checkpoint storage unavailable');
				}
				return journal.complete(value);
			}
		},
		runtime,
		progress: () => {}
	});
	await assert.rejects(runForegroundCloudSync(saved, scope, input(), new AbortController().signal), /Lost accepted commit/);
	const runId = (await journal.read(scope))!.id;
	journal.close();
	journal = await openSyncJournal(factory);
	const before = puts;
	await assert.rejects(runForegroundCloudSync(saved, scope, input(), new AbortController().signal), /Checkpoint storage unavailable/);
	assert.equal(puts, before);
	assert.equal((await journal.read(scope))!.id, runId);
	assert.ok((await journal.read(scope))!.operations.every((op) => op.confirmed));
	assert.equal(await journal.checkpoint(scope), null);
	const first = (await api('/api/v1/files?rootId=' + rootId)).inventory.nodes.find((node: any) => node.kind === 'file').file;
	const downloadSource = createCloudDownloadSource(runtime, scope, first);
	const downloaded = await downloadSource.read(0, bytes.length);
	assert.equal(createHash('sha256').update(downloaded).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
	assert.deepEqual(await fingerprintSource(downloadSource), first.content.fingerprint);
	const rangePath =
		'/api/v1/attachments/content?' +
		new URLSearchParams({ id: first.content.attachmentId, range: '1', version: first.content.version, offset: '0', length: '1' });
	assert.equal((await fetch(new URL(rangePath, base), { redirect: 'error' })).status, 404);
	assert.equal((await sessionFetch(new URL(rangePath.replace(first.content.version, 'f'.repeat(64)), base))).status, 409);
	if (bytes.length > 16 * 1024 * 1024)
		assert.equal((await sessionFetch(new URL('/api/v1/attachments/content?id=' + first.content.attachmentId + '&cache=bytes', base))).status, 413);
	console.log(
		'PASS: exact-version bounded cloud ranges, independent full byte hash and multipart fingerprint, anonymous denial and changed-version refusal; bytes:',
		bytes.length
	);
	bytes = new Uint8Array([5, 6, 7, 8, 9]);
	version = 'local-2';
	await runForegroundCloudSync(saved, scope, input(), new AbortController().signal);
	const cp = await journal.checkpoint(scope);
	assert.equal(cp!.baseline.entries[0].local.version, 'local-2');
	file = (await api('/api/v1/files?rootId=' + rootId)).inventory.nodes.find((node: any) => node.kind === 'file').file;
	assert.equal(file.id, first.id);
	assert.notEqual(file.revision, first.revision);
	await assert.rejects(downloadSource.read(0, 1), /Cloud source changed/);
	const result = await sessionFetch(new URL('/api/v1/attachments/content?id=' + file.content.attachmentId + '&cache=bytes', base));
	assert.equal(result.status, 200);
	assert.equal(
		createHash('sha256')
			.update(new Uint8Array(await result.arrayBuffer()))
			.digest('hex'),
		createHash('sha256').update(bytes).digest('hex')
	);
	const count = puts;
	await runForegroundCloudSync(saved, scope, input(), new AbortController().signal);
	assert.equal(puts, count);
	console.log(
		'PASS: user-started configured upload; lost accepted commit and journal reopen; no byte reupload on retry; failed completion checkpoint; local edit recovered using immutable prior receipt; stable replacement and independent byte hash; repeat scan performs no upload.'
	);
	// A fresh device baseline sees divergent copies and must obtain a specific
	// version choice. Use the real file API for replacement and retained bytes.
	const retained = structuredClone(file),
		retainedBytes = bytes.slice();
	const reviewFactory = new IDBFactory();
	journal.close();
	journal = await openSyncJournal(reviewFactory);
	bytes = new Uint8Array([41, 42, 43, 44, 45, 46]);
	version = 'conflicting-local';
	const beforeReview = puts;
	await assert.rejects(
		runForegroundCloudSync(
			saved,
			scope,
			{
				...input(),
				reviewConflicts: async () => {
					throw Error('Review cancelled');
				}
			},
			new AbortController().signal
		),
		/Review cancelled/
	);
	assert.equal(await journal.read(scope), null);
	assert.equal(puts, beforeReview);
	await assert.rejects(
		runForegroundCloudSync(
			saved,
			scope,
			{
				...input(),
				reviewConflicts: async (conflicts) => {
					assert.equal(conflicts[0].path, 'sample.bin');
					version = 'changed-during-review';
					return [{ path: 'sample.bin', from: 'local' }];
				}
			},
			new AbortController().signal
		),
		/changed during review/
	);
	assert.equal(await journal.read(scope), null);
	assert.equal(puts, beforeReview);
	let reviews = 0;
	lost = true;
	const chosenInput = () => ({
		...input(),
		reviewConflicts: async () => {
			reviews++;
			return [{ path: 'sample.bin', from: 'local' as const }];
		}
	});
	await assert.rejects(runForegroundCloudSync(saved, scope, chosenInput(), new AbortController().signal), /Lost accepted commit/);
	const chosen = (await journal.read(scope))!,
		afterChosen = puts;
	journal.close();
	journal = await openSyncJournal(reviewFactory);
	const resumed = await runForegroundCloudSync(saved, scope, chosenInput(), new AbortController().signal);
	assert.equal(resumed.id, chosen.id);
	assert.equal(reviews, 1);
	assert.equal(puts, afterChosen);
	file = (await api('/api/v1/files?id=' + retained.id)).file;
	assert.equal(file.id, retained.id);
	assert.notEqual(file.revision, retained.revision);
	for (const [content, expected] of [
		[retained.content, retainedBytes],
		[file.content, bytes]
	] as const) {
		const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + content.attachmentId + '&cache=bytes', base));
		assert.equal(response.status, 200);
		assert.equal(
			createHash('sha256')
				.update(new Uint8Array(await response.arrayBuffer()))
				.digest('hex'),
			createHash('sha256').update(expected).digest('hex')
		);
	}
	const repeat = await runForegroundCloudSync(saved, scope, chosenInput(), new AbortController().signal);
	assert.equal(repeat.operations.length, 0);
	assert.equal(reviews, 1);
	assert.equal(puts, afterChosen);
	console.log(
		'PASS: conflict cancellation and stale review write nothing; chosen replacement survives lost commit/reopen without another choice or upload; stable identity, both retained byte hashes and repeat convergence. Native permissions are fixture adapters.'
	);
	// Capture an alternate version, lose its accepted response and then make
	// the local source unavailable. Recovery must use its durable receipt.
	const captureFactory = new IDBFactory();
	journal.close();
	journal = await openSyncJournal(captureFactory);
	const liveBeforeCapture = structuredClone(file),
		liveBytesBeforeCapture = bytes.slice();
	bytes = new Uint8Array([71, 72, 73, 74, 75, 76, 77]);
	version = 'capture-local';
	let captureReviews = 0;
	const captureInput = () => ({
		...input(),
		reviewConflicts: async () => {
			captureReviews++;
			return { action: 'retain' as const };
		}
	});
	lost = true;
	await assert.rejects(runForegroundCloudSync(saved, scope, captureInput(), new AbortController().signal), /Lost accepted commit/);
	const pendingCapture = (await journal.read(scope))!,
		capturePuts = puts;
	assert.equal(pendingCapture.version, 2);
	assert.equal(pendingCapture.intent, 'retain-conflicts');
	assert.deepEqual((await api('/api/v1/files?id=' + file.id)).file, liveBeforeCapture);
	journal.close();
	journal = await openSyncJournal(captureFactory);
	const unavailableSource = async (): Promise<never> => {
		throw Error('Device source removed after accepted capture');
	};
	const captured = await runForegroundCloudSync(
		saved,
		scope,
		{ ...captureInput(), scanLocal: unavailableSource, source: unavailableSource },
		new AbortController().signal
	);
	assert.equal(captured.id, pendingCapture.id);
	assert.ok(captured.operations.every((op) => op.confirmed));
	assert.equal(puts, capturePuts);
	assert.equal(captureReviews, 1);
	assert.equal(await journal.checkpoint(scope), null);
	const captureReceipt = (await api(`/api/v1/files?id=${file.id}&operationId=${captured.operations[0].id}&kind=retained-version`)).receipt.file;
	for (const [content, expected] of [
		[captureReceipt.content, bytes],
		[liveBeforeCapture.content, liveBytesBeforeCapture]
	] as const) {
		const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + content.attachmentId + '&cache=bytes', base));
		assert.equal(response.status, 200);
		assert.equal(
			createHash('sha256')
				.update(new Uint8Array(await response.arrayBuffer()))
				.digest('hex'),
			createHash('sha256').update(expected).digest('hex')
		);
	}
	await runForegroundCloudSync(saved, scope, captureInput(), new AbortController().signal);
	assert.equal(puts, capturePuts);
	assert.equal(captureReviews, 2);
	assert.deepEqual((await api('/api/v1/files?id=' + file.id)).file, liveBeforeCapture);
	console.log(
		'PASS: configured conflict capture; durable lost-response recovery after source removal; both independent byte hashes; unchanged live file/baseline; repeated Ignore reuses captured receipts. Native source/consent remains an explicit test adapter.'
	);

	if (process.argv.includes('--portable-backup')) {
		const vaultRoot = await mkdtemp(join(tmpdir(), 'thingtime-api-backup-'));
		try {
			const snapshotId = randomUUID(),
				store = await openLocalBackupStore(join(vaultRoot, 'capture'));
			const startedAt = new Date().toISOString(),
				pinned = (await api('/api/v1/files?id=' + file.id)).file;
			const completedAt = new Date().toISOString();
			const backupAccess = { scope: { apiOrigin: base.origin, ownerId: fixture.userId, dataPlane: 'home' }, authorize: async () => {} };
			async function* selectedFile(): AsyncIterable<BackupItem> {
				yield {
					ordinal: 0,
					thingId: pinned.id,
					revision: pinned.revision,
					snapshot: { adapter: 'file-content', version: 1, value: pinned },
					content: { size: pinned.content.size, fingerprint: pinned.content.fingerprint }
				};
			}
			await prepareBackup(
				store,
				{
					format: BACKUP_FORMAT,
					snapshotId,
					scope: backupAccess.scope,
					boundary: { kind: 'capture-interval', token: pinned.revision, startedAt, completedAt },
					coverage: { selectionId: pinned.id, description: 'One explicit disposable file; not an account-wide inventory' }
				},
				selectedFile(),
				backupAccess
			);
			const emptyId = randomUUID();
			await api('/api/v1/files', { kind: 'folder', id: emptyId, operationId: randomUUID(), name: 'Empty backup folder', folderId: rootId });
			const treeId = randomUUID(),
				tree = await openLocalBackupStore(join(vaultRoot, 'tree'));
			const backupRuntime = {
				scope: backupAccess.scope,
				currentScope: () => backupAccess.scope,
				fetch: sessionFetch,
				requireCapability: runtime.requireCapability
			};
			await prepareCloudFolderBackup(tree, treeId, rootId!, backupRuntime);
			const sessionConfig = join(vaultRoot, 'session.json');
			await writeFile(
				sessionConfig,
				JSON.stringify({ origin: base.origin, ownerId: fixture.userId, token: await authCookie.parse('tt_auth=' + cookies.get('tt_auth')) }),
				{ mode: 0o600 }
			);
			const cliId = randomUUID();
			const cli = async (args: string[]) => {
				try {
					return await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/backup-cloud.mts', ...args], { maxBuffer: 1024 * 1024 });
				} catch {
					throw Error('Cloud backup CLI failed; session configuration and API bodies are withheld');
				}
			};
			const created = await cli(['create', sessionConfig, join(vaultRoot, 'cli'), cliId, rootId!]);
			assert.equal(JSON.parse(created.stdout.trim().split('\n').at(-1)!).verified, true);

			const cloud = createCloudDownloadSource(runtime, scope, pinned);
			let sourceReads = 0,
				lostRange = true;
			const reader = {
				read: async (_item: BackupItem, offset: number, length: number, signal?: AbortSignal) => {
					sourceReads++;
					return cloud.read(offset, length, signal);
				}
			};
			await assert.rejects(
				captureBackup(
					{
						...store,
						put: async (key, data) => {
							await store.put(key, data);
							if (key.includes('/ranges/') && lostRange) {
								lostRange = false;
								throw Error('Lost backup range reply');
							}
						}
					},
					snapshotId,
					reader,
					backupAccess
				),
				/Lost backup range reply/
			);
			const afterCapture = sourceReads;
			await api('/api/v1/files', {
				id: pinned.id,
				operationId: randomUUID(),
				expectedRevision: pinned.revision,
				name: pinned.name,
				folderId: pinned.folderId,
				attachmentId: pinned.content.attachmentId,
				contentVersion: pinned.content.version,
				trashed: true
			});
			await assert.rejects(cloud.read(0, pinned.content.size), /changed|unavailable/);
			// The entire file tree was frozen before Trash, but these bytes were not
			// captured yet: resume must fetch the retained version, not current state.
			const treeResult = await resumeCloudFolderBackup(tree, treeId, backupRuntime);
			assert.equal(treeResult.seal.items, 3);
			const treeFile = await openBackupItem(tree, treeId, pinned.id, backupAccess),
				treeHash = createHash('sha256');
			for await (const chunk of treeFile.ranges) treeHash.update(chunk);
			assert.equal(treeHash.digest('hex'), createHash('sha256').update(liveBytesBeforeCapture).digest('hex'));
			assert.equal((await openBackupItem(tree, treeId, emptyId, backupAccess)).item.content, null);
			const restoredTree = join(vaultRoot, 'restored-tree');
			const offline = async (args: string[]) =>
				JSON.parse(
					(await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/backup-vault.mts', ...args], { maxBuffer: 1024 * 1024 })).stdout
				);
			const treeReview = await offline(['plan-tree', join(vaultRoot, 'tree'), treeId, restoredTree]);
			assert.equal(treeReview.entries.length, 3);
			const treeRestored = await offline(['restore-tree', join(vaultRoot, 'tree'), treeId, restoredTree, treeReview.review]);
			assert.equal(treeRestored.files, 1);
			assert.equal(
				createHash('sha256')
					.update(await readFile(join(treeRestored.directory, pinned.name)))
					.digest('hex'),
				createHash('sha256').update(liveBytesBeforeCapture).digest('hex')
			);
			assert.equal((await stat(join(treeRestored.directory, 'Empty backup folder'))).isDirectory(), true);
			const repeatedTree = await offline(['resume-tree', join(vaultRoot, 'tree'), treeId, restoredTree, treeReview.review]);
			assert.equal(repeatedTree.reusedFiles, 1);
			assert.equal(repeatedTree.restoredFiles, 0);
			console.log(
				'PASS: reviewed offline whole selected-tree restore from real cloud capture; exact file hash, empty folder, repeated resume reuses verified output.'
			);

			const resumed = await cli(['resume', sessionConfig, join(vaultRoot, 'cli'), cliId]);
			assert.equal(JSON.parse(resumed.stdout.trim().split('\n').at(-1)!).copiedBytes, '0');
			console.log(
				'PASS: real complete selected-folder capture, empty folder retention, exact retained bytes first downloaded after live Trash, authenticated CLI create and zero-reupload resume. Whole-account enumeration remains out of scope.'
			);

			const recovered = await openLocalBackupStore(join(vaultRoot, 'capture'));
			await captureBackup(
				recovered,
				snapshotId,
				{
					read: async () => {
						throw Error('Source access removed');
					}
				},
				backupAccess
			);
			const sealed = await sealBackup(recovered, snapshotId, backupAccess);
			assert.equal(sourceReads, afterCapture);
			const exported = await openLocalBackupStore(join(vaultRoot, 'export'));
			assert.deepEqual((await copySealedBackup(recovered, exported, snapshotId, backupAccess)).seal, sealed);
			await rm(join(vaultRoot, 'capture'), { recursive: true });
			assert.deepEqual(await verifySealedBackup(exported, snapshotId, backupAccess), sealed);
			const restored = await openBackupItem(exported, snapshotId, pinned.id, backupAccess),
				hasher = createHash('sha256');
			for await (const chunk of restored.ranges) hasher.update(chunk);
			assert.equal(hasher.digest('hex'), createHash('sha256').update(liveBytesBeforeCapture).digest('hex'));
			console.log(
				'PASS: real authorized API ranges into independent portable backup; lost capture receipt/reopen; original file trashed; copy survives removal of first vault; exact byte hash and canonical file snapshot. One-file fixture, not account-wide or 100 TB acceptance.'
			);
		} finally {
			await rm(vaultRoot, { recursive: true, force: true });
		}
	}
} finally {
	try {
		if (rootId) {
			const inventory = await api('/api/v1/files?rootId=' + rootId);
			for (const node of inventory.inventory.nodes) {
				if (node.kind === 'file') {
					const f = node.file;
					await api('/api/v1/files', {
						id: f.id,
						operationId: randomUUID(),
						expectedRevision: f.revision,
						name: f.name,
						folderId: f.folderId,
						attachmentId: f.content.attachmentId,
						contentVersion: f.content.version,
						trashed: true
					});
					console.log('Accounted synthetic versions retained in private Trash:', f.id);
				}
			}
		}
		if (configurationId) await api('/api/v1/things?id=' + configurationId, undefined, 'DELETE');
		if (rootId) await api('/api/v1/things?id=' + rootId, undefined, 'DELETE');
	} finally {
		journal.close();
		await api('/api/v1/auth/accounts/remove', { userId: fixture.userId });
	}
}
