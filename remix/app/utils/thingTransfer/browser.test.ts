import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleFromPlan, downloadTransfer, readTransferClipboard, transferClipboardText, writeTransferClipboard } from './browser';
import { TRANSFER_LIMITS } from './format';
import type { TransferPlan } from './plan';
import { encodeTransferArchive, decodeTransferArchive } from './archive';

const plan = (): TransferPlan => ({ roots: ['note'], things: [{ id: 'note', thingtime: ['note'], crystal: { name: 'A note' }, extended: ['json', 42] }], files: [] });

test('inline emoji plan bytes reject unrelated targets, excess bytes and ambiguous download sources', async () => {
  const base: TransferPlan = { roots: ['emoji'], things: [{ id: 'emoji', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'file' } }],
    files: [{ id: 'file', targetId: 'emoji', name: 'party.png', mime: 'image/png', bytes: 3, inlineBase64: 'AQID' }] };
  for (const change of [
    (p: TransferPlan) => { p.files[0].sourceId = 'existing-file'; },
    (p: TransferPlan) => { p.files[0].bytes = 4; },
    (p: TransferPlan) => { p.files[0].inlineBase64 = 'AQID\n'; },
    (p: TransferPlan) => { p.files[0].inlineBase64 = 'A'.repeat(700 * 1024 + 1); },
    (p: TransferPlan) => { p.files[0].mime = 'text/html'; },
    (p: TransferPlan) => { p.things[0].thingtime = ['data']; }
  ]) {
    const value = structuredClone(base); change(value);
    await assert.rejects(bundleFromPlan(value, { fetch: async () => { throw new Error('Must not fetch inline sources'); } }));
  }
});

test('recording download source IDs authorize bytes without entering the portable archive', async () => {
  const p = plan(); p.files = [{ id: 'portable-file', sourceId: 'original-recording', targetId: 'note', name: 'a.wav', mime: 'audio/wav', bytes: 4 }];
  const bundle = await bundleFromPlan(p, { fetch: async (url) => {
    assert.equal(new URL(String(url), 'https://example.test').searchParams.get('id'), 'original-recording');
    return new Response(new Uint8Array([1, 2, 3, 4]));
  } });
  assert.equal(bundle.files.has('portable-file'), true);
  assert.equal('sourceId' in bundle.manifest.files[0], false);
  assert.deepEqual(await readTransferClipboard(await transferClipboardText(bundle)), bundle);
});

test('linked metadata round-trips clipboard and ZIP without fetching external URLs', async () => {
  const original = plan();
  original.links = [{ id: 'link', targetId: 'note', url: 'https://example.com/photo.png', mediaKind: 'image', title: 'Photo 🥰', description: 'First\nSecond' }];
  original.attachmentOrder = ['link'];
  const bundle = await bundleFromPlan(original, { fetch: async () => { throw new Error('Must not fetch links'); } });
  assert.deepEqual(await readTransferClipboard(await transferClipboardText(bundle)), bundle);
  assert.deepEqual(await decodeTransferArchive(await encodeTransferArchive(bundle)), bundle);
});

test('clipboard JSON preserves portable content and cannot carry destructive cut commands', async () => {
  const bundle = await bundleFromPlan(plan());
  assert.deepEqual(await readTransferClipboard(await transferClipboardText(bundle)), bundle);
  await assert.rejects(readTransferClipboard(JSON.stringify({ ...bundle.manifest, cut: true })), /Unsupported transfer field/);
});

test('stored bytes survive clipboard ZIP and key-bearing download scope stays out of the archive', async () => {
  const original = plan(); const bytes = new TextEncoder().encode('Actual portable bytes 🥰');
  original.files.push({ id: 'photo', targetId: 'note', name: 'file.txt', mime: 'text/plain', bytes: bytes.length, sharedRoot: 'note', title: 'Title 🥰', description: 'First\nSecond', filenamePreview: 'Display filename' });
  const bundle = await bundleFromPlan(original, { key: 'presented-key', fetch: async (url, init) => {
    assert.match(String(url), /^\/api\/v1\/attachments\/content\?/);
    assert.match(String(url), /key=presented-key/); assert.equal(init?.referrerPolicy, 'no-referrer');
    return new Response(bytes);
  } });
  assert.equal(JSON.stringify(bundle.manifest).includes('presented-key'), false);
  assert.equal(JSON.stringify(bundle.manifest).includes('sharedRoot'), false);
  assert.equal(bundle.manifest.files[0].title, 'Title 🥰');
  assert.equal(bundle.manifest.files[0].description, 'First\nSecond');
  assert.equal(bundle.manifest.files[0].filenamePreview, 'Display filename');
  const text = await transferClipboardText(bundle);
  assert.match(text, /^thingtime:zip:v1:/);
  assert.deepEqual(await readTransferClipboard(text), bundle);
});

