import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import nativeDownload from '../../../../../electron/lib/web-bundle-download.cjs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import contract from '../../../../../native-bundles/release.cjs';
import { createNativeWebReleaseService, NATIVE_WEB_CATALOGUE_PATH, NATIVE_WEB_CONTENT_PATH, NATIVE_WEB_REQUIREMENTS, NATIVE_WEB_METADATA_BUDGETS, NativeWebReleaseError } from './nativeWeb';
import { createNativeWebReleaseHandlers } from './nativeWebHttp';
import { planStoredZip, storedZipBlob } from '../../../utils/thingTransfer/storedZip';
import { apiEndpointDocs, createApiCapabilitiesManifest } from '../../../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';
import { capabilitySatisfies } from '../capabilities/capabilityContract';
import handleApi, { routeModules } from '../../../../server/routes/api/[...]';
import { RATE_LIMIT_DEFAULTS } from '../rateLimit/config';
const keys = generateKeyPairSync('ed25519');
const policy = { format: 1, channel: 'stable', minimumSequence: 1, trustedKeys: [{ keyId: 'synthetic-publisher', publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }),
  channels: ['stable'], platforms: ['darwin', 'ios'], runtimes: ['electron-node-middleware-v1'] }] };
const host = { platform: 'darwin', arch: 'arm64', runtimeId: 'electron-node-middleware-v1', nativeAbi: 'electron-43.1.0-node-24.18.0-modules-148', shellVersion: '1.0.0', channel: 'stable', minimumSequence: '0' };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const catalogueUrl = (changes = {}) => new URL(`${NATIVE_WEB_CATALOGUE_PATH}?${new URLSearchParams({ ...host, ...changes })}`, 'https://api.test');
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
async function publication(sequence = 1, platform = 'darwin', channel = 'stable') {
  const payloads = new Map([['.output/public/empty', new Uint8Array(0)], ['.output/public/index.html', new TextEncoder().encode('<div id="root">signed renderer fixture</div>')],
    ['.output/server/index.mjs', new TextEncoder().encode('export const handler = () => "fixture";')]]);
  const files = [...payloads].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes) }));
  const descriptor = { version: `1.0.${sequence}`, channel, sequence, target: { platform, arch: 'arm64' },
    runtime: { id: host.runtimeId, nativeAbi: host.nativeAbi, minShellVersion: '1.0.0', maxShellVersion: '1.9.0' },
    entrypoints: { renderer: '.output/public/index.html', server: '.output/server/index.mjs' }, files };
  const envelope = contract.signDescriptor(descriptor, { keyId: 'synthetic-publisher', privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const zip = new Uint8Array(await storedZipBlob(planStoredZip(files), [...payloads.values()].map(bytes => ({ blob: new Blob([bytes]), crc: crc32(bytes) }))).arrayBuffer());
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  const tag = `desktop-v1.0.${sequence}`, prefix = `https://github.com/lopugit/thingtime/releases/download/${tag}/`;
  const assets = [{ id: sequence * 10 + 1, state: 'uploaded', name: `native-web-${envelope.releaseId}.json`, size: json.length, updated_at: '2026-11-11T00:00:00Z', browser_download_url: `${prefix}native-web-${envelope.releaseId}.json` },
    { id: sequence * 10 + 2, state: 'uploaded', name: `native-web-${envelope.releaseId}.zip`, size: zip.length, browser_download_url: `${prefix}native-web-${envelope.releaseId}.zip` }];
  return { envelope, json, zip, payloads, release: { id: sequence, draft: false, prerelease: false, published_at: '2026-11-11T00:00:00Z', tag_name: tag, assets } };
}
function fixture(publications: Awaited<ReturnType<typeof publication>>[], options: { pageSize?: number; patch?: (url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>; selectedPolicy?: any; deadlines?: { catalogueMs?: number; envelopeMs?: number; operationMs?: number } } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const assets = new Map(publications.flatMap(p => [[p.release.assets[0].id, p.json], [p.release.assets[1].id, p.zip]] as [number, Uint8Array][]));
  const request = async (url: string | URL | Request, init: RequestInit = {}) => {
    const address = String(url); calls.push({ url: address, init });
    const patch = await options.patch?.(address, init); if (patch) return patch;
    const parsed = new URL(address);
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(new Headers(init.headers).has('Cookie'), false);
    if (parsed.hostname === 'api.github.com') {
      assert.equal(parsed.pathname, '/repos/lopugit/thingtime/releases');
      const page = Number(parsed.searchParams.get('page') || 1), count = options.pageSize || publications.length;
      const values = publications.slice((page - 1) * count, page * count).map(p => p.release);
      return Response.json(values, { headers: page * count < publications.length ? { Link: `<https://api.github.com/repos/lopugit/thingtime/releases?per_page=100&page=${page + 1}>; rel="next"` } : {} });
    }
    if (parsed.hostname === 'github.com') {
      const asset = publications.flatMap(p => p.release.assets).find(asset => asset.browser_download_url === address);
      assert.ok(asset, 'only an exact registered asset can be fetched');
      return new Response(null, { status: 302, headers: { Location: `https://release-assets.githubusercontent.com/fixture/${asset.id}` } });
    }
    assert.equal(parsed.hostname, 'release-assets.githubusercontent.com');
    const bytes = assets.get(Number(parsed.pathname.split('/').at(-1))); assert.ok(bytes);
    const range = new Headers(init.headers).get('Range');
    if (!range) return new Response(Uint8Array.from(bytes), { headers: { 'Content-Length': String(bytes.length) } });
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)!; assert.ok(match);
    const start = Number(match[1]), end = Number(match[2]), selected = bytes.slice(start, end + 1);
    return new Response(selected, { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(selected.length) } });
  };
  return { calls, service: createNativeWebReleaseService({ policy: options.selectedPolicy || policy, request: request as typeof fetch, deadlines: options.deadlines }) };
}
function contentRequest(p: Awaited<ReturnType<typeof publication>>, { path = '.output/public/index.html', range = 'bytes=3-14', etag = true, changes = {}, signal }: { path?: string; range?: string; etag?: boolean | string; changes?: Record<string, string>; signal?: AbortSignal } = {}) {
  const file = p.envelope.descriptor.files.find(file => file.path === path);
  const url = new URL(NATIVE_WEB_CONTENT_PATH, 'https://api.test');
  url.search = new URLSearchParams({ releaseId: p.envelope.releaseId, path, ...changes }).toString();
  return new Request(url, { signal, headers: { ...(range ? { Range: range } : {}), ...(etag ? { 'If-Match': typeof etag === 'string' ? etag : `"${file?.sha256}"` } : {}), Cookie: 'unrelated-fixture-session', Authorization: 'Bearer unrelated-fixture-token' } });
}
const rejectsStatus = (promise: Promise<unknown>, status: number) => assert.rejects(promise, error => error instanceof NativeWebReleaseError && error.status === status);

