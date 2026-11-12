import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { reportDeviceSyncHistoryStorage, withDeviceSyncHistoryRecordingIssue } from './deviceSyncHistory.client';
import { createDeviceSyncHistoryAggregation, parseDeviceSyncHistory, type DeviceSyncHistorySample } from './deviceSyncHistory';
import { createDeviceSyncHistoryRecorder } from './deviceSyncHistoryRecorder';

const scope = { origin: 'https://thingtime.test', ownerId: 'owner', deviceId: 'mac', dataPlane: 'home' };
const sample = (at: number, uploadMbps: number | null, patch: Partial<DeviceSyncHistorySample> = {}): DeviceSyncHistorySample =>
	({ at, status: 'running', uploadMbps, downloadMbps: null, scanMbps: null, cpuPercent: null, memoryBytes: null, ...patch });

test('journal upgrade preserves the old stores and history survives reopening without crossing identity scopes', async () => {
	const db = new IDBFactory(), name = 'sync-history';
	await new Promise<void>((resolve, reject) => {
		const previous = db.open(name, 15);
		previous.onupgradeneeded = () => previous.result.createObjectStore('runs');
		previous.onerror = () => reject(previous.error);
		previous.onsuccess = () => { previous.result.close(); resolve(); };
	});
	const range = { from: 1000, to: 7000, bucketCount: 6 };
	const first = await openSyncJournal(db, name, IDBKeyRange);
	const history = first.deviceHistory({ scope, assertCurrent() {} });
	await Promise.all([
		history.append(sample(1000, 0)), history.append(sample(1200, null)), history.append(sample(1600, 2)),
		history.append(sample(6100, 4, { status: 'complete', cpuPercent: 0, cpuScopes: ['source-thread'] })),
		history.append(sample(7000, 10))
	]);
	for (const foreign of [{ ownerId: 'someone' }, { origin: 'https://preview.test' }, { deviceId: 'phone' }, { dataPlane: 'satellite' }])
		await first.deviceHistory({ scope: { ...scope, ...foreign }, assertCurrent() {} }).append(sample(1300, 1000));
	first.close();
	const second = await openSyncJournal(db, name, IDBKeyRange);
	assert.equal(await second.read({ ...scope, rootId: 'old-root' }), null);
	const result = await second.deviceHistory({ scope, assertCurrent() {} }).read(range);
	assert.equal(result.sampleCount, 4);
	assert.equal(result.firstObservedAt, 1000);
	assert.equal(result.latest?.status, 'complete');
	assert.deepEqual(result.latest?.cpuScopes, ['source-thread']);
	assert.deepEqual(result.buckets.map(b => [b.samples, b.measured.uploadMbps, b.uploadMbps, b.cpuPercent]),
		[[3, 2, 1, null], [0, 0, null, null], [0, 0, null, null], [0, 0, null, null], [0, 0, null, null], [1, 1, 4, 0]]);
	assert.deepEqual(parseDeviceSyncHistory(result, range), result);
	assert.throws(() => parseDeviceSyncHistory({ ...result, latest: { ...result.latest, sourcePath: '/private' } }, range), /Invalid sync history/);
	assert.throws(() => parseDeviceSyncHistory(result, { ...range, to: 6000 }), /Invalid sync history/);
	second.close();
});

test('streaming fold consumes every row without bridging gaps and fences identity during reads', async () => {
	const db = await openSyncJournal(new IDBFactory(), 'sync-history', IDBKeyRange);
	const history = db.deviceHistory({ scope, assertCurrent() {} });
	await Promise.all(Array.from({ length: 620 }, (_, i) => history.append(sample(i + 10, i % 2 ? 0 : 2))));
	const range = { from: 0, to: 1000, bucketCount: 2 };
	const full = await history.read(range);
	assert.deepEqual(full.buckets.map(b => b.samples), [490, 130]);
	for (const bucket of full.buckets) assert.ok(Math.abs(bucket.uploadMbps! - 1) < 1e-10);
	let interleaved: Promise<void> | undefined, pageChecks = 0;
	const withWrite = await db.deviceHistory({ scope, assertCurrent() {
		if (++pageChecks === 3) interleaved = history.append(sample(900, 2));
	} }).read(range);
	await interleaved;
	assert.equal(withWrite.sampleCount, 621, 'a later-page write can commit while a long read is still in progress');
	let calls = 0;
	await assert.rejects(db.deviceHistory({ scope, assertCurrent() { if (++calls === 5) throw Error('Account changed'); } }).read(range), /Account changed/);
	calls = 0;
	const abort = new AbortController();
	await assert.rejects(db.deviceHistory({ scope, signal: abort.signal, assertCurrent() { if (++calls === 3) abort.abort(); } }).read(range), { name: 'AbortError' });
	db.close();
});