test('truncated, excessive or forbidden file responses never return a partial bundle', async () => {
  const original = plan(); original.files.push({ id: 'file', targetId: 'note', name: 'a', mime: 'text/plain', bytes: 2 });
  for (const response of [new Response('x'), new Response('longer'), new Response(null, { status: 404 })]) {
    await assert.rejects(bundleFromPlan(original, { fetch: async () => response }));
  }
});

test('clipboard write is invoked during the gesture before asynchronous export resolves', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  let writeCalled = false;
  let resolve!: (value: Awaited<ReturnType<typeof bundleFromPlan>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof bundleFromPlan>>>((done) => { resolve = done; });
  class Item {
    data: Record<string, Promise<Blob>>;
    constructor(data: Record<string, Promise<Blob>>) { this.data = data; }
  }
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: Item });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { write: async (items: Item[]) => {
    writeCalled = true; const blob = await items[0].data['text/plain']; assert.match(await blob.text(), /thingtime.transfer/);
  } } } });
  try {
    const written = writeTransferClipboard(pending);
    assert.equal(writeCalled, true);
    resolve(await bundleFromPlan(plan()));
    assert.match(await written, /thingtime.transfer/);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete (globalThis as any).navigator;
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor); else delete (globalThis as any).ClipboardItem;
  }
});

test('synchronous clipboard denial is a rejection and pending export failure stays observed', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const item = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { write() { throw new Error('Permission denied'); } } } });
  let reject!: (error: Error) => void;
  const pending = new Promise<Awaited<ReturnType<typeof bundleFromPlan>>>((_, fail) => { reject = fail; });
  try {
    await assert.rejects(writeTransferClipboard(pending), /Permission denied/);
    reject(new Error('Export cancelled'));
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete (globalThis as any).navigator;
    if (item) Object.defineProperty(globalThis, 'ClipboardItem', item); else delete (globalThis as any).ClipboardItem;
  }
});

test('cancelled and undeclared clipboard bundles are never serialized', async () => {
  const bundle = await bundleFromPlan(plan());
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transferClipboardText(bundle, controller.signal), { name: 'AbortError' });
  bundle.files.set('hidden', new Blob([new Uint8Array([1])]));
  await assert.rejects(transferClipboardText(bundle), /undeclared/);
});


test('in-process export availability is checked before and after preparing portable content',async()=>{
 const original=plan();let reads=0,allowed=true;
 original.assertCurrent=async()=>{reads++;if(!allowed)throw Error('Export refused');};
 const bundle=await bundleFromPlan(original);assert.equal(reads,2);assert.equal('assertCurrent' in bundle.manifest,false);
 allowed=false;await assert.rejects(bundleFromPlan(original),/Export refused/);
 allowed=true;original.files=[{id:'file',targetId:'note',name:'file.txt',mime:'text/plain',bytes:2}];
 original.readLocalFile=async()=>{allowed=false;return new Uint8Array([1,2]);};
 await assert.rejects(bundleFromPlan(original),/Export refused/);
});


test('portable encoding and download cannot outlive an in-process availability fence',async()=>{
 let allowed=true;
 const original=plan();original.assertCurrent=async()=>{if(!allowed)throw Error('Export refused');};
 const bundle=await bundleFromPlan(original);allowed=false;
 await assert.rejects(encodeTransferArchive(bundle),/Export refused/);
 await assert.rejects(transferClipboardText(bundle),/Export refused/);
 await assert.rejects(downloadTransfer(bundle,'json'),/Export refused/);
 let checks=0;bundle.assertCurrent=async()=>{if(++checks===2)throw Error('Refused during ZIP encoding');};
 await assert.rejects(encodeTransferArchive(bundle),/Refused during ZIP encoding/);
});

