import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let remaining = 1, consumptions = 0, revoked = false, expired = false, accountLive = true, scopes = ['things.read'];
const session = () => ({ jti: 'admitted-token', userId: 'owner', purpose: 'pat', expiresAt: null, meta: { scopes, maxUses: 1, usesRemaining: remaining } });
mock.module('./characterSession', { namedExports: { CHARACTER_HEADER: 'X-Thingtime-Character', characterAccountLive: async () => accountLive } });
mock.module('./getCurrentUser', { namedExports: { getCurrentUser: async () => null, resolveSessionUser: async () => null, serviceAccountAuthenticationAllowed: () => true } });
mock.module('./internalRequestActor', { namedExports: { internalRequestActor: () => null } });
mock.module('../apps/appTokens', { namedExports: { resolveAppToken: async () => null } });
mock.module('./authCookie', { namedExports: { getAuthToken: async (request: Request) => request.headers.get('Authorization')?.slice(7) || null } });
mock.module('./jwt', { namedExports: { signJwt: async () => '', verifyJwt: async (token: string) => token === 'admitted-token' ? { jti: token, sub: 'owner' } : null } });
mock.module('./sessions', { namedExports: { createSession: async () => null, getLiveSession: async () => revoked || expired ? null : session(), REVOKED_SESSION_REAP_MS: 1 } });
mock.module('./users', { namedExports: { findUserById: async () => ({ _id: 'owner', username: 'owner' }), toPublicUserWithStorage: async () => ({ id: 'owner', username: 'owner' }) } });
mock.module('../mongodb/collections', { namedExports: { getSessionsCollection: async () => ({ updateOne: async () => {
	if (remaining <= 0) return { modifiedCount: 0 }; consumptions++; remaining--; return { modifiedCount: 1 };
} }) } });
mock.module('../subscriptions/subscriptions', { namedExports: { getSubscription: async () => null } });
mock.module('../apps/namespace', { namedExports: { appScopeOf: () => null } });
const { resolveThingsActor, revalidateThingsActor } = await import('./patTokens');
const { resolveActor, revalidateActor } = await import('./resolveActor');
const request = () => new Request('https://thingtime.test/api/v1/agent-overview', { headers: { Authorization: 'Bearer admitted-token' } });
const reset = () => { remaining = 1; consumptions = 0; revoked = false; expired = false; accountLive = true; scopes = ['things.read']; };

test('a last-use PAT admits exactly one request and revalidates it without consuming again', async () => {
	reset(); const req = request(); const initial = await resolveThingsActor(req, 'things.read');
	assert.equal(initial.ok, true); if (!initial.ok) throw new Error('expected admission');
	assert.equal(remaining, 0); assert.equal(consumptions, 1);
	for (let i = 0; i < 3; i++) assert.equal((await revalidateThingsActor(req, 'things.read', initial.actor.pat!)).ok, true);
	assert.equal(consumptions, 1); assert.equal((await resolveThingsActor(request(), 'things.read')).ok, false);
});

test('copied actors, another request and another scope cannot skip admission', async () => {
	reset(); const req = request(); const initial = await resolveThingsActor(req, 'things.read'); if (!initial.ok) throw new Error();
	for (const [otherRequest, scope, pat] of [[request(), 'things.read', initial.actor.pat], [req, 'things.update', initial.actor.pat], [req, 'things.read', { ...initial.actor.pat }]] as const) {
		assert.equal((await revalidateThingsActor(otherRequest, scope, pat as any)).ok, false);
	}
	assert.equal(consumptions, 1);
});

test('every revalidation checks live revocation, expiry, scopes and account state', async () => {
	for (const change of ['revoked', 'expired', 'scopes', 'account']) {
		reset(); const req = request(); const initial = await resolveThingsActor(req, 'things.read'); if (!initial.ok) throw new Error();
		if (change === 'revoked') revoked = true; if (change === 'expired') expired = true; if (change === 'scopes') scopes = []; if (change === 'account') accountLive = false;
		const next = await revalidateThingsActor(req, 'things.read', initial.actor.pat!);
		assert.equal(next.ok === false || !next.actor.user, true, change); assert.equal(consumptions, 1);
	}
});

test('canonical tagged Actor revalidator keeps PAT fences and does not admit a copied Request', async () => {
	reset(); const req = request(); const actor = await resolveActor(req, { thingsScope: 'things.read' });
	assert.ok(!(actor instanceof Response)); assert.equal(actor.kind, 'pat');
	const next = await revalidateActor(req, actor, { thingsScope: 'things.read' });
	assert.ok(!(next instanceof Response)); assert.equal(next.kind, 'pat'); if (next.kind === 'pat') { assert.equal(next.pat.jti, 'admitted-token'); assert.equal(next.pat.usesRemaining, 0); }
	const denied = await revalidateActor(request(), actor, { thingsScope: 'things.read' }); assert.ok(denied instanceof Response); assert.equal(denied.status, 401);
});
