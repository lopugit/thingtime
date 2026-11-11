const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebBundleUpdates } = require('../lib/web-bundle-updates.cjs');

test('background update checks reuse one operation and stage only verified download without reloading', async () => {
  const calls = [], envelope = { releaseId: 'release', descriptor: { version: '1.0.1' } };
  const updates = createWebBundleUpdates({
    store: { inspect: async () => ({ highestSequence: 7, pending: null }), stage: async (...args) => { calls.push(['stage', ...args]); } },
    downloader: { check: async ({ minimumSequence }) => { calls.push(['check', minimumSequence]); return envelope; },
      download: async (input, { onProgress }) => { assert.equal(input, envelope); onProgress({ completeBytes: 123 }); return { directory: '/verified', completeBytes: 123 }; },
      discard: async releaseId => { calls.push(['discard', releaseId]); } }
  });
  const first = updates.checkAndStage(); assert.equal(updates.checkAndStage(), first);
  assert.equal((await first).status, 'pending'); assert.equal(updates.snapshot().completeBytes, 123);
  assert.deepEqual(calls.map(call => call[0]), ['check', 'stage', 'discard']); assert.equal(calls[0][1], 7);
  assert.equal(calls[1][1], '/verified'); assert.equal(calls[1][2], envelope);
  await updates.close(); assert.equal((await updates.checkAndStage()).status, 'pending');
});
test('pending launch stays untouched and failed downloads never enter the staging store', async () => {
  let checks = 0, stages = 0;
  const pending = createWebBundleUpdates({ store: { inspect: async () => ({ pending: { releaseId: 'pending' } }) }, downloader: { check: () => { checks++; } } });
  assert.equal((await pending.checkAndStage()).releaseId, 'pending'); assert.equal(checks, 0);
  const failed = createWebBundleUpdates({ store: { inspect: async () => ({ highestSequence: 0 }), stage: () => { stages++; } },
    downloader: { check: async () => ({ releaseId: 'bad', descriptor: {} }), download: async () => { throw new Error('sensitive upstream body'); } } });
  const result = await failed.checkAndStage(); assert.equal(result.status, 'unavailable'); assert.equal(stages, 0);
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});
test('shutdown aborts in-flight delivery and waits without staging or clearing partial data', async () => {
  let downloaded, stages = 0;
  const started = new Promise(resolve => { downloaded = resolve; });
  const updates = createWebBundleUpdates({ store: { inspect: async () => ({ highestSequence: 0 }), stage: () => { stages++; } },
    downloader: { check: async () => ({ releaseId: 'candidate', descriptor: {} }), download: async (_envelope, { signal }) => {
      downloaded(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } } });
  const operation = updates.checkAndStage(); await started; await updates.close();
  assert.equal((await operation).status, 'interrupted'); assert.equal(stages, 0);
});

test('a fresh check after transient failure retries in the same process and clears stale error', async () => {
  let checks = 0;
  const updates = createWebBundleUpdates({ store: { inspect: async () => ({ highestSequence: 0 }) },
    downloader: { check: async () => { if (++checks === 1) throw new Error('offline'); return null; } } });
  assert.equal((await updates.checkAndStage()).status, 'unavailable');
  const recovered = await updates.checkAndStage();
  assert.equal(recovered.status, 'current'); assert.equal(recovered.error, null); assert.equal(checks, 2);
});
