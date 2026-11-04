import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const bundle = { ASC_KEY_ID:'EXAMPL1234', ASC_ISSUER_ID:'00000000-0000-0000-0000-000000000000', ASC_KEY_CONTENT:Buffer.from('synthetic-private-key').toString('base64'), DEVELOPMENT_TEAM:'EXAMPLTEAM', PRODUCT_BUNDLE_IDENTIFIER:'com.example.app', WATCH_BUNDLE_IDENTIFIER:'com.example.app.watchkitapp', IOS_DISTRIBUTION_CERTIFICATE_ID:'EXAMPLECERT', IOS_DISTRIBUTION_CERT_P12:'c3ludGhldGlj', IOS_DISTRIBUTION_CERT_P12_PASSWORD:'synthetic-password' };
function run(mode = 'success', operation = 'upload') {
  const dir = mkdtempSync(join(tmpdir(), 'ios-vault-client-'));
  try {
    const envfile = join(dir, 'environment'); writeFileSync(envfile, '');
    const hook = join(dir, 'fetch.mjs');
    writeFileSync(hook, `let identities = 0; const bundle = ${JSON.stringify(bundle)};
      globalThis.fetch = async (url, init = {}) => {
        if (String(url).includes('well-known/thingtime')) return Response.json({ origin: ${JSON.stringify(mode === 'origin' ? 'https://other.test' : 'https://release.test')}, features: { 'api.integration-ios-release': { version: ${JSON.stringify(mode === 'version' ? '2.0.0' : '1.0.0')} } } });
        if (String(url).startsWith('https://identity.test')) return Response.json({value: 'synthetic-identity-' + (++identities)});
        if (!init.headers.Authorization.endsWith(String(identities))) throw Error('Wrong identity');
        const body = JSON.parse(init.body);
        if (body.operation === 'migrate') return Response.json({ok:true, imported:true});
        if (${JSON.stringify(operation)} === 'migrate-secrets' && identities !== 2) throw Error('Token replay');
        if (${JSON.stringify(mode)} === 'failure') return Response.json({error:'secret-must-not-log'}, {status:503});
        if (${JSON.stringify(mode)} === 'injection') bundle.NODE_OPTIONS = '--require=evil';
        return Response.json({ok:true, credentials:bundle});
      };`);
    const result = spawnSync(process.execPath, ['--import', hook, new URL('../vault-credentials.mjs', import.meta.url).pathname], { encoding:'utf8', env:{...process.env, ...bundle, GITHUB_ENV:envfile, THINGTIME_RELEASE_ORIGIN:'https://release.test', ACTIONS_ID_TOKEN_REQUEST_URL:'https://identity.test/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic-request-token', RELEASE_OPERATION:operation} });
    return {...result, environment: readFileSync(envfile,'utf8')};
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
test('vault client masks values before exporting only approved environment names', () => {
  const r = run(); assert.equal(r.status,0, r.stderr);
  for (const [key,value] of Object.entries(bundle)) { assert.ok(r.environment.includes(`${key}<<`)); assert.ok(r.stdout.includes(`::add-mask::${value}`)); }
});
test('migration verifies with a fresh identity and exports no secret environment', () => {
  const r = run('success','migrate-secrets'); assert.equal(r.status,0,r.stderr); assert.equal(r.environment,'');
});
test('origin/version mismatch, failed delivery and environment injection fail closed', () => {
  for (const mode of ['origin','version','failure','injection']) {
    const r = run(mode); assert.notEqual(r.status,0); assert.equal(r.environment,''); assert.ok(!r.stderr.includes('secret-must-not-log'));
  }
});
