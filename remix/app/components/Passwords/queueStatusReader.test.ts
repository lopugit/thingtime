import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueueStatusReader, type QueueStatusSnapshot } from './queueStatusReader';
function deferred<T>() {
 let resolve!: (value: T) => void, reject!: (reason: Error) => void;
 const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}
function fixture() {
 const requests: ReturnType<typeof deferred<string[]>>[] = [];
 let view: QueueStatusSnapshot<string[]> = { value: null, failed: false };
 const reader = createQueueStatusReader(() => { const request = deferred<string[]>(); requests.push(request); return request.promise; }, next => { view = next; });
 return { reader, requests, get view() { return view; } };
}
test('a delayed initial queue read remains unknown until completion', async () => {
 const f = fixture(), first = f.reader.refresh();
 assert.deepEqual(f.view, { value: null, failed: false });
 f.requests[0].resolve([]); await first;
 assert.deepEqual(f.view, { value: [], failed: false });
});
test('initial failure stays unknown and successful retry clears the error', async () => {
 const f = fixture(), first = f.reader.refresh();
 f.requests[0].reject(Error('storage unavailable')); await assert.rejects(first);
 assert.deepEqual(f.view, { value: null, failed: true });
 const retry = f.reader.refresh();
 assert.deepEqual(f.view, { value: null, failed: true });
 f.requests[1].resolve(['pending attachment']); await retry;
 assert.deepEqual(f.view, { value: ['pending attachment'], failed: false });
});
test('known rows remain visible during refresh and failure; retry can confirm empty queue', async () => {
 const f = fixture(), first = f.reader.refresh(); f.requests[0].resolve(['refused entry', 'attachment']); await first;
 const refresh = f.reader.refresh();
 assert.deepEqual(f.view, { value: ['refused entry', 'attachment'], failed: false });
 f.requests[1].reject(Error('storage unavailable')); await assert.rejects(refresh);
 assert.deepEqual(f.view, { value: ['refused entry', 'attachment'], failed: true });
 const retry = f.reader.refresh(); f.requests[2].resolve([]); await retry;
 assert.deepEqual(f.view, { value: [], failed: false });
});
test('newer reads win over stale successes and errors', async () => {
 for (const fails of [false, true]) {
  const f = fixture(), old = f.reader.refresh(), latest = f.reader.refresh();
  f.requests[1].resolve(['current']); await latest;
  if (fails) { f.requests[0].reject(Error('late failure')); await assert.rejects(old); }
  else { f.requests[0].resolve(['stale title']); await old; }
  assert.deepEqual(f.view, { value: ['current'], failed: false });
 }
});
test('retired vault/scope cannot publish late rows, titles or errors to next identity', async () => {
 for (const fails of [false, true]) {
  const previous = fixture(), next = fixture(), read = previous.reader.refresh(); previous.reader.retire();
  const current = next.reader.refresh(); next.requests[0].resolve(['next account']); await current;
  if (fails) { previous.requests[0].reject(Error('retired vault')); await assert.rejects(read); }
  else { previous.requests[0].resolve(['prior account title']); await read; }
  assert.deepEqual(previous.view, { value: null, failed: false });
  assert.deepEqual(next.view, { value: ['next account'], failed: false });
 }
});
