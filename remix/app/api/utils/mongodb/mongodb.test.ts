import assert from 'node:assert/strict';
import test from 'node:test';

import { getMongoDb } from './mongodb';

test('the real Mongo client keeps a Fluid invocation alive through its configured idle timeout', async t => {
  const { MongoClient } = await getMongoDb();
  const contextKey = Symbol.for('@vercel/request-context');
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previousContext = globals[contextKey];
  const previousUrl = process.env.VERCEL_URL;
  const previousRegion = process.env.VERCEL_REGION;
  const pending: Promise<unknown>[] = [];
  globals[contextKey] = { get: () => ({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) }) };
  process.env.VERCEL_URL = 'pool-test.example';
  process.env.VERCEL_REGION = 'test';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    if (previousContext === undefined) delete globals[contextKey]; else globals[contextKey] = previousContext;
    if (previousUrl === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = previousUrl;
    if (previousRegion === undefined) delete process.env.VERCEL_REGION; else process.env.VERCEL_REGION = previousRegion;
  });
  // Construction and CMAP events only: no connection or database mutation.
  const client = new MongoClient('mongodb://127.0.0.1:1', { maxIdleTimeMS: 60_000, minPoolSize: 0 });
  assert.equal(client.listenerCount('connectionCheckedOut'), 1);
  client.emit('connectionCheckedOut', { address: '127.0.0.1:1', connectionId: 1, durationMS: 0, time: new Date() });
  assert.equal(pending.length, 1, 'the installed Vercel adapter registers invocation work');
  let settled = false;
  void pending[0].then(() => { settled = true; });
  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(settled, false, 'retain the adapter grace period beyond driver idle expiry');
  t.mock.timers.tick(100);
  await pending[0];
  assert.equal(settled, true);
  await client.close();
});

test('a client without idle retirement does not claim suspension cleanup', async () => {
  const { MongoClient } = await getMongoDb();
  const client = new MongoClient('mongodb://127.0.0.1:1', { maxIdleTimeMS: 0 });
  assert.equal(client.listenerCount('connectionCheckedOut'), 0);
  await client.close();
});
