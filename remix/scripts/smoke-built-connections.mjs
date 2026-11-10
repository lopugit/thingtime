#!/usr/bin/env node
// Canonical Vercel build required. Exercise compiled handlers with synthetic
// bootstrap only; OS sandbox denies every network connection, including DB.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = fileURLToPath(import.meta.url);
const bundle = resolve(dirname(here), '../.vercel/output/functions/__server.func/index.mjs');
if (process.argv[2] !== '--worker') {
  assert.equal(process.platform, 'darwin', 'Compiled Connections smoke requires macOS network sandbox; no permissive fallback.');
  const result = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', process.execPath, here, '--worker'], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdio: 'inherit', timeout: 30_000
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Compiled Connections manifest smoke failed.');
} else {
  process.env.JWT_SECRET = randomBytes(32).toString('base64url');
  process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:28165/thingtime-built-smoke?serverSelectionTimeoutMS=500';
  process.env.THINGTIME_DATA_ENV = 'custom:built-smoke';
  process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = 'https://thingtime.test';
  const { default: app } = await import(pathToFileURL(bundle).href);
  assert.equal(typeof app.fetch, 'function', 'Expected the compiled Vercel web fetch adapter.');
  const features = ['connections-providers', 'connections', 'connections-oauth-begin', 'connections-oauth-callback', 'connections-feed', 'connections-request'];
  for (const path of ['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']) {
    const response = await app.fetch(new Request('https://thingtime.test' + path), { waitUntil() {} });
    assert.equal(response.status, 200, path);
    const body = await response.json();
    if (path.startsWith('/.well-known')) assert.equal(body.origin, 'https://thingtime.test');
    for (const feature of features) {
      const version = body.features['api.' + feature];
      assert.equal(typeof version === 'string' ? version : version.version, '2.0.0');
    }
  }
  console.log('PASS: both compiled manifests expose all six Connections 2.0.0 features; network denied; synthetic runtime only.');
}