test('catalogue follows fixed-repository pagination and selects the highest compatible signed sequence', async () => {
  const p1 = await publication(1), p2 = await publication(2), other = await publication(3, 'ios'), draft = await publication(4);
  draft.release.draft = true;
  const { service, calls } = fixture([p1, other, draft, p2], { pageSize: 2 });
  assert.deepEqual(await service.select(catalogueUrl()), p2.envelope);
  const count = calls.length;
  assert.equal(await service.select(catalogueUrl({ minimumSequence: '3' })), null);
  assert.equal(calls.length, count, 'verified immutable asset metadata is reused');
  assert.equal(calls.filter(call => call.url.startsWith('https://api.github.com')).length, 2);
  assert.equal(calls.some(call => call.url.includes(`native-web-${draft.envelope.releaseId}`)), false);
  assert.equal(await service.select(catalogueUrl({ shellVersion: '1.0.0-beta.1' })), null);
});
test('empty shipped trust does not access a provider and cannot authorize bytes', async () => {
  const p = await publication(); const { service, calls } = fixture([p], { selectedPolicy: { ...policy, trustedKeys: [] } });
  assert.equal(await service.select(catalogueUrl()), null);
  await rejectsStatus(service.content(contentRequest(p)), 404);
  assert.equal(calls.length, 0);
});
test('closed selectors, signature/filename binding and exact asset origins fail closed', async () => {
  const p = await publication(); const { service, calls } = fixture([p]);
  for (const suffix of ['&url=https://evil.test', '&channel=stable']) {
    await rejectsStatus(service.select(new URL(catalogueUrl().href + suffix)), 400);
  }
  await rejectsStatus(service.select(catalogueUrl({ minimumSequence: '01' })), 400);
  await rejectsStatus(service.select(catalogueUrl({ minimumSequence: '0\n' })), 400);
  await rejectsStatus(service.select(catalogueUrl({ shellVersion: '1.0.0-01' })), 400);
  assert.equal(calls.length, 0);
  const forged = await publication(2); forged.envelope.descriptor.sequence = 99;
  forged.json = new TextEncoder().encode(JSON.stringify(forged.envelope)); forged.release.assets[0].size = forged.json.length;
  assert.equal(await fixture([forged]).service.select(catalogueUrl()), null);
  const external = await publication(3); external.release.assets[1].browser_download_url = 'https://github.com/foreign/repo/releases/download/test/payload.zip';
  assert.equal(await fixture([external]).service.select(catalogueUrl()), null);
});
test('publication outage retries safely and ambiguous same-sequence payloads are never selected', async () => {
  const p = await publication(); let unavailable = true;
  const f = fixture([p], { patch: url => url.startsWith('https://api.github.com/') && unavailable ? new Response(null, { status: 429 }) : undefined });
  await rejectsStatus(f.service.select(catalogueUrl()), 503);
  unavailable = false;
  assert.deepEqual(await f.service.select(catalogueUrl()), p.envelope);
  const second = await publication();
  second.envelope.descriptor.version = '1.1.0';
  second.envelope = contract.signDescriptor(second.envelope.descriptor, { keyId: 'synthetic-publisher', privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  second.json = new TextEncoder().encode(JSON.stringify(second.envelope));
  second.release.assets[0] = { ...second.release.assets[0], id: 101, name: `native-web-${second.envelope.releaseId}.json`, size: second.json.length,
    browser_download_url: `https://github.com/lopugit/thingtime/releases/download/${second.release.tag_name}/native-web-${second.envelope.releaseId}.json` };
  second.release.assets[1] = { ...second.release.assets[1], id: 102, name: `native-web-${second.envelope.releaseId}.zip`,
    browser_download_url: `https://github.com/lopugit/thingtime/releases/download/${second.release.tag_name}/native-web-${second.envelope.releaseId}.zip` };
  await rejectsStatus(fixture([p, second]).service.select(catalogueUrl()), 503);
});
test('file responses read actual stored ZIP offsets and return only exact declared file windows', async () => {
  const p = await publication(); const { service, calls } = fixture([p]);
  const response = await service.content(contentRequest(p));
  const file = p.envelope.descriptor.files.find(file => file.path === '.output/public/index.html')!;
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), `bytes 3-14/${file.bytes}`);
  assert.equal(response.headers.get('Content-Length'), '12');
  assert.equal(response.headers.get('ETag'), `"${file.sha256}"`);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), p.payloads.get(file.path)!.slice(3, 15));
  const zipCall = calls.filter(call => new Headers(call.init.headers).has('Range')).at(-1)!;
  assert.notEqual(new Headers(zipCall.init.headers).get('Range'), 'bytes=3-14', 'range is translated to the declared ZIP entry offset');
});
test('file reads refuse missing/mismatched hashes, traversal, undeclared files and invalid ranges before payload fetch', async () => {
  const p = await publication(); const { service, calls } = fixture([p]);
  await rejectsStatus(service.content(contentRequest(p, { etag: false })), 428);
  await rejectsStatus(service.content(contentRequest(p, { etag: '"wrong"' })), 412);
  await rejectsStatus(service.content(contentRequest(p, { path: '../private.key' })), 400);
  await rejectsStatus(service.content(contentRequest(p, { path: '.output/server/unknown.mjs' })), 404);
  await rejectsStatus(service.content(contentRequest(p, { changes: { url: 'https://evil.test' } })), 400);
  await rejectsStatus(service.content(contentRequest(p, { range: '' })), 400);
  for (const range of ['bytes=0-', 'bytes=-10', 'bytes=1-0', 'bytes=0-999', 'bytes=0-1,3-4']) await rejectsStatus(service.content(contentRequest(p, { range })), 416);
  assert.equal(calls.some(call => new Headers(call.init.headers).has('Range')), false);
});
test('unsafe redirects, foreign pagination and an upstream full body cannot substitute requested bytes', async () => {
  const p = await publication();
  const redirected = fixture([p], { patch: url => url.startsWith('https://github.com/') ? new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }) : undefined });
  await rejectsStatus(redirected.service.select(catalogueUrl()), 502);
  assert.equal(redirected.calls.some(call => call.url.includes('127.0.0.1')), false);
  const foreign = fixture([p], { patch: url => url.startsWith('https://api.github.com/') ? Response.json([p.release], { headers: { Link: '<https://api.github.com/repos/foreign/repo/releases?per_page=100&page=2>; rel="next"' } }) : undefined });
  await rejectsStatus(foreign.service.select(catalogueUrl()), 503);
  assert.equal(foreign.calls.length, 1);
  let cancelled = false;
  const full = fixture([p], { patch: (url, init) => new Headers(init.headers).has('Range') ? new Response(new ReadableStream({ start(controller) { controller.enqueue(p.zip); }, cancel() { cancelled = true; } }), { status: 200 }) : undefined });
  await rejectsStatus(full.service.content(contentRequest(p)), 502);
  assert.equal(cancelled, true);
});
test('truncated/oversized/range-mismatched provider streams fail closed and cancellation releases the source', async () => {
  const p = await publication();
  for (const kind of ['short', 'long', 'wrong-range', 'encoded']) {
    const f = fixture([p], { patch: (_url, init) => {
      const r = new Headers(init.headers).get('Range'); if (!r) return;
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(r)!;
      const expected = Number(end) - Number(start) + 1;
      return new Response(new Uint8Array(kind === 'short' ? expected - 1 : kind === 'long' ? expected + 1 : expected), { status: 206,
        headers: { 'Content-Range': `bytes ${Number(start) + (kind === 'wrong-range' ? 1 : 0)}-${end}/${p.zip.length}`, 'Content-Length': String(expected), ...(kind === 'encoded' ? { 'Content-Encoding': 'gzip' } : {}) } });
    } });
    await rejectsStatus(f.service.content(contentRequest(p)), 502);
  }
  const abort = new AbortController();
  const f = fixture([p], { patch: (_url, init) => {
    if (!new Headers(init.headers).has('Range')) return;
    abort.abort(new Error('synthetic caller cancellation'));
    assert.equal(init.signal?.aborted, true);
    return Promise.reject(new Error('synthetic transport abort'));
  } });
  await assert.rejects(f.service.content(contentRequest(p, { signal: abort.signal })), /synthetic caller cancellation/);

});
test('HTTP handlers enforce existing anonymous release admission and keep failures safe', async () => {
  const p = await publication(); const { service } = fixture([p]);
  let admissions = 0;
  const handlers = createNativeWebReleaseHandlers(service, async (_req, name, identity, options) => {
    admissions++; assert.equal(name, 'releases.read'); assert.equal(identity, null); assert.equal(options.failClosed, true);
    return { allowed: true, remaining: 1, limit: 600, resetAt: new Date().toISOString() };
  });
  const selected = await handlers.catalogue({ request: new Request(catalogueUrl()) });
  assert.equal(selected.status, 200); assert.deepEqual(await selected.json(), { ok: true, release: p.envelope });
  assert.equal((await handlers.catalogue({ request: new Request(catalogueUrl(), { method: 'POST' }) })).status, 405);
  assert.equal(admissions, 1);
  const denied = createNativeWebReleaseHandlers(service, async () => ({ allowed: false, unavailable: true, remaining: 0, limit: 600, resetAt: new Date().toISOString() }));
  assert.equal((await denied.catalogue({ request: new Request(catalogueUrl()) })).status, 503);
  const limited = createNativeWebReleaseHandlers(service, async () => ({ allowed: false, remaining: 0, limit: 600, resetAt: new Date(Date.now() + 60000).toISOString() }));
  assert.equal((await limited.catalogue({ request: new Request(catalogueUrl()) })).status, 429);
  const broken = createNativeWebReleaseHandlers({ ...service, select: async () => { throw new Error('provider-private-fixture-detail'); } }, async () => ({ allowed: true, remaining: 1, limit: 600, resetAt: new Date().toISOString() }));
  const failure = await broken.catalogue({ request: new Request(catalogueUrl()) });
  assert.equal(failure.status, 503); assert.equal((await failure.text()).includes('provider-private-fixture-detail'), false);
  assert.deepEqual(RATE_LIMIT_DEFAULTS['releases.read'], { enabled: true, limit: 600, windowMs: 60_000 });
});
test('both manifests, actual route imports and compatible client requirements describe both GET operations', async () => {
  const origin = thingtimeCapabilityManifest('https://releases.test');
  const legacy = createApiCapabilitiesManifest(Object.keys(routeModules));
  for (const [feature, version] of Object.entries(NATIVE_WEB_REQUIREMENTS)) {
    const path = feature.endsWith('-content') ? NATIVE_WEB_CONTENT_PATH : NATIVE_WEB_CATALOGUE_PATH;
    assert.equal(legacy.features[feature], version); assert.equal(origin.features[feature].version, version);
    assert.deepEqual(origin.operations.find(operation => operation.feature === feature && operation.path === path), { feature, path, methods: ['GET'] });
    const route = await routeModules[path.replace('/api/', '')](); assert.equal(typeof route.loader, 'function');
    const doc = apiEndpointDocs.find(doc => doc.endpoint === path)!; assert.equal(doc.auth.mode, 'none'); assert.equal(doc.contractVersion, version);
    for (const actual of ['1.0.0', '1.0.1', '1.1.0']) assert.equal(capabilitySatisfies(actual, version), true);
    for (const actual of [undefined, '0.9.0', '2.0.0']) assert.equal(capabilitySatisfies(actual, version), false);
  }
});
test('actual Nitro dispatch preserves configured-origin/fallback gates for anonymous release requests', async () => {
  const names = ['MONGODB_CONNECTION_STRING', 'JWT_SECRET', 'JWT_PRIVATE_KEY', 'THINGTIME_API_FALLBACK_ORIGIN', 'THINGTIME_DESKTOP', 'THINGTIME_DESKTOP_API_MODE', 'THINGTIME_AGENT_TEST_MODE', 'NODE_ENV'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.NODE_ENV = 'production';
    for (const path of [NATIVE_WEB_CATALOGUE_PATH, NATIVE_WEB_CONTENT_PATH]) {
      const request = new Request(`http://127.0.0.1:28171${path}`);
      const invoke = () => (handleApi as any)({ req: request, context: { params: { path: path.replace('/api/', '') } } });
      assert.equal((await invoke()).status, 503);
      process.env.THINGTIME_API_FALLBACK_ORIGIN = 'https://unrelated-fallback.test';
      process.env.THINGTIME_DESKTOP = '1'; process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
      const refused = await invoke(); assert.equal(refused.status, 503); assert.equal((await refused.json()).code, 'release_origin_unavailable');
      delete process.env.THINGTIME_API_FALLBACK_ORIGIN;
    }
  } finally { for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; } }
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function keepEventLoop(t: { after: (callback: () => void) => void }) { const timer = setTimeout(() => {}, 1000); t.after(() => clearTimeout(timer)); }
function oversizedStream(budget: number, observed: { pulls: number; cancelled: boolean }) {
  return new ReadableStream<Uint8Array>({
    pull(controller) { observed.pulls++; if (observed.pulls === 1) controller.enqueue(new Uint8Array(budget)); else if (observed.pulls === 2) controller.enqueue(new Uint8Array(1)); else controller.close(); },
    cancel() { observed.cancelled = true; }
  }, { highWaterMark: 0 });
}
test('metadata budgets reject excessive declared and actual bodies before whole-response buffering', async () => {
  const p = await publication();
  const declared = { pulls: 0, cancelled: false };
  const header = fixture([p], { patch: url => url.startsWith('https://api.github.com/') ? new Response(oversizedStream(1, declared), { headers: { 'Content-Length': String(NATIVE_WEB_METADATA_BUDGETS.cataloguePageBytes + 1) } }) : undefined });
  await rejectsStatus(header.service.select(catalogueUrl()), 503);
  assert.equal(declared.pulls, 0); assert.equal(declared.cancelled, true);
  const page = { pulls: 0, cancelled: false };
  const body = fixture([p], { patch: url => url.startsWith('https://api.github.com/') ? new Response(oversizedStream(NATIVE_WEB_METADATA_BUDGETS.cataloguePageBytes, page)) : undefined });
  await rejectsStatus(body.service.select(catalogueUrl()), 503);
  assert.equal(page.pulls, 2); assert.equal(page.cancelled, true);
  const large = await publication(2); large.release.assets[0].size = NATIVE_WEB_METADATA_BUDGETS.envelopeBytes + 1;
  const early = fixture([large]); await rejectsStatus(early.service.select(catalogueUrl()), 502);
  assert.equal(early.calls.length, 1, 'excessive published size is rejected before downloading the envelope');
  const streamed = await publication(3); streamed.release.assets[0].size = NATIVE_WEB_METADATA_BUDGETS.envelopeBytes;
  const envelope = { pulls: 0, cancelled: false };
  const stream = fixture([streamed], { patch: url => url.startsWith('https://github.com/') ? new Response(oversizedStream(NATIVE_WEB_METADATA_BUDGETS.envelopeBytes, envelope)) : undefined });
  await rejectsStatus(stream.service.select(catalogueUrl()), 502);
  assert.equal(envelope.pulls, 2); assert.equal(envelope.cancelled, true);
});
test('one shared pagination deadline covers every page instead of resetting per request', async t => {
  keepEventLoop(t);
  const p = await publication();
  const f = fixture([p], { deadlines: { catalogueMs: 45, operationMs: 250 }, patch: async url => {
    if (!url.startsWith('https://api.github.com/')) return;
    const page = Number(new URL(url).searchParams.get('page') || 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    return Response.json([], { headers: page < 3 ? { Link: `<https://api.github.com/repos/lopugit/thingtime/releases?per_page=100&page=${page + 1}>; rel="next"` } : {} });
  } });
  await rejectsStatus(f.service.select(catalogueUrl()), 503);
  assert.equal(f.calls.length, 2, 'no third page is scheduled beyond the aggregate deadline');
});
test('selection deadline covers a sequence of individually responsive envelope candidates', async t => {
  keepEventLoop(t);
  const publications = [await publication(1), await publication(2), await publication(3)];
  const f = fixture(publications, { deadlines: { catalogueMs: 250, envelopeMs: 250, operationMs: 45 }, patch: async url => {
    if (!url.startsWith('https://github.com/')) return;
    const publication = publications.find(p => p.release.assets[0].browser_download_url === url)!;
    await new Promise(resolve => setTimeout(resolve, 30));
    return new Response(Uint8Array.from(publication.json), { headers: { 'Content-Length': String(publication.json.length) } });
  } });
  await rejectsStatus(f.service.select(catalogueUrl()), 503);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://github.com/')).length, 2);
});
test('stalled page fetch and envelope body have finite shared lifetimes and cancel retained readers', async t => {
  keepEventLoop(t);
  const p = await publication();
  const page = fixture([p], { deadlines: { catalogueMs: 30, operationMs: 250 }, patch: url => url.startsWith('https://api.github.com/') ? new Promise<Response>(() => {}) : undefined });
  await rejectsStatus(page.service.select(catalogueUrl()), 503);
  assert.equal(page.calls.length, 1);
  let cancelled = false;
  const envelope = fixture([p], { deadlines: { envelopeMs: 30, operationMs: 250 }, patch: url => url.startsWith('https://github.com/') ?
    new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Length': String(p.json.length) } }) : undefined });
  await rejectsStatus(envelope.service.select(catalogueUrl()), 503);
  assert.equal(cancelled, true);
});
test('caller abort releases shared catalogue wait promptly without aborting a second caller', async () => {
  const p = await publication(), gate = deferred<Response>(), controller = new AbortController();
  const f = fixture([p], { patch: url => url.startsWith('https://api.github.com/') ? gate.promise : undefined });
  const first = f.service.select(catalogueUrl(), controller.signal);
  const second = f.service.select(catalogueUrl());
  assert.equal(f.calls.length, 1);
  controller.abort(new Error('synthetic catalogue cancellation'));
  await assert.rejects(first, /synthetic catalogue cancellation/);
  gate.resolve(Response.json([p.release]));
  assert.deepEqual(await second, p.envelope);
  assert.equal(f.calls.filter(call => call.url.startsWith('https://api.github.com/')).length, 1);
});
test('content caller abort releases a shared envelope wait and never schedules a payload fetch', async () => {
  const p = await publication(), gate = deferred<Response>(), started = deferred<void>(), controller = new AbortController();
  const f = fixture([p], { patch: url => {
    if (url.startsWith('https://github.com/') && url.endsWith('.json')) { started.resolve(); return gate.promise; }
  } });
  const first = f.service.content(contentRequest(p, { signal: controller.signal }));
  await started.promise;
  const second = f.service.select(catalogueUrl());
  controller.abort(new Error('synthetic content cancellation'));
  await assert.rejects(first, /synthetic content cancellation/);
  gate.resolve(new Response(Uint8Array.from(p.json), { headers: { 'Content-Length': String(p.json.length) } }));
  assert.deepEqual(await second, p.envelope);
  assert.equal(f.calls.some(call => new Headers(call.init.headers).has('Range')), false);
});
test('content-body cancellation reaches the stalled provider reader', async () => {
  const p = await publication(), started = deferred<void>(), controller = new AbortController(); let cancelled = false;
  const f = fixture([p], { patch: (_url, init) => {
    const range = new Headers(init.headers).get('Range'); if (!range) return;
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    return new Response(new ReadableStream({ pull() { started.resolve(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), {
      status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${p.zip.length}`, 'Content-Length': String(Number(end) - Number(start) + 1) }
    });
  } });
  const pending = f.service.content(contentRequest(p, { signal: controller.signal }));
  await started.promise;
  controller.abort(new Error('synthetic range cancellation'));
  await assert.rejects(pending, /synthetic range cancellation/);
  assert.equal(cancelled, true);
});
test('stable policy cannot promote GitHub prereleases while deliberate preview channels remain usable', async () => {
  const stable = await publication(); stable.release.prerelease = true;
  const filtered = fixture([stable]); assert.equal(await filtered.service.select(catalogueUrl()), null);
  assert.equal(filtered.calls.length, 1, 'prerelease envelope is not fetched for stable');
  const preview = await publication(2, 'darwin', 'preview'); preview.release.prerelease = true;
  const previewPolicy = { ...policy, channel: 'preview', trustedKeys: policy.trustedKeys.map(key => ({ ...key, channels: ['preview'] })) };
  assert.deepEqual(await fixture([preview], { selectedPolicy: previewPolicy }).service.select(catalogueUrl({ channel: 'preview' })), preview.envelope);
});
test('real native downloader negotiates this HTTP API and downloads verified stored-ZIP file bytes without credentials', async t => {
  const p = await publication(), f = fixture([p]);
  const handlers = createNativeWebReleaseHandlers(f.service, async () => ({ allowed: true, remaining: 600, limit: 600, resetAt: new Date().toISOString() }));
  const root = await mkdtemp(path.join(os.tmpdir(), 'thingtime-native-api-integration-'));
  const incoming: { path: string; cookie?: string; authorization?: string }[] = [];
  const failures: unknown[] = []; let origin = '';
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, origin);
      incoming.push({ path: url.pathname, cookie: req.headers.cookie, authorization: req.headers.authorization });
      if (url.pathname === '/.well-known/thingtime-capabilities.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(thingtimeCapabilityManifest(origin))); return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const request = new Request(url, { method: req.method, headers });
      const response = await (url.pathname === NATIVE_WEB_CATALOGUE_PATH ? handlers.catalogue({ request }) : handlers.content({ request }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(new Uint8Array(await response.arrayBuffer()));
    } catch (error) { failures.push(error); res.writeHead(500); res.end('Isolated fixture error'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const client = nativeDownload.createWebBundleDownload({ origin, host: { ...host, minimumSequence: 0 }, trustedKeys: policy.trustedKeys, downloadDirectory: path.join(root, 'downloads') });
  assert.deepEqual(await client.check(), p.envelope);
  const downloaded = await client.download(p.envelope);
  for (const [name, bytes] of p.payloads) assert.deepEqual(new Uint8Array(await readFile(path.join(downloaded.directory, name))), bytes);
  assert.deepEqual(failures, []);
  assert.equal(incoming[0].path, '/.well-known/thingtime-capabilities.json');
  assert.equal(incoming[1].path, NATIVE_WEB_CATALOGUE_PATH);
  assert.ok(incoming.some(request => request.path === NATIVE_WEB_CONTENT_PATH));
  assert.ok(incoming.every(request => !request.cookie && !request.authorization));
});
test('immediately resolved pages cannot starve the monotonic aggregate deadline', async () => {
  const p = await publication();
  const f = fixture([p], { deadlines: { catalogueMs: 5, operationMs: 250 }, patch: url => {
    if (!url.startsWith('https://api.github.com/')) return;
    const page = Number(new URL(url).searchParams.get('page') || 1);
    return Response.json([], { headers: { Link: `<https://api.github.com/repos/lopugit/thingtime/releases?per_page=100&page=${page + 1}>; rel="next"` } });
  } });
  await rejectsStatus(f.service.select(catalogueUrl()), 503);
  assert.ok(f.calls.length > 1);
});
