// Opt-in real MacFolderSync + cloud acceptance. Picker/consent and credentials
// are isolated test adapters; this never uses the installed Node or Keychain.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomBytes, randomUUID, sign, createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { runForegroundCloudSync } from '../app/fileSync/foregroundSync';
import { runPagedForegroundCloudSync } from '../app/fileSync/pagedForegroundSync';
import { readNativeInventory } from '../app/fileSync/nativeInventory';
import { readCloudFolderInventoryPages } from '../app/fileSync/cloudInventoryPages.client';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { parseCloudInventory, inventorySyncEntry } from '../app/fileSync/cloudInventory';
import { parseMobileFolderResult, mobileFolderSource, type FolderRequest, type FolderCapabilities } from '../app/fileSync/mobileFolders.client';
import { approveMobileSyncTarget } from '../app/fileSync/mobileSyncTarget.client';
import { createSyncRun, executeSyncRun, type SyncRun } from '../app/fileSync/execute';
import { prepareCloudInventoryRun } from '../app/fileSync/cloudWrite';
import { readCloudPathEntry } from '../app/fileSync/cloudPath.client';
import { createCloudSyncPort } from '../app/fileSync/cloudSyncPort.client';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import type { CloudTransportRuntime } from '../app/fileSync/cloudTransport';

const { FolderStream } = createRequire(import.meta.url)('../../electron/lib/folder-stream.cjs');

const [fixturePath] = process.argv.slice(2);
const photoFixture = process.argv.includes('--photos');
const pagedFixture = process.argv.includes('--paged');
const wideFixture = process.argv.includes('--wide');
const wideFolders = wideFixture ? 10001 : 0;
assert.ok(!wideFixture || pagedFixture, 'Wide acceptance requires the paged runner');
assert.ok(!pagedFixture || !photoFixture, 'Photos retain their separate bounded acceptance');
const forcePreflightCooldown = process.argv.includes('--cooldown-before-upload');
assert.ok(fixturePath);
assert.equal((await stat(fixturePath)).mode & 0o077, 0);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')),
	base = new URL(fixture.base);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.origin, fixture.base);
const directory = await mkdtemp(path.join(tmpdir(), 'thingtime-mac-sync-live-'));
const cookies = new Map<string, string>();
let native: ChildProcessWithoutNullStreams | undefined, pending: { resolve(value: any): void; reject(error: unknown): void; stream?: any; requestId?: string } | undefined;
let nativeExit: Promise<void> | undefined,
	nativeCalls = 0,
	verifyCalls = 0,
	lastVerifyCalls = 0;
const counts = { puts: 0, publishes: 0, reads: 0, streams: 0, streamedBytes: 0, stageRanges: 0, stagedBytes: 0 };
let cooldownCount = 0,
	cooldownSeconds = 0,
	priorCooldownCount = 0,
	priorCooldownSeconds = 0;
let loseCloud = false,
	losePublication = false,
    loseStage = false;
