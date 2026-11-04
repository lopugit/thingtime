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
  const features = ['connections-providers', 'connections', 'connections-unlink', 'connections-feed', 'connections-filters', 'connections-oauth-begin', 'connections-oauth-callback'];
  for (const path of ['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']) {
    const response = await app.fetch(new Request('https://thingtime.test' + path), { waitUntil() {} });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const body = await response.json();
    if (path.startsWith('/.well-known')) assert.equal(body.origin, 'https://thingtime.test');
    for (const feature of features) {
      const version = body.features['api.' + feature];
      assert.equal(typeof version === 'string' ? version : version.version, '2.0.0');
    }
  }
  console.log('PASS: both compiled Vercel manifest handlers return JSON and all seven Connections 2.0.0 contracts; synthetic runtime only.');
}
