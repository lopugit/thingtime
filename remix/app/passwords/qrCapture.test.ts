import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { scanQrScreen } from './qr.client';

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
}

test('closing an editor cancels a pending picker and stops any late stream without reading pixels', async t => {
  let accept!: (value: MediaStream) => void, stops = 0;
  const controller = new AbortController();
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: () => new Promise<MediaStream>(resolve => { accept = resolve; }) } });
  const capture = scanQrScreen(controller.signal);
  controller.abort();
  await assert.rejects(capture, { name: 'AbortError' });
  accept({ getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 1);
});

test('cancelling stalled video playback releases capture immediately and ignores late playback', async t => {
  let play!: () => void, stops = 0, frames = 0;
  const controller = new AbortController();
  const video = { srcObject: null, muted: false, play: () => new Promise<void>(resolve => { play = resolve; }), pause() {}, requestVideoFrameCallback() { frames++; return 1; }, cancelVideoFrameCallback() {} };
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: async () => ({ getTracks: () => [{ stop: () => stops++ }] }) } });
  replaceGlobal(t, 'document', { createElement: () => video });
  const capture = scanQrScreen(controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(capture, { name: 'AbortError' });
  assert.equal(stops, 1); assert.equal(video.srcObject, null);
  play(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(frames, 0);
});

test('capture denial does not create a video or mask the browser error', async t => {
  replaceGlobal(t, 'navigator', { mediaDevices: { getDisplayMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  await assert.rejects(scanQrScreen(), { name: 'NotAllowedError' });
});
