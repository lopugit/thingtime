'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { createWebBundleDownload, WINDOW_BYTES } = require('../lib/web-bundle-download.cjs');
const { createWebBundleStore } = require('../lib/web-bundle-store.cjs');
const contract = require('../../native-bundles/release.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-bundle-download-'));
  const keys = generateKeyPairSync('ed25519');
  const host = { platform: 'darwin', arch: 'arm64', runtimeId: 'fixture', nativeAbi: 'fixture-1', shellVersion: '1.0.0', channel: 'stable', minimumSequence: 0 };
  const trustedKeys = [{ keyId: 'fixture', publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }), channels: ['stable'], platforms: ['darwin'], runtimes: ['fixture'] }];
  const payloads = new Map([['index.html', Buffer.from('<p>real file fixture</p>')], ['large.bin', Buffer.alloc(WINDOW_BYTES + 123, 73)], ['server.mjs', Buffer.from('export default {};')], ['zero', Buffer.alloc(0)]]);
  const descriptor = { version: '1.0.1', channel: 'stable', sequence: 1, target: { platform: 'darwin', arch: 'arm64' }, runtime: { id: 'fixture', nativeAbi: 'fixture-1', minShellVersion: '1.0.0', maxShellVersion: '1.0.0' }, entrypoints: { renderer: 'index.html', server: 'server.mjs' }, files: [...payloads].map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })) };
  const envelope = contract.signDescriptor(descriptor, { keyId: 'fixture', privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }) });
  const requests = []; let mode = 'normal', origin;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, origin);
    requests.push({ path: url.pathname, file: url.searchParams.get('path'), range: req.headers.range, cookie: req.headers.cookie, authorization: req.headers.authorization });
    const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (mode === 'redirect') { res.writeHead(302, { Location: `${origin}/elsewhere` }); res.end(); return; }
    if (url.pathname === '/.well-known/thingtime-capabilities.json') {
      json({ origin: mode === 'wrong-origin' ? 'https://wrong.example' : origin, features: { 'api.releases-native-web': { version: mode === 'breaking' ? '2.0.0' : '1.0.0' }, 'api.releases-native-web-content': { version: '1.0.1' } } }); return;
    }
    if (url.pathname === '/api/v1/releases/native-web') { json({ ok: true, release: mode === 'bad-signature' ? { ...envelope, signature: Buffer.alloc(64).toString('base64') } : envelope }); return; }
    if (mode === 'throttle') { mode = 'normal'; res.writeHead(429, { 'Retry-After': '0' }); res.end(); return; }
    const file = descriptor.files.find(value => value.path === url.searchParams.get('path'));
    if (!file || url.searchParams.get('releaseId') !== envelope.releaseId || req.headers['if-match'] !== `"${file.sha256}"`) { res.writeHead(404); res.end(); return; }
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    if (mode === 'interrupt' && Number(start) > 0) { res.writeHead(503); res.end(); return; }
    let bytes = payloads.get(file.path).subarray(Number(start), Number(end) + 1);
    if (mode === 'corrupt') bytes = Buffer.alloc(bytes.length, 0);
    res.writeHead(mode === 'range-ignored' ? 200 : 206, { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${file.bytes}`, 'Content-Length': bytes.length, ETag: mode === 'wrong-etag' ? '"wrong"' : `"${file.sha256}"` }); res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const options = { origin, host, trustedKeys, downloadDirectory: path.join(root, 'downloads') };
  return { root, host, trustedKeys, payloads, envelope, requests, options, setMode(value) { mode = value; }, create() { return createWebBundleDownload(options); } };
}

test('real HTTP catalogue and durable resumed ranges reach the verified staging store without credentials', async t => {
  const f = await fixture(t), first = f.create();
  assert.deepEqual(await first.check(), f.envelope);
  f.setMode('interrupt');
  await assert.rejects(first.download(f.envelope), /HTTP 503/);
  const prior = f.requests.length;
  f.setMode('normal');
  const result = await f.create().download(f.envelope);
  const next = f.requests.slice(prior).filter(request => request.path.endsWith('/content'));
  assert.equal(next[0].file, 'large.bin'); assert.equal(next[0].range, `bytes=${WINDOW_BYTES}-${WINDOW_BYTES + 122}`);
  assert.ok(!next.some(request => request.file === 'index.html' || request.file === 'zero'));
  for (const [file, bytes] of f.payloads) assert.deepEqual(await fs.readFile(path.join(result.directory, file)), bytes);
  const bundledDirectory = path.join(f.root, 'bundled'); await fs.mkdir(bundledDirectory);
  const store = await createWebBundleStore({ cacheDirectory: path.join(f.root, 'store'), bundledDirectory, host: f.host, trustedKeys: f.trustedKeys });
  await store.stage(result.directory, result.envelope);
  await f.create().discard(f.envelope.releaseId);
  await assert.rejects(fs.stat(result.directory), { code: 'ENOENT' });
  assert.equal((await store.prepareLaunch()).source, 'trial');
  assert.ok(f.requests.every(request => !request.cookie && !request.authorization));
});
test('negotiation refuses origin/major mismatches, redirects and invalid signature before content', async t => {
  const f = await fixture(t);
  for (const mode of ['wrong-origin', 'breaking', 'redirect', 'bad-signature']) {
    f.setMode(mode); await assert.rejects(f.create().check());
  }
  assert.ok(!f.requests.some(request => request.path.endsWith('/content')));
  f.setMode('normal'); assert.equal(await f.create().check({ minimumSequence: 1 }), null);
});
test('byte identity and exact 206 range are mandatory; cancelled or corrupt downloads never stage', async t => {
  const f = await fixture(t);
  for (const mode of ['range-ignored', 'wrong-etag', 'corrupt']) {
    f.setMode(mode); await assert.rejects(f.create().download(f.envelope), /range or identity mismatch|signed integrity/);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.create().download(f.envelope, { signal: controller.signal }), { name: 'AbortError' });
  f.setMode('normal'); await f.create().download(f.envelope);
});
test('untrusted paths and cache symlinks cannot redirect writes outside private staging', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, f.options.downloadDirectory);
  await assert.rejects(f.create().download(f.envelope), /Unsafe/);
  assert.deepEqual(await fs.readdir(outside), []);
  const supplied = structuredClone(f.envelope); supplied.descriptor.files[0].path = '../escape';
  await assert.rejects(f.create().download(supplied), /unsafe file path/);
});

test('real HTTP rate backpressure retries the unchanged signed range before writing bytes', async t => {
  const f = await fixture(t); f.setMode('throttle');
  await f.create().download(f.envelope);
  const attempts = f.requests.filter(request => request.file === 'index.html');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].range, attempts[1].range);
});
