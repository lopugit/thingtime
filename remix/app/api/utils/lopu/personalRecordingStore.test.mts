import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { personalRecordingLeaseIsLive, PERSONAL_RECORDING_CAPABILITY, PersonalRecordingCompletionPending } from './personalRecordingCore';

// In-memory collaborators, never direct database reads or fixtures.
const actor = { userId: 'owner', deviceId: 'device', sessionId: 'session', capabilities: [PERSONAL_RECORDING_CAPABILITY] };
const jobId = `lopu-recording-job-${'a'.repeat(64)}`;
const leaseId = '52a5a4a2-060c-44bf-a208-6aac88913e75';
let row: any, active: boolean, privateSource: boolean, processCount: number, download: () => Promise<any>;
let processing: (job: any, deps: any) => Promise<string>;
const calls: any[] = [];
const get = (value: any, path: string) => path.split('.').reduce((value, key) => value?.[key], value);
const matches = (doc: any, filter: any): boolean => Object.entries(filter).every(([key, expected]: any) => {
	if (key === '$or') return expected.some((entry: any) => matches(doc, entry));
	const value = get(doc, key);
	if (expected && typeof expected === 'object' && !(expected instanceof Date)) return Object.entries(expected).every(([op, operand]: any) =>
		op === '$exists' ? (value !== undefined) === operand : op === '$gt' ? value > operand : op === '$lt' ? value < operand :
			op === '$lte' ? value <= operand : op === '$in' ? operand.includes(value) : false);
	return value === expected;
});
const write = (path: string, value: any, remove = false) => {
	const keys = path.split('.'); let target = row;
	for (const key of keys.slice(0, -1)) target = target[key] ||= {};
	if (remove) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = structuredClone(value);
};
const collection = {
	async findOne(filter: any) { return matches(row, filter) ? structuredClone(row) : null; },
	async updateOne(filter: any, patch: any) {
		calls.push({ filter, patch });
		if (!matches(row, filter)) return { matchedCount: 0 };
		for (const [key, value] of Object.entries(patch.$set || {})) write(key, value);
		for (const [key, value] of Object.entries(patch.$inc || {})) write(key, (get(row, key) || 0) + Number(value));
		for (const key of Object.keys(patch.$unset || {})) write(key, undefined, true);
		return { matchedCount: 1 };
	},
	async findOneAndUpdate(filter: any, patch: any) {
		return (await collection.updateOne(filter, patch)).matchedCount ? structuredClone(row) : null;
	}
};
class Unavailable extends Error {}
const authority = async (value: any) => {
	if (!active || value.userId !== actor.userId || value.deviceId !== actor.deviceId || value.sessionId !== actor.sessionId)
		throw new Unavailable();
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
	getHomeThingsCollection: async () => collection,
	withHomeMongoTransaction: async (work: (session: any) => unknown) => work({ transaction: true })
} });
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: {
	runWithMongoEndpoint: async (endpoint: unknown, work: () => unknown) => { assert.equal(endpoint, null); return work(); }
} });
mock.module(new URL('./personalRecordingAuth.ts', import.meta.url).href, { namedExports: {
	PersonalRecordingUnavailable: Unavailable,
	assertPersonalRecordingAuthority: authority,
	assertPersonalRecordingJob: async (job: any) => {
		await authority({ userId: job.ownerId, deviceId: job.runtimeDeviceId, sessionId: job.runtimeSessionId });
		if (!privateSource || !personalRecordingLeaseIsLive(row, job.lease, new Date())) throw new Unavailable();
	}
} });
mock.module(new URL('./recordingsStore.ts', import.meta.url).href, { namedExports: {
	discoverRecordingUploads: async (ownerId: string) => { assert.equal(ownerId, actor.userId); return 0; },
	getRecordingSettings: async () => ({ enabled: true, createNotes: true, createTodos: true }),
	recordingJobState: (job: any) => structuredClone(job.secure), recordingStateBlob: (state: any) => structuredClone(state),
	recordingSource: async () => privateSource ? { attachment: { crystal: { contentType: 'audio/wav' }, objectSizeBytes: 4 } } : null
} });
mock.module(new URL('./recordingsProvider.ts', import.meta.url).href, { namedExports: { readRecordingBytes: async () => download() } });
mock.module(new URL('./recordingsWorker.ts', import.meta.url).href, { namedExports: {
	recordingTranscriptState: (state: any, transcript: string) => {
		if (state.transcript && state.transcript !== transcript) throw new TypeError('changed transcript');
		return state.transcript ? state : { ...state, transcript, commentIds: ['server-comment'] };
	},
	processRecordingJob: async (job: any, deps: any) => { processCount++; return processing(job, deps); }
} });
const broker = await import('./personalRecordingStore');
const result = { op: 'complete', jobId, leaseId, transcript: 'Water the fern.', analysis: '{"items":[]}' };
beforeEach(() => {
	active = privateSource = true; processCount = 0; calls.length = 0;
	row = { shareId: jobId, ownerId: actor.userId, thingtime: 'lopu-recording-job', runtimeDeviceId: actor.deviceId,
		runtimeSessionId: actor.sessionId, lease: leaseId, leaseUntil: new Date(Date.now() + 60_000), runtimeStartedAt: new Date(),
		nextRunAt: new Date(0), crystal: { status: 'processing', attempts: 1, attachmentId: 'audio' },
		secure: { commentIds: [], commentIndex: 0, insightIndex: 0, resultIds: [] } };
	download = async () => ({ bytes: new Uint8Array(4), type: 'audio/wav' });
	processing = async (job, deps) => {
		assert.equal(job.secure.transcript, result.transcript);
		assert.deepEqual(job.secure.commentIds, ['server-comment']);
		await assert.rejects(deps.analyze(), /must not call a cloud provider/);
		row.crystal.status = 'done'; delete row.lease; delete row.leaseUntil;
		return 'done';
	};
});

