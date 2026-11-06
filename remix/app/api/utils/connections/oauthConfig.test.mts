import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let reads = 0, stored: string | null;
mock.module(new URL('../admin/integrations.ts', import.meta.url).href, { namedExports: {
  readAdminAutomationSecret: async (label: string) => { assert.equal(label, 'connections-google-oauth'); reads++; return stored; }
} });
const { oauthClientConfig, parseOAuthClientConfig, oauthGrantMatches } = await import('./oauthConfig.ts');
const { withVaultRequest } = await import('../auth/vaultRequest.ts');
const origin = 'https://thingtime.test', environment = 'oauth-test';
const entry = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', redirectUri: `${origin}/api/v1/connections/oauth/callback` };
const bundle = (value: unknown = entry) => JSON.stringify({ environments: { [environment]: { origins: { [origin]: value } } } });
const parse = (raw: string | null) => parseOAuthClientConfig(raw, 'GOOGLE_CLIENT_ID', origin, environment);
beforeEach(() => {
  process.env.THINGTIME_DATA_ENV = `custom:${environment}`;
  process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = origin;
  delete process.env.CONNECTIONS_OAUTH_REDIRECT_BASE;
  process.env.GOOGLE_CLIENT_ID = 'legacy-client'; process.env.GOOGLE_CLIENT_SECRET = 'legacy-secret';
  stored = bundle(); reads = 0;
});
test('configuration selects an exact environment and origin and refuses malformed/empty values', () => {
  assert.equal(parse(bundle())?.clientId, entry.clientId);
  for (const raw of [null, '', 'secret', '{}', '[]', 'null', bundle(null), bundle([]), bundle({ ...entry, clientSecret: '' }), bundle({ ...entry, clientId: ' client' }), bundle({ ...entry, authMethod: 'none' }), bundle({ ...entry, redirectUri: entry.redirectUri + '?leak=secret' })]) assert.equal(parse(raw), null);
  for (const other of ['https://preview.test', 'http://localhost:9999', origin + '/', 'https://user:pass@thingtime.test']) assert.equal(parseOAuthClientConfig(bundle(), 'GOOGLE_CLIENT_ID', other, environment), null);
  assert.equal(parseOAuthClientConfig(bundle(), 'GOOGLE_CLIENT_ID', origin, 'production'), null);
  assert.equal(parseOAuthClientConfig(bundle(), '__proto__', origin, environment), null);
});
test('missing vault/environment/origin never falls back to legacy environment credentials', async () => {
  stored = null;
  assert.equal(await oauthClientConfig('GOOGLE_CLIENT_ID', origin), null);
  stored = bundle(); delete process.env.THINGTIME_DATA_ENV;
  assert.equal(await oauthClientConfig('GOOGLE_CLIENT_ID', origin), null);
  process.env.THINGTIME_DATA_ENV = `custom:${environment}`;
  assert.equal(await oauthClientConfig('GOOGLE_CLIENT_ID'), null);
});
test('same-origin callback-base compatibility cannot redirect one origin into another', async () => {
  process.env.CONNECTIONS_OAUTH_REDIRECT_BASE = origin;
  assert.ok(await oauthClientConfig('GOOGLE_CLIENT_ID', origin));
  process.env.CONNECTIONS_OAUTH_REDIRECT_BASE = 'https://production.test';
  assert.equal(await oauthClientConfig('GOOGLE_CLIENT_ID', origin), null);
});
test('request reads coalesce, do not leak across requests and reject another selected origin', async () => {
  await withVaultRequest(new Request(origin), async () => {
    assert.ok((await Promise.all(Array.from({ length: 8 }, () => oauthClientConfig('GOOGLE_CLIENT_ID')))).every(Boolean));
    assert.equal(reads, 1);
    assert.equal(await oauthClientConfig('GOOGLE_CLIENT_ID', 'https://production.test'), null);
  });
  stored = bundle({ ...entry, clientId: 'rotated-client' });
  await withVaultRequest(new Request(origin), async () => assert.equal((await oauthClientConfig('GOOGLE_CLIENT_ID'))?.clientId, 'rotated-client'));
  assert.equal(reads, 2);
});
test('binding rejects changed client/origin/environment and permits secret rotation', () => {
  const config = parse(bundle())!;
  const grant = { clientId: config.clientId, oauthBinding: config.binding, oauthOrigin: config.origin, oauthEnvironment: config.environment };
  assert.equal(oauthGrantMatches(grant, parse(bundle({ ...entry, clientSecret: 'rotated-secret' }))!), true);
  assert.equal(oauthGrantMatches(grant, parse(bundle({ ...entry, clientId: 'rotated-client' }))!), false);
  for (const key of ['clientId', 'oauthBinding', 'oauthOrigin', 'oauthEnvironment']) assert.equal(oauthGrantMatches({ ...grant, [key]: 'wrong' }, config), false);
});
