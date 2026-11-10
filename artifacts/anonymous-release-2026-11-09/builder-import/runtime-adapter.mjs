import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const workspace = process.argv[2];
const origin = process.env.APP_URL;
const vercel = '/home/pwuser/qa';
const require = createRequire('/opt/thingtime-mcp/MCP/package.json');
const mime = require('mime-types');
const { default: handler } = await import(pathToFileURL(resolve(vercel, 'server/index.mjs')).href);
const config = JSON.parse(readFileSync(resolve(vercel, 'config.json')));
const publicRoot = '/tmp/qa-public';
assert.equal(typeof handler.fetch, 'function');
const headersFor = path => {
 const headers = new Headers();
 for (const route of config.routes) {
  if (route.handle === 'filesystem') break;
  if (!route.headers || !new RegExp(route.src).test(path)) continue;
  for (const [key, value] of Object.entries(route.headers)) headers.set(key, value);
 }
 return headers;
};
const app = createServer(async (req, res) => {
 try {
  assert.equal(req.headers.host, new URL(origin).host);
  if (existsSync('/tmp/qa-offline.flag')) { req.socket.destroy(); return; }
  const url = new URL(req.url, origin);
  assert.equal(url.origin, origin);
  const path = url.pathname;
  const headers = headersFor(path);
  const browserShell = path === '/builder' || path === '/things' || path === '/ode' || path.startsWith('/p/');
  const candidate = resolve(publicRoot, browserShell ? 'index.html' : '.' + decodeURIComponent(path));
  if (['GET', 'HEAD'].includes(req.method) && path !== '/' && !path.startsWith('/api/') &&
      !path.startsWith('/.well-known/') && candidate.startsWith(publicRoot + sep) &&
      existsSync(candidate) && statSync(candidate).isFile()) {
   headers.set('Content-Type', mime.contentType(mime.lookup(candidate)) || 'application/octet-stream');
   headers.set('Content-Length', statSync(candidate).size);
   res.writeHead(200, Object.fromEntries(headers));
   if (req.method === 'HEAD') res.end(); else createReadStream(candidate).pipe(res);
   return;
  }
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) {
   for (const part of Array.isArray(value) ? value : [value]) requestHeaders.append(key, part);
  }
  const request = new Request(url, { method: req.method, headers: requestHeaders,
   ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
  const response = await handler.fetch(request, { waitUntil(work) { void Promise.resolve(work).catch(() => {}); } });
  for (const [key, value] of response.headers) if (key !== 'set-cookie') headers.set(key, value);
  res.writeHead(response.status, { ...Object.fromEntries(headers), ...(response.headers.getSetCookie().length ? { 'set-cookie': response.headers.getSetCookie() } : {}) });
  if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  if (path.startsWith('/api/') || path.startsWith('/.well-known/')) {
   console.log(JSON.stringify({ method: req.method, path, status: response.status, authenticatedRequest: Boolean(req.headers.authorization || req.headers.cookie?.includes('auth=')) }));
  }
 } catch (error) {
  console.error('Fixture adapter:', error.message);
  if (!res.headersSent) res.writeHead(500);
  res.end();
 }
});
app.listen(Number(new URL(origin).port), '127.0.0.1');
