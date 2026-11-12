'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebBundleLaunch } = require('../lib/web-bundle-launch.cjs');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  const calls = [], failures = [];
  let callback, cleared = 0, unref = 0;
  const store = { prepareLaunch: async () => ({ source: 'trial', releaseId: 'candidate' }), confirmLaunch: async id => { calls.push(id); }, ...options.store };
  const launch = createWebBundleLaunch({ store, onFailure: error => { failures.push(error); },
    setTimer(fn, ms) { callback = fn; assert.equal(ms, 60000); return { unref() { unref++; } }; },
    clearTimer() { cleared++; }, ...options, store });
  return { launch, calls, failures, expire: () => callback(), get cleared() { return cleared; }, get unref() { return unref; } };
}
test('renderer first and duplicate readiness confirm exactly once', async () => {
  const f = fixture();
  const selected = await f.launch.prepare();
  assert.equal(f.launch.selection, selected);
  assert.equal(await f.launch.rendererReady(), false);
  assert.deepEqual(f.calls, []);
  const results = await Promise.all([f.launch.serverReady(), f.launch.serverReady(), f.launch.rendererReady()]);
  assert.deepEqual(results, [true, true, true]);
  assert.deepEqual(f.calls, ['candidate']);
  assert.equal(await f.launch.serverReady(), false);
  assert.equal(f.cleared, 1); assert.equal(f.unref, 1);
  assert.equal(await f.launch.fail(new Error('late')), false);
});
test('server first still requires renderer and retained bundles never confirm', async () => {
  const f = fixture(); await f.launch.prepare();
  assert.equal(await f.launch.serverReady(), false);
  assert.equal(await f.launch.rendererReady(), true);
  for (const source of ['retained', 'bundled']) {
    const other = fixture({ store: { prepareLaunch: async () => ({ source }), confirmLaunch: () => assert.fail('unexpected confirmation') } });
    await other.launch.prepare();
    assert.equal(await other.launch.serverReady(), false); assert.equal(await other.launch.rendererReady(), false);
    assert.equal(await other.launch.fail(new Error('ordinary startup')), false); assert.equal(other.unref, 0);
  }
});
test('deadline starts after preparation and fails one unconfirmed trial', async () => {
  const pending = deferred(); const f = fixture({ store: { prepareLaunch: () => pending.promise, confirmLaunch: () => assert.fail('unexpected') } });
  const preparing = f.launch.prepare(); await Promise.resolve(); assert.equal(f.unref, 0);
  pending.resolve({ source: 'trial', releaseId: 'candidate' }); await preparing;
  f.expire(); f.expire(); await f.launch.failure;
  assert.equal(f.failures.length, 1); assert.match(f.failures[0].message, /deadline/);
  assert.equal(await f.launch.serverReady(), false); assert.equal(await f.launch.rendererReady(), false);
  assert.equal(await f.launch.fail(new Error('again')), false);
});
test('confirmation rejection takes the same recovery path once', async () => {
  const error = new Error('disk failure');
  const f = fixture({ store: { prepareLaunch: async () => ({ source: 'trial', releaseId: 'candidate' }), confirmLaunch: async () => { throw error; } } });
  await f.launch.prepare(); await f.launch.serverReady();
  assert.equal(await f.launch.rendererReady(), false); assert.deepEqual(f.failures, [error]);
  f.expire(); assert.equal(f.failures.length, 1);
});
test('close during preparation or queued confirmation prevents confirmation and recovery', async () => {
  const pending = deferred(); const f = fixture({ store: { prepareLaunch: () => pending.promise } });
  const preparing = f.launch.prepare(); await Promise.resolve(); f.launch.close(); pending.resolve({ source: 'trial', releaseId: 'candidate' }); await preparing;
  assert.equal(f.unref, 0); assert.equal(await f.launch.serverReady(), false);
  const g = fixture(); await g.launch.prepare(); await g.launch.serverReady();
  const confirming = g.launch.rendererReady(); g.launch.close();
  assert.equal(await confirming, false); assert.deepEqual(g.calls, []); assert.equal(await g.launch.fail(new Error()), false);
});
test('close during an executing confirmation suppresses late recovery without pretending to cancel store I/O', async () => {
  const pending = deferred(), entered = deferred();
  const f = fixture({ store: { prepareLaunch: async () => ({ source: 'trial', releaseId: 'candidate' }), confirmLaunch: () => { entered.resolve(); return pending.promise; } } });
  await f.launch.prepare(); await f.launch.rendererReady(); const confirming = f.launch.serverReady(); await entered.promise;
  f.launch.close(); pending.reject(new Error('late disk failure'));
  assert.equal(await confirming, false); assert.deepEqual(f.failures, []);
});
test('startup deadline cannot race a durable confirmation after both gates pass', async () => {
  const pending = deferred(), entered = deferred();
  const f = fixture({ store: { prepareLaunch: async () => ({ source: 'trial', releaseId: 'candidate' }), confirmLaunch: () => { entered.resolve(); return pending.promise; } } });
  await f.launch.prepare(); await f.launch.serverReady(); const confirming = f.launch.rendererReady(); await entered.promise;
  f.expire(); pending.resolve();
  assert.equal(await confirming, true); assert.deepEqual(f.failures, []);
});
test('failure callback rejection remains observable to callers and timer integration', async () => {
  const error = new Error('relaunch failed'); const f = fixture({ onFailure: async () => { throw error; } });
  await f.launch.prepare(); f.expire();
  await assert.rejects(f.launch.failure, error); assert.equal(f.launch.failureError, error);
});
test('prepare is idempotent and preparation errors propagate', async () => {
  let count = 0; const f = fixture({ store: { prepareLaunch: async () => { count++; throw new Error('invalid inventory'); } } });
  const first = f.launch.prepare(); assert.equal(f.launch.prepare(), first);
  await assert.rejects(first, /invalid inventory/); assert.equal(count, 1); assert.equal(f.unref, 0);
});
