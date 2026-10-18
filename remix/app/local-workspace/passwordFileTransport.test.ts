import assert from 'node:assert/strict';
import test from 'node:test';
import { accountPasswordFileTransport } from './passwordFileTransport.client';
import { bindLocalWorkspace, accountWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { decryptPasswordFile, iterableStream, newPasswordFile } from '../passwords/fileCrypto';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
const fileId = 'att_' + 'a'.repeat(64), entryId = '31793278-3c8a-4ec5-aee6-730e33484c98';
const signal = () => new AbortController().signal;
type Reply = (url: string, init: RequestInit, body?: any) => Promise<Response>;
async function fixture(run: (f: { ownerId: string; bind: (confirmed?: boolean) => ReturnType<typeof accountPasswordFileTransport>; calls: { url: string; init: RequestInit; body?: any }[]; respond: (fn: Reply) => void }) => Promise<void>, version = '1.2.0') {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  const scope = { kind: 'account' as const, ownerId: 'owner', origin: `https://files-${crypto.randomUUID()}.example`, dataPlane: 'home' };
  const calls: { url: string; init: RequestInit; body?: any }[] = [];
  let respond: Reply = async () => Response.json({ ok: true, ownerId: scope.ownerId, files: [], nextCursor: null });
  Object.assign(globalThis, { window: { location: { origin: scope.origin }, dispatchEvent: () => true }, fetch: async (url: string, init: RequestInit = {}) => {
    if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin: scope.origin, features: { 'api.passwords': { version }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
    const body = url === '/api/v1/passwords' ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, init, body }); return respond(url, init, body);
  } });
  const bind = (confirmed = true) => { rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed); return accountPasswordFileTransport(scope, accountWorkspaceLease(scope)); };
  try { await run({ ownerId: scope.ownerId, bind, calls, respond: fn => { respond = fn; } }); }
  finally {
    // Each fixture represents a new document/origin; retire the shared checker
    // cache via its normal failed-negotiation path before replacing window.
    await requireThingtimeCapability('fixture.absent', '1.0.0').catch(() => {});
    Object.assign(globalThis, previous); rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(true, rootIdentity.read().generation);
  }
}

test('files require confirmed actor/plane authority and the file-capable API contract', async () => {
  await fixture(async f => {
    await assert.rejects(f.bind(false).page([entryId], undefined, signal()), /offline/); assert.equal(f.calls.length, 0);
    const transport = f.bind(); await transport.page([entryId], undefined, signal());
    assert.deepEqual(f.calls[0].init.headers, { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': 'owner', 'X-Thingtime-Expected-Data-Plane': 'home' });
    assert.equal(f.calls[0].init.credentials, 'same-origin'); assert.equal(f.calls[0].body.expectedOwnerId, 'owner');
    bindLocalWorkspace(true, rootIdentity.read().generation); await assert.rejects(transport.page([entryId], undefined, signal())); assert.equal(f.calls.length, 1);
  });
  await fixture(async f => { await assert.rejects(f.bind().page([entryId], undefined, signal())); assert.equal(f.calls.length, 0); }, '1.1.0');
});

test('uploads record server identity before ciphertext, omit object credentials and preserve deferred deletion', async () => {
  await fixture(async f => {
    const transport = f.bind(), metadata = newPasswordFile('synthetic.txt', 3), bytes = new Uint8Array([7, 8, 9]), order: string[] = [], uploaded: Uint8Array[] = [];
    f.respond(async (url, init, body) => {
      if (url.startsWith('https://objects.example/')) { order.push('object'); uploaded.push(init.body as Uint8Array); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); return new Response(null); }
      const result = body.operation === 'file-start' ? { upload: { id: fileId, state: 'pending', partSizeBytes: 8 } } : body.operation === 'file-parts' ? { parts: [{ url: 'https://objects.example/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] } : body.operation === 'file-complete' ? { file: { id: fileId, metadata } } : { deferred: true };
      return Response.json({ ok: true, ownerId: f.ownerId, ...result });
    });
    const result = await transport.upload(entryId, metadata, () => new Blob([bytes]).stream(), async id => { assert.equal(id, fileId); order.push('recorded'); }, signal());
    assert.equal(result.id, fileId); assert.equal(result.entryId, entryId); assert.equal(order[0], 'recorded');
    const recovered = await new Response(iterableStream(decryptPasswordFile(new Blob(uploaded as BlobPart[]).stream(), metadata))).arrayBuffer(); assert.deepEqual(new Uint8Array(recovered), bytes);
    assert.deepEqual(await transport.remove(entryId, fileId, signal()), { deferred: true });
  });
});

test('losing identity before start returns cannot open local plaintext or dispatch object requests', async () => {
  await fixture(async f => {
    const transport = f.bind(); let opened = false, recorded = false;
    f.respond(async () => { f.bind(false); return Response.json({ ok: true, ownerId: f.ownerId, upload: { id: fileId, state: 'pending', partSizeBytes: 8 } }); });
    await assert.rejects(transport.upload(entryId, newPasswordFile('test', 0), () => { opened = true; return new Blob([]).stream(); }, async () => { recorded = true; }, signal()));
    assert.equal(opened, false); assert.equal(recorded, false); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init.signal!.aborted, true);
  });
});

test('a delayed object response after retirement cannot complete an upload', async () => {
  await fixture(async f => {
    const transport = f.bind(); let release!: (value: Response) => void, started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    f.respond(async (url, _init, body) => {
      if (url.startsWith('https://objects.example/')) { started(); return new Promise(resolve => { release = resolve; }); }
      return Response.json({ ok: true, ownerId: f.ownerId, ...(body.operation === 'file-start' ? { upload: { id: fileId, state: 'pending', partSizeBytes: 100 } } : { parts: [{ url: 'https://objects.example/part', headers: {} }] }) });
    });
    const pending = transport.upload(entryId, newPasswordFile('test', 1), () => new Blob([new Uint8Array([1])]).stream(), async () => {}, signal());
    await ready; f.bind(false); release(new Response(null)); await assert.rejects(pending);
    assert.equal(f.calls.some(call => call.body?.operation === 'file-complete'), false); assert.equal(f.calls.at(-1)!.init.signal!.aborted, true);
  });
});

test('authority spans a blocked download stream and releases on callback failure', async () => {
  await fixture(async f => {
    let transport = f.bind(), started!: () => void, cancelled = false; const ready = new Promise<void>(resolve => { started = resolve; });
    const metadata = newPasswordFile('test', 1);
    f.respond(async url => url.startsWith('https://objects.example/') ? new Response(new ReadableStream({ pull() { started(); return new Promise(() => {}); }, cancel() { cancelled = true; } })) : Response.json({ ok: true, ownerId: f.ownerId, url: 'https://objects.example/file', metadata }));
    const pending = transport.download(entryId, fileId, async file => { await new Response(file.stream).arrayBuffer(); }, signal());
    await ready; f.bind(false); await assert.rejects(pending); assert.equal(cancelled, true);
    transport = f.bind();
    await assert.rejects(transport.download(entryId, fileId, async () => { throw new Error('Local storage refused'); }, signal()), /Local storage refused/);
    assert.equal(f.calls.at(-1)!.init.signal!.aborted, true);
  });
});
