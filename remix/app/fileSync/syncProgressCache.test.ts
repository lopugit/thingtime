import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncProgressCache } from './syncProgressCache';
test('routine progress is coalesced, stage changes flush latest and prune only once', async () => {
 const signal = new AbortController(), writes: unknown[] = []; let prunes = 0;
 const cache = createSyncProgressCache<{ stage: string; n?: number }>({ signal: signal.signal, check() {}, persist: value => writes.push(value), prune: () => { prunes++; }, intervalMs: 5 });
 cache.write({ stage: 'transferring', n: 1 });
 for (let n = 2; n <= 10; n++) cache.write({ stage: 'transferring', n });
 assert.equal(writes.length, 1); await new Promise(resolve => setTimeout(resolve, 15));
 assert.deepEqual(writes, [{ stage: 'transferring', n: 1 }, { stage: 'transferring', n: 10 }]);
 cache.write({ stage: 'transferring', n: 11 }); cache.write({ stage: 'complete', n: 12 });
 assert.equal(writes.length, 3); assert.equal(prunes, 1); cache.dispose();
});
test('abort, explicit disposal and changed authorization discard pending cache writes', async () => {
 for (const reason of ['abort', 'dispose', 'identity']) {
  const signal = new AbortController(), writes: unknown[] = []; let current = true;
  const cache = createSyncProgressCache<{ stage: string; n?: number }>({ signal: signal.signal, check() { if (!current) throw Error('changed'); }, persist: value => writes.push(value), prune() {}, intervalMs: 5 });
  cache.write({ stage: 'transferring' }); cache.write({ stage: 'transferring' });
  if (reason === 'abort') signal.abort(); else if (reason === 'dispose') cache.dispose(); else current = false;
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(writes.length, 1); cache.dispose();
 }
});
