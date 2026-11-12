import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { connectionProviderById } from './providers.ts';

// MASTODON_INSTANCE normalization (providers.ts mastodonInstance).
//
// The env var names the ONE instance a deployment registers its OAuth app on,
// and the resulting host is load-bearing in two unrelated places: every
// authorize/token/timeline URL the account provider builds, and the
// `${instance}-${status.id}` externalId grammar that mapMastodonStatus shares
// with the public provider under `postNamespace: 'mastodon'`.
//
// The public provider's host comes from sanitizeHost, which lowercases BEFORE
// stripping the scheme. This helper is driven by operator config rather than
// user input, so it used to skip that — which is why both failure modes below
// are only reachable through a mis-spelled env var.
//
// Driven through buildAuthorizeUrl because it is the pure, synchronous
// expression of the same normalization — no fetch or DNS stubbing needed.
//
// Asserted on the RAW returned string, never through `new URL(...)`: WHATWG URL
// lowercases the hostname itself, so parsing first would launder exactly the
// casing defect the second test exists to catch, and the externalId grammar
// interpolates the raw value rather than a parsed one.

const provider: any = connectionProviderById('mastodon-account');

const authorizeUrl = (instanceEnv: string): string => {
  const previous = process.env.MASTODON_INSTANCE;
  process.env.MASTODON_INSTANCE = instanceEnv;
  try {
    return provider.oauth.buildAuthorizeUrl({
      clientId: 'client-id',
      redirectUri: 'https://thingtime.test/api/v1/connections/oauth/callback',
      state: 'state-token'
    });
  } finally {
    if (previous === undefined) delete process.env.MASTODON_INSTANCE;
    else process.env.MASTODON_INSTANCE = previous;
  }
};

// The exact prefix a correctly normalized instance must produce.
const CANONICAL = 'https://mastodon.social/oauth/authorize?';

test('every spelling of MASTODON_INSTANCE resolves to the same canonical host', () => {
  for (const spelling of [
    'mastodon.social',
    'Mastodon.Social',
    'MASTODON.SOCIAL',
    'https://mastodon.social',
    'https://mastodon.social/',
    'https://Mastodon.Social/web',
    '  mastodon.social  '
  ]) {
    assert.ok(
      authorizeUrl(spelling).startsWith(CANONICAL),
      `MASTODON_INSTANCE=${JSON.stringify(spelling)} produced ${authorizeUrl(spelling).slice(0, 60)}`
    );
  }
});

test('an upper-case scheme does not survive into the host', () => {
  // The scheme strip is case-sensitive, so without the lowercase-first ordering
  // `HTTPS://mastodon.social` kept its prefix, `/\/.*$/` cut at the first slash,
  // and the instance became the literal `HTTPS:` — making every URL built from
  // it (`https://HTTPS:/oauth/authorize`) point at nothing reachable.
  const url = authorizeUrl('HTTPS://mastodon.social');
  assert.ok(url.startsWith(CANONICAL), `got ${url.slice(0, 60)}`);
  assert.ok(!/HTTPS:/i.test(url.slice('https://'.length)), 'the scheme must never be mistaken for the host');
});

test('a mis-cased instance cannot fork the shared mastodon post namespace', () => {
  // Both providers share `postNamespace: 'mastodon'` and mapMastodonStatus keys
  // externalIds on `${instance}-${status.id}`. The public provider's instance
  // comes from sanitizeHost (lowercase); if this one disagrees on casing, the
  // SAME status arrives as two external-posts with split comment threads, and
  // `${instance}:id:…` mints two external-accounts for one identity.
  const publicProvider: any = connectionProviderById('mastodon');
  assert.equal(publicProvider.postNamespace ?? publicProvider.id, provider.postNamespace, 'both providers share one namespace');

  // Recover the host exactly as the externalId grammar would interpolate it.
  const host = authorizeUrl('Mastodon.Social').slice('https://'.length).split('/')[0];
  assert.equal(host, 'mastodon.social');
  // sanitizeHost's contract, which the public provider's instance already meets
  assert.match(host, /^[a-z0-9][a-z0-9.-]{1,200}\.[a-z]{2,}$/);
});