test('streamed file chunks become exact immutable Blobs with the same download authority', async () => {
  const original = plan(); original.files = [{ id: 'file', sourceId: 'source', sharedRoot: 'note', targetId: 'note', name: 'a.bin', mime: 'application/octet-stream', bytes: 4 }];
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  const bundle = await bundleFromPlan(original, { key: 'presented', fetch: async (url, init) => {
    const parsed = new URL(String(url), 'https://fixture.invalid');
    assert.equal(parsed.pathname, '/api/v1/attachments/content');
    assert.equal(parsed.searchParams.get('id'), 'source');
    assert.equal(parsed.searchParams.get('sharedRoot'), 'note');
    assert.equal(parsed.searchParams.get('key'), 'presented');
    assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store');
    return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }));
  } });
  chunks.forEach(chunk => chunk.fill(0));
  assert.ok(bundle.files.get('file') instanceof Blob);
  assert.deepEqual(new Uint8Array(await bundle.files.get('file')!.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
  const copied = await readTransferClipboard(await transferClipboardText(bundle));
  assert.deepEqual(copied.manifest, bundle.manifest);
  assert.deepEqual(new Uint8Array(await copied.files.get('file')!.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test('negotiated original streams pin source receipts and recheck them before later export, including empty files', async () => {
 for (const size of [0, 3]) {
  const original = plan(); original.files = [{id: 'file', sourceId: 'source', sharedRoot: 'note', targetId: 'note', name: 'a.bin', mime: 'application/octet-stream', bytes: size}];
  const modes: string[] = []; let key = 'a'.repeat(64);
  const bundle = await bundleFromPlan(original, {originalStream: true, key: 'presented-only', fetch: async (input, init) => {
   const url = new URL(String(input), 'https://fixture.invalid'), mode = url.searchParams.get('cache')!; modes.push(mode);
   assert.equal(url.searchParams.get('id'), 'source'); assert.equal(url.searchParams.get('sharedRoot'), 'note'); assert.equal(url.searchParams.get('key'), 'presented-only');
   assert.equal(init?.redirect, 'error'); assert.equal(init?.referrerPolicy, 'no-referrer');
   if (mode === 'validate') return Response.json({ok: true, cacheKey: key + ':original', size});
   assert.equal(mode, 'original-bytes'); assert.equal(new Headers(init?.headers).get('If-Match'), '"' + key + ':original:v1"');
   return new Response(new Uint8Array(size), {headers: {ETag: '"' + key + ':original:v1"', 'Content-Length': String(size)}});
  }});
  assert.equal(bundle.files.get('file')!.size, size);
  await bundle.assertCurrent!(); assert.deepEqual(modes, ['validate', 'original-bytes', 'validate', 'validate']);
  assert.equal(JSON.stringify(bundle.manifest).includes('presented-only'), false); assert.equal(JSON.stringify(bundle.manifest).includes(key), false);
  key = 'b'.repeat(64); await assert.rejects(bundle.assertCurrent!(), /changed during export/);
 }
});

test('a new bundle recheck signal cancels receipt requests even when the fetch ignores cancellation', async () => {
 const original = plan(); original.files = [{id: 'file', targetId: 'note', name: 'a.bin', mime: 'application/octet-stream', bytes: 1}];
 let stalled = false, entered!: () => void;
 const waiting = new Promise<void>(resolve => {entered = resolve;});
 const bundle = await bundleFromPlan(original, {originalStream: true, fetch: async input => {
  const url = new URL(String(input), 'https://fixture.invalid');
  if (url.searchParams.get('cache') === 'validate') {
   if (stalled) {entered(); await new Promise(() => {});}
   return Response.json({ok: true, cacheKey: 'a'.repeat(64) + ':original', size: 1});
  }
  return new Response(new Uint8Array([1]), {headers: {ETag: '"' + 'a'.repeat(64) + ':original:v1"', 'Content-Length': '1'}});
 }});
 stalled = true; const controller = new AbortController(), pending = bundle.assertCurrent!(controller.signal);
 await waiting; controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
});

test('cancelling a stalled stream releases the reader without waiting for the server', async () => {
  const original = plan(); original.files = [{ id: 'file', targetId: 'note', name: 'a.bin', mime: 'application/octet-stream', bytes: 4 }];
  const controller = new AbortController(); let cancelled = false;
  let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; });
  const body = new ReadableStream({ pull() { reading(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const pending = bundleFromPlan(original, { signal: controller.signal, fetch: async () => new Response(body) });
  await started; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true); assert.equal(body.locked, false);
});

test('plan metadata and reader identity are frozen before asynchronous availability checks', async () => {
  const original = plan(); const bytes = new Uint8Array([1, 2, 3]);
  original.files = [{ id: 'file', targetId: 'note', name: 'original.bin', mime: 'application/octet-stream', bytes: 3 }];
  original.readLocalFile = async () => bytes;
  let checks = 0;
  original.assertCurrent = async () => {
    if (++checks !== 1) return;
    original.things[0].crystal.name = 'Changed'; original.files[0].name = 'changed.bin';
    original.files[0].id = 'other'; original.roots.length = 0;
    original.readLocalFile = async () => { throw Error('Replaced reader'); };
  };
  const bundle = await bundleFromPlan(original);
  bytes.fill(0);
  assert.equal(checks, 2); assert.deepEqual(bundle.manifest.roots, ['note']);
  assert.equal(bundle.manifest.things[0].crystal.name, 'A note');
  assert.equal(bundle.manifest.files[0].name, 'original.bin');
  assert.deepEqual(new Uint8Array(await bundle.files.get('file')!.arrayBuffer()), new Uint8Array([1, 2, 3]));
});


test('large local Blob plans reach bounded hashing while remote plans keep their existing budget', async () => {
  const value = plan();
  value.files = [{ id: 'file', targetId: 'note', name: 'large.bin', mime: 'application/octet-stream', bytes: TRANSFER_LIMITS.fileBytes + 1 }];
  await assert.rejects(bundleFromPlan(value, { fetch: async () => { throw new Error('must not fetch'); } }), /too large/);
  const controller = new AbortController();
  const data = new Blob();
  Object.defineProperty(data, 'size', { value: value.files[0].bytes });
  Object.defineProperty(data, 'slice', { value: (start: number, end: number) => {
    assert.equal(start, 0); assert.ok(end <= 1024 * 1024);
    controller.abort(new Error('cancelled local hash'));
    return new Blob([new Uint8Array([1])]);
  } });
  value.readLocalFile = async () => data;
  await assert.rejects(bundleFromPlan(value, { signal: controller.signal }), /cancelled local hash/);
});


test('remote aggregates above the legacy budget require pinned originals and never bypass read refusal', async () => {
  const original = plan(); original.files = ['first', 'second'].map(id => ({ id, targetId: 'note', name: `${id}.bin`, mime: 'application/octet-stream', bytes: 300 * 1024 * 1024 }));
  let reads = 0;
  const fetcher: typeof fetch = async input => { reads++; assert.equal(new URL(String(input), 'https://fixture.test').searchParams.get('cache'), 'validate'); return new Response(null, { status: 403 }); };
  await assert.rejects(bundleFromPlan(original, { fetch: fetcher }), /too large/); assert.equal(reads, 0);
  await assert.rejects(bundleFromPlan(original, { fetch: fetcher, originalStream: true }), /no longer readable/); assert.equal(reads, 1);
});


test('many small network frames retain bounded immutable Blob chunks', async () => {
  const OriginalBlob = Blob, sizes: number[] = [], bytes = 2 * 1024 * 1024 + 3;
  const original = plan(); original.files = [{ id: 'file', targetId: 'note', name: 'frames.bin', mime: 'application/octet-stream', bytes }];
  class ObservedBlob extends OriginalBlob {
    constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
      super(parts, options);
      if (parts[0] instanceof Uint8Array) sizes.push(parts[0].byteLength);
    }
  }
  Object.defineProperty(globalThis, 'Blob', { configurable: true, value: ObservedBlob });
  try {
    let produced = 0;
    const bundle = await bundleFromPlan(original, { fetch: async () => new Response(new ReadableStream({ pull(controller) {
      if (produced === bytes) { controller.close(); return; }
      const frame = new Uint8Array(Math.min(257, bytes - produced)); frame.fill(7); produced += frame.byteLength; controller.enqueue(frame);
    } })) });
    assert.equal(bundle.files.get('file')!.size, bytes);
    assert.deepEqual(sizes, [1024 * 1024, 1024 * 1024, 3]);
    assert.deepEqual(new Uint8Array(await bundle.files.get('file')!.slice(bytes - 3).arrayBuffer()), new Uint8Array([7, 7, 7]));
  } finally { Object.defineProperty(globalThis, 'Blob', { configurable: true, value: OriginalBlob }); }
});
