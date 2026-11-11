// Exercise compiled Vercel routing with a clean synthetic runtime.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (process.argv[2] !== '--worker') {
  const result = spawnSync(process.execPath, [import.meta.filename, '--worker'], { env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdio: 'inherit', timeout: 30000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Compiled Connections manifest smoke failed');
} else {
  process.env.JWT_SECRET = randomBytes(32).toString('base64url');
  process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:28165/thingtime-built-smoke?serverSelectionTimeoutMS=500';
  process.env.THINGTIME_DATA_ENV = 'custom:built-smoke';
  process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = 'https://thingtime.test';
  const bundle = resolve(import.meta.dirname, '../.vercel/output/functions/__server.func/index.mjs');
  const { default: app } = await import(pathToFileURL(bundle).href);
  assert.equal(typeof app.fetch, 'function');
  const features = { 'connections-providers': '2.0.0', connections: '2.1.0', 'connections-unlink': '2.1.0',
    'connections-feed': '2.0.1', 'connections-filters': '2.0.0', 'connections-oauth-begin': '2.2.0',
    'connections-oauth-callback': '2.2.0', 'connections-named': '1.1.0', 'connections-provider-icon': '1.0.0' };
  for (const path of ['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']) {
    const response = await app.fetch(new Request('https://thingtime.test' + path), { waitUntil() {} });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const body = await response.json();
    if (path.startsWith('/.well-known')) assert.equal(body.origin, 'https://thingtime.test');
    for (const [feature, expected] of Object.entries(features)) {
      const version = body.features['api.' + feature];
      assert.equal(typeof version === 'string' ? version : version.version, expected);
    }
  }
  const unknownIcon = await app.fetch(new Request('https://thingtime.test/api/v1/connections/provider-icon?provider=https://127.0.0.1/'), { waitUntil() {} });
  assert.equal(unknownIcon.status, 404, 'Unknown icon IDs must reach the real handler and reject URL input.');
  console.log('PASS: both compiled Vercel manifest handlers return JSON and all Connections contracts; synthetic runtime only.');
}
