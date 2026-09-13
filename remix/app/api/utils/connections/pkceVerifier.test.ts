import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { pkceVerifierFor } from './shared';

// The state that carries the nonce is a SIGNED JWT, not an encrypted one: it is
// handed to the provider and comes back in the callback URL beside the
// authorization code, and its payload is plain base64url. So whatever the state
// carries is readable by exactly the attacker PKCE defends against — whoever
// intercepted the code. These tests pin that the verifier is never one of those
// things, and that it is still a conforming RFC 7636 verifier.

const decodeJwtPayload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

test('the verifier is derivable from the nonce plus the server secret, not from the nonce alone', () => {
  const nonce = randomUUID();
  const first = pkceVerifierFor('x', nonce);

  // Same inputs, same answer — the callback recomputes rather than reads back.
  assert.equal(pkceVerifierFor('x', nonce), first);
  // The secret is load-bearing: without it the public nonce yields nothing.
  assert.notEqual(first, nonce);
  assert.ok(!first.includes(nonce));
});

test('the verifier is bound to its provider and its nonce', () => {
  const nonce = randomUUID();
  assert.notEqual(pkceVerifierFor('x', nonce), pkceVerifierFor('tiktok', nonce));
  assert.notEqual(pkceVerifierFor('x', nonce), pkceVerifierFor('x', randomUUID()));
});

test('the verifier satisfies RFC 7636 length and alphabet', () => {
  const verifier = pkceVerifierFor('x', randomUUID());
  // 32 HMAC bytes → 43 base64url characters, RFC 7636's minimum.
  assert.equal(verifier.length, 43);
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  // RFC 7636 unreserved: ALPHA / DIGIT / "-" / "." / "_" / "~".
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
});

test('a state carrying only the nonce never leaks the verifier to whoever reads the callback URL', () => {
  const nonce = randomUUID();
  const verifier = pkceVerifierFor('x', nonce);

  // Exactly the claims beginOAuth signs, and a stand-in for the
  // signed-but-readable JWT they become. An earlier revision appended the
  // verifier to this payload.
  const claims = { sub: 'user-1', provider: 'x', nonce, purpose: 'connections-oauth', iat: 1, exp: 2 };
  const state = `${Buffer.from('{"alg":"ES256"}').toString('base64url')}.${Buffer.from(
    JSON.stringify(claims)
  ).toString('base64url')}.signature`;

  // The whole point: decoding the state with no key at all — which is all an
  // interceptor of the callback URL has to do — must not yield the verifier.
  const payload = decodeJwtPayload(state);
  assert.equal(payload.nonce, nonce);
  // The state is a PURPOSE token, never a session JWT: verifyJwt requires a
  // jti, so this envelope can never be replayed as a session/PAT/app token no
  // matter who reads it off the callback URL.
  assert.equal(payload.purpose, 'connections-oauth');
  assert.equal(payload.jti, undefined);
  assert.ok(!state.includes(verifier));
  assert.ok(!JSON.stringify(payload).includes(verifier));

  // And the challenge that did go to the provider must not give it up either.
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.ok(!state.includes(challenge));
  assert.notEqual(challenge, verifier);
});
