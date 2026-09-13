import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { signJwt, signPurposeToken, verifyJwt, verifyPurposeToken } from '../auth/jwt';

// The connections OAuth `state` is the one credential-shaped value Thingtime
// deliberately hands to an arbitrary third party: it rides the authorize URL
// into the provider, its access logs, the browser's history, and the callback
// page's Referer. So the envelope it is minted in matters as much as the claims
// it carries — these tests pin the fence between it and a real session JWT in
// both directions, at the signer/verifier layer where the fence actually lives.
//
// jwt.ts reads its key material lazily (nothing at module scope), so setting
// this here still lands before the first sign/verify call below. Each test file
// runs in its own process, so it cannot leak into another suite.
process.env.JWT_SECRET = `connections-oauth-state-test-${randomUUID()}`;

// Must stay identical to STATE_PURPOSE in ./oauth.ts — a drift would silently
// stop testing the token the flow actually mints.
const STATE_PURPOSE = 'connections-oauth';

const mintState = (userId: string, provider = 'x', nonce = randomUUID()) =>
  signPurposeToken(STATE_PURPOSE, { sub: userId, provider, nonce }, '15m');

test('the OAuth state round-trips its user, provider, and nonce', async () => {
  const nonce = randomUUID();
  const claims = await verifyPurposeToken(await mintState('user-1', 'reddit', nonce), STATE_PURPOSE);
  assert.ok(claims);
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.provider, 'reddit');
  assert.equal(claims.nonce, nonce);
});

test('a leaked OAuth state can never be replayed as a session token', async () => {
  // The threat this envelope exists to remove: whoever reads the callback URL
  // holds a validly-signed, user-bound, 15-minute token. verifyJwt is the door
  // every session, PAT, app-token, and authorization-code path goes through, so
  // it is the door that has to refuse — structurally, not because each of those
  // callers separately re-checks a jti against Mongo.
  assert.equal(await verifyJwt(await mintState('user-1')), null);
});

test('a real session token can never be replayed as an OAuth state', async () => {
  // The other direction: a stolen session cookie must not let an attacker
  // complete an account link (which would bind THEIR external account, and its
  // sealed credentials, to the victim).
  const session = await signJwt({ sub: 'user-1', jti: `session-${randomUUID()}`, expiresIn: '30d' });
  assert.equal(await verifyPurposeToken(session, STATE_PURPOSE), null);
});

test('a state minted for another purpose is refused', async () => {
  const other = await signPurposeToken('sso-handoff', { sub: 'user-1', provider: 'x', nonce: 'n' }, '15m');
  assert.equal(await verifyPurposeToken(other, STATE_PURPOSE), null);
});

test('an expired state is refused', async () => {
  const expired = await signPurposeToken(STATE_PURPOSE, { sub: 'user-1', provider: 'x', nonce: 'n' }, '-5 min');
  assert.equal(await verifyPurposeToken(expired, STATE_PURPOSE), null);
});

test('a tampered state is refused', async () => {
  // An attacker who wants the link to land on someone else has to change `sub`,
  // which is exactly what the signature covers.
  const [header, payload, signature] = (await mintState('user-1')).split('.');
  const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  forged.sub = 'victim';
  const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;
  assert.equal(await verifyPurposeToken(tampered, STATE_PURPOSE), null);
});
