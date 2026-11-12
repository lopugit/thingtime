import assert from 'node:assert/strict';
import test from 'node:test';
import { storageFailureCode, storageFailureFromResponse } from './storageFailure';

const migration = 'Account content requires storage migration before its ledger can be reconciled';
test('handled migration responses expose only a fixed code and preserve the response', async () => {
  const body = { ok: false, error: migration, privateField: 'must never be logged' };
  const response = Response.json(body, { status: 503 });
  assert.equal(await storageFailureFromResponse(response), 'STORAGE_MIGRATION_REQUIRED');
  assert.deepEqual(await response.json(), body);
  assert.equal(storageFailureCode('private arbitrary error'), undefined);
});

test('unknown, successful, non-JSON and oversized responses do not become storage incidents', async () => {
  for (const response of [
    Response.json({ ok: true, error: migration }, { status: 503 }),
    Response.json({ ok: false, error: migration }),
    new Response(migration, { status: 503 }),
    Response.json({ ok: false, error: 'private secret' }, { status: 503 }),
    Response.json({ ok: false, error: migration, privateField: 'x'.repeat(20_000) }, { status: 503 })
  ]) assert.equal(await storageFailureFromResponse(response), undefined);
});

test('stalled diagnostic streams cannot hold up a response', async () => {
  const response = new Response(new ReadableStream({ start() {} }), { status: 503, headers: { 'content-type': 'application/json' } });
  assert.equal(await storageFailureFromResponse(response), undefined);
  void response.body?.cancel();
});
