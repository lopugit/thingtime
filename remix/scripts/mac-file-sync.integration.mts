// Opt-in real MacFolderSync + cloud acceptance. Picker/consent and credentials
// are isolated test adapters; this never uses the installed Node or Keychain.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, stat, truncate, rename, symlink, readlink, lstat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MacFixtureTransport, FixtureIdentityTiming, FixturePageObservers, FixtureReceiptObservations, fixtureActionLabel, fixturePathLabel } from './mac-fixture-transport.mjs';
import { createMacFixtureHost, macFixtureWorkerOptions, macFixtureRuntime } from './mac-fixture-host.mts';
import { createFixtureTLSFetch } from './mac-fixture-tls.mjs';
import { saveDeviceSyncResourcePolicy, deviceResourceKey, readDeviceSyncResourcePolicy } from '../app/fileSync/deviceResourcePolicy';
import { NATIVE_INVENTORY_BATCH_ENTRIES } from '../app/fileSync/nativeInventory';
import { supportsNativeStreamingBatches } from '../app/fileSync/mobileFolders.client';
import { createRequire } from 'node:module';
import { generateKeyPairSync, randomBytes, randomUUID, sign, createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { runForegroundCloudSync } from '../app/fileSync/foregroundSync';
import { runPagedForegroundCloudSync } from '../app/fileSync/pagedForegroundSync';
import { readNativeIndexChanges } from '../app/fileSync/streamingIndex';
import { readCloudIndexChanges } from '../app/fileSync/cloudIndexChanges.client';
import type { ForegroundSyncInput } from '../app/fileSync/foregroundSync';
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
import { createCloudDownloadSource } from '../app/fileSync/cloudDownloadSource';
import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import { parseTimelineEntry } from '../app/timeline/contract';
import { timelineFileVersion, fileRestoreCommand, checkFileRestoreReceipt, fileContentId } from '../app/fileSync/fileVersions';
import type { CloudTransportRuntime } from '../app/fileSync/cloudTransport';

const { FolderStream } = createRequire(import.meta.url)('../../electron/lib/folder-stream.cjs');

const [fixturePath] = process.argv.slice(2);
const fixtureIndexer = process.env.THINGTIME_MAC_SYNC_INDEXER_BIN;
if (fixtureIndexer) {
	assert.ok(path.isAbsolute(fixtureIndexer));
	assert.ok((await stat(fixtureIndexer)).isFile(), 'The fixture Rust indexer must be a regular executable.');
}
const photoFixture = process.argv.includes('--photos');
const symlinksOnly = process.argv.includes('--symlinks-only');
const earlyFixture = process.argv.includes('--two-way-early');
const normalEarlyBudget = process.argv.includes('--normal-early-budget');
const uploadStartDiagnostic = process.argv.includes('--upload-start-diagnostic');
if (uploadStartDiagnostic && (!earlyFixture || !normalEarlyBudget)) throw Error('Upload-start diagnostic requires normal-budget early mode');
if (normalEarlyBudget && !earlyFixture) throw Error('Normal early budget requires the early fixture.');
const pagedFixture = process.argv.includes('--paged');
const wideFixture = process.argv.includes('--wide');
const wideMixedFixture = process.argv.includes('--wide-mixed');
const wideCountArg = process.argv.find(arg => arg.startsWith('--wide-count='));
const wideFolders = wideFixture ? Number(wideCountArg?.slice(13) || 10001) : 0;
const benchmarkDeviceLimits = (wideMixedFixture || earlyFixture) ? { transferBytesPerSecond: 5_000_000, scanBytesPerSecond: earlyFixture && !normalEarlyBudget ? 400_000 : 5_000_000, cpuPercent: 15 } : null;
assert.ok(!wideFixture || pagedFixture, 'Wide acceptance requires the paged runner');
assert.ok(!wideMixedFixture || wideFixture, 'Mixed large-folder acceptance requires the wide paged runner');
assert.ok(!wideCountArg || (wideFixture && Number.isSafeInteger(wideFolders) && wideFolders > 0 && wideFolders <= 10001), 'Diagnostic wide count must be between 1 and 10,001');
assert.ok(!pagedFixture || !photoFixture, 'Photos retain their separate bounded acceptance');
const forcePreflightCooldown = process.argv.includes('--cooldown-before-upload');
assert.ok(fixturePath);
assert.equal((await stat(fixturePath)).mode & 0o077, 0);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8')),
	base = new URL(fixture.base);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.origin, fixture.base);
