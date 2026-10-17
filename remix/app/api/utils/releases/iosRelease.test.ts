import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { authorizeIOSRelease, parseIOSReleasePolicy, parseIOSReleaseBundle, IOS_RELEASE_AUDIENCE } from './iosReleaseCore';
import { createIOSReleaseTokenVerifier } from './iosRelease';
import { createIOSReleaseAction } from '../../../routes/api/v1/integrations/ios-release/_ios-release';
const policy = { repository: 'example/project', repositoryId: '123', ownerId: '456', enabled: true as const, allowMigration: true };
const identity = {
  repository: policy.repository, repository_id: '123', repository_owner_id: '456', ref: 'refs/heads/main', ref_type: 'branch',
  workflow_ref: 'example/project/.github/workflows/ios-testflight.yml@refs/heads/main', runner_environment: 'github-hosted',
  event_name: 'push', sha: 'a'.repeat(40), workflow_sha: 'a'.repeat(40), jti: 'one-time-identity-12345',
  sub: 'repo:example/project:ref:refs/heads/main', exp: Math.floor(Date.now() / 1000) + 300, run_id: '100', run_attempt: '1'
};
const bundle = {
  ASC_KEY_ID: 'EXAMPL1234', ASC_ISSUER_ID: '00000000-0000-0000-0000-000000000000', ASC_KEY_CONTENT: 'c3ludGhldGlj',
  DEVELOPMENT_TEAM: 'EXAMPLTEAM', PRODUCT_BUNDLE_IDENTIFIER: 'com.example.app', WATCH_BUNDLE_IDENTIFIER: 'com.example.app.watchkitapp',
  IOS_DISTRIBUTION_CERTIFICATE_ID: 'EXAMPLECERT', IOS_DISTRIBUTION_CERT_P12: 'c3ludGhldGlj', IOS_DISTRIBUTION_CERT_P12_PASSWORD: 'synthetic-secret'
};
const post = (body: unknown = { operation: 'fetch' }, authorization = `Bearer ${'a'.repeat(120)}`) => new Request('https://example.test/api/v1/integrations/ios-release', { method: 'POST', headers: { authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function fixture(overrides: Record<string, any> = {}, production = true) {
  const calls: string[] = [], used = new Set();
  const deps = {
    readIOSReleasePolicy: async () => policy, verifyIOSReleaseToken: async () => identity,
    claimIOSReleaseToken: async (jti: string) => { if (used.has(jti)) return false; used.add(jti); return true; },
    readIOSReleaseCredentials: async () => { calls.push('read'); return bundle; },
    migrateIOSReleaseCredentials: async () => { calls.push('migrate'); return true; },
    auditIOSRelease: async () => { calls.push('audit'); }, ...overrides
  };
  return { calls, action: createIOSReleaseAction(deps as any, () => production) };
}
const privateResponse = (r: Response) => assert.equal(r.headers.get('Cache-Control'), 'private, no-store, max-age=0');
test('identity binds immutable ownership, exact workflow, source, ref, event and subject', () => {
  assert.equal(authorizeIOSRelease(identity, policy), true);
  assert.equal(authorizeIOSRelease({ ...identity, sub: 'repo:example@456/project@123:ref:refs/heads/main' }, policy), true);
  for (const change of [
    { repository: 'fork/project' }, { repository_id: '124' }, { repository_owner_id: '457' }, { ref: 'refs/heads/develop' },
    { ref_type: 'tag' }, { event_name: 'pull_request' }, { event_name: 'pull_request_target' },
    { workflow_ref: identity.workflow_ref.replace('ios-testflight', 'other') }, { workflow_sha: 'b'.repeat(40) },
    { runner_environment: 'self-hosted' }, { sub: 'repo:example/project:pull_request' }, { jti: '' }, { run_id: '' }
  ]) assert.equal(authorizeIOSRelease({ ...identity, ...change }, policy), false, JSON.stringify(change));
  assert.equal(parseIOSReleasePolicy(JSON.stringify({ ...policy, enabled: false })), null);
});
test('real JWT verification rejects wrong audience, issuer, age, signature and expiry', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const verify = createIOSReleaseTokenVerifier(createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] }) as any);
  const now = Math.floor(Date.now() / 1000);
  const make = (override = {}) => new SignJWT({ ...identity, iat: now, nbf: now - 1, iss: 'https://token.actions.githubusercontent.com', aud: IOS_RELEASE_AUDIENCE, ...override }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey);
  assert.equal((await verify(await make())).repository, policy.repository);
  for (const change of [{ aud: 'other' }, { iss: 'https://untrusted.example' }, { exp: now - 30 }, { iat: now - 600 }, { nbf: now + 60 }]) await assert.rejects(verify(await make(change)));
  const parts = (await make()).split('.'); parts[1] = Buffer.from(JSON.stringify({ ...identity, repository_id: '999' })).toString('base64url');
  await assert.rejects(verify(parts.join('.')));
});
test('only the bounded Apple environment allowlist is accepted', () => {
  assert.deepEqual(parseIOSReleaseBundle(bundle), bundle);
  for (const change of [{ NODE_OPTIONS: '--require=evil' }, { ASC_KEY_CONTENT: 'a\nb' }, { WATCH_BUNDLE_IDENTIFIER: 'other.app' }, { IOS_DISTRIBUTION_CERT_P12_PASSWORD: 'a'.repeat(32000) }]) assert.equal(parseIOSReleaseBundle({ ...bundle, ...change }), null);
});
test('delivery is private, audited and one-use', async () => {
  const f = fixture(), response = await f.action({ request: post() });
  assert.equal(response.status, 200); privateResponse(response);
  assert.deepEqual(await response.json(), { ok: true, credentials: bundle }); assert.deepEqual(f.calls, ['read', 'audit']);
  const replay = await f.action({ request: post() }); assert.equal(replay.status, 409); privateResponse(replay);
  assert.deepEqual(f.calls, ['read', 'audit']);
});
test('anonymous, preview, disabled, foreign and invalid identities never read secrets', async () => {
  for (const [overrides, production, authorization] of [
    [{}, false, undefined], [{}, true, ''], [{ readIOSReleasePolicy: async () => null }, true, undefined],
    [{ verifyIOSReleaseToken: async () => ({ ...identity, ref: 'refs/heads/feature' }) }, true, undefined],
    [{ verifyIOSReleaseToken: async () => { throw new Error('synthetic-secret'); } }, true, undefined]
  ] as const) {
    const f = fixture(overrides, production), response = await f.action({ request: post(undefined, authorization) });
    assert.ok([401, 403, 503].includes(response.status)); privateResponse(response); assert.deepEqual(f.calls, []);
    assert.doesNotMatch(await response.text(), /synthetic-secret/);
  }
});
test('migration needs explicit policy and manual workflow, and reports an existing bundle', async () => {
  const body = { operation: 'migrate', credentials: bundle }, automatic = fixture();
  assert.equal((await automatic.action({ request: post(body) })).status, 403); assert.deepEqual(automatic.calls, []);
  const disabled = fixture({ readIOSReleasePolicy: async () => ({ ...policy, allowMigration: false }), verifyIOSReleaseToken: async () => ({ ...identity, event_name: 'workflow_dispatch' }) });
  assert.equal((await disabled.action({ request: post(body) })).status, 403);
  const f = fixture({ verifyIOSReleaseToken: async () => ({ ...identity, event_name: 'workflow_dispatch' }), migrateIOSReleaseCredentials: async () => false });
  const response = await f.action({ request: post(body) });
  assert.deepEqual(await response.json(), { ok: true, imported: false }); assert.deepEqual(f.calls, ['audit']);
});
test('oversized requests and vault/audit failures never return private details', async () => {
  for (const overrides of [
    { readIOSReleaseCredentials: async () => { throw new Error('synthetic-secret'); } },
    { auditIOSRelease: async () => { throw new Error('synthetic-secret'); } }
  ]) {
    const response = await fixture(overrides).action({ request: post() });
    assert.equal(response.status, 503); privateResponse(response); assert.doesNotMatch(await response.text(), /synthetic-secret/);
  }
  assert.equal((await fixture().action({ request: post({ operation: 'fetch', credentials: bundle }) })).status, 400);
  try { await fixture().action({ request: post({ operation: 'fetch', padding: 'a'.repeat(33000) }) }); assert.fail(); }
  catch (error) { assert.equal((error as Response).status, 413); privateResponse(error as Response); }
});

test('both discovery manifests publish the iOS delivery contract', async () => {
  const { createApiCapabilitiesManifest, apiV1RouteKeys } = await import('../../../docs/apiDocs');
  const { thingtimeCapabilityManifest } = await import('../capabilities/thingtimeCapabilities');
  assert.equal(createApiCapabilitiesManifest().features['api.integration-ios-release'], '1.0.0');
  assert.equal(thingtimeCapabilityManifest('https://example.test').features['api.integration-ios-release'].version, '1.0.0');
  assert.ok(apiV1RouteKeys.includes('v1/integrations/ios-release'));
});


test('revocation between identity admission and disclosure stops secret reads', async () => {
  let reads = 0;
  const f = fixture({ readIOSReleasePolicy: async () => ++reads === 1 ? policy : null });
  const response = await f.action({ request: post() });
  assert.equal(response.status, 403); assert.deepEqual(f.calls, []); privateResponse(response);
});
