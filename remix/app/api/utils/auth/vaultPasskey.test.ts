import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { signPurposeToken } from './jwt';
import { finishVaultPasskeyVerification } from './passkeys';

const origin = 'https://thingtime.example';
const request = new Request(origin);
const payload = { challenge: 'synthetic-challenge', rpID: 'thingtime.example', origin, userId: 'owner', binding: 'session-item-binding' };
const response = { id: 'credential', response: { userHandle: Buffer.from('owner').toString('base64url') } } as any;
const doc = {
	shareId: 'passkey',
	ownerId: 'owner',
	crystal: {},
	secureCounter: 0,
	secure: new Binary(Buffer.from(JSON.stringify({ credentialId: 'credential', publicKey: 'AA' })))
};
const fixture = (overrides = {}) => {
	const consumed = new Set();
	let verified = 0;
	const deps = {
		find: async () => doc,
		verify: async (options: any) => {
			verified++;
			assert.equal(options.requireUserVerification, true);
			assert.equal(options.expectedOrigin, origin);
			assert.equal(options.expectedRPID, payload.rpID);
			assert.equal(options.expectedChallenge, payload.challenge);
			return { verified: true, authenticationInfo: { newCounter: 1 } };
		},
		consume: async (kind: string, challenge: string) => {
			assert.equal(kind, 'vault');
			if (consumed.has(challenge)) return false;
			consumed.add(challenge);
			return true;
		},
		update: async () => ({ matchedCount: 1 }),
		...overrides
	};
	return { deps: deps as any, verified: () => verified };
};
test('vault assertion requires user verification and is consumed once even with synced zero counters', async () => {
	const ticket = await signPurposeToken('vault-reveal', payload, '2m');
	const { deps } = fixture();
	assert.equal(await finishVaultPasskeyVerification(request, 'owner', payload.binding, ticket, response, deps), true);
	assert.equal(await finishVaultPasskeyVerification(request, 'owner', payload.binding, ticket, response, deps), false);
});
test('login tickets, expired tickets and changed owner/session/item/origin are rejected before verification', async () => {
	const cases = [
		await signPurposeToken('webauthn-auth', payload, '2m'),
		await signPurposeToken('vault-reveal', payload, '-1s'),
		...(await Promise.all(
			[{ userId: 'other' }, { binding: 'other-session-or-item' }, { origin: 'https://other.example' }, { rpID: 'other.example' }].map((change) =>
				signPurposeToken('vault-reveal', { ...payload, ...change }, '2m')
			)
		)),
		'forged-ticket'
	];
	for (const ticket of cases) {
		const { deps, verified } = fixture();
		assert.equal(await finishVaultPasskeyVerification(request, 'owner', payload.binding, ticket, response, deps), false);
		assert.equal(verified(), 0);
	}
});
test('wrong-owner, revoked, corrupt, unknown or mismatched-userHandle passkeys cannot reveal', async () => {
	const ticket = await signPurposeToken('vault-reveal', payload, '2m');
	for (const found of [null, { ...doc, ownerId: 'victim' }, { ...doc, crystal: { revokedAt: '2026-09-09' } }, { ...doc, secure: null }]) {
		const { deps, verified } = fixture({ find: async () => found });
		assert.equal(await finishVaultPasskeyVerification(request, 'owner', payload.binding, ticket, response, deps), false);
		assert.equal(verified(), 0);
	}
	const { deps } = fixture();
	assert.equal(
		await finishVaultPasskeyVerification(
			request,
			'owner',
			payload.binding,
			ticket,
			{ ...response, response: { userHandle: Buffer.from('victim').toString('base64url') } },
			deps
		),
		false
	);
});
test('bad signatures and revocation during verification fail closed', async () => {
	const ticket = await signPurposeToken('vault-reveal', payload, '2m');
	for (const overrides of [
		{
			verify: async () => {
				throw new Error('invalid signature');
			}
		},
		{ verify: async () => ({ verified: false }) },
		{ update: async () => ({ matchedCount: 0 }) }
	]) {
		assert.equal(await finishVaultPasskeyVerification(request, 'owner', payload.binding, ticket, response, fixture(overrides).deps), false);
	}
});
