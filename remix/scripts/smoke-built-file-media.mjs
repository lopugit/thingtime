/** Smoke compiled routing/manifest, without database writes or user credentials. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:23868';
if (process.argv[2] !== '--worker') {
 const child = spawn(process.execPath, [import.meta.filename, '--worker', resolve(process.argv[2] || '.output/server/index.mjs')], { stdio: 'inherit', env: {
  PATH: process.env.PATH, NODE_ENV: 'test', MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:23869/thingtime', JWT_SECRET: randomUUID() + randomUUID(), APP_URL: origin
 } });
 const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
 try { const [code] = await once(child, 'exit'); assert.equal(code, 0); } finally { clearTimeout(timeout); }
} else {
 const application = await import(pathToFileURL(process.argv[3]).href); assert.equal(typeof application.middleware, 'function');
 const server = createServer((req, res) => application.middleware(req, res));
 try {
  server.listen({ host: '127.0.0.1', port: 23868, exclusive: true }); await once(server, 'listening');
  const get = async path => { const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(8000) }); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/json/); return response.json(); };
  const manifest = await get('/.well-known/thingtime-capabilities.json'); assert.equal(manifest.origin, origin);
  const registry = await get('/api/v1/capabilities');
  for (const [feature, version] of Object.entries({ 'api.things': '1.67.0', 'api.things-update': '1.30.0' })) { assert.equal(manifest.features[feature].version, version); assert.equal(registry.features[feature], version); }
  for (const [id, version] of [['things', '1.67.0'], ['things-update', '1.30.0']]) { const docs = await get(`/api/v1/${id === 'things-update' ? 'things/update' : id}-docs`); assert.equal(docs.docs.contractVersion, version); }
  console.log(JSON.stringify({ builtManifest: 'passed', origin, versions: { things: '1.67.0', thingsUpdate: '1.30.0' } }));
 } finally { server.close(); }
 process.exit(0);
}
