import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicationStageTimer } from './preview-publication-timing.mjs';

test('success logs fixed boundaries with measured elapsed time and preserves return identity', async () => {
  const lines = [], times = [10, 35.4], value = { toJSON() { throw new Error('must not inspect result'); } };
  const timed = createPublicationStageTimer({ now: () => times.shift(), write: line => lines.push(line) });
  assert.equal(await timed('configuration', () => value), value);
  assert.deepEqual(lines, [
    '[preview-publication] stage=configuration status=started elapsed_ms=0',
    '[preview-publication] stage=configuration status=succeeded elapsed_ms=25'
  ]);
});

test('sync and async failures retain the exact thrown value without reflecting secrets', async () => {
  const secret = 'synthetic-token https://private.invalid/path?secret=sentinel';
  for (const value of [new Error(secret), secret, null, undefined]) {
    for (const operation of [() => { throw value; }, () => Promise.reject(value)]) {
      const lines = [], times = [5, 12];
      const timed = createPublicationStageTimer({ now: () => times.shift(), write: line => lines.push(line) });
      let caught = false;
      try { await timed('vercel-cli-upload', operation); }
      catch (error) { caught = true; assert.equal(error, value); }
      assert.equal(caught, true);
      assert.deepEqual(lines, [
        '[preview-publication] stage=vercel-cli-upload status=started elapsed_ms=0',
        '[preview-publication] stage=vercel-cli-upload status=failed elapsed_ms=7'
      ]);
      assert.ok(lines.every(line => !line.includes(secret)));
    }
  }
});

test('unrecognized labels cannot leak into logs or execute the operation', async () => {
  const lines = [], timed = createPublicationStageTimer({ write: line => lines.push(line) });
  let called = false;
  await assert.rejects(timed('secret-token', () => { called = true; }), /Unknown preview publication timing stage/);
  assert.equal(called, false);
  assert.deepEqual(lines, []);
});

test('logger and clock failures cannot replace the operation result or failure', async () => {
  const failure = new Error('synthetic protected operation');
  for (const now of [() => 1, () => { throw new Error('clock'); }, () => NaN, () => Infinity]) {
    const timed = createPublicationStageTimer({ now, write: () => { throw new Error('logger'); } });
    assert.equal(await timed('github-status', () => 42), 42);
    await assert.rejects(timed('github-status', () => { throw failure; }), error => error === failure);
  }
});

test('nested stages retain ordering and never emit a non-finite or negative duration', async () => {
  const lines = [], times = [10, 12, 15, 20];
  const timed = createPublicationStageTimer({ now: () => times.shift(), write: line => lines.push(line) });
  await timed('configuration', () => timed('master-readiness', () => undefined));
  assert.deepEqual(lines.map(line => line.match(/stage=(\S+) status=(\S+) elapsed_ms=(\d+)$/).slice(1)), [
    ['configuration', 'started', '0'], ['master-readiness', 'started', '0'],
    ['master-readiness', 'succeeded', '3'], ['configuration', 'succeeded', '10']
  ]);
  const invalid = [], values = [10, -1];
  await createPublicationStageTimer({ now: () => values.shift(), write: line => invalid.push(line) })('retention', () => null);
  assert.equal(invalid.length, 1);
});
