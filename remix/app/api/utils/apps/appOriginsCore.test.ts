import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { normalizeAppOrigin, normalizeAppOriginEntry, originAllowedBy } from './appOriginsCore.ts';

test('exact origins normalize as before', () => {
  assert.equal(normalizeAppOrigin('https://Example.com/'), 'https://example.com');
  assert.equal(normalizeAppOrigin('https://example.com:8443'), 'https://example.com:8443');
  assert.equal(normalizeAppOrigin('http://localhost:5199'), 'http://localhost:5199');
  assert.equal(normalizeAppOrigin('http://example.com'), null); // http only for localhost
  assert.equal(normalizeAppOrigin('https://example.com/path'), null);
  assert.equal(normalizeAppOrigin('https://user:pw@example.com'), null);
  assert.equal(normalizeAppOrigin('ftp://example.com'), null);
  assert.equal(normalizeAppOrigin('https://star-*.example.com'), null); // literal origins never contain *
});

test('wildcard entries: the vercel preview shape is accepted and canonicalized', () => {
  assert.equal(
    normalizeAppOriginEntry('https://StarsAlign-*-lopugits-projects.Vercel.app/'),
    'https://starsalign-*-lopugits-projects.vercel.app'
  );
  assert.equal(normalizeAppOriginEntry('https://*.example.com'), 'https://*.example.com');
  assert.equal(normalizeAppOriginEntry('https://preview-*.example.com:8443'), 'https://preview-*.example.com:8443');
});

test('wildcard entries: exact origins pass through unchanged', () => {
  assert.equal(normalizeAppOriginEntry('https://example.com'), 'https://example.com');
  assert.equal(normalizeAppOriginEntry('http://localhost:5199'), 'http://localhost:5199');
});

test('wildcard entries: structural guardrails', () => {
  assert.equal(normalizeAppOriginEntry('http://*-preview.example.com'), null); // https only
  assert.equal(normalizeAppOriginEntry('https://a-*-b-*.example.com'), null); // one star max
  assert.equal(normalizeAppOriginEntry('https://sub.*.example.com'), null); // leftmost label only
  assert.equal(normalizeAppOriginEntry('https://*.com'), null); // needs 2 literal labels after
  assert.equal(normalizeAppOriginEntry('https://*'), null);
  assert.equal(normalizeAppOriginEntry('https://app-*.example.com/path'), null); // bare origins only
});

test('wildcard entries: multi-tenant suffixes (PSL private domains) need a trailing anchor', () => {
  // No anchor at all → refused (would allowlist every site on the platform).
  assert.equal(normalizeAppOriginEntry('https://*.vercel.app'), null);
  assert.equal(normalizeAppOriginEntry('https://*.netlify.app'), null);
  assert.equal(normalizeAppOriginEntry('https://*.github.io'), null);
  // Prefix-only anchor → refused: any stranger can create 'myapp-evil…'.
  assert.equal(normalizeAppOriginEntry('https://myapp-*.vercel.app'), null);
  assert.equal(normalizeAppOriginEntry('https://myapp-*.pages.dev'), null);
  // A trailing anchor (the platform-appended team/site slug) is required…
  assert.equal(normalizeAppOriginEntry('https://*-myteam.vercel.app'), 'https://*-myteam.vercel.app');
  // …and anchoring both sides stays the documented best practice.
  assert.equal(
    normalizeAppOriginEntry('https://myapp-*-myteam.vercel.app'),
    'https://myapp-*-myteam.vercel.app'
  );
});

test('wildcard entries: public eTLDs never take a wildcard', () => {
  assert.equal(normalizeAppOriginEntry('https://*.co.uk'), null);
  assert.equal(normalizeAppOriginEntry('https://starsalign-*.co.uk'), null); // anyone can buy starsalign-evil.co.uk
  assert.equal(normalizeAppOriginEntry('https://myapp-*.com.au'), null);
});

test('wildcard entries: domains the developer owns allow any shape', () => {
  assert.equal(normalizeAppOriginEntry('https://*.thingtime.com'), 'https://*.thingtime.com');
  // A registrable domain UNDER a private suffix is owned by one tenant, so
  // subdomain wildcards beneath it are fine too.
  assert.equal(
    normalizeAppOriginEntry('https://*.starsalign-previews.vercel.app'),
    'https://*.starsalign-previews.vercel.app'
  );
});

test('matching: vercel previews match, strangers do not', () => {
  const allowlist = ['https://starsalign.example', 'https://starsalign-*-lopugits-projects.vercel.app'];

  assert.equal(originAllowedBy(allowlist, 'https://starsalign.example'), true);
  assert.equal(
    originAllowedBy(allowlist, 'https://starsalign-git-claude-astrology-webapp-61aaad-lopugits-projects.vercel.app'),
    true
  );
  assert.equal(originAllowedBy(allowlist, 'https://starsalign-abc123-lopugits-projects.vercel.app'), true);

  // a different team's lookalike must not match
  assert.equal(originAllowedBy(allowlist, 'https://starsalign-evil-attackers-projects.vercel.app'), false);
  // nor a bare vercel site
  assert.equal(originAllowedBy(allowlist, 'https://other.vercel.app'), false);
});

test('matching: the star never crosses a label boundary', () => {
  const allowlist = ['https://*.example.com'];
  assert.equal(originAllowedBy(allowlist, 'https://preview.example.com'), true);
  assert.equal(originAllowedBy(allowlist, 'https://a.b.example.com'), false); // would need * to span a dot
  assert.equal(originAllowedBy(allowlist, 'https://example.com'), false); // no subdomain present
});

test('matching: scheme and port are exact', () => {
  const allowlist = ['https://preview-*.example.com:8443'];
  assert.equal(originAllowedBy(allowlist, 'https://preview-1.example.com:8443'), true);
  assert.equal(originAllowedBy(allowlist, 'https://preview-1.example.com'), false);
  assert.equal(originAllowedBy(allowlist, 'http://preview-1.example.com:8443'), false);
});

test('matching: regex metacharacters in hostnames stay literal', () => {
  // A dot in the pattern must not act as regex-any: only real dots match.
  const allowlist = ['https://app-*.my-site.com'];
  assert.equal(originAllowedBy(allowlist, 'https://app-1.my-site.com'), true);
  assert.equal(originAllowedBy(allowlist, 'https://app-1.myxsite.com'), false);
});

test('matching: malformed inputs are refused outright', () => {
  assert.equal(originAllowedBy(['https://*.example.com'], 'not a url'), false);
  assert.equal(originAllowedBy(['https://*.example.com'], 'https://x.example.com/path-kept'), false);
  assert.equal(originAllowedBy('https://*.example.com' as unknown as string[], 'https://x.example.com'), false);
  assert.equal(originAllowedBy([42, null, 'https://x.example.com'] as unknown as string[], 'https://x.example.com'), true);
});

test('matching: entries with more than one star never match (legacy/tampered data)', () => {
  assert.equal(originAllowedBy(['https://a-*-b-*.example.com'], 'https://a-x-b-y.example.com'), false);
  assert.equal(originAllowedBy(['https://**.example.com'], 'https://x.example.com'), false);
});
