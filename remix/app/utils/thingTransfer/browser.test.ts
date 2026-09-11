import assert from 'node:assert/strict';
import test from 'node:test';
import { bundleFromPlan, readTransferClipboard, transferClipboardText, writeTransferClipboard } from './browser';
import type { TransferPlan } from './plan';

const plan = (): TransferPlan => ({ roots: ['note'], things: [{ id: 'note', thingtime: ['note'], crystal: { name: 'A note' }, extended: ['json', 42] }], files: [] });

test('clipboard JSON preserves portable content and cannot carry destructive cut commands', async () => {
  const bundle = await bundleFromPlan(plan());
  assert.deepEqual(await readTransferClipboard(await transferClipboardText(bundle)), bundle);
  await assert.rejects(readTransferClipboard(JSON.stringify({ ...bundle.manifest, cut: true })), /Unsupported transfer field/);
});

test('stored bytes survive clipboard ZIP and key-bearing download scope stays out of the archive', async () => {
  const original = plan(); const bytes = new TextEncoder().encode('Actual portable bytes 🥰');
  original.files.push({ id: 'photo', targetId: 'note', name: 'file.txt', mime: 'text/plain', bytes: bytes.length, sharedRoot: 'note' });
  const bundle = await bundleFromPlan(original, { key: 'presented-key', fetch: async (url, init) => {
    assert.match(String(url), /^\/api\/v1\/attachments\/content\?/);
    assert.match(String(url), /key=presented-key/); assert.equal(init?.referrerPolicy, 'no-referrer');
    return new Response(bytes);
  } });
  assert.equal(JSON.stringify(bundle.manifest).includes('presented-key'), false);
  assert.equal(JSON.stringify(bundle.manifest).includes('sharedRoot'), false);
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
  bundle.files.set('hidden', new Uint8Array([1]));
  await assert.rejects(transferClipboardText(bundle), /undeclared/);
});