const sessionFetch: typeof fetch = async (url, init = {}) => {
	const target = new URL(String(url), base),
		headers = new Headers(init.headers);
	if (target.origin === base.origin && init.credentials !== 'omit') {
		headers.set('Cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
		headers.set('Origin', base.origin);
	}
	if (init.method === 'PUT') counts.puts++;
	let response: Response;
	try { response = await fetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30000) }); }
	catch (cause) { throw Error(`Acceptance HTTP ${init.method ?? 'GET'} ${target.pathname} failed`, { cause }); }
	if (target.origin === base.origin && init.credentials !== 'omit')
		for (const value of response.headers.getSetCookie()) {
			const pair = value.split(';')[0],
				at = pair.indexOf('=');
			cookies.set(pair.slice(0, at), pair.slice(at + 1));
		}
	if (loseCloud && target.pathname === '/api/v1/files' && init.method === 'POST' && response.ok) {
		loseCloud = false;
		await response.body?.cancel();
		throw Error('Lost accepted cloud commit');
	}
	return response;
};
async function api(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await sessionFetch(new URL(route, base), {
		method,
		headers: { 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	assert.equal(response.status, 200, route.split('?')[0] + ' status');
	try { return await response.json(); }
	catch (cause) { throw Error(`Acceptance response ${method} ${new URL(route, base).pathname} failed`, { cause }); }
}
async function startNative() {
	lastVerifyCalls = 0;
	priorCooldownCount = 0;
	priorCooldownSeconds = 0;
	native = spawn(process.env.THINGTIME_MAC_SYNC_FIXTURE_BIN || path.resolve('../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), [path.join(directory, 'native.json')]);
	const current = native;
	nativeExit = new Promise((resolve, reject) => {
		current.on('error', reject);
		current.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(Error('Native fixture exited ' + code));
			pending?.reject(Error('Native fixture exited'));
			pending = undefined;
		});
	});
	void nativeExit.catch(() => {});
	current.stderr.on('data', () => {}); // Do not print credential-bearing diagnostics.
	const lines = createInterface({ input: current.stdout });
	lines.on('line', (line) => {
		try {
			assert.ok(line.length <= 1_000_000);
			const value = JSON.parse(line);
            if (value.type === 'chunk') {
                assert.ok(pending?.stream); pending.stream.write(Buffer.from(line + '\n')); return;
            }
			verifyCalls += value.identityChecks - lastVerifyCalls;
			lastVerifyCalls = value.identityChecks;
			cooldownCount += value.cooldowns.count - priorCooldownCount;
			cooldownSeconds += value.cooldowns.seconds - priorCooldownSeconds;
			priorCooldownCount = value.cooldowns.count;
			priorCooldownSeconds = value.cooldowns.seconds;
			const next = pending;
			if (value.ok && next?.stream) {
                next.stream.write(Buffer.from(JSON.stringify({ type: 'result', response: { id: next.requestId, ok: true, result: value.result } }) + '\n'));
                next.resolve(next.stream.finish().result);
            } else value.ok ? next?.resolve(value.result) : next?.reject(Error('Native fixture: ' + value.error));
            pending = undefined;
		} catch (error) {
			pending?.reject(error);
			pending = undefined;
		}
	});
}
async function stopNative() {
	const current = native,
		exited = nativeExit;
	current?.stdin.end();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		if (exited)
			await Promise.race([
				exited,
				new Promise((_, reject) => {
					timer = setTimeout(() => {
						current?.kill('SIGKILL');
						reject(Error('Native fixture shutdown timeout'));
					}, 5000);
					timer.unref();
				})
			]);
	} finally {
		clearTimeout(timer);
		native = undefined;
		nativeExit = undefined;
	}
}
async function send(payload: any) {
	assert.ok(native && !pending);
	nativeCalls++;
	return new Promise<any>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending = undefined;
			native?.kill('SIGKILL');
			reject(Error('Native fixture request timeout'));
		}, 280000);
		pending = {
            requestId: payload.requestId,
            ...(payload.action === 'read-range' ? { stream: new FolderStream({ id: payload.requestId, method: 'folder-sync.request', parameters: payload }) } : {}),
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value);
			},
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			}
		};
		const metadata = { ...payload };
        let bytes: Uint8Array | undefined;
        if (payload.action === 'stage-range') { bytes = payload.bytes; metadata.length = bytes!.byteLength; delete metadata.bytes; }
        const encoded = Buffer.from(JSON.stringify(metadata)), header = Buffer.alloc(4);
        header.writeUInt32BE(encoded.length);
        native!.stdin.write(Buffer.concat([header, encoded, ...(bytes ? [bytes] : [])]));
	});
}
const signal = new AbortController().signal;
const caps: FolderCapabilities = { platform: 'macos', fileAccessVersion: pagedFixture ? '1.5.1' : '1.3.0', fileStagingVersion: '1.1.0', filePublicationVersion: '1.1.1', fileTrashVersion: '1.2.0' };
let deviceId: string | undefined, remoteRoot: string | undefined, configurationId: string | undefined;
const deviceName = 'Mac sync acceptance ' + randomUUID();
const factory = new IDBFactory();
let journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
try {
	await api('/api/v1/login', { username: fixture.username, password: fixture.password });
	assert.equal((await api('/api/v1/auth/me')).user.id, fixture.userId);
	const manifest = await api('/.well-known/thingtime-capabilities.json');
	const { pairing } = await api('/api/v1/devices/pairing', {});
	const { privateKey, publicKey: key } = generateKeyPairSync('ed25519');
	const publicKey = key.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
	const nonce = randomBytes(32).toString('base64url'),
		credential = 'ttnode_' + randomBytes(32).toString('base64url');
	const {
		proof: { pairingId, serverNonce }
	} = await api('/api/v1/devices/pairing/claim', { op: 'prepare', pairingSecret: pairing.pairingSecret, publicKey, nonce });
	const device = { name: deviceName, platform: 'macos', model: 'Acceptance', osVersion: 'test', appVersion: '1.1.0' },
		capabilities: string[] = [];
	const fields = [
		'thingtime-device-pairing-claim-v1',
		pairingId,
		pairing.pairingSecret,
		credential,
		publicKey,
		nonce,
		serverNonce,
		device.name,
		device.platform,
		device.model,
		device.osVersion,
		device.appVersion,
		'0'
	];
	const proofBytes = Buffer.concat(
		fields.map((value) => {
			const bytes = Buffer.from(value);
			return Buffer.concat([Buffer.from(bytes.length + ':'), bytes]);
		})
	);
	deviceId = (
		await api('/api/v1/devices/pairing/claim', {
			op: 'complete',
			pairingSecret: pairing.pairingSecret,
			credential,
			device,
			capabilities,
			proof: { pairingId, publicKey, nonce, serverNonce, signature: sign(null, proofBytes, privateKey).toString('base64url') }
		})
	).device.id;
	await writeFile(
		path.join(directory, 'native.json'),
		JSON.stringify({ base: base.origin, deviceId, credential, photoFixture, directory: pathToFileURL(directory + '/').href }),
		{ mode: 0o600 }
	);
	await startNative();
	let loseTrash = false, loseRestore = false;
	const request = async (ownerId: string, input: FolderRequest, abort: AbortSignal) => {
		abort.throwIfAborted();
		const expected = { requestId: randomUUID(), ownerId, origin: base.origin };
		if (input.action === 'read') counts.reads++;
        if (input.action === 'read-range') { counts.streams++; counts.streamedBytes += input.length; }
		if (input.action === 'publish') counts.publishes++;
        if (input.action === 'stage-range') { counts.stageRanges++; counts.stagedBytes += input.bytes.length; }
		const payload = await send({ ...expected, deviceId, ...input });
		assert.equal(payload.deviceId, deviceId);
		const result = parseMobileFolderResult({ type: 'mobile-files-result', payload }, expected, input);
		assert.ok(result);
        if (input.action === 'stage-range' && loseStage) {
            loseStage = false;
            throw Error('Lost accepted native stage');
        }
		if (input.action === 'publish' && losePublication) {
			losePublication = false;
			throw Error('Lost accepted native publication');
		}
		if (input.action === 'trash' && loseTrash) { loseTrash = false; throw Error('Lost accepted native Trash'); }
		if (input.action === 'trash-restore-reviewed' && loseRestore) { loseRestore = false; throw Error('Lost accepted restore'); }
		return result;
	};
	const nativeRoot = (await request(fixture.userId, { action: 'choose' }, signal)).roots[0].id;
	remoteRoot = (await api('/api/v1/things', { thingtime: ['folder'], crystal: { name: deviceName } })).thing.id;
	const row = (
		await api('/api/v1/things', {
			thingtime: ['file-sync'],
			crystal: {
				...newFileSyncConfiguration({ name: deviceName, deviceId: deviceId!, localRootId: nativeRoot, remoteFolderId: remoteRoot!, ...(photoFixture ? { sourceKind: 'photos' } : {}) }),
				mode: photoFixture ? 'backup' : 'two-way',
				propagateDeletes: !photoFixture,
				paused: false
			}
		})
	).thing;
	configurationId = row.id;
	const saved = readOwnedFileSyncConfiguration(row, fixture.userId);
	const scope = { origin: base.origin, ownerId: fixture.userId, dataPlane: 'home', deviceId: deviceId!, rootId: row.id };
	let primeCooldown = false,
		primedAt = 0,
		preflightWaitMs = 0;
	const runtime: CloudTransportRuntime = {
		currentScope: () => scope,
		origin: () => base.origin,
		authorizeMutation: async () => {
			if (!primeCooldown) return;
			primeCooldown = false;
			primedAt = Date.now();
			// Consume only this disposable device's identity budget. The foreground
			// preflight must then honor the real cooldown before starting HTTP time.
			for (let attempts = 0; verifyCalls < 239 && attempts < 120; attempts++) {
				await request(fixture.userId, { action: 'conditions' }, signal);
			}
			assert.ok(verifyCalls >= 239);
		},
		fetch: async (url, init) => {
			if (primedAt && !preflightWaitMs && init?.method === 'POST') {
				assert.ok(cooldownCount >= 1);
				init.signal?.throwIfAborted();
				preflightWaitMs = Date.now() - primedAt;
				assert.ok(preflightWaitMs > 30_000, 'Real preflight must outlast the JSON network deadline');
			}
			return sessionFetch(url, init);
		},
		requireCapability: async (feature, minimum) => {
			assert.ok(capabilitySatisfies(manifest.features[feature]?.version, minimum), feature);
		}
	};
	const inventory = async () => {
		if (!wideFixture) return parseCloudInventory((await api('/api/v1/files?rootId=' + remoteRoot)).inventory, remoteRoot!);
		// Acceptance truth only; the production runner consumes bounded pages.
		const nodes: import('../app/fileSync/cloudInventory').CloudInventoryNode[] = [];
		let rootRevision = '', complete = false;
		for await (const page of readCloudFolderInventoryPages(scope, remoteRoot!, { ...runtime, signal })) {
			nodes.push(...page.nodes); rootRevision = page.rootRevision;
			if (page.totalEntries !== undefined) { assert.equal(nodes.length, page.totalEntries); complete = true; }
		}
		assert.ok(complete); return { version: 1 as const, complete: true as const, rootId: remoteRoot!, rootRevision, nodes };
	};

    if (photoFixture) {
        const roots = (await request(fixture.userId, { action: 'list' }, signal)).roots;
        assert.equal(roots[0].sourceKind, 'photos'); assert.equal(roots[0].publicationVersion, undefined);
        const runPhotos = () => runForegroundCloudSync(saved, scope, {
            currentScope: () => scope,
            readConfiguration: async () => (await api('/api/v1/things?id=' + row.id)).thing,
            authorizeDevice: async () => { await request(fixture.userId, { action: 'list' }, signal); },
            conditions: async () => (await request(fixture.userId, { action: 'conditions' }, signal)).conditions!,
            scanLocal: async () => (await request(fixture.userId, { action: 'scan', rootId: nativeRoot }, signal)).entries!,
            inventory, source: async entry => mobileFolderSource(fixture.userId, nativeRoot, entry, signal, request, caps),
            journal, runtime, progress: () => {}
        }, signal);
        const original = randomBytes(8 * 1024 * 1024 + 17), edited = randomBytes(original.length + 2);
        await writeFile(path.join(directory, 'selected/original.png'), original);
        await runPhotos();
        const first = (await inventory()).nodes;
        assert.equal(first.length, 1); assert.equal(first[0].kind, 'file');
        assert.ok(first[0].kind === 'file');
        const firstFile = first[0].file;
        const download = async (attachment: string) => {
            const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + attachment + '&cache=bytes', base));
            assert.equal(response.status, 200); return new Uint8Array(await response.arrayBuffer());
        };
        assert.equal(hash(await download(firstFile.content.attachmentId)), hash(original));
        await writeFile(path.join(directory, 'selected/original.png'), edited);
        await runPhotos();
        const changedNode = (await inventory()).nodes[0]; assert.ok(changedNode.kind === 'file');
        const changed = changedNode.file;
        assert.notEqual(changed.revision, firstFile.revision);
        assert.equal(hash(await download(changed.content.attachmentId)), hash(edited));
        assert.equal(hash(await download(firstFile.content.attachmentId)), hash(original));
        await rm(path.join(directory, 'selected/original.png'));
        await writeFile(path.join(directory, 'selected/second.png'), original);
        await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
        await runPhotos();
        const after = (await inventory()).nodes;
        assert.equal(after.length, 2);
        const retained = after.find(n => n.kind === 'file' && n.file.id === firstFile.id);
        assert.ok(retained?.kind === 'file'); assert.equal(retained.file.revision, changed.revision);
        for (const node of after) {
            assert.ok(node.kind === 'file');
            assert.equal(hash(await download(node.file.content.attachmentId)), hash(node.file.id === firstFile.id ? edited : original));
        }
        const puts = counts.puts; await runPhotos(); assert.equal(counts.puts, puts);
        assert.ok(counts.streams >= 6); assert.equal(counts.stageRanges, 0); assert.equal(counts.publishes, 0);
        console.log(JSON.stringify({ ok: true, scenario: 'Mac photo adapter backup', nativeCalls, verifyCalls, counts,
            verified: ['binary-original-hashes', 'retained-original-after-replacement', 'retention-after-device-deletion', 'new-photo-discovery', 'native-process-restart', 'no-repeat-upload'],
            photos: 'synthetic provider; real PhotoKit permission and library not exercised' }));
    } else {
	const seed = async (name: string, bytes: Uint8Array<ArrayBuffer>) => {
		const source = { size: bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length), check: () => {} };
		const entry = {
			path: name,
			id: 'seed-' + name,
			version: randomUUID(),
			kind: 'file' as const,
			size: bytes.length,
			sha256: null,
			fingerprint: await fingerprintSource(source)
		};
		const inv = await inventory(),
			before = inv.nodes.find((node) => node.path === name);
		const run = prepareCloudInventoryRun(
			createSyncRun({
				scope,
				decisions: [{ kind: 'copy', from: 'local', path: name, source: entry, expectedTarget: before ? inventorySyncEntry(before) : null }]
			}),
			inv
		);
		let retained: SyncRun | undefined;
		await executeSyncRun(
			run,
			createCloudSyncPort(
				run,
				{
					currentScope: () => scope,
					persist: async (value) => {
						retained = structuredClone(value);
					},
					readLocal: async () => entry,
					openSource: async () => source
				},
				runtime
			)
		);
		assert.ok(retained?.operations.every((operation) => operation.confirmed));
	};
	const localBytes = new Uint8Array(process.argv.includes('--large-upload') ? 8 * 1024 * 1024 + 17 : 65_537).fill(17),
		remoteBytes = new Uint8Array(process.argv.includes('--large-download') ? 2 * 1024 * 1024 + 17 : 65_539).fill(29);
	await writeFile(path.join(directory, 'selected/local.bin'), localBytes);
	await seed('remote.bin', remoteBytes);
	if (wideFixture) {
		assert.equal(base.origin, 'http://127.0.0.1:28311');
		console.log('MAC_PAGED_STAGE wide-folder-setup');
		for (let offset = 0; offset < wideFolders; offset += 1000) {
			const things = Array.from({ length: Math.min(1000, wideFolders - offset) }, (_, i) => ({
				id: 'folder-' + (offset + i), thingtime: ['folder'], crystal: { name: 'wide-' + String(offset + i).padStart(5, '0') }
			}));
			const imported = await api('/api/v1/things/import', { folderId: remoteRoot,
				manifest: { format: 'thingtime.transfer', version: 1, roots: things.map(t => t.id), things, files: [] } });
			assert.equal(imported.imported, things.length);
		}
		for (let offset = 0; offset < wideFolders; offset += 128)
			await Promise.all(Array.from({ length: Math.min(128, wideFolders - offset) }, (_, i) =>
				mkdir(path.join(directory, 'selected', 'wide-' + String(offset + i).padStart(5, '0')))));
		console.log('MAC_PAGED_STAGE wide-folders-ready');
	}
	primeCooldown = forcePreflightCooldown;
	let nativePages = 0, cloudPages = 0, reviewInterrupt = false, reviewedChoices = 0;
	const journalAccess = { scope, currentScope: () => scope };
	const confirmedIds = new Map<string, Set<string>>();
	const readRun = async () => {
		if (!pagedFixture) return (await journal.read(scope))!;
		const runs = journal.pagedRuns(journalAccess), active = await runs.active(); assert.ok(active);
		const pending = await runs.read(active.spec);
		assert.equal(pending.progress.confirmed, 0, 'Capture operation IDs at the first lost reply');
		return { id: active.spec.id, operations: pending.operations };
	};
	const assertCompletedRun = async (id: string, ids: string[]) => {
		if (pagedFixture) {
			assert.equal(await journal.pagedRuns(journalAccess).active(), null);
			assert.equal((await journal.pagedCheckpoints(journalAccess).current())?.runId, id);
			assert.deepEqual([...(confirmedIds.get(id) ?? [])].sort(), [...ids].sort());
		} else {
			const run = (await journal.read(scope))!; assert.equal(run.id, id);
			assert.deepEqual(run.operations.map(op => op.id).sort(), [...ids].sort());
			assert.ok(run.operations.every(op => op.confirmed));
		}
	};
	const run = async () => {
		let lastStage = '';
		const localTarget = await approveMobileSyncTarget(saved, scope, signal, request, caps);
		const result = await (pagedFixture ? runPagedForegroundCloudSync : runForegroundCloudSync)(
			saved,
			scope,
			{
				currentScope: () => scope,
				readConfiguration: async () => (await api('/api/v1/things?id=' + row.id)).thing,
				authorizeDevice: async () => {
					await request(fixture.userId, { action: 'list' }, signal);
				},
				conditions: async () => (await request(fixture.userId, { action: 'conditions' }, signal)).conditions!,
				scanLocal: async () => (await request(fixture.userId, { action: 'scan', rootId: nativeRoot }, signal)).entries!,
				...(pagedFixture ? {
					scanLocalPages: async function* () {
						for await (const page of readNativeInventory({ ownerId: fixture.userId, deviceId: deviceId!, rootId: nativeRoot, signal, request })) {
							nativePages++; yield page;
						}
					},
					inspectLocal: async (path: string) => (await request(fixture.userId, { action: 'inspect', rootId: nativeRoot, path }, signal)).inspectedEntry!,
					inventoryPages: async function* () {
						for await (const page of readCloudFolderInventoryPages(scope, remoteRoot!, { ...runtime, signal })) {
							cloudPages++; yield page;
						}
					},
					reviewPagedConflicts: async (session: import('../app/fileSync/pagedForegroundReview').PagedConflictReviewSession) => {
						const page = await session.read(); assert.equal(page.next, null); assert.equal(page.rows.length, 1);
						const row = page.rows[0];
						if (reviewInterrupt) {
							await session.choose(row.conflict.path, 'local', row.revision); reviewInterrupt = false;
							throw Error('Acceptance interrupted saved review');
						}
						assert.equal(row.from, 'local', 'Reopened review retains the actual saved choice'); reviewedChoices++;
						return { action: 'resolve' as const, revision: page.progress.revision };
					}
				} : {}),
				inventory,
				source: async (entry) => mobileFolderSource(fixture.userId, nativeRoot, entry, signal, request, caps),
				journal: pagedFixture ? { ...journal, pagedRuns: access => {
					const runs = journal.pagedRuns(access); return { ...runs, confirm: async (spec, receipt) => {
						const result = await runs.confirm(spec, receipt), ids = confirmedIds.get(spec.id) ?? new Set<string>();
						ids.add(receipt.operationId); confirmedIds.set(spec.id, ids); return result;
					} };
				} } : journal,
				runtime,
				localTarget,
				progress: value => { if (wideFixture && value.stage !== lastStage) {
					lastStage = value.stage; console.log('MAC_PAGED_STAGE sync-' + value.stage);
				} }
			},
			signal
		);
		return result;
	};
	loseCloud = true;
	losePublication = true;
	await assert.rejects(run(), /Lost accepted cloud commit/);
	const original = await readRun(),
		originalIds = original.operations.map((op) => op.id);
	const afterCloud = counts.puts;
    loseStage = true;
    await assert.rejects(run(), /Lost accepted native stage/);
    const firstStagedBytes = counts.stagedBytes;
    assert.equal(firstStagedBytes, Math.min(2 * 1024 * 1024, remoteBytes.length));
    await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
	await assert.rejects(run(), /Lost accepted native publication/);
    assert.equal(counts.stagedBytes, remoteBytes.length, 'Restart must resume after the accepted range without replay');
	assert.equal(counts.puts, afterCloud);
	await stopNative();
	journal.close();
	journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
	await startNative();
	const beforeRecovery = { ...counts };
	await run();
	assert.equal(counts.puts, beforeRecovery.puts);
	assert.equal(counts.publishes, beforeRecovery.publishes);
	await assertCompletedRun(original.id, originalIds);
	const verifyBytes = async (expected: Record<string, Uint8Array>) => {
		const inv = await inventory();
		assert.equal(inv.nodes.length, Object.keys(expected).length + wideFolders);
		const folders = inv.nodes.filter(n => n.kind === 'folder');
		assert.equal(folders.length, wideFolders);
		if (wideFixture) assert.deepEqual(folders.map(n => n.path).sort(), Array.from({ length: wideFolders }, (_, i) => 'wide-' + String(i).padStart(5, '0')));
		for (const node of inv.nodes) {
			if (node.kind !== 'file') continue;
			const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + node.file.content.attachmentId + '&cache=bytes', base));
			assert.equal(response.status, 200);
			assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(expected[node.path]));
			assert.equal(hash(await readFile(path.join(directory, 'selected', node.path))), hash(expected[node.path]));
		}
		return inv.nodes.map((node) => ({
			path: node.path,
			id: node.kind === 'file' ? node.file.id : node.id,
			revision: node.kind === 'file' ? node.file.revision : node.revision
		}));
	};
	assert.ok(counts.streams > 0 && counts.streamedBytes >= localBytes.length);
	const first = await verifyBytes({ 'local.bin': localBytes, 'remote.bin': remoteBytes });
	await run();
	assert.deepEqual(await verifyBytes({ 'local.bin': localBytes, 'remote.bin': remoteBytes }), first);
	if (wideFixture) {
		const head = (await journal.pagedCheckpoints(journalAccess).current())!; assert.ok(head);
		for (const id of [head.baseline.local, head.baseline.remote])
			assert.equal((await journal.inventory(journalAccess).read(id)).totalEntries, wideFolders + 2);
		assert.ok(nativePages >= 4 * 79 && cloudPages >= 4 * 79);
		console.log(JSON.stringify({ ok: true, paged: true, wideFolders, totalPaths: wideFolders + 2, nativePages, cloudPages,
			nativeCalls, verifyCalls, cooldownCount, cooldownSeconds, counts, picker: 'fixture', keychain: 'not-used',
			checks: ['wide-native-and-cloud-pages', 'complete-checkpoint', 'real-upload-download-byte-hashes', 'lost-accepted-replies',
				'native-restart', 'original-operation-IDs', 'no-replayed-transfers', 'stable-convergence'],
			provisioning: 'cloud folders created by the normal import API; real native directories and HTTP reads/transfers' }));
	} else {
	const oldInventory = await inventory();
	const editedLocal = new Uint8Array(257).fill(41),
		editedRemote = new Uint8Array(263).fill(53);
	await writeFile(path.join(directory, 'selected/local.bin'), editedLocal);
	await seed('remote.bin', editedRemote);
	await run();
	const replaced = await verifyBytes({ 'local.bin': editedLocal, 'remote.bin': editedRemote });
	assert.deepEqual(
		replaced.map((node) => node.id),
		first.map((node) => node.id)
	);
	assert.ok(replaced.every((node, index) => node.revision !== first[index].revision));
	await run();
	assert.deepEqual(await verifyBytes({ 'local.bin': editedLocal, 'remote.bin': editedRemote }), replaced);
	for (const node of oldInventory.nodes)
		if (node.kind === 'file') {
			const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + node.file.content.attachmentId + '&cache=bytes', base));
			assert.equal(response.status, 200);
			assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(node.path === 'local.bin' ? localBytes : remoteBytes));
		}
	if (pagedFixture) {
		const localWinner = new Uint8Array(277).fill(61), remoteAlternate = new Uint8Array(281).fill(71);
		await writeFile(path.join(directory, 'selected/local.bin'), localWinner);
		await seed('local.bin', remoteAlternate);
		reviewInterrupt = true;
		const before = { ...counts };
		await assert.rejects(run(), /Acceptance interrupted saved review/);
		assert.deepEqual(counts, before, 'Saving a review must not transfer or publish bytes');
		const draft = (await journal.reviewDrafts(journalAccess).active())!;
		assert.equal(draft.progress.selected, 1);
		await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
		await run(); assert.equal(reviewedChoices, 1);
		await verifyBytes({ 'local.bin': localWinner, 'remote.bin': editedRemote });
		const head = await journal.pagedCheckpoints(journalAccess).current(); assert.ok(head);
		assert.equal((await journal.inventory(journalAccess).read(head.baseline.local)).totalEntries, 2);
		assert.equal(await journal.reviewDrafts(journalAccess).active(), null);
		assert.ok(nativePages > 0 && cloudPages > 0);
	}

    // Fresh path observations distinguish a missing name from an old object's
    // missing id. Recreate the same nested path with two new stable identities.
    const pathProbe = 'path-check-' + randomUUID(), probeIds: string[] = [];
    const readProbe = () => readCloudPathEntry(runtime, scope, remoteRoot!, pathProbe + '/child', signal);
    const createProbeFolder = async (name: string, folderId: string) => {
        const id = randomUUID();
        await api('/api/v1/files', { kind: 'folder', id, operationId: id, name, folderId });
        probeIds.push(id); return id;
    };
    const removeProbeFolders = async () => {
        while (probeIds.length) {
            await api('/api/v1/things?id=' + probeIds.at(-1), undefined, 'DELETE');
            probeIds.pop();
        }
    };
    try {
        assert.equal(await readProbe(), null);
        const parent = await createProbeFolder(pathProbe, remoteRoot!);
        const child = await createProbeFolder('child', parent);
        assert.equal((await readProbe())!.id, child);
        await assert.rejects(readCloudPathEntry(runtime, scope, remoteRoot!, pathProbe.toUpperCase() + '/child', signal), /409/);
        await removeProbeFolders();
        assert.equal(await readProbe(), null);
        const replacementParent = await createProbeFolder(pathProbe, remoteRoot!);
        const replacementChild = await createProbeFolder('child', replacementParent);
        assert.notEqual(replacementChild, child);
        assert.equal((await readProbe())!.id, replacementChild);
    } finally { await removeProbeFolders(); }
    // Shared planner, fresh cloud absence and recoverable child-before-parent removal.
    await mkdir(path.join(directory, 'selected/deleted-tree'));
    await writeFile(path.join(directory, 'selected/deleted-tree/a.bin'), new Uint8Array([1, 2, 3]));
    await writeFile(path.join(directory, 'selected/deleted-tree/b.bin'), new Uint8Array([4, 5, 6]));
    await run();
    const tree = (await inventory()).nodes.filter(node => node.path === 'deleted-tree' || node.path.startsWith('deleted-tree/'));
    assert.equal(tree.length, 3);
    for (const node of tree) if (node.kind === 'file') {
        const f = node.file;
        await api('/api/v1/files', { id: f.id, operationId: randomUUID(), expectedRevision: f.revision,
            name: f.name, folderId: f.folderId, attachmentId: f.content.attachmentId, contentVersion: f.content.version, trashed: true });
    }
    const cloudParent = tree.find(node => node.kind === 'folder')!;
    assert.equal(cloudParent.kind, 'folder');
    await api('/api/v1/things?id=' + cloudParent.id, undefined, 'DELETE');
    loseTrash = true;
    await assert.rejects(run(), /Lost accepted native Trash/);
    const deletionRun = await readRun(), deletionIds = deletionRun.operations.map(op => op.id);
    assert.equal(deletionIds.length, 3);
    await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
    await run();
    await assertCompletedRun(deletionRun.id, deletionIds);
    await assert.rejects(stat(path.join(directory, 'selected/deleted-tree')), { code: 'ENOENT' });
    const recoveryPage = (await request(fixture.userId, { action: 'trash-list', rootId: nativeRoot }, signal)).trashPage!;
    const retainedTree = recoveryPage.items.filter(item => item.request.operation.mutation.path.startsWith('deleted-tree'));
    assert.equal(retainedTree.length, 3);
    retainedTree.sort((a, b) => a.request.operation.mutation.path.length - b.request.operation.mutation.path.length);
    for (const item of retainedTree) {
        const inspected = await request(fixture.userId, { action: 'trash-inspect', rootId: nativeRoot, trash: item.request }, signal);
        const restore = { path: item.request.operation.mutation.path, expected: inspected.retainedEntry! };
        const input = { action: 'trash-restore-reviewed' as const, rootId: nativeRoot, trash: item.request, restore };
        loseRestore = true;
        await assert.rejects(request(fixture.userId, input, signal), /Lost accepted restore/);
        await stopNative(); await startNative();
        const resumed = await request(fixture.userId, { action: 'trash-inspect', rootId: nativeRoot, trash: item.request }, signal);
        assert.deepEqual(resumed.restoreIntent!.request, restore);
        assert.ok((await request(fixture.userId, input, signal)).restoredEntry);
    }
    assert.deepEqual(await readFile(path.join(directory, 'selected/deleted-tree/a.bin')), Buffer.from([1, 2, 3]));
    assert.deepEqual(await readFile(path.join(directory, 'selected/deleted-tree/b.bin')), Buffer.from([4, 5, 6]));
    assert.equal((await request(fixture.userId, { action: 'trash-list', rootId: nativeRoot }, signal)).trashPage!.items.length, 0);
    // Additional direct recovery leaves an occupied destination untouched.
    const recoverBytes = new Uint8Array(131_079).fill(63);
    await writeFile(path.join(directory, 'selected/recover-only.bin'), recoverBytes);
    const recoverEntry = (await request(fixture.userId, { action: 'scan', rootId: nativeRoot }, signal)).entries!.find(e => e.path === 'recover-only.bin')!;
    const recoverOperation = { id: randomUUID(), confirmed: false, mutation: { kind: 'trash' as const, side: 'local' as const, path: recoverEntry.path, expected: recoverEntry } };
    const recoverRequest = { scope, rootId: nativeRoot, operation: recoverOperation };
    const deletionConfig = { ...saved, configuration: { ...saved.configuration, propagateDeletes: true } };
    let deletionTarget = await approveMobileSyncTarget(deletionConfig, scope, signal, request, caps);
    const recoveryReceipt = await deletionTarget.trash!(recoverOperation, scope);
    assert.equal(recoveryReceipt.entry, null);
    await assert.rejects(readFile(path.join(directory, 'selected/recover-only.bin')), { code: 'ENOENT' });
    await stopNative(); await startNative();
    deletionTarget = await approveMobileSyncTarget(deletionConfig, scope, signal, request, caps);
    assert.deepEqual(await deletionTarget.lookup(recoverOperation, scope), { status: 'complete', receipt: recoveryReceipt });
    const retained = (await request(fixture.userId, { action: 'trash-inspect', rootId: nativeRoot, trash: recoverRequest }, signal)).retainedEntry!;
    assert.equal(retained.id, recoverEntry.id);
    const approval = { scope, configurationRevision: saved.updatedAt,
        configurationHash: createHash('sha256').update(JSON.stringify(deletionConfig.configuration)).digest('hex'), allowTrash: true };
    await writeFile(path.join(directory, 'selected/recover-only.bin'), new Uint8Array([73]));
    await assert.rejects(request(fixture.userId, { action: 'trash-restore', rootId: nativeRoot, trash: recoverRequest,
        restore: { path: recoverEntry.path, expected: retained }, approval }, signal));
    const restored = await request(fixture.userId, { action: 'trash-restore', rootId: nativeRoot, trash: recoverRequest,
        restore: { path: 'recovered-only.bin', expected: retained }, approval }, signal);
    assert.equal(restored.restoredEntry!.id, retained.id);
    assert.equal(hash(await readFile(path.join(directory, 'selected/recovered-only.bin'))), hash(recoverBytes));
    assert.deepEqual(await readFile(path.join(directory, 'selected/recover-only.bin')), Buffer.from([73]));
	await api('/api/v1/devices/disconnect', { deviceId });
    await assert.rejects(request(fixture.userId, { action: 'trash-inspect', rootId: nativeRoot, trash: recoverRequest }, signal), /401/);
	await assert.rejects(request(fixture.userId, { action: 'scan', rootId: nativeRoot }, signal), /401/);
	assert.equal(hash(await readFile(path.join(directory, 'selected/remote.bin'))), hash(editedRemote));
	if (forcePreflightCooldown) assert.ok(preflightWaitMs > 30_000);
	console.log(
		JSON.stringify({
			ok: true,
			paged: pagedFixture,
			...(pagedFixture ? { nativePages, cloudPages, reviewedChoices } : {}),
			checks: [
				'signed-pairing',
                'native-trash-restart-recovery',
                'planner-child-parent-deletion',
                'native-recovery-list-and-approved-restore',
                'lost-restore-reply-restart',
                'exclusive-native-trash-restore',
                'native-trash-revoked-identity',
				'live-native-identity',
				'real-Mac-upload-download',
				'lost-cloud-reply',
                'lost-native-stage-reply',
				'lost-native-publication-reply',
				'native-process-restart',
				'original-IDs',
				'no-replay',
				'full-byte-hashes',
				'stable-convergence',
				'independent-replacements',
				'retained-cloud-versions',
				'fresh-cloud-path-replacement-and-alias-checks',
				'revocation'
			],
			nativeCalls,
			verifyCalls,
			cooldownCount,
			cooldownSeconds,
			preflightWaitMs,
			counts,
			picker: 'fixture',
			keychain: 'not-used'
		})
	);
    }
    }
} finally {
	if (wideFixture) console.log('MAC_PAGED_STAGE cleanup');
	loseCloud = false;
	losePublication = false;
	let stopFailure: unknown;
	try {
		await stopNative();
	} catch (error) {
		stopFailure = error;
	}
	journal.close();
	try {
		if (remoteRoot && !wideFixture) {
			const value = await api('/api/v1/files?rootId=' + remoteRoot);
			for (const node of value.inventory.nodes)
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
				}
		}
		if (configurationId) await api('/api/v1/things?id=' + configurationId, undefined, 'DELETE');
		if (remoteRoot && !wideFixture) await api('/api/v1/things?id=' + remoteRoot, undefined, 'DELETE');
		const devices = deviceId ? [{ id: deviceId, name: deviceName }] : (await api('/api/v1/devices')).devices;
		for (const device of devices)
			if (device.id === deviceId || device.name === deviceName) await api('/api/v1/devices/disconnect', { deviceId: device.id });
	} finally {
		await rm(directory, { recursive: true, force: true });
		await api('/api/v1/auth/accounts/remove', { userId: fixture.userId });
	}
	if (stopFailure) throw stopFailure;
}
