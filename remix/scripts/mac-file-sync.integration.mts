// Opt-in real MacFolderSync + cloud acceptance. Picker/consent and credentials
// are isolated test adapters; this never uses the installed Node or Keychain.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomBytes, randomUUID, sign, createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { runForegroundCloudSync } from '../app/fileSync/foregroundSync';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { parseCloudInventory, inventorySyncEntry } from '../app/fileSync/cloudInventory';
import { parseMobileFolderResult, mobileFolderSource, type FolderRequest, type FolderCapabilities } from '../app/fileSync/mobileFolders.client';
import { approveMobileSyncTarget } from '../app/fileSync/mobileSyncTarget.client';
import { createSyncRun, executeSyncRun, type SyncRun } from '../app/fileSync/execute';
import { prepareCloudInventoryRun } from '../app/fileSync/cloudWrite';
import { createCloudSyncPort } from '../app/fileSync/cloudSyncPort.client';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import type { CloudTransportRuntime } from '../app/fileSync/cloudTransport';

const { FolderStream } = createRequire(import.meta.url)('../../electron/lib/folder-stream.cjs');

const [fixturePath] = process.argv.slice(2);
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
const counts = { puts: 0, publishes: 0, reads: 0, streams: 0, streamedBytes: 0 };
let cooldownCount = 0,
	cooldownSeconds = 0,
	priorCooldownCount = 0,
	priorCooldownSeconds = 0;
let loseCloud = false,
	losePublication = false;
const sessionFetch: typeof fetch = async (url, init = {}) => {
	const target = new URL(String(url), base),
		headers = new Headers(init.headers);
	if (target.origin === base.origin && init.credentials !== 'omit') {
		headers.set('Cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
		headers.set('Origin', base.origin);
	}
	if (init.method === 'PUT') counts.puts++;
	const response = await fetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30000) });
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
	return response.json();
}
async function startNative() {
	lastVerifyCalls = 0;
	priorCooldownCount = 0;
	priorCooldownSeconds = 0;
	native = spawn(path.resolve('../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), [path.join(directory, 'native.json')]);
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
		native!.stdin.write(JSON.stringify(payload) + '\n');
	});
}
const signal = new AbortController().signal;
const caps: FolderCapabilities = { platform: 'macos', fileAccessVersion: '1.2.0', fileStagingVersion: '1.0.0', filePublicationVersion: '1.1.0' };
let deviceId: string | undefined, remoteRoot: string | undefined, configurationId: string | undefined;
const deviceName = 'Mac sync acceptance ' + randomUUID();
const factory = new IDBFactory();
let journal = await openSyncJournal(factory);
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
		JSON.stringify({ base: base.origin, deviceId, credential, directory: pathToFileURL(directory + '/').href }),
		{ mode: 0o600 }
	);
	await startNative();
	const request = async (ownerId: string, input: FolderRequest, abort: AbortSignal) => {
		abort.throwIfAborted();
		const expected = { requestId: randomUUID(), ownerId, origin: base.origin };
		if (input.action === 'read') counts.reads++;
        if (input.action === 'read-range') { counts.streams++; counts.streamedBytes += input.length; }
		if (input.action === 'publish') counts.publishes++;
		const payload = await send({ ...expected, deviceId, ...input });
		assert.equal(payload.deviceId, deviceId);
		const result = parseMobileFolderResult({ type: 'mobile-files-result', payload }, expected, input);
		assert.ok(result);
		if (input.action === 'publish' && losePublication) {
			losePublication = false;
			throw Error('Lost accepted native publication');
		}
		return result;
	};
	const nativeRoot = (await request(fixture.userId, { action: 'choose' }, signal)).roots[0].id;
	remoteRoot = (await api('/api/v1/things', { thingtime: ['folder'], crystal: { name: deviceName } })).thing.id;
	const row = (
		await api('/api/v1/things', {
			thingtime: ['file-sync'],
			crystal: {
				...newFileSyncConfiguration({ name: deviceName, deviceId: deviceId!, localRootId: nativeRoot, remoteFolderId: remoteRoot! }),
				mode: 'two-way',
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
	const inventory = async () => parseCloudInventory((await api('/api/v1/files?rootId=' + remoteRoot)).inventory, remoteRoot!);
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
		remoteBytes = new Uint8Array(65_539).fill(29);
	await writeFile(path.join(directory, 'selected/local.bin'), localBytes);
	await seed('remote.bin', remoteBytes);
	primeCooldown = forcePreflightCooldown;
	const run = async () => {
		const localTarget = await approveMobileSyncTarget(saved, scope, signal, request, caps);
		return runForegroundCloudSync(
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
				inventory,
				source: async (entry) => mobileFolderSource(fixture.userId, nativeRoot, entry, signal, request, caps),
				journal,
				runtime,
				localTarget,
				progress: () => {}
			},
			signal
		);
	};
	loseCloud = true;
	losePublication = true;
	await assert.rejects(run(), /Lost accepted cloud commit/);
	const original = (await journal.read(scope))!,
		originalIds = original.operations.map((op) => op.id);
	const afterCloud = counts.puts;
	await assert.rejects(run(), /Lost accepted native publication/);
	assert.equal(counts.puts, afterCloud);
	await stopNative();
	journal.close();
	journal = await openSyncJournal(factory);
	await startNative();
	const beforeRecovery = { ...counts };
	await run();
	assert.equal(counts.puts, beforeRecovery.puts);
	assert.equal(counts.publishes, beforeRecovery.publishes);
	assert.equal((await journal.read(scope))!.id, original.id);
	assert.deepEqual(
		(await journal.read(scope))!.operations.map((op) => op.id),
		originalIds
	);
	assert.ok((await journal.read(scope))!.operations.every((op) => op.confirmed));
	const verifyBytes = async (expected: Record<string, Uint8Array>) => {
		const inv = await inventory();
		assert.equal(inv.nodes.length, Object.keys(expected).length);
		for (const node of inv.nodes) {
			assert.equal(node.kind, 'file');
			if (node.kind !== 'file') throw Error('Unexpected folder');
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
	await api('/api/v1/devices/disconnect', { deviceId });
	await assert.rejects(request(fixture.userId, { action: 'scan', rootId: nativeRoot }, signal), /401/);
	assert.equal(hash(await readFile(path.join(directory, 'selected/remote.bin'))), hash(editedRemote));
	if (forcePreflightCooldown) assert.ok(preflightWaitMs > 30_000);
	console.log(
		JSON.stringify({
			ok: true,
			checks: [
				'signed-pairing',
				'live-native-identity',
				'real-Mac-upload-download',
				'lost-cloud-reply',
				'lost-native-publication-reply',
				'native-process-restart',
				'original-IDs',
				'no-replay',
				'full-byte-hashes',
				'stable-convergence',
				'independent-replacements',
				'retained-cloud-versions',
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
} finally {
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
		if (remoteRoot) {
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
		if (remoteRoot) await api('/api/v1/things?id=' + remoteRoot, undefined, 'DELETE');
		const devices = deviceId ? [{ id: deviceId, name: deviceName }] : (await api('/api/v1/devices')).devices;
		for (const device of devices)
			if (device.id === deviceId || device.name === deviceName) await api('/api/v1/devices/disconnect', { deviceId: device.id });
	} finally {
		await rm(directory, { recursive: true, force: true });
		await api('/api/v1/auth/accounts/remove', { userId: fixture.userId });
	}
	if (stopFailure) throw stopFailure;
}
