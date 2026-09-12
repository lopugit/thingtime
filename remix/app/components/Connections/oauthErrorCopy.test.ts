import assert from 'node:assert/strict';
import test from 'node:test';

import { OAUTH_ERROR_CODES } from '~/api/utils/connections/shared';
import { OAUTH_ERROR_COPY, connectedProviderLabel, oauthErrorMessage } from './shared';

// The /connections OAuth landing reads ?connected= and ?oauthError= off the URL
// and renders them in a Lopu toast. Nothing authenticates either one: the
// callback route is a GET a stranger can aim a signed-in victim at, and the
// landing params can simply be typed. Echoing them verbatim therefore renders
// attacker-chosen copy inside Thingtime's own chrome at a real thingtime.com
// address — not XSS (Chakra renders text), but the phishing surface under it.
// These tests pin the rule that closes it: the URL SELECTS copy, it never
// supplies it.

test('oauthErrorMessage maps known codes and never echoes an unknown one', () => {
  assert.equal(oauthErrorMessage('session'), OAUTH_ERROR_COPY.get('session'));
  assert.equal(oauthErrorMessage('rateLimited'), OAUTH_ERROR_COPY.get('rateLimited'));

  // the whole point: a hand-typed lure degrades to our own generic line
  const lure = 'Your Thingtime session expired — reverify at thingtime-support.example 🔐';
  assert.equal(oauthErrorMessage(lure), OAUTH_ERROR_COPY.get('failed'));
  assert.notEqual(OAUTH_ERROR_COPY.get('failed'), lure);
  // an inherited key must not resolve either: on a plain object literal
  // `__proto__` yields Object.prototype, which is truthy, so the fallback is
  // skipped and a non-string reaches the toast title. React throws on that.
  assert.equal(typeof oauthErrorMessage('__proto__'), 'string');
  assert.equal(oauthErrorMessage('__proto__'), OAUTH_ERROR_COPY.get('failed'));
  assert.equal(oauthErrorMessage('constructor'), OAUTH_ERROR_COPY.get('failed'));

  // absent means "say nothing", not "say something generic"
  assert.equal(oauthErrorMessage(null), null);
  assert.equal(oauthErrorMessage(''), null);
  assert.equal(oauthErrorMessage(undefined), null);
});

// Drift here is silent in production and loud only here: a new server code with
// no client copy renders as the generic line for every one of its failures, and
// client copy with no server code is dead weight that reads as supported.
test('the client copy map covers exactly the server code set', () => {
  assert.deepEqual([...OAUTH_ERROR_COPY.keys()].sort(), [...OAUTH_ERROR_CODES].sort());
  assert.ok(OAUTH_ERROR_CODES.includes('failed'), 'the generic fallback must itself be a real code');
});

test('connectedProviderLabel prefers the catalogue name and word-shapes the fallback', () => {
  const providers = [{ id: 'bluesky-account', name: 'Bluesky 🦋' }];
  assert.equal(connectedProviderLabel('bluesky-account', providers), 'Bluesky 🦋');

  // the landing effect runs before the first providers read settles, so a
  // first-ever link has nothing to resolve against — the slug still shows
  assert.equal(connectedProviderLabel('youtube', []), 'youtube');

  // …but only because it is word-shaped. Anything that could be a sentence is
  // dropped to null, and the caller says "Account linked 🎉" with no name.
  assert.equal(connectedProviderLabel('Reddit — verify your card at evil.example', []), null);
  assert.equal(connectedProviderLabel('a'.repeat(33), []), null, 'length is bounded too');
  assert.equal(connectedProviderLabel('-leading-hyphen', []), null);
  assert.equal(connectedProviderLabel(null, providers), null);
});