test('history uses native period observations, not long batch receipt bytes, and preserves genuine idle and gaps', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	let now = 1000;
	const samples: DeviceSyncHistorySample[] = [];
	const recorder = createDeviceSyncHistoryRecorder({ wallTime: () => now, monotonicTime: () => now, write: async s => { samples.push(s); } });
	const flush = () => new Promise<void>(resolve => setImmediate(resolve));
	const tick = async (elapsed: number) => { now += elapsed; t.mock.timers.tick(5000); await flush(); };
	await flush();
	assert.equal(samples[0].uploadMbps, null);
	await tick(5000);
	assert.deepEqual(samples[1], sample(6000, 0, { downloadMbps: 0 }));
	recorder.stage('transferring');
	recorder.transfer({ direction: 'upload', bytes: 0 });
	await tick(5000);
	assert.deepEqual(samples[2], sample(11000, null), 'an in-flight native batch without a meter is not idle');
	recorder.observe({ version: 1, cpuStatus: 'measured', cpuPercent: 0, cpuScopes: ['source-thread'], memoryBytes: 512,
		scanBytesPerSecond: 250_000, currentUploadBytesPerSecond: 125_000, measuredAt: 15000,
		effectiveTransferConcurrency: 1, effectiveIndexingConcurrency: 1 });
	await tick(5000);
	assert.deepEqual(samples[3], sample(16000, 1, { cpuPercent: 0, cpuScopes: ['source-thread'], memoryBytes: 512, scanMbps: 2 }));
	recorder.transfer({ direction: 'upload', bytes: 500_000_000 });
	recorder.stage('verifying');
	await tick(5000);
	assert.deepEqual(samples[4], sample(21000, null), 'the completion receipt cannot charge 500 MB to its final time bucket');
	await tick(60_000);
	assert.deepEqual(samples[5], sample(81000, null), 'a suspended interval does not become a measured idle interval');
	await recorder.finish('paused');
	assert.deepEqual(samples.at(-1), sample(81000, 0, { status: 'paused', downloadMbps: 0 }));
});

test('resource sampling allows one independent in-flight read and aborts it at runner shutdown', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	let calls = 0, readSignal: AbortSignal | undefined;
	const recorder = createDeviceSyncHistoryRecorder({ write: async () => {}, readResources: signal => {
		calls++;
		readSignal = signal;
		return new Promise(resolve => signal.addEventListener('abort', () => resolve(undefined), { once: true }));
	} });
	await new Promise(resolve => setImmediate(resolve));
	t.mock.timers.tick(15_000);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls, 1, 'slow native resource sampling cannot overlap');
	await recorder.finish('complete');
	assert.equal(readSignal?.aborted, true);
});

test('a failed telemetry write reports a bounded scope warning and does not prevent completion', async () => {
	const range = { from: 0, to: 10, bucketCount: 1 };
	const history = createDeviceSyncHistoryAggregation(range).result();
	const observations: DeviceSyncHistorySample[] = [];
	let fail = true;
	const recorder = createDeviceSyncHistoryRecorder({ wallTime: () => 1, monotonicTime: () => 1,
		write: async value => { if (fail) throw Error('Quota exceeded'); observations.push(value); },
		onStorageStatus: available => reportDeviceSyncHistoryStorage(scope, available)
	});
	await new Promise(resolve => setImmediate(resolve));
	const warned = withDeviceSyncHistoryRecordingIssue(scope, history);
	assert.equal(warned.recordingIssue, 'storage-unavailable');
	assert.deepEqual(parseDeviceSyncHistory(warned, range), warned);
	assert.equal(withDeviceSyncHistoryRecordingIssue({ ...scope, deviceId: 'other' }, history).recordingIssue, undefined);
	assert.throws(() => parseDeviceSyncHistory({ ...warned, recordingIssue: '/private/quota-error' }, range), /Invalid sync history/);
	fail = false;
	await recorder.finish('complete');
	assert.equal(observations.at(-1)?.status, 'complete');
	assert.equal(withDeviceSyncHistoryRecordingIssue(scope, history).recordingIssue, undefined);
});