test('claim waits for an existing lease and claims only the selected device queue', async () => {
	assert.deepEqual(await broker.claimPersonalRecording(actor), { ok: true, job: null });
	row.leaseUntil = new Date(0);
	const claim = await broker.claimPersonalRecording(actor);
	assert.ok(claim.job);
	assert.equal(claim.job.jobId, jobId);
	assert.equal(claim.job.organize, true);
	assert.notEqual(claim.job.leaseId, leaseId);
	assert.equal(row.runtimeSessionId, actor.sessionId);
	assert.equal(row.crystal.attempts, 2);
	assert.deepEqual(Object.keys(claim.job).sort(), ['bytes', 'jobId', 'leaseId', 'organize', 'type']);
});

test('revoked consent and different devices cannot claim or submit results', async () => {
	active = false;
	await assert.rejects(broker.claimPersonalRecording(actor), Unavailable);
	await assert.rejects(broker.completePersonalRecording(actor, result), Unavailable);
	active = true;
	await assert.rejects(broker.completePersonalRecording({ ...actor, deviceId: 'other' }, result), Unavailable);
	assert.equal(processCount, 0);
});

test('expired leases and forged job identities cannot download or complete', async () => {
	await assert.rejects(broker.completePersonalRecording(actor, { ...result, jobId: `lopu-recording-job-${'b'.repeat(64)}` }), Unavailable);
	row.leaseUntil = new Date(0);
	await assert.rejects(broker.readPersonalRecordingAudio(actor, { op: 'heartbeat', jobId, leaseId }), Unavailable);
	await assert.rejects(broker.completePersonalRecording(actor, result), Unavailable);
	assert.equal(processCount, 0);
});

test('audio is not disclosed if consent changes while storage is downloading', async () => {
	download = async () => { active = false; return { bytes: new Uint8Array(4), type: 'audio/wav' }; };
	await assert.rejects(broker.readPersonalRecordingAudio(actor, { op: 'heartbeat', jobId, leaseId }), Unavailable);
});

