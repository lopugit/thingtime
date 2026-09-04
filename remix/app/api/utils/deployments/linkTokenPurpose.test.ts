import assert from 'node:assert/strict';
import test from 'node:test';

import { sessionPurposeCanActAsAccount } from '../auth/credentialPurpose';

// The deployment-link token is minted by POST /api/v1/deployment-links/token
// with purpose 'deployment-link', and the linking flow in
// routes/api/v1/deployment-links/_deployment-links.tsx immediately swaps to it
// and REVOKES the login-derived token it replaced. Everything the link then
// does — remoteMe (/api/v1/auth/me, the token-liveness check), remoteListThings,
// remotePutThing, remoteUpdateProfile — authenticates through getCurrentUser,
// which drops any session whose purpose is not account-acting.
//
// sessionPurposeCanActAsAccount fails closed on unknown purposes by design, so
// adding a purpose to SessionDoc without adding it here mints a token that
// cannot authenticate anything, with no working credential left to fall back
// on. That regression is invisible to the remote.ts tests (pure URL/address
// vetting) and to any test that stubs auth, so it is pinned here.
test('deployment-link sessions can act as the account', () => {
  assert.equal(sessionPurposeCanActAsAccount('deployment-link'), true);
});

test('the other full-account purposes still act as the account', () => {
  assert.equal(sessionPurposeCanActAsAccount(undefined), true, 'legacy sessions predate `purpose`');
  assert.equal(sessionPurposeCanActAsAccount(null), true);
  assert.equal(sessionPurposeCanActAsAccount('browser'), true);
  assert.equal(sessionPurposeCanActAsAccount('service'), true);
});

// The point of the allowlist is that widening it for deployment links did not
// widen it for the bounded credentials.
test('bounded purposes are still refused the general account path', () => {
  for (const purpose of [
    'app',
    'app-sandbox',
    'pat',
    'oauth-code',
    'chatgpt-oauth-code',
    'chatgpt-mcp',
    'chatgpt-mcp-refresh',
    'chatgpt-mcp-connection'
  ]) {
    assert.equal(sessionPurposeCanActAsAccount(purpose), false, `${purpose} must not act as the account`);
  }
});

test('an unrecognised purpose still fails closed', () => {
  assert.equal(sessionPurposeCanActAsAccount('some-future-bounded-purpose'), false);
  assert.equal(sessionPurposeCanActAsAccount(''), false);
  assert.equal(sessionPurposeCanActAsAccount(0), false);
  assert.equal(sessionPurposeCanActAsAccount({}), false);
});
