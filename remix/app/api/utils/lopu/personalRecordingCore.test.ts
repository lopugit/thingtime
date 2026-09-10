import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePersonalRecordingRequest, personalRecordingLeaseIsLive, personalRecordingReceiptHash } from './personalRecordingCore';

const lease = { jobId: `lopu-recording-job-${'a'.repeat(64)}`, leaseId: '52a5a4a2-060c-44bf-a208-6aac88913e75' };
const complete = { op: 'complete' as const, ...lease, transcript: 'Remember to water the fern.', analysis: JSON.stringify({ items: [
	{ kind: 'todo', title: 'Water the fern', description: 'Water the fern.', evidence: 'water the fern' }
] }) };

test('personal recording requests project only the bounded operation payload', () => {
	assert.deepEqual(parsePersonalRecordingRequest({ op: 'claim', ownerId: 'other', deviceId: 'other', command: 'execute' }), { op: 'claim' });
	assert.deepEqual(parsePersonalRecordingRequest({ op: 'heartbeat', ...lease, expiresAt: '2099-01-01' }), { op: 'heartbeat', ...lease });
	assert.deepEqual(parsePersonalRecordingRequest({ ...complete, targetId: 'other', acl: ['tt:all'], apiKey: 'not-a-real-key' }), complete);
	assert.deepEqual(parsePersonalRecordingRequest({ op: 'failed', ...lease, stage: 'analysis', error: 'secret URL' }), { op: 'failed', ...lease, stage: 'analysis' });
});

test('the runtime cannot submit arbitrary commands, identities or raw errors', () => {
	for (const input of [null, [], { op: 'execute', ...lease }, { op: 'heartbeat', ...lease, jobId: { $ne: null } },
		{ op: 'heartbeat', ...lease, leaseId: '' }, { op: 'failed', ...lease, stage: 'secret URL' }])
		assert.throws(() => parsePersonalRecordingRequest(input));
});

test('completed results must be bounded and grounded in the exact transcript', () => {
	for (const input of [{ ...complete, transcript: '' }, { ...complete, transcript: 'x'.repeat(60_001) },
		{ ...complete, analysis: 'x'.repeat(65_537) }, { ...complete, analysis: '{' },
		{ ...complete, transcript: 'No instructions here.' },
		{ ...complete, analysis: JSON.stringify({ items: [{ kind: 'execute', title: 'Run', evidence: 'water' }] }) }])
		assert.throws(() => parsePersonalRecordingRequest(input));
});

test('receipt identity binds the lease and exact result for safe completion retries', () => {
	assert.equal(personalRecordingReceiptHash(complete), personalRecordingReceiptHash({ ...complete }));
	for (const changed of [{ ...complete, transcript: complete.transcript + ' ' }, { ...complete, analysis: complete.analysis + ' ' },
		{ ...complete, leaseId: '52a5a4a2-060c-44bf-a208-6aac88913e76' }, { ...complete, jobId: `lopu-recording-job-${'b'.repeat(64)}` }])
		assert.notEqual(personalRecordingReceiptHash(complete), personalRecordingReceiptHash(changed));
});

test('expired, forged, future or indefinitely renewed runtime leases fail closed', () => {
	const now = new Date('2026-09-10T07:00:00Z');
	const job = { lease: lease.leaseId, leaseUntil: new Date('2026-09-10T07:01:00Z'), runtimeStartedAt: new Date('2026-09-10T06:59:00Z') };
	assert.equal(personalRecordingLeaseIsLive(job, lease.leaseId, now), true);
	for (const bad of [{ ...job, lease: 'wrong' }, { ...job, leaseUntil: now }, { ...job, leaseUntil: 'bad' },
		{ ...job, runtimeStartedAt: 'bad' }, { ...job, runtimeStartedAt: new Date('2026-09-10T07:00:01Z') },
		{ ...job, runtimeStartedAt: new Date('2026-09-10T06:50:00Z') }])
		assert.equal(personalRecordingLeaseIsLive(bad, lease.leaseId, now), false);
});