const setupByteFetch: typeof fetch = fixture.tls ? createFixtureTLSFetch(fixture.tls.origin, fixture.tls.caFile) : fetch;
const directory = await mkdtemp(path.join(tmpdir(), 'thingtime-mac-sync-live-'));
const cookies = new Map<string, string>();
let native: ChildProcessWithoutNullStreams | undefined;
let nativeTransport: MacFixtureTransport | undefined;
const nativeIdentityTiming = new FixtureIdentityTiming();
const nativeIdentityCalls: Record<string, unknown>[] = [];
const nativeRequestTimings: Record<string, unknown>[] = [];
const nativeServiceCalls: { session: number; requestId: string; action: string; path: string; lane: string; startedMs: number; endedMs: number }[] = [];
const phaseTimings: { phase: string; path: string; operationId: string | null; at: number }[] = [];
const preparedCounts = new Map<string, number>();
let nativeSession = 0, transferRunStartedAtMonotonic = 0;
const recordPhase = (phase: string, path: string | undefined, operationId?: string, at = performance.now()) => {
    phaseTimings.push({ phase, path: fixturePathLabel(path), operationId: operationId ?? null, at });
};
const nativeConcurrency = () => {
    let peak = 0;
    for (const session of new Set(nativeServiceCalls.map(call => call.session))) {
        let active = 0;
        const points = nativeServiceCalls.filter(call => call.session === session && call.lane === 'active')
            .flatMap(call => [[call.startedMs, 1], [call.endedMs, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        for (const [, delta] of points) { active += delta; peak = Math.max(peak, active); }
    }
    return { policyActiveSlotLimit: 1, observedActiveRequestPeak: peak,
        policySource: 'MacFolderSync.swift:506-508', scope: 'top-level native service calls; index/CPU work and control lanes may overlap' };
};
const nativeServiceTiming: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
let nativeExit: Promise<void> | undefined,
	nativeCalls = 0,
	verifyCalls = 0;
const counts = { puts: 0, publishes: 0, reads: 0, streams: 0, streamedBytes: 0, stageRanges: 0, stagedBytes: 0 };
const httpRequests: Record<string, number> = {};
const httpLatency: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
const nativeLatency: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
const slowEvents: Record<string, number> = {};
let transferRunStartedAt = 0, firstTransferMs: number | null = null;
const benchmarkTimeline: { firstCompleteNativeInventoryObservedMs: number | null; firstConfirmedFileMs: number | null } = { firstCompleteNativeInventoryObservedMs: null, firstConfirmedFileMs: null };
const earlyFirstRequestMs: Record<string, number> = {};
const markEarlyRequest = (label: string) => {
	if (earlyFixture && transferRunStartedAt && earlyFirstRequestMs[label] === undefined)
		earlyFirstRequestMs[label] = Date.now() - transferRunStartedAt;
};
let earlyIdentityStartTotalMs = 0;
let cooldownCount = 0,
	cooldownSeconds = 0;
let loseCloud = false,
	losePublication = false,
    loseStage = false;
const sessionFetch: typeof fetch = async (url, init = {}) => {
	const target = new URL(String(url), base),
		headers = new Headers(init.headers);
	const requestClass = (init.method || 'GET') + ' ' + target.pathname;
	markEarlyRequest('http ' + requestClass);
	httpRequests[requestClass] = (httpRequests[requestClass] || 0) + 1;
	if (transferRunStartedAt && firstTransferMs === null && init.method === 'PUT') firstTransferMs = Date.now() - transferRunStartedAt;
	if (target.origin === base.origin && init.credentials !== 'omit') {
		headers.set('Cookie', [...cookies].map(([k, v]) => k + '=' + v).join('; '));
		headers.set('Origin', base.origin);
	}
	if (init.method === 'PUT') counts.puts++;
	let response: Response;
	const started = Date.now();
	try { response = await setupByteFetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(target.pathname === '/api/v1/things/import' ? 120000 : 30000) }); }
	catch (cause) { throw Error(`Acceptance HTTP ${init.method ?? 'GET'} ${target.pathname} failed`, { cause }); }
	finally {
		const elapsed = Date.now() - started, metric = httpLatency[requestClass] ?? { count: 0, totalMs: 0, maxMs: 0 };
		metric.count++; metric.totalMs += elapsed; metric.maxMs = Math.max(metric.maxMs, elapsed); httpLatency[requestClass] = metric;
		if (wideMixedFixture && elapsed > 15_000 && (slowEvents[requestClass] || 0) < 3) {
			slowEvents[requestClass] = (slowEvents[requestClass] || 0) + 1;
			console.log('MAC_PAGED_STAGE slow-http-' + (init.method || 'GET').toLowerCase() + '-' + target.pathname.split('/').filter(Boolean).join('-') + '-' + Math.round(elapsed / 1000) + 's');
		}
	}
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
    const session = ++nativeSession;
    const observeIdentityTiming = nativeIdentityTiming.beginSession();
    let lastVerifyCalls = 0, priorCooldownCount = 0, priorCooldownSeconds = 0;
    const seenIdentityChecks = new Set<number>(), seenServiceCalls = new Set<string>();
	native = spawn(process.env.THINGTIME_MAC_SYNC_FIXTURE_BIN || path.resolve('../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), [path.join(directory, 'native.json')]);
	const current = native;
    nativeTransport = new MacFixtureTransport({
        write: (frame: Buffer) => current.stdin.write(frame),
        createStream: (payload: any) => new FolderStream({ id: payload.requestId, method: 'folder-sync.request', parameters: payload }),
        observeRequest: (event: any) => { if (earlyFixture) nativeRequestTimings.push({ ...event, session }); }
    });
    const transport = nativeTransport;
    nativeExit = new Promise((resolve, reject) => {
        current.on('error', error => { transport.close(error); reject(error); });
        current.on('exit', code => {
            transport.close(Error('Native fixture exited'));
            if (code === 0) resolve(); else reject(Error('Native fixture exited ' + code));
        });
    });
    void nativeExit.catch(() => {});
    current.stderr.on('data', () => {}); // Never forward credential-bearing diagnostics.
    current.stdin.on('error', error => transport.close(error));
    const lines = createInterface({ input: current.stdout });
    lines.on('close', () => transport.close(Error('Native fixture output closed')));
    lines.on('line', line => {
        try {
            assert.ok(line.length <= 1_000_000);
            const value = JSON.parse(line);
            if (value.type !== 'chunk' && value.type !== 'batch') {
                const action = transport.pending.get(value.requestId)?.payload.action;
                if (action && Number.isFinite(value.serviceMs) && value.serviceMs >= 0) {
                    const metric = nativeServiceTiming[action] ??= { count: 0, totalMs: 0, maxMs: 0 };
                    metric.count++; metric.totalMs += value.serviceMs; metric.maxMs = Math.max(metric.maxMs, value.serviceMs);
                }
                // Concurrent responses may arrive after a later counter sample.
                const checks = Math.max(lastVerifyCalls, value.identityChecks);
                verifyCalls += checks - lastVerifyCalls; lastVerifyCalls = checks;
                const count = Math.max(priorCooldownCount, value.cooldowns.count);
                const seconds = Math.max(priorCooldownSeconds, value.cooldowns.seconds);
                cooldownCount += count - priorCooldownCount; cooldownSeconds += seconds - priorCooldownSeconds;
                priorCooldownCount = count; priorCooldownSeconds = seconds;
                observeIdentityTiming(value.identityTiming);
                for (const call of value.identityCalls ?? []) {
                    assert.ok(Number.isSafeInteger(call.checkId) && call.checkId > 0);
                    if (!seenIdentityChecks.has(call.checkId)) { seenIdentityChecks.add(call.checkId); nativeIdentityCalls.push({ ...call, session }); }
                }
                if (earlyFixture && value.nativeRequestTiming && !seenServiceCalls.has(value.requestId)) {
                    seenServiceCalls.add(value.requestId);
                    const timing = value.nativeRequestTiming;
                    assert.ok(['active','poll','resources'].includes(timing.lane) && Number.isFinite(timing.startedMs) && Number.isFinite(timing.endedMs) && timing.endedMs >= timing.startedMs);
                    nativeServiceCalls.push({ session, requestId: value.requestId, action: fixtureActionLabel(timing.action),
                        path: fixturePathLabel(timing.path), lane: timing.lane, startedMs: timing.startedMs, endedMs: timing.endedMs });
                }
            }
            transport.receive(value);
        } catch { transport.close(Error('Invalid native fixture frame')); }
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
async function send(payload: any, signal?: AbortSignal, options: any = {}) {
    assert.ok(native && nativeTransport);
    nativeCalls++;
    markEarlyRequest('native ' + payload.action);
    if (payload.action === 'read') counts.reads++;
    if (payload.action === 'read-range') { counts.streams++; counts.streamedBytes += payload.length; }
    if (payload.action === 'publish') counts.publishes++;
    if (payload.action === 'stage-range') { counts.stageRanges++; counts.stagedBytes += payload.bytes.length; }
    return nativeTransport.request(payload, signal, options);
}
const signal = new AbortController().signal;
let canonicalHost: Awaited<ReturnType<typeof createMacFixtureHost>> | undefined;
const hostTimings: Record<string, unknown>[] = [];
const boundaryTimings: { phase: string; at: number; elapsedMs: number }[] = [];
async function measured<T>(phase: string, work: () => Promise<T>): Promise<T> {
 const at = performance.now(); try { return await work(); } finally { boundaryTimings.push({ phase, at, elapsedMs: performance.now() - at }); }
}
const serverPuts = async () => {
 if (!fixture.requestTimings) throw Error('Canonical worker requires server-side PUT observation');
 try { const rows = (await readFile(fixture.requestTimings, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
 return rows.filter(event => event.operation === 'attachment-object-put').map(event => {
   const first = rows.find(row => row.sequence === event.sequence && row.operation === 'attachment-object-put-first-byte');
   const body = rows.find(row => row.sequence === event.sequence && row.operation === 'attachment-object-put-body');
   return { ...event, firstByteAt: first?.firstByteAt ?? null, payloadBytes: body?.payloadBytes ?? null };
 }); }
 catch (error) { if ((error as { code?: string }).code === 'ENOENT') return []; throw error; }
};
let caps: FolderCapabilities = { platform: 'macos', fileAccessVersion: '1.17.0', fileSymbolicLinksVersion: '1.0.0', fileStagingVersion: '1.1.0', filePublicationVersion: '1.2.0', fileTrashVersion: '1.2.0' };
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
		JSON.stringify({ base: base.origin, deviceId, credential, photoFixture, directory: pathToFileURL(directory + '/').href,
			...(fixtureIndexer ? { commanderIndexer: pathToFileURL(fixtureIndexer).href } : {}) }),
		{ mode: 0o600 }
	);
	await startNative();
	const nativeContext = await send({ requestId: randomUUID(), ownerId: fixture.userId, deviceId, origin: base.origin, action: 'context' });
	assert.equal(nativeContext.capabilities.filePublicationVersion, '1.2.0');
    if (earlyFixture) {
        saveDeviceSyncResourcePolicy(deviceResourceKey(base.origin, fixture.userId, deviceId!), benchmarkDeviceLimits!);
        canonicalHost = await createMacFixtureHost({ origin: base.origin, ownerId: fixture.userId, deviceId: deviceId!, signal,
            fetch: sessionFetch, sendNative: send,
            cancelNative: id => { const row = nativeTransport?.pending.get(id); if (row) nativeTransport!.cancel(row, Error('Fixture host suspended')); },
            resourcePolicy: { get resourceScope() { return configurationId ?? deviceName; },
                deviceResourceLimits: () => benchmarkDeviceLimits!, observe: () => {} },
            diagnostic: row => { if (row.phase === 'folder-timing' || row.phase === 'digest-worker') hostTimings.push(row); } });
        caps = canonicalHost.capabilities!;
        assert.equal(caps.fileAccessVersion, nativeContext.capabilities.fileAccessVersion);
        assert.deepEqual(readDeviceSyncResourcePolicy(deviceResourceKey(base.origin, fixture.userId, deviceId!)), benchmarkDeviceLimits);
        const effective = await canonicalHost.request(fixture.userId, { action: 'resources', deviceResourceLimits: benchmarkDeviceLimits! }, signal);
        assert.deepEqual(effective.deviceResourceLimits, benchmarkDeviceLimits, 'Native and renderer device policy must match');
    }
	let loseTrash = false, loseRestore = false;
	const request = async (ownerId: string, input: FolderRequest, abort: AbortSignal) => {
		abort.throwIfAborted();
		markEarlyRequest((canonicalHost ? 'host ' : 'native ') + input.action);
		const expected = { requestId: randomUUID(), ownerId, origin: base.origin };

		const started = Date.now();
		let payload: any;
		try { payload = canonicalHost ? await canonicalHost.request(ownerId, input, abort) : await send({ ...expected, deviceId, ...input, ...(benchmarkDeviceLimits ? { deviceResourceLimits: benchmarkDeviceLimits } : {}) }, abort); }
		finally {
			const elapsed = Date.now() - started, metric = nativeLatency[input.action] ?? { count: 0, totalMs: 0, maxMs: 0 };
			metric.count++; metric.totalMs += elapsed; metric.maxMs = Math.max(metric.maxMs, elapsed); nativeLatency[input.action] = metric;
			if (wideMixedFixture && elapsed > 15_000 && (slowEvents['native ' + input.action] || 0) < 3) {
				slowEvents['native ' + input.action] = (slowEvents['native ' + input.action] || 0) + 1;
				console.log('MAC_PAGED_STAGE slow-native-' + input.action + '-' + Math.round(elapsed / 1000) + 's');
			}
		}
		if (!canonicalHost) assert.equal(payload.deviceId, deviceId);
		const result = canonicalHost ? payload : parseMobileFolderResult({ type: 'mobile-files-result', payload }, expected, input);
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
	if (benchmarkDeviceLimits && !earlyFixture) {
		const selected = (await request(fixture.userId, { action: 'resources' }, signal)).deviceResourceLimits;
		assert.deepEqual(selected, benchmarkDeviceLimits, 'Synthetic device policy must match the benchmark limits');
	}
	remoteRoot = (await api('/api/v1/things', { thingtime: ['folder'], crystal: { name: deviceName } })).thing.id;
	const row = (
		await api('/api/v1/things', {
			thingtime: ['file-sync'],
			crystal: {
				...newFileSyncConfiguration({ name: deviceName, deviceId: deviceId!, localRootId: nativeRoot, remoteFolderId: remoteRoot!, ...(photoFixture ? { sourceKind: 'photos' } : {}) }),
				mode: photoFixture ? 'backup' : 'two-way',
				propagateDeletes: !photoFixture && !earlyFixture,
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
	const runtime: CloudTransportRuntime = canonicalHost ? macFixtureRuntime(canonicalHost, scope) : {
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
            readConfiguration: async () => measured('configuration', async () => (await api('/api/v1/things?id=' + row.id)).thing),
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
	const mixedFiles: Record<string, Uint8Array> = {}, mixedFolders: string[] = [];
	const phaseMs: Record<string, number> = {};
	const measure = async (name: string, action: () => Promise<unknown>) => {
		const started = Date.now();
		try { return await action(); }
		finally { phaseMs[name] = Date.now() - started; }
	};
	await writeFile(path.join(directory, 'selected/local.bin'), localBytes);
	if (!uploadStartDiagnostic) await seed('remote.bin', remoteBytes);
    else assert.equal((await inventory()).nodes.length, 0, 'Upload-start diagnostic requires an initially empty synthetic cloud folder');
    if (earlyFixture && !uploadStartDiagnostic) {
        const remote = (await inventory()).nodes.find(node => node.path === 'remote.bin');
        assert.ok(remote?.kind === 'file');
        const source = createCloudDownloadSource(runtime, scope, remote.file, signal);
        try { await source.downloadTarget!(0, Math.min(remoteBytes.length, 2 * 1024 * 1024), signal); }
        catch (cause) {
            throw Error('Canonical two-way benchmark prerequisite failed: the selected storage provider must supply an owned signed HTTPS download range. No timing run was started.', { cause });
        }
    }
	if (wideFixture) {
		const setupStarted = Date.now();
		assert.equal(base.origin, 'http://127.0.0.1:28311');
		console.log('MAC_PAGED_STAGE wide-folder-setup');
		for (let offset = 0; offset < wideFolders; offset += 250) {
			const things = Array.from({ length: Math.min(250, wideFolders - offset) }, (_, i) => ({
				id: 'folder-' + (offset + i), thingtime: ['folder'], crystal: { name: 'wide-' + String(offset + i).padStart(5, '0') }
			}));
			const imported = await api('/api/v1/things/import', { folderId: remoteRoot,
				manifest: { format: 'thingtime.transfer', version: 1, roots: things.map(t => t.id), things, files: [] } });
			assert.equal(imported.imported, things.length);
			if ((offset + things.length) % 1000 === 0 || offset + things.length === wideFolders)
				console.log('MAC_PAGED_STAGE wide-imported-' + (offset + things.length));
		}
		for (let offset = 0; offset < wideFolders; offset += 128)
			await Promise.all(Array.from({ length: Math.min(128, wideFolders - offset) }, (_, i) =>
				mkdir(path.join(directory, 'selected', 'wide-' + String(offset + i).padStart(5, '0')))));
		if (wideMixedFixture) {
			// Keep the 10,001 API-provisioned siblings, then exercise real nested
			// upload work including empty, small, medium and multi-range files.
			for (let folder = 0; folder < 6; folder++) {
				const parent = 'wide-' + String(Math.floor(folder * wideFolders / 6)).padStart(5, '0');
				const nested = parent + '/nested';
				mixedFolders.push(nested);
				await mkdir(path.join(directory, 'selected', nested));
				for (let index = 0; index < 4; index++) {
					const name = nested + '/file-' + index + '.bin';
					const size = [0, 257, 65_537, 2 * 1024 * 1024 + 17][index];
					const bytes = new Uint8Array(size).fill(31 + folder * 4 + index);
					mixedFiles[name] = bytes;
					await writeFile(path.join(directory, 'selected', name), bytes);
				}
			}
		}
		phaseMs.setup = Date.now() - setupStarted;
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
		const localTarget = await approveMobileSyncTarget(saved, scope, signal, request, caps, 'existing');
		const result = await (pagedFixture ? runPagedForegroundCloudSync : runForegroundCloudSync)(
			saved,
			scope,
			{
				currentScope: () => scope,
				readConfiguration: async () => measured('configuration', async () => (await api('/api/v1/things?id=' + row.id)).thing),
				authorizeDevice: async () => {
					await request(fixture.userId, { action: 'list' }, signal);
				},
				conditions: async () => (await request(fixture.userId, { action: 'conditions' }, signal)).conditions!,
				scanLocal: async () => (await request(fixture.userId, { action: 'scan', rootId: nativeRoot }, signal)).entries!,
				...(pagedFixture ? {
					scanLocalPages: async function* () {
						for await (const page of readNativeInventory({ ownerId: fixture.userId, deviceId: deviceId!, rootId: nativeRoot, signal, request })) {
							nativePages++;
                            if (page.totalEntries !== undefined && transferRunStartedAt) benchmarkTimeline.firstCompleteNativeInventoryObservedMs ??= Date.now() - transferRunStartedAt;
                            yield page;
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
                        if (receipt.entry?.kind === 'file' && transferRunStartedAt) benchmarkTimeline.firstConfirmedFileMs ??= Date.now() - transferRunStartedAt;
						ids.add(receipt.operationId); confirmedIds.set(spec.id, ids); return result;
					} };
				} } : journal,
				runtime,
				localTarget,
				progress: value => { if ((wideFixture || symlinksOnly) && value.stage !== lastStage) {
					lastStage = value.stage; console.log('MAC_PAGED_STAGE sync-' + value.stage);
				} }
			},
			signal
		);
		return result;
	};
	const exerciseSymbolicLinks = async () => {
    // A link is an inert target-byte file version, never a read of its target.
    // Exercise kind-only transitions with identical payload bytes as well.
    const transitionPath = path.join(directory, 'selected/link-transition.bin');
    const targetBytes = Buffer.from('../outside-sentinel.bin'), outsideBytes = randomBytes(313);
    await writeFile(path.join(directory, 'outside-sentinel.bin'), outsideBytes);
    await writeFile(transitionPath, targetBytes);
    await run();
    const linkNode = async () => { const node = (await inventory()).nodes.find(node => node.path === 'link-transition.bin'); assert.ok(node?.kind === 'file'); return node.file; };
    const beforeLink = await linkNode();
    await rm(transitionPath); await symlink(targetBytes, transitionPath);
    await symlink('missing-target', path.join(directory, 'selected/dangling-link'));
    await symlink(Buffer.from([255, 254, 47, 120]), path.join(directory, 'selected/non-utf8-link'));
    await run();
    const linked = await linkNode();
    assert.equal(linked.id, beforeLink.id); assert.notEqual(linked.revision, beforeLink.revision);
    assert.deepEqual(linked.symbolicLink, { format: 'posix-symlink-v1', targetBase64: targetBytes.toString('base64') });
    const readCloudBytes = async (file: typeof linked) => { const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + file.content.attachmentId + '&cache=bytes', base)); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()); };
    assert.deepEqual(await readCloudBytes(linked), targetBytes);
    for (const [name, expected] of [['dangling-link', Buffer.from('missing-target')], ['non-utf8-link', Buffer.from([255, 254, 47, 120])]] as const) {
      const node = (await inventory()).nodes.find(node => node.path === name); assert.ok(node?.kind === 'file');
      assert.equal(node.file.symbolicLink?.targetBase64, expected.toString('base64')); assert.deepEqual(await readCloudBytes(node.file), expected);
    }
    const mismatch = await sessionFetch(new URL('/api/v1/files', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      ...fileRestoreCommand(linked, linked, randomUUID()), symbolicLink: { format: 'posix-symlink-v1', targetBase64: Buffer.from('wrong-target').toString('base64') }
    }) });
    assert.equal(mismatch.status, 409); await mismatch.body?.cancel(); assert.equal((await linkNode()).revision, linked.revision);
    await rm(transitionPath); await writeFile(transitionPath, targetBytes); await run();
    const ordinaryAgain = await linkNode(); assert.equal(ordinaryAgain.symbolicLink, undefined); assert.equal(ordinaryAgain.id, linked.id); assert.notEqual(ordinaryAgain.revision, linked.revision);
    const linkHistory = (await api('/api/v1/timeline?' + new URLSearchParams({ ownerId: fixture.userId, dataPlane: 'home', thingId: linked.id }))).entries.map(parseTimelineEntry);
    const priorLink = linkHistory.map((entry: import('../app/timeline/contract').TimelineEntry) => timelineFileVersion(entry.event, 'after')).find((file: typeof linked | null) => file?.revision === linked.revision);
    assert.ok(priorLink?.symbolicLink);
    const restoreLink = fileRestoreCommand(ordinaryAgain, priorLink, randomUUID());
    await checkFileRestoreReceipt((await api('/api/v1/files', restoreLink)).file, restoreLink, priorLink, fixture.userId);
    await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
    await run(); assert.equal((await lstat(transitionPath)).isSymbolicLink(), true);
    assert.deepEqual(await readlink(transitionPath, { encoding: 'buffer' }), targetBytes);
    assert.deepEqual(await readFile(path.join(directory, 'outside-sentinel.bin')), outsideBytes, 'The outside target is never opened or modified by sync');
    const stableLink = await linkNode(), transfersAfterLink = { ...counts }; await run();
    assert.deepEqual(await linkNode(), stableLink); assert.deepEqual(counts, transfersAfterLink);
    console.log('MAC_PAGED_STAGE symbolic-links-verified');

	};
	// No consent exists yet: a resumed worker must stop without prompting.
	await assert.rejects(approveMobileSyncTarget(saved, scope, signal, request, caps, 'existing'));
	await approveMobileSyncTarget(saved, scope, signal, request, caps);
	// All retries below, including process restarts, can only reuse that grant.
	if (earlyFixture) {
		assert.ok(fixtureIndexer && pagedFixture);
		const folder = path.join(directory, 'selected'), blocker = path.join(folder, 'zz-late-scan.bin');
		// Keep the late file hashing beyond the 90-second before-seal proof even
		// if the whole 5 MB/s policy is available to the scanner. A 128 MiB file
		// completed too soon and its own follow-up inspect delayed the other receipt.
		const blockerBytes = (normalEarlyBudget ? 512 : 48) * 1024 * 1024;
		const scanBytesPerSecond = normalEarlyBudget ? 5_000_000 : 400_000;
		await writeFile(blocker, new Uint8Array()); await truncate(blocker, blockerBytes);
		const scanStartedAt = Date.now(), proofTimeout = AbortSignal.timeout(90_000);
		// Pipe transport mirrors the production manager: polling has its own lane.
		const governedRequest: typeof request = (owner, command, requestSignal) => request(owner, {
				...command, deviceResourceLimits: { scanBytesPerSecond, transferBytesPerSecond: 5_000_000, cpuPercent: 15 }
			}, requestSignal);
		const nativeIndex = () => {
            const databasePath = path.join(directory, 'private-filesystem-index.sqlite3');
            if (!existsSync(databasePath)) return undefined;
			const database = new DatabaseSync(databasePath, { readOnly: true });
			try {
				return database.prepare('SELECT g.mode, g.generation, g.coverage, g.indexed, g.entry_count AS entries FROM inventory_generations g JOIN inventory_scopes s ON s.id=g.scope WHERE s.root_id=? AND g.created_ms>=? ORDER BY g.created_ms DESC LIMIT 1').get(nativeRoot, scanStartedAt);
			} finally { database.close(); }
		};
		const proof = new Map<string, { receipt: import('../app/fileSync/execute').SyncReceipt; at: number; nativeState: string; index: ReturnType<typeof nativeIndex>; receiptCommittedAtMonotonic: number; nativePageObservedAtMonotonic: number; nativePageObservationSequence: number }>();
		let notify!: () => void;
		const both = new Promise<void>(resolve => { notify = resolve; });
        const receiptObservations = new FixtureReceiptObservations();

		let capture: string | undefined;
        const nativePagesObserved = new FixturePageObservers();
		let firstLocalChangeMs: number | null = null, firstAdmittedMs: number | null = null, firstAdmittedPath: string | null = null;
		const input = async (current: AbortSignal, observe: boolean): Promise<ForegroundSyncInput> => {
			const localTarget = await approveMobileSyncTarget(saved, scope, current, governedRequest, caps, 'existing');
			return {
				currentScope: () => scope, localTarget, runtime,
                ...macFixtureWorkerOptions(canonicalHost!, fixture.userId, deviceId!, current),
				readConfiguration: async () => measured('configuration', async () => (await api('/api/v1/things?id=' + row.id)).thing),
				authorizeDevice: async () => { await governedRequest(fixture.userId, { action: 'list' }, current); },
				conditions: async () => (await governedRequest(fixture.userId, { action: 'conditions' }, current)).conditions!,
				scanLocal: async () => (await governedRequest(fixture.userId, { action: 'scan', rootId: nativeRoot }, current)).entries!,
                scanLocalPages: options => readNativeInventory({ ownerId: fixture.userId, deviceId: deviceId!, rootId: nativeRoot,
                    signal: current, request: governedRequest, ...options, strictAsync: true, captureId: randomUUID(), pageSize: NATIVE_INVENTORY_BATCH_ENTRIES }),
                inventoryPages: () => readCloudFolderInventoryPages(scope, remoteRoot!, { ...runtime, signal: current }),
				inspectLocal: async name => (await governedRequest(fixture.userId, { action: 'inspect', rootId: nativeRoot, path: name }, current)).inspectedEntry!,
				streamLocalChanges: async function* (id, after, streamSignal, readyToFinish) {
					capture = id;
					for await (const page of readNativeIndexChanges({ ownerId: fixture.userId, deviceId: deviceId!, rootId: nativeRoot, captureId: id,
						afterSequence: after, signal: streamSignal ?? current, readyToFinish, request: governedRequest,
                            ...(supportsNativeStreamingBatches(caps) ? { pageSize: NATIVE_INVENTORY_BATCH_ENTRIES } : {}) })) {
                        if (observe) nativePagesObserved.publish(page);
						if (page.changes.length) {
							firstLocalChangeMs ??= Date.now() - transferRunStartedAt;

						}
						yield page;
					}
				},
                streamRemoteChanges: (id, after, streamSignal, readyToFinish, resume) => readCloudIndexChanges(scope, remoteRoot!,
                    { ...runtime, signal: streamSignal ?? current }, id, after, readyToFinish!, resume!),
				inventory,
				source: async entry => {
                    const source = mobileFolderSource(fixture.userId, nativeRoot, entry, current, governedRequest, caps);
                    return { ...source, check: () => measured('source-check', async () => { await source.check(); }),
                        ...(source.verify ? { verify: () => measured('source-verify', async () => { await source.verify!(); }) } : {}) };
                },
				progress: () => {},
				journal: observe ? { ...journal, pagedRuns: access => {
					const runs = journal.pagedRuns(access);
					return { ...runs, appendStream: async (spec, event, binding, conflict, track) => {
						const result = await runs.appendStream(spec, event, binding, conflict, track);
                        const priorPrepared = preparedCounts.get(spec.id) ?? 0;
                        assert.ok(result.operations >= priorPrepared && result.operations <= priorPrepared + 1, 'Unattributed durable preparation count');
                        const becameReady = !!binding && result.operations === priorPrepared + 1;
                        preparedCounts.set(spec.id, result.operations);
                        recordPhase('append', event.entry.path, binding?.write.operation.id);
                        if (becameReady) recordPhase('ready', event.entry.path, binding!.write.operation.id);
						if (becameReady && firstAdmittedMs === null) {
							firstAdmittedMs = Date.now() - transferRunStartedAt;
							firstAdmittedPath = event.entry.path;
						}
						return result;
					}, claimNext: async (...args: Parameters<typeof runs.claimNext>) => {
                        const startedAt = performance.now(), operation = await runs.claimNext(...args);
                        if (operation) { recordPhase('claim-start', operation.mutation.path, operation.id, startedAt); recordPhase('claim', operation.mutation.path, operation.id); }
                        return operation;
                    }, confirm: async (spec, receipt) => receiptObservations.confirm(receipt.operationId,
                        () => runs.confirm(spec, receipt), async (_result: unknown, receiptCommittedAtMonotonic: number) => {
                        recordPhase('receipt-durable', receipt.entry?.path, receipt.operationId, receiptCommittedAtMonotonic);
						const name = receipt.entry?.path;
						if (spec.streaming?.source === 'both' && (name === 'local.bin' || name === 'remote.bin')) {
							assert.ok(capture);
                            // Observe the next actual feed result after this receipt;
                            // never enqueue a competing proof-only long poll.
                            recordPhase('proof-observation-start', name, receipt.operationId);
                            const observation = await nativePagesObserved.next(current, receiptCommittedAtMonotonic);
                            assert.ok(observation.observedAt >= receiptCommittedAtMonotonic);
                            recordPhase('proof-observed', name, receipt.operationId, observation.observedAt);
                            const page = observation.page;
							const index = nativeIndex();
							if (!index || index.mode !== 'backup' || index.indexed !== 0 || index.coverage !== 'scanning' ||
								page?.id !== capture || page?.state !== 'running' || page.generation.toLowerCase() !== String(index.generation).toLowerCase())
								throw Error('The native capture was not live and unsealed at an early receipt: ' + JSON.stringify({ index, state: page?.state }));
							proof.set(name, { receipt, at: Date.now(), nativeState: page.state, index, receiptCommittedAtMonotonic,
                                nativePageObservedAtMonotonic: observation.observedAt, nativePageObservationSequence: observation.sequence });
							if (proof.size === (uploadStartDiagnostic ? 1 : 2)) notify();
						}
					}) };
				} } : journal
			};
		};
		const controller = new AbortController(), current = AbortSignal.any([controller.signal, proofTimeout]),
			stop = new Error(uploadStartDiagnostic ? 'Stop after the upload-start diagnostic receipt' : 'Stop after the two before-seal confirmations');
        const serverPutBaseline = (await serverPuts()).length;
		transferRunStartedAt = Date.now(); transferRunStartedAtMonotonic = performance.now();
        earlyIdentityStartTotalMs = nativeIdentityTiming.totalMs;
		console.log('MAC_PAGED_STAGE early-input-start');
		const firstInput = await input(current, true);
		console.log('MAC_PAGED_STAGE early-input-ready');
		const running = runPagedForegroundCloudSync(saved, scope, firstInput, current);
		void running.catch(() => {});
		try {
			await Promise.race([both, receiptObservations.failed, running.then(() => { throw Error('Early sync finished before its required receipts were observed.'); })]);
			const upload = proof.get('local.bin')!, download = proof.get('remote.bin');
            assert.ok(upload);
            if (!uploadStartDiagnostic) { assert.ok(download); assert.equal(upload.index?.generation, download.index?.generation); }
			const remote = (await api('/api/v1/files?' + new URLSearchParams({ id: upload.receipt.entry!.id, operationId: upload.receipt.operationId }))).receipt.file;
			assert.equal(remote.revision, upload.receipt.entry!.version);
			const content = await sessionFetch(new URL('/api/v1/attachments/content?' + new URLSearchParams({ id: remote.content.attachmentId, cache: 'bytes' }), base));
			assert.equal(content.status, 200);
			assert.equal(hash(new Uint8Array(await content.arrayBuffer())), hash(localBytes));
			if (!uploadStartDiagnostic) assert.equal(hash(await readFile(path.join(folder, 'remote.bin'))), hash(remoteBytes));
			assert.equal(nativeIndex()?.indexed, 0);
			console.log(uploadStartDiagnostic ? 'MAC_PAGED_STAGE upload-diagnostic-confirmed-while-rust-indexing' : 'MAC_PAGED_STAGE both-directions-confirmed-while-rust-indexing');
			const cancelledAt = Date.now(), originalCapture = capture;
			controller.abort(stop);
			await assert.rejects(running, error => error === stop);
            await receiptObservations.drain();
            assert.equal(receiptObservations.pending.size, 0, 'Drain every proof before resume and success');
			assert.ok(originalCapture);
			const stopped = await governedRequest(fixture.userId, { action: 'scan-cancel', rootId: nativeRoot, inventoryDeviceId: deviceId!,
				captureId: originalCapture, capturePolicy: 'one-way-supported', excludedPaths: [] }, AbortSignal.timeout(15000));
			assert.equal(stopped.changesPage?.state, 'interrupted');
			assert.ok(cancelledAt >= Math.max(upload.at, download?.at ?? 0));
			await rename(blocker, path.join(directory, 'held-scan.bin'));
			const countsBefore = { ...counts };
            const serverPutCountBefore = (await serverPuts()).length;
			const resume = AbortSignal.timeout(120000), resumedAt = Date.now();
			const settled = await runPagedForegroundCloudSync(saved, scope, await input(resume, false), resume);
			const reconciliationCompletedAt = Date.now(), indexAfterReconciliation = nativeIndex();
            assert.ok('progress' in settled); assert.equal(settled.progress.operations, 0);
			assert.equal(capture, originalCapture);
			const entries = (await api('/api/v1/timeline?' + new URLSearchParams({ ownerId: fixture.userId, dataPlane: 'home', thingId: remote.id }))).entries.map(parseTimelineEntry);
			assert.equal(entries.filter(entry => entry.event.mode === 'revision').length, 1);
			assert.equal(entries.filter(entry => entry.event.operationId === upload.receipt.operationId).length, 1);
			if (!uploadStartDiagnostic) assert.equal(hash(await readFile(path.join(folder, 'remote.bin'))), hash(remoteBytes));
			assert.equal(counts.puts, countsBefore.puts);
            assert.equal((await serverPuts()).length, serverPutCountBefore, 'Native transfer worker must not replay a PUT on resume');
			assert.equal(counts.publishes, countsBefore.publishes);
			assert.ok(await journal.pagedCheckpoints(journalAccess).current());
            const observedPuts = (await serverPuts()).slice(serverPutBaseline);
            assert.equal(observedPuts.length, 1, 'Exactly one native worker upload PUT is expected');
            assert.ok(observedPuts[0].firstByteAt !== null);
            assert.equal(observedPuts[0].payloadBytes, localBytes.length);
            firstTransferMs = observedPuts[0].firstByteAt - transferRunStartedAt;
            assert.ok(firstTransferMs >= 0, 'Server timestamp must not precede the observation append barrier');
			assert.ok(firstLocalChangeMs !== null && firstAdmittedMs !== null && firstTransferMs !== null);
			assert.ok(firstLocalChangeMs <= firstAdmittedMs && firstAdmittedMs <= firstTransferMs);
			console.log(JSON.stringify({ ok: true, scenario: uploadStartDiagnostic ? 'Canonical upload-start diagnostic with empty cloud folder' : 'Mac two-way transfer before initial index seal',
                proofKind: uploadStartDiagnostic ? 'upload-start-diagnostic' : 'two-way-before-seal', twoWayAcceptance: !uploadStartDiagnostic,
				firstLocalChangeMs, firstAdmittedMs, firstAdmittedPath, serverPutBaseline, serverPutEvents: await serverPuts(), firstPutMs: firstTransferMs, firstPutObservation: 'server parsed native transfer-worker first body byte (request enqueue; full byte count + independent content hash verified)', earlyFirstRequestMs,
                parity: { capabilities: caps, nativeOperationGuards: true, compositeAuthorization: true, customMutationHook: false,
                    canonicalDesktopManager: true, canonicalRendererHost: true, canonicalTransferWorkerSelected: true,
                    tlsTrust: fixture.tls ? "ephemeral CA scoped to exact canonical child; setup byte fetch scoped to TLS origin; no OS trust changes" : "none",
                    rendererDevicePolicy: readDeviceSyncResourcePolicy(deviceResourceKey(base.origin, fixture.userId, deviceId!)) },
                phaseTimings, transferRunStartedAtMonotonic, nativeRequestTimings, nativeServiceCalls, nativeConcurrency: nativeConcurrency(),
                proofObservationBlocksConsumer: false, hostTimings, boundaryTimings, nativeIdentityCalls, nativeTransportTiming: nativeTransport?.timings, nativeServiceTiming, nativeIdentityTiming, earlyIdentityStartTotalMs,
                nativeLatency, httpLatency, httpRequests, nativeCalls, verifyCalls, cooldownCount, cooldownSeconds,
				resourceLimits: { scanBytesPerSecond, transferBytesPerSecond: 5_000_000, cpuPercent: 15, effectiveRustScanBytesPerSecond: scanBytesPerSecond / 2 }, blockerBytes,
				upload: { at: upload.at, receiptCommittedAtMonotonic: upload.receiptCommittedAtMonotonic, nativePageObservedAtMonotonic: upload.nativePageObservedAtMonotonic, nativePageObservationSequence: upload.nativePageObservationSequence, nativeState: upload.nativeState, index: upload.index, operationId: upload.receipt.operationId, revision: remote.revision, sha256: hash(localBytes) },
				download: uploadStartDiagnostic ? { exercised: false, reason: 'Initially empty cloud folder; signed native download remains unverified' } : { at: download!.at, receiptCommittedAtMonotonic: download!.receiptCommittedAtMonotonic, nativePageObservedAtMonotonic: download!.nativePageObservedAtMonotonic, nativePageObservationSequence: download!.nativePageObservationSequence, nativeState: download!.nativeState, index: download!.index, operationId: download!.receipt.operationId, sha256: hash(remoteBytes) },
				timeline: { firstCommittedIndexEntryObservedMs: firstLocalChangeMs, firstUploadPayloadReceivedMs: firstTransferMs, firstConfirmedFileMs: Math.min(upload.receiptCommittedAtMonotonic, download?.receiptCommittedAtMonotonic ?? upload.receiptCommittedAtMonotonic) - transferRunStartedAtMonotonic, interruptedAtMs: cancelledAt - transferRunStartedAt, resumedAtMs: resumedAt - transferRunStartedAt, strictReconciliationCompletedMs: reconciliationCompletedAt - transferRunStartedAt, indexAfterReconciliation, scope: 'feed/receipt observations; interrupted initial index has no completion time; final strict reconciliation is observed after resume' },
                verifiedFiles: [{ path: 'local.bin', bytes: localBytes.length, sha256: hash(localBytes) }, ...(!uploadStartDiagnostic ? [{ path: 'remote.bin', bytes: remoteBytes.length, sha256: hash(remoteBytes) }] : [])],
                cancelledAt, sameNativeCaptureAfterResume: true, strictCheckpointAfterResume: true, duplicateTransfers: false, cloudHistoryRevisions: 1 }));
		} catch (error) {
			// Keep a bounded, non-secret stage snapshot when the deliberate
			// before-seal deadline fires; otherwise its only symptom is a timeout.
			console.log(JSON.stringify({ earlyTimingFailure: true, firstLocalChangeMs, firstAdmittedMs,
				firstAdmittedPath, serverPutBaseline, serverPutEvents: await serverPuts(), firstPutMs: firstTransferMs, firstPutObservation: 'server parsed native transfer-worker first body byte (request enqueue; full byte count + independent content hash verified)', earlyFirstRequestMs,
                parity: { capabilities: caps, nativeOperationGuards: true, compositeAuthorization: true, customMutationHook: false,
                    canonicalDesktopManager: true, canonicalRendererHost: true, canonicalTransferWorkerSelected: true,
                    tlsTrust: fixture.tls ? "ephemeral CA scoped to exact canonical child; setup byte fetch scoped to TLS origin; no OS trust changes" : "none",
                    rendererDevicePolicy: readDeviceSyncResourcePolicy(deviceResourceKey(base.origin, fixture.userId, deviceId!)) },
                phaseTimings, transferRunStartedAtMonotonic, nativeRequestTimings, nativeServiceCalls, nativeConcurrency: nativeConcurrency(),
                proofObservationBlocksConsumer: false, hostTimings, boundaryTimings, nativeIdentityCalls, nativeTransportTiming: nativeTransport?.timings, nativeServiceTiming, nativeIdentityTiming, earlyIdentityStartTotalMs,
                nativeLatency, httpLatency, httpRequests, nativeCalls, verifyCalls, cooldownCount, cooldownSeconds,
				resourceLimits: { scanBytesPerSecond, effectiveRustScanBytesPerSecond: scanBytesPerSecond / 2 },
				index: nativeIndex(), counts }));
			throw error;
		} finally { controller.abort(stop); await running.catch(() => {}); await receiptObservations.drain().catch(() => {}); }
	} else if (symlinksOnly) {
		await run(); await exerciseSymbolicLinks();
		console.log(JSON.stringify({ok:true, scenario:'Mac symlink round trip',nativeCalls,verifyCalls,nativePages,cloudPages,counts,checks:['regular-link-regular-kind-transitions','raw-target-bytes-no-follow','dangling-and-non-utf8-links','link-metadata-attachment-integrity','link-timeline-restore-after-restart','stable-convergence'],picker:'fixture',keychain:'not-used'}));
	} else {
	transferRunStartedAt = Date.now();
	loseCloud = true;
	losePublication = true;
	await assert.rejects(measure('lostCloud', run), /Lost accepted cloud commit/);
	const original = await readRun(),
		originalIds = original.operations.map((op) => op.id);
	const afterCloud = counts.puts;
    loseStage = true;
	await assert.rejects(measure('lostStage', run), /Lost accepted native stage/);
    const firstStagedBytes = counts.stagedBytes;
    assert.equal(firstStagedBytes, Math.min(2 * 1024 * 1024, remoteBytes.length));
    await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
	await assert.rejects(measure('lostPublication', run), /Lost accepted native publication/);
    assert.equal(counts.stagedBytes, remoteBytes.length, 'Restart must resume after the accepted range without replay');
	assert.equal(counts.puts, afterCloud);
	await stopNative();
	journal.close();
	journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
	await startNative();
	const beforeRecovery = { ...counts };
	await measure('recovery', run);
	if (wideMixedFixture) assert.equal(counts.puts - beforeRecovery.puts,
		Object.values(mixedFiles).filter(bytes => bytes.length > 0).length,
		'Recovery uploads each remaining nonempty nested file once without replaying acknowledged bytes');
	else assert.equal(counts.puts, beforeRecovery.puts);
	assert.equal(counts.publishes, beforeRecovery.publishes);
	await assertCompletedRun(original.id, originalIds);
	const verifyBytes = async (expected: Record<string, Uint8Array>) => {
		const inv = await inventory();
		assert.equal(inv.nodes.length, Object.keys(expected).length + wideFolders + mixedFolders.length);
		const folders = inv.nodes.filter(n => n.kind === 'folder');
		assert.equal(folders.length, wideFolders + mixedFolders.length);
		if (wideFixture) assert.deepEqual(folders.map(n => n.path).sort(), [...Array.from({ length: wideFolders }, (_, i) => 'wide-' + String(i).padStart(5, '0')), ...mixedFolders].sort());
		for (const node of inv.nodes) {
			if (node.kind !== 'file') continue;
			assert.ok(Object.hasOwn(expected, node.path), 'Unexpected file ' + node.path);
			const response = await sessionFetch(new URL('/api/v1/attachments/content?id=' + node.file.content.attachmentId + '&cache=bytes', base));
			assert.equal(response.status, 200, 'Cloud content for synthetic path ' + node.path);
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
	const expectedFiles = { 'local.bin': localBytes, 'remote.bin': remoteBytes, ...mixedFiles };
	const first = await measure('verify', () => verifyBytes(expectedFiles));
	const beforeUnchanged = { puts: counts.puts, publishes: counts.publishes, reads: counts.reads, streams: counts.streams, stageRanges: counts.stageRanges };
	await measure('unchanged', run);
	assert.deepEqual({ puts: counts.puts, publishes: counts.publishes, reads: counts.reads, streams: counts.streams, stageRanges: counts.stageRanges }, beforeUnchanged);
	assert.deepEqual(await verifyBytes(expectedFiles), first);
	if (wideFixture) {
		const head = (await journal.pagedCheckpoints(journalAccess).current())!; assert.ok(head);
		for (const id of [head.baseline.local, head.baseline.remote])
			assert.equal((await journal.inventory(journalAccess).read(id)).totalEntries, wideFolders + mixedFolders.length + Object.keys(expectedFiles).length);
		const minimumPages = Math.ceil((wideFolders + mixedFolders.length + Object.keys(expectedFiles).length) / 128);
		assert.ok(nativePages >= minimumPages && cloudPages >= minimumPages,
			`Each source must expose a complete paged capture: native=${nativePages}, cloud=${cloudPages}, minimum=${minimumPages}`);
		const usage = process.resourceUsage();
		const initialLocalBytes = localBytes.length + Object.values(mixedFiles).reduce((sum, bytes) => sum + bytes.length, 0);
		assert.ok((await stat(path.join(directory, 'private-filesystem-index.sqlite3'))).isFile(), 'Rust inventory must use the disposable fixture database');
		console.log(JSON.stringify({ ok: true, paged: true, wideFolders, nestedFolders: mixedFolders.length, mixedFiles: Object.keys(mixedFiles).length, totalPaths: wideFolders + mixedFolders.length + Object.keys(expectedFiles).length, initialLocalBytes, finalFileBytes: initialLocalBytes + remoteBytes.length, actualHashedBytes: null, warmHashedBytes: null, benchmarkDeviceLimits, effectiveRustScanBytesPerSecond: benchmarkDeviceLimits ? benchmarkDeviceLimits.scanBytesPerSecond / 2 : null, privateIndexDatabase: true, firstTransferMs, serverPutEvents: await serverPuts(), benchmarkTimeline, operationIds: originalIds, checkpointRunId: head.runId, countsBeforeRecovery: beforeRecovery, acceptedStagedBytesBeforeRestart: firstStagedBytes,
            verifiedFiles: Object.entries(expectedFiles).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) })),
            checkpointEntries: { local: (await journal.inventory(journalAccess).read(head.baseline.local)).totalEntries, remote: (await journal.inventory(journalAccess).read(head.baseline.remote)).totalEntries }, phaseMs, httpRequests, httpLatency, nativeLatency, integrationProcessOnly: { maxRssKiB: usage.maxRSS, userCpuMs: Math.round(usage.userCPUTime / 1000), systemCpuMs: Math.round(usage.systemCPUTime / 1000) }, nativePages, cloudPages,
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

	// Join the real native edit and cloud publication paths to the exact same
	// historical version/restore contract used by History. A cloud-only restore
	// is insufficient: the next two-way pass must put those bytes back on disk.
	assert.ok(capabilitySatisfies(manifest.features['api.timeline']?.version, '1.6.0'));
	const originalLocal = oldInventory.nodes.find(node => node.path === 'local.bin');
	assert.ok(originalLocal?.kind === 'file');
	const currentLocal = (await inventory()).nodes.find(node => node.path === 'local.bin');
	assert.ok(currentLocal?.kind === 'file');
	const timeline = async (): Promise<import('../app/timeline/contract').TimelineEntry[]> => {
		const result = await api('/api/v1/timeline?' + new URLSearchParams({ ownerId: fixture.userId, dataPlane: 'home', thingId: currentLocal.file.id }));
		return result.entries.map(parseTimelineEntry);
	};
	const history = await timeline();
	const historical = history.map(entry => timelineFileVersion(entry.event, 'after')).find(file => file?.revision === originalLocal.file.revision);
	assert.ok(historical, 'The original native upload must be a selectable Timeline file version');
	assert.ok(history.some(entry => timelineFileVersion(entry.event, 'after')?.revision === currentLocal.file.revision), 'The later edit must appear in the same file Timeline');
	assert.equal(historical.id, currentLocal.file.id);
	assert.notEqual(fileContentId(historical), fileContentId(currentLocal.file));
	const restore = fileRestoreCommand(currentLocal.file, historical, randomUUID());
	loseCloud = true;
	await assert.rejects(api('/api/v1/files', restore), /Lost accepted cloud commit/);
	const historyRestoreReceipt = await api('/api/v1/files', JSON.parse(JSON.stringify(restore)));
	assert.equal(historyRestoreReceipt.replayed, true);
	await checkFileRestoreReceipt(historyRestoreReceipt.file, restore, historical, fixture.userId);
	assert.equal((await timeline()).filter(entry => entry.event.operationId === restore.operationId).length, 1, 'Lost restore reply must not duplicate Timeline publication');
	await stopNative(); journal.close(); journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange); await startNative();
	await run();
	const afterHistoryRestore = await verifyBytes({ 'local.bin': localBytes, 'remote.bin': editedRemote });
	assert.equal(afterHistoryRestore.find(node => node.path === 'local.bin')!.id, historical.id);
	assert.equal(afterHistoryRestore.find(node => node.path === 'local.bin')!.revision, historyRestoreReceipt.file.revision);
	const transfersAfterRestore = { ...counts };
	await run();
	assert.deepEqual(await verifyBytes({ 'local.bin': localBytes, 'remote.bin': editedRemote }), afterHistoryRestore);
	assert.deepEqual(counts, transfersAfterRestore, 'A converged historical restore must not upload, stage or publish again');

    await exerciseSymbolicLinks();

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
    deletionTarget = await approveMobileSyncTarget(deletionConfig, scope, signal, request, caps, 'existing');
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
                'existing-approval-restart-without-prompt',
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
                'symlink-raw-target-bytes-no-follow',
                'regular-link-regular-kind-transitions',
                'link-timeline-restore-after-restart',
                'dangling-and-non-utf8-links',
                'link-metadata-attachment-integrity',
				'native-edit-timeline-history-and-restore',
				'lost-history-restore-reply-exact-replay',
				'history-restore-download-after-native-restart',
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