test('exact completion retries return the durable receipt without creating content again', async () => {
	const first = await broker.completePersonalRecording(actor, result);
	assert.deepEqual(await broker.completePersonalRecording(actor, result), first);
	assert.deepEqual(first, { ok: true, jobId, leaseId, status: 'done' });
	assert.equal(processCount, 1);
	await assert.rejects(broker.completePersonalRecording(actor, { ...result, analysis: '{"items":[]} ' }), Unavailable);
	await assert.rejects(broker.completePersonalRecording({ ...actor, sessionId: 'new-session' }, result), Unavailable);
});

test('a heartbeat racing a completed receipt succeeds without resurrecting the lease', async () => {
	await broker.completePersonalRecording(actor, result);
	assert.deepEqual(await broker.heartbeatPersonalRecording(actor, { op: 'heartbeat', jobId, leaseId }), { ok: true });
	assert.equal(row.lease, undefined);
	assert.equal(row.leaseUntil, undefined);
});

test('heartbeats cannot renew beyond the absolute ten-minute runtime deadline', async () => {
	row.runtimeStartedAt = new Date(Date.now() - 9.5 * 60_000);
	await broker.heartbeatPersonalRecording(actor, { op: 'heartbeat', jobId, leaseId });
	assert.equal(row.leaseUntil.getTime(), row.runtimeStartedAt.getTime() + 10 * 60_000);
	row.runtimeStartedAt = new Date(Date.now() - 10 * 60_000);
	await assert.rejects(broker.heartbeatPersonalRecording(actor, { op: 'heartbeat', jobId, leaseId }), Unavailable);
});

test('failed work releases only its own lease and stores a closed error, never runtime diagnostics', async () => {
	await broker.failPersonalRecording(actor, { op: 'failed', jobId, leaseId, stage: 'analysis', error: 'private provider credentials' });
	assert.equal(row.crystal.status, 'retry');
	assert.equal(row.lease, undefined);
	assert.doesNotMatch(row.crystal.error, /private provider credentials/);
	assert.ok(row.nextRunAt > new Date());
	assert.equal(row.runtimeDeviceId, actor.deviceId, 'retry must never switch a personal job into the cloud queue');
});

test('pending completions reject competing failures and submissions', async () => {
	row.runtimeCompleting = true;
	await assert.rejects(broker.failPersonalRecording(actor, { op: 'failed', jobId, leaseId, stage: 'runtime' }), Unavailable);
	await assert.rejects(broker.completePersonalRecording(actor, result), Unavailable);
	assert.equal(processCount, 0);
	assert.equal(row.crystal.status, 'processing');
});

test('exact in-flight completion is retryable and later returns one durable receipt', async () => {
	let release!: () => void;
	let entered!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const gate = new Promise<void>(resolve => { release = resolve; });
	processing = async () => {
		entered(); await gate;
		row.crystal.status = 'done'; delete row.lease; delete row.leaseUntil;
		return 'done';
	};
	const first = broker.completePersonalRecording(actor, result);
	await started;
	try {
		await assert.rejects(broker.completePersonalRecording(actor, result), PersonalRecordingCompletionPending);
		await assert.rejects(broker.completePersonalRecording(actor, { ...result, analysis: '{"items":[]} ' }), Unavailable);
		await assert.rejects(broker.completePersonalRecording({ ...actor, sessionId: 'other' }, result), Unavailable);
		await assert.rejects(broker.failPersonalRecording(actor, { op: 'failed', jobId, leaseId, stage: 'runtime' }), Unavailable);
		assert.equal(processCount, 1);
	} finally { release(); }
	const receipt = await first;
	assert.deepEqual(await broker.completePersonalRecording(actor, result), receipt);
	assert.equal(processCount, 1);
});

test('after a worker crash the next claim reuses the accepted transcript and analysis', async () => {
	processing = async () => { throw new Error('process crash'); };
	await assert.rejects(broker.completePersonalRecording(actor, result), /process crash/);
	const savedIds = row.secure.commentIds;
	row.leaseUntil = new Date(0);
	const claim = await broker.claimPersonalRecording(actor);
	assert.equal(claim.job?.transcript, result.transcript);
	assert.equal(claim.job?.organize, false);
	assert.deepEqual(row.secure.commentIds, savedIds);
	assert.equal(row.runtimeCompleting, undefined);
});
