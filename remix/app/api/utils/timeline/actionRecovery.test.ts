import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createActionOutcomeRecovery } from './actionRecovery';
import { createActionTimelineRecorder } from './actionOutcome';
import { withTimelineMutationContext } from './mutationContext';
import { signContentProof, verifyContentProof, verifyJwt, signPurposeToken } from '../auth/jwt';
import { actionOutcomeFixture, entryFixture } from '../../../timeline/testFixtures';
import { parseActionOutcomeRecoveryCommand } from '../../../timeline/actionRecovery';

const fixture = (t: any) => {
	const saved = { ...process.env }; process.env.JWT_SECRET = 'disposable-test-secret-12345678901234567890';
	delete process.env.JWT_PRIVATE_KEY; delete process.env.JWT_PUBLIC_KEY;
	process.env.JWT_ISSUER = 'https://timeline.example.invalid';
	t.after(() => { for (const key of ['JWT_SECRET', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'JWT_ISSUER']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; });
};

test('durable content proofs bind exact content, issuer, purpose and storage; they cannot authenticate a session', async (t) => {
	fixture(t); const proof = await signContentProof('timeline-action-outcome-v1', 'digest', 'database');
	assert.equal(await verifyContentProof(proof, 'timeline-action-outcome-v1', 'digest', 'database'), true);
	assert.equal(await verifyJwt(proof), null);
	for (const args of [['other-purpose', 'digest', 'database'], ['timeline-action-outcome-v1', 'changed', 'database'], ['timeline-action-outcome-v1', 'digest', 'elsewhere']])
		assert.equal(await verifyContentProof(proof, args[0], args[1], args[2]), false);
	process.env.JWT_ISSUER = 'https://other.invalid';
	assert.equal(await verifyContentProof(proof, 'timeline-action-outcome-v1', 'digest', 'database'), false);
	process.env.JWT_ISSUER = 'https://timeline.example.invalid';
	const challenge = await signPurposeToken('timeline-action-outcome-v1', { digest: 'digest', aud: 'database' }, '30d');
	assert.equal(await verifyContentProof(challenge, 'timeline-action-outcome-v1', 'digest', 'database'), false);
	const payload = JSON.parse(Buffer.from(proof.split('.')[1], 'base64url').toString()); assert.equal(payload.exp, undefined);
	delete process.env.JWT_SECRET;
	await assert.rejects(signContentProof('timeline-action-outcome-v1', 'digest', 'database'), /configured signing key/);
	assert.equal(await verifyContentProof(proof, 'timeline-action-outcome-v1', 'digest', 'database'), false);
	process.env.JWT_SECRET = 'short'; await assert.rejects(signContentProof('purpose', 'digest', 'database'), /configured signing key/);
});

test('only the exact sealed completion and its original admission reach the canonical metered append', async (t) => {
	fixture(t); let writes = 0; let plane = 'home'; let realm = 'database'; let start = actionOutcomeFixture('started'); const session = {};
	const recovery = createActionOutcomeRecovery({
		plane: () => plane, audience: () => realm, collection: async () => ({} as any), transaction: async work => work(session as any),
		entries: async (_things, ownerId, ids, tx) => { assert.equal(ownerId, 'user-1'); assert.deepEqual(ids, ['admission']); assert.equal(tx, session); return [entryFixture(start)]; },
		append: async (_things, event, tx) => { writes++; assert.equal(tx, session); return entryFixture(event, 2); }
	});
	const sealed = await recovery.seal(actionOutcomeFixture());
	assert.deepEqual((await recovery.recover('user-1', sealed)).event, sealed.event); assert.equal(writes, 1);
	await assert.rejects(recovery.recover('other', sealed), /cannot be verified/);
	for (const patch of [{ label: 'forged' }, { source: 'ai' as const }, { operationId: 'other-operation' }, { id: 'other-event' }, { ownerId: 'other', actorId: 'other' }, { parentIds: ['other-admission'] }])
		await assert.rejects(recovery.recover('user-1', { ...sealed, event: { ...sealed.event, ...patch } }), /cannot be verified/);
	plane = `custom-${'a'.repeat(64)}`; await assert.rejects(recovery.recover('user-1', sealed), /cannot be verified/); plane = 'home';
	realm = 'other-database'; await assert.rejects(recovery.recover('user-1', sealed), /cannot be verified/); realm = 'database';
	start = { ...start, operationId: 'different-run' }; await assert.rejects(recovery.recover('user-1', sealed), /admission/);
	assert.equal(writes, 1);
	assert.deepEqual(parseActionOutcomeRecoveryCommand({ command: 'recover-action-outcome', recovery: sealed }), sealed);
	assert.throws(() => parseActionOutcomeRecoveryCommand({ command: 'recover-action-outcome', recovery: sealed, actor: 'other' }));
});

test('failed completion returns the SAME immutable attempted event; unavailable proof signing preserves the actual incomplete status', async () => {
	const events: any[] = []; const captured: any[] = [];
	const recorder = createActionTimelineRecorder(async event => { events.push(event); if (events.length > 1) throw new Error('quota'); }, () => new Date('2026-09-27T05:00:00.000Z'), async event => {
		captured.push(event); return { formatVersion: 1, event, dataPlane: 'home', proof: 'header.payload.signature' };
	});
	await withTimelineMutationContext('user-1', 'action', async () => {
		const start = await recorder.begin('user-1', 'page-1', `action-run-${randomUUID()}`);
		const report = await recorder.finish(start, { status: 'error', durationMs: 10, opsUsed: 1, depthUsed: 0, childActionsUsed: 0 });
		assert.equal(report.status, 'incomplete'); assert.equal(report.outcomeEventId, null);
		assert.deepEqual(report.recovery?.event, events[1]); assert.deepEqual(events.slice(1), [captured[0], captured[0], captured[0]]);
	});
});

test('ES256 content proofs work with the configured asymmetric signing pair', async (t) => {
	fixture(t); delete process.env.JWT_SECRET;
	const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
	process.env.JWT_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
	const proof = await signContentProof('timeline-action-outcome-v1', 'digest', 'database');
	assert.equal(await verifyContentProof(proof, 'timeline-action-outcome-v1', 'digest', 'database'), true);
	assert.equal(await verifyJwt(proof), null);
});
