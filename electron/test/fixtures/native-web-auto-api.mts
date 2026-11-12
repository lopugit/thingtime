// Synthetic upstream publication; real catalogue validation and HTTP handlers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createNativeWebReleaseService, NATIVE_WEB_CATALOGUE_PATH, NATIVE_WEB_CONTENT_PATH } from '../../../remix/app/api/utils/releases/nativeWeb';
import { createNativeWebReleaseHandlers } from '../../../remix/app/api/utils/releases/nativeWebHttp';
import { thingtimeCapabilityManifest } from '../../../remix/app/api/utils/capabilities/thingtimeCapabilities';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const envelopeBytes = await readFile(path.join(config.directory, config.assets.envelope));
const zipPath = path.join(config.directory, config.assets.archive), zipBytes = (await stat(zipPath)).size;
const envelope = JSON.parse(envelopeBytes.toString('utf8'));
const prefix = 'https://github.com/lopugit/thingtime/releases/download/desktop-native-auto-qa/';
const assets = [{ id: 1, state: 'uploaded', name: config.assets.envelope, size: envelopeBytes.length, browser_download_url: prefix + config.assets.envelope },
 { id: 2, state: 'uploaded', name: config.assets.archive, size: zipBytes, browser_download_url: prefix + config.assets.archive }];
let published = false, publish!: () => void, origin = '', catalogueWaiting = false;
const publication = new Promise<void>(resolve => { publish = resolve; });
const requests: { path: string; cookie: boolean; authorization: boolean }[] = [], upstream: string[] = [], failures: string[] = [];
let contentRequests = 0, contentBytes = 0;
const service = createNativeWebReleaseService({ policy: config.policy, cacheMs: 0, request: (async (input, init = {}) => {
 const url = new URL(String(input)); upstream.push(url.hostname);
 assert.equal(new Headers(init.headers).has('Authorization'), false); assert.equal(new Headers(init.headers).has('Cookie'), false);
 if (url.hostname === 'api.github.com') {
  assert.equal(url.pathname, '/repos/lopugit/thingtime/releases');
  return Response.json(published ? [{ id: 1, draft: false, prerelease: false, published_at: '2026-11-11T00:00:00Z', tag_name: 'desktop-native-auto-qa', assets }] : []);
 }
 if (url.hostname === 'github.com') {
  const asset = assets.find(asset => asset.browser_download_url === url.href); assert.ok(asset);
  return new Response(null, { status: 302, headers: { Location: `https://release-assets.githubusercontent.com/native-auto-qa/${asset.id}` } });
 }
 assert.equal(url.hostname, 'release-assets.githubusercontent.com');
 if (url.pathname.endsWith('/1')) return new Response(envelopeBytes, { headers: { 'Content-Length': String(envelopeBytes.length) } });
 assert.equal(url.pathname, '/native-auto-qa/2');
 const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('Range') || ''); assert.ok(range);
 const start = Number(range[1]), end = Number(range[2]); assert.ok(end >= start && end < zipBytes && end - start < 2 * 1024 * 1024);
 const bytes = Buffer.alloc(end - start + 1), handle = await open(zipPath, 'r');
 try { const result = await handle.read(bytes, 0, bytes.length, start); assert.equal(result.bytesRead, bytes.length); } finally { await handle.close(); }
 return new Response(bytes, { status: 206, headers: { 'Content-Length': String(bytes.length), 'Content-Range': `bytes ${start}-${end}/${zipBytes}` } });
}) as typeof fetch });
const handlers = createNativeWebReleaseHandlers(service, async () => ({ allowed: true, remaining: 10000, limit: 10000, resetAt: new Date().toISOString() }));
const server = createServer(async (req, res) => {
 try {
  const url = new URL(req.url!, origin);
  if (url.pathname === '/.well-known/thingtime-capabilities.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(thingtimeCapabilityManifest(origin))); return; }
  if ([NATIVE_WEB_CATALOGUE_PATH, NATIVE_WEB_CONTENT_PATH].includes(url.pathname)) {
   requests.push({ path: url.pathname, cookie: Boolean(req.headers.cookie), authorization: Boolean(req.headers.authorization) });
   if (url.pathname === NATIVE_WEB_CATALOGUE_PATH && !published) { catalogueWaiting = true; process.send?.({ type: 'catalogue-waiting' }); await publication; }
   const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
   const request = new Request(url, { method: req.method, headers });
   const response = await (url.pathname === NATIVE_WEB_CATALOGUE_PATH ? handlers.catalogue({ request }) : handlers.content({ request }));
   const bytes = new Uint8Array(await response.arrayBuffer());
   if (url.pathname === NATIVE_WEB_CONTENT_PATH && response.status === 206) { contentRequests++; contentBytes += bytes.length; }
   res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes); return;
  }
  // Credential-free remote bootstrap only. Never create or authenticate users.
  const body = url.pathname === '/api/root-data' ? { user: null, dataPlane: 'home', envFromCookie: {}, devKitEnv: {}, dataEnvironment: null, titlePrefix: '[Native QA]' }
   : url.pathname === '/api/v1/auth/me' ? { user: null, ok: true }
   : { ok: true, things: [], themes: [], posts: [], algorithms: [], nextCursor: null };
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body));
 } catch (error) { failures.push(error instanceof Error ? error.message : 'Fixture failed'); res.writeHead(500); res.end('Synthetic release fixture failed'); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${(server.address() as any).port}`;
process.on('message', async (message: any) => {
 if (message?.type === 'publish') { published = true; publish(); process.send?.({ type: 'published' }); }
 if (message?.type === 'stats') process.send?.({ type: 'stats', requests, upstream, contentRequests, contentBytes, failures, catalogueWaiting });
 if (message?.type === 'stop') { publish(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); process.send?.({ type: 'stopped' }); process.disconnect?.(); }
});
process.send?.({ type: 'ready', origin });
