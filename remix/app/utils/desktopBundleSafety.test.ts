import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopBundleSafety } from './desktopBundleSafety';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(fn => { resolve = fn; }); return { promise, resolve }; };

test('checkpoint awaits fulfilled durable writes and certifies the exact saved revision', async () => {
  const safety = createDesktopBundleSafety(), write = deferred(); let revision = 3, saved = 0;
  safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => true,
    checkpoint: async () => { const expected = revision; await write.promise; saved = expected; return () => revision === expected && saved === expected; } });
  let finished = false;
  const result = safety.checkpoint(new AbortController().signal, 'session').then(check => { finished = true; return check; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false); write.resolve();
  const check = await result; assert.equal(check(), true); revision++; assert.equal(check(), false);
});
test('missing persistence, opt-out, unknown work and failed writes cannot certify reload', async () => {
  const safety = createDesktopBundleSafety(), signal = new AbortController().signal;
  await assert.rejects(safety.checkpoint(signal, 'session'));
  const off = safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => false });
  assert.equal(safety.automaticUpdatesEnabled('session'), false); await assert.rejects(safety.checkpoint(signal, 'session')); off();
  safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => true, checkpoint: async () => { throw Error('disk unavailable'); } });
  await assert.rejects(safety.checkpoint(signal, 'session'), /disk unavailable/);
  safety.register({ kind: 'work', ready: () => false }); await assert.rejects(safety.checkpoint(signal, 'session'));
});
test('identity/scope replacement and mutations during saving invalidate the checkpoint', async () => {
  for (const change of ['membership', 'mutation', 'abort']) {
    const safety = createDesktopBundleSafety(), write = deferred(), controller = new AbortController();
    const off = safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => true,
      checkpoint: async () => { await write.promise; return () => true; } });
    const result = safety.checkpoint(controller.signal, 'session');
    if (change === 'membership') off(); else if (change === 'mutation') safety.changed(); else controller.abort();
    write.resolve(); await assert.rejects(result);
  }
});
test('a new Messenger draft or recording invalidates an already fulfilled checkpoint', async () => {
  const safety = createDesktopBundleSafety(); let busy = false;
  safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => true });
  safety.register({ kind: 'work', ready: () => !busy });
  const certificate = await safety.checkpoint(new AbortController().signal, 'session'); assert.equal(certificate(), true);
  busy = true; assert.equal(certificate(), false);
});
test('an unresponsive persistence participant releases the cancelled checkpoint promptly', async () => {
  const safety = createDesktopBundleSafety(), controller = new AbortController();
  safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => true, checkpoint: () => new Promise(() => {}) });
  const result = safety.checkpoint(controller.signal, 'session'); controller.abort(); await assert.rejects(result);
});
test('optional checkpoint observations cannot bypass or break actual persistence and work checks', async () => {
  const safety = createDesktopBundleSafety(), signal = new AbortController().signal;
  const reasons: string[] = [];
  await assert.rejects(safety.checkpoint(signal, 'session', reason => reasons.push(reason)));
  assert.deepEqual(reasons, ['persistence-missing']);
  safety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => true });
  const certificate = await safety.checkpoint(signal, 'session', () => { throw Error('PRIVATE_SENTINEL'); });
  assert.equal(certificate(), true);
  safety.register({ kind: 'work', ready: () => false }); reasons.length = 0;
  await assert.rejects(safety.checkpoint(signal, 'session', reason => reasons.push(reason)));
  assert.deepEqual(reasons, ['work-unready']);
});
