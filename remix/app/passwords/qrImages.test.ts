import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { scanQrFile, scanQrScreen } from './qr.client';

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
}
function canvas(onRead: () => void) {
  const result = { width: 0, height: 0, getContext: () => ({
    drawImage() {}, clearRect() {},
    getImageData() {
      assert.ok(result.width * result.height <= 1024 * 1024);
      onRead();
      return { data: new Uint8ClampedArray(result.width * result.height * 4) };
    }
  }) };
  return result;
}

test('large QR uploads scan with bounded pixel memory and remain cancellable', async t => {
  let closed = 0, reads = 0;
  const controller = new AbortController();
  const surface = canvas(() => { reads++; controller.abort(); });
  replaceGlobal(t, 'document', { createElement: () => surface });
  replaceGlobal(t, 'createImageBitmap', async () => ({ width: 6000, height: 4000, close: () => closed++ }));
  const file = { size: 14 * 1024 * 1024, type: 'image/png' } as File;
  await assert.rejects(scanQrFile(file, controller.signal), { name: 'AbortError' });
  assert.equal(reads, 1); assert.equal(closed, 1);
  assert.equal(surface.width, 0); assert.equal(surface.height, 0);
});

test('screen sharing stops before QR decoding and the snapshot closes on cancellation', async t => {
  let stopped = 0, closed = 0, reads = 0;
  const controller = new AbortController();
  const video = { srcObject: null, muted: false, play: async () => {}, pause() {}, requestVideoFrameCallback(done: () => void) { queueMicrotask(done); return 1; }, cancelVideoFrameCallback() {} };
  const surface = canvas(() => { assert.equal(stopped, 1); assert.equal(video.srcObject, null); reads++; controller.abort(); });
  replaceGlobal(t, 'document', { createElement: (name: string) => name === 'video' ? video : surface });
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } });
  replaceGlobal(t, 'createImageBitmap', async (source: unknown) => { assert.equal(source, video); return { width: 1920, height: 1080, close: () => closed++ }; });
  await assert.rejects(scanQrScreen(controller.signal), { name: 'AbortError' });
  assert.equal(reads, 1); assert.equal(stopped, 1); assert.equal(closed, 1);
});

test('cancel while a screen snapshot is pending stops sharing and closes the late bitmap', async t => {
  let stopped = 0, closed = 0, snapshot!: (value: unknown) => void;
  const controller = new AbortController();
  const video = { srcObject: null, muted: false, play: async () => {}, pause() {}, requestVideoFrameCallback(done: () => void) { queueMicrotask(done); return 1; }, cancelVideoFrameCallback() {} };
  replaceGlobal(t, 'document', { createElement: () => video });
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } });
  replaceGlobal(t, 'createImageBitmap', () => new Promise(resolve => { snapshot = resolve; }));
  const scan = scanQrScreen(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await assert.rejects(scan, { name: 'AbortError' });
  assert.equal(stopped, 1);
  snapshot({ width: 1920, height: 1080, close: () => closed++ });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1); assert.equal(stopped, 1);
});

test('a queued abort after an immediately resolved upload bitmap closes it exactly once', async t => {
  let closed = 0;
  const controller = new AbortController();
  replaceGlobal(t, 'document', { createElement: () => canvas(() => assert.fail('Aborted scan read pixels')) });
  replaceGlobal(t, 'createImageBitmap', () => Promise.resolve({ width: 6000, height: 4000, close: () => closed++ }));
  const scan = scanQrFile({ type: 'image/png' } as File, controller.signal);
  queueMicrotask(() => controller.abort());
  await assert.rejects(scan, { name: 'AbortError' });
  assert.equal(closed, 1);
});

test('a queued abort during screen bitmap handoff closes the snapshot and stream exactly once', async t => {
  let stopped = 0, closed = 0;
  const controller = new AbortController();
  const video = { srcObject: null, muted: false, play: async () => {}, pause() {}, requestVideoFrameCallback(done: () => void) { queueMicrotask(done); return 1; }, cancelVideoFrameCallback() {} };
  replaceGlobal(t, 'document', { createElement: (name: string) => name === 'video' ? video : canvas(() => assert.fail('Aborted scan read pixels')) });
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => stopped++ }] }) } });
  replaceGlobal(t, 'createImageBitmap', () => {
    // Resolve first; abort between the resource precheck and the wrapper's
    // resolution callback in the former two-promise implementation.
    queueMicrotask(() => queueMicrotask(() => controller.abort()));
    return Promise.resolve({ width: 1920, height: 1080, close: () => closed++ });
  });
  await assert.rejects(scanQrScreen(controller.signal), { name: 'AbortError' });
  assert.equal(closed, 1); assert.equal(stopped, 1); assert.equal(video.srcObject, null);
});

test('a queued abort during immediate stream handoff stops it exactly once', async t => {
  let stopped = 0;
  const controller = new AbortController();
  replaceGlobal(t, 'document', { createElement() { assert.fail('Cancelled stream must not create a video'); } });
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => stopped++ }] }) } });
  const scan = scanQrScreen(controller.signal);
  queueMicrotask(() => controller.abort());
  await assert.rejects(scan, { name: 'AbortError' });
  assert.equal(stopped, 1);
});

test('a stream arriving after chooser cancellation is stopped exactly once', async t => {
  let stopped = 0, acquire!: (value: unknown) => void;
  const controller = new AbortController();
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: () => new Promise(resolve => { acquire = resolve; }) } });
  const scan = scanQrScreen(controller.signal);
  controller.abort(); await assert.rejects(scan, { name: 'AbortError' });
  acquire({ getTracks: () => [{ stop: () => stopped++ }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, 1);
});

test('video construction failure after stream acquisition still stops sharing', async t => {
  let stopped = 0;
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => stopped++ }] }) } });
  replaceGlobal(t, 'document', { createElement() { throw new Error('Synthetic video creation failure'); } });
  await assert.rejects(scanQrScreen(), /Synthetic video creation failure/);
  assert.equal(stopped, 1);
});
