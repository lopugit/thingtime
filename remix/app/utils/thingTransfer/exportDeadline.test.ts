import assert from 'node:assert/strict';
import test from 'node:test';
import { withExportDeadline } from './exportDeadline';

test('export metadata timeout aborts transport even when preparation ignores cancellation', async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(withExportDeadline(async value => {
    signal = value;
    return new Promise(() => {});
  }, undefined, 10), /Preparing the export timed out/);
  assert.equal(signal?.aborted, true);
  assert.equal(await withExportDeadline(async () => 'fresh retry'), 'fresh retry');
});

test('parent cancellation rejects promptly and never starts an already cancelled export', async () => {
  const parent = new AbortController();
  let called = false;
  const pending = withExportDeadline(async () => new Promise(() => {}), parent.signal);
  parent.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(withExportDeadline(async () => { called = true; }, parent.signal), { name: 'AbortError' });
  assert.equal(called, false);
});

test('completion preserves errors and clears the deadline without cancelling completed work', async () => {
  let signal: AbortSignal | undefined;
  assert.equal(await withExportDeadline(async value => { signal = value; return 7; }, undefined, 10), 7);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(signal?.aborted, false);
  const expected = new Error('Access denied');
  await assert.rejects(withExportDeadline(async () => { throw expected; }), error => error === expected);
});
