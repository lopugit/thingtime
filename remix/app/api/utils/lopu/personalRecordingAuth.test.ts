import assert from 'node:assert/strict';
import test from 'node:test';
import { createPersonalRecordingAuthority, PersonalRecordingUnavailable, personalRecordingActorForJob } from './personalRecordingAuth';
import { PERSONAL_RECORDING_CAPABILITY } from './personalRecordingCore';
import { recordingTranscriptState } from './recordingsWorker';

const actor = { userId: 'owner', deviceId: 'paired-device', sessionId: 'paired-session', capabilities: [PERSONAL_RECORDING_CAPABILITY] };
const harness = (deny = -1) => {
	const calls: Array<{ collection: string; method: string; filter: any; options: any; update?: any }> = [];
	let active = false;
	const collection = (name: string) => Object.fromEntries(['findOne', 'updateOne'].map((method) => [method, async (...args: any[]) => {
		assert.equal(active, false, 'authority operations must be sequential inside a transaction');
		active = true;
		await Promise.resolve();
		active = false;
		calls.push({ collection: name, method, filter: args[0], options: args.at(-1), ...(method === 'updateOne' ? { update: args[1] } : {}) });
		const allowed = calls.length - 1 !== deny;
		return method === 'updateOne' ? { matchedCount: Number(allowed) } : allowed ? { _id: name } : null;
	}]));
	const guard = createPersonalRecordingAuthority({ things: async () => collection('things'), sessions: async () => collection('sessions') } as any);
	return { calls, guard };
};

test('personal recording disclosure repeats exact current session, device and consent checks', async () => {
	const { calls, guard } = harness();
	await guard(actor);
	assert.equal(calls.length, 3);
	assert.deepEqual(calls.map((call) => [call.collection, call.method]), [['sessions', 'findOne'], ['things', 'findOne'], ['things', 'findOne']]);
	const [session, device, consent] = calls;
	assert.equal(session.filter.jti, actor.sessionId);
	assert.equal(session.filter.userId, actor.userId);
	assert.equal(session.filter.purpose, 'device');
	assert.equal(session.filter.revokedAt, null);
	assert.equal(session.filter['meta.deviceId'], actor.deviceId);
	assert.equal(session.filter['meta.capabilities'], PERSONAL_RECORDING_CAPABILITY);
	assert.ok(session.filter.$or[1].expiresAt.$gt instanceof Date);
	assert.deepEqual(device.filter, { shareId: actor.deviceId, ownerId: actor.userId, thingtime: 'device', deletedAt: null });
	assert.equal(consent.filter.ownerId, actor.userId);
	assert.equal(consent.filter.thingtime, 'lopu-recording-settings');
	assert.equal(consent.filter['crystal.enabled'], true);
	assert.equal(consent.filter['crystal.runtimeDeviceId'], actor.deviceId);
	for (const call of calls) assert.deepEqual(call.options, { projection: { _id: 1 } });
});

test('personal output transactions write-fence every authority with the same session', async () => {
	const { calls, guard } = harness();
	const transaction = { marker: 'same transaction' };
	await guard(actor, transaction);
	for (const call of calls) {
		assert.equal(call.method, 'updateOne');
		assert.deepEqual(call.update, { $inc: { recordingWriteFence: 1 } });
		assert.equal(call.options.session, transaction);
	}
});

test('revocation, removed devices and switched/off consent each fail closed for reads and writes', async () => {
	for (const session of [undefined, { transaction: true }]) for (const denied of [0, 1, 2]) {
		const { calls, guard } = harness(denied);
		await assert.rejects(guard(actor, session), PersonalRecordingUnavailable);
		assert.equal(calls.length, denied + 1);
	}
});

test('missing capability and malformed identities never query storage', async () => {
	for (const invalid of [{ ...actor, capabilities: [] }, { ...actor, sessionId: '' }, { ...actor, userId: { $ne: null } },
		{ ...actor, deviceId: null }, { ...actor, capabilities: null }]) {
		const { calls, guard } = harness();
		await assert.rejects(guard(invalid as any), PersonalRecordingUnavailable);
		assert.equal(calls.length, 0);
	}
});

test('worker authorization uses stored job identities, not a submitted account or session', () => {
	assert.deepEqual(personalRecordingActorForJob({ ownerId: 'owner', runtimeDeviceId: 'paired-device', runtimeSessionId: 'paired-session',
		crystal: { ownerId: 'attacker', runtimeDeviceId: 'other' } }), actor);
});

test('accepted transcripts get stable comment ids before processing and cannot be replaced on retry', () => {
	const empty = { commentIds: [], commentIndex: 0, insightIndex: 0, resultIds: [] };
	const text = 'Remember the fern. 🌿'.repeat(800);
	const accepted = recordingTranscriptState(empty, text);
	assert.equal(accepted.transcript, text);
	assert.ok(accepted.commentIds.length > 1);
	assert.equal(new Set(accepted.commentIds).size, accepted.commentIds.length);
	assert.equal(recordingTranscriptState(accepted, text), accepted);
	assert.throws(() => recordingTranscriptState(accepted, text + ' edited'), TypeError);
	assert.equal(empty.commentIds.length, 0);
});
