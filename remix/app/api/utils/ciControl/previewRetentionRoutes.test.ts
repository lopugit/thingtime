import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createPreviewRetentionHandlers } from '../../../routes/api/v1/admin/ci/preview-retention/_preview-retention';
import { createControllerPreviewRetentionHandler } from '../../../routes/api/v1/integrations/ci/preview-retention/_preview-retention';
import { DEFAULT_PREVIEW_RETENTION, PreviewRetentionConflict, parsePreviewRetentionPolicy } from './previewRetentionCore';
const url = 'https://thingtime.test/api/v1/admin/ci/preview-retention';
const request = (body: unknown) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const saved = { policy: DEFAULT_PREVIEW_RETENTION, revision: null };
const allowed = async () => ({ user: { id: 'admin' } } as any);
test('admin settings refuse anonymous/non-admin reads and writes and mark responses private', async () => {
  for (const status of [401, 403]) {
    let touched = false;
    const handlers = createPreviewRetentionHandlers({ requireAdmin: async () => ({ error: { status, message: 'Forbidden' } }), get: async () => { touched = true; return saved; }, set: async () => { touched = true; return saved; } });
    for (const response of [await handlers.loader({ request: new Request(url) }), await handlers.action({ request: request({ policy: DEFAULT_PREVIEW_RETENTION, expectedRevision: null }) })]) {
      assert.equal(response.status, status); assert.match(response.headers.get('cache-control')!, /private.*no-store/);
    }
    assert.equal(touched, false);
  }
});
test('admin writes preserve actor and expected revision, report conflicts and fail storage closed', async () => {
  let received: unknown;
  const handlers = createPreviewRetentionHandlers({ requireAdmin: allowed, get: async () => saved, set: async (...args) => { received = args; return { ...saved, revision: 'new' }; } });
  const response = await handlers.action({ request: request({ policy: DEFAULT_PREVIEW_RETENTION, expectedRevision: 'old' }) });
  assert.equal(response.status, 200); assert.deepEqual(received, [DEFAULT_PREVIEW_RETENTION, 'old', 'admin']);
  const deps = { requireAdmin: allowed, get: async () => { throw new Error('mongodb://private'); }, set: async () => { throw new PreviewRetentionConflict(); } };
  const failed = createPreviewRetentionHandlers(deps);
  assert.equal((await failed.action({ request: request({ policy: DEFAULT_PREVIEW_RETENTION, expectedRevision: null }) })).status, 409);
  const read = await failed.loader({ request: new Request(url) });
  assert.equal(read.status, 503); assert.equal((await read.text()).includes('mongodb://private'), false);
});
test('a stored policy this deployment cannot validate reads as unavailable, never as a form error', async () => {
  // A newer deployment may save a version this one rejects; the admin must see
  // the fail-closed message, not a 400 asking them to fix their own input.
  const handlers = createPreviewRetentionHandlers({ requireAdmin: allowed,
    // Both stubs validate exactly where the real storage layer does.
    get: async () => ({ policy: parsePreviewRetentionPolicy({ ...DEFAULT_PREVIEW_RETENTION, version: 2 }), revision: 'stored' }),
    set: async (value) => ({ policy: parsePreviewRetentionPolicy(value), revision: 'written' }) });
  const read = await handlers.loader({ request: new Request(url) });
  assert.equal(read.status, 503);
  const body = await read.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /unavailable\. Cleanup must preserve deployments/);
  assert.equal(/grace hours/.test(body.error), false);
  // A policy the caller submits is still their own 400 to correct.
  const written = await handlers.action({ request: request({ policy: { ...DEFAULT_PREVIEW_RETENTION, noOpenPrGraceHours: -1 }, expectedRevision: null }) });
  assert.equal(written.status, 400);
  assert.match((await written.json()).error, /grace hours/);
});
test('signed controller route refuses unsigned, wrong-repo and stale requests, and never exposes revisions', async () => {
  const secret = 'synthetic-test-router-secret';
  let reads = 0;
  const handler = createControllerPreviewRetentionHandler({ get: async () => { reads++; return { ...saved, revision: 'private-revision' }; }, secret: () => secret, repository: () => 'lopugit/thingtime' });
  const signed = (body: any, valid = true) => {
    const raw = JSON.stringify(body);
    const signature = 'sha256=' + createHmac('sha256', valid ? secret : 'wrong').update(raw).digest('hex');
    return new Request(url, { method: 'POST', headers: { 'x-thingtime-ci-signature': signature }, body: raw });
  };
  const body = { repository: 'lopugit/thingtime', ref: 'github-actions', requestedAt: new Date().toISOString() };
  assert.equal((await handler({ request: signed(body, false) })).status, 403);
  assert.equal((await handler({ request: signed({ ...body, repository: 'attacker/fork' }) })).status, 400);
  assert.equal((await handler({ request: signed({ ...body, requestedAt: '2000-01-01T00:00:00Z' }) })).status, 400);
  assert.equal(reads, 0);
  const response = await handler({ request: signed(body) });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /private.*no-store/);
  assert.deepEqual(await response.json(), { ok: true, repository: body.repository, policy: DEFAULT_PREVIEW_RETENTION });
  const unavailable = createControllerPreviewRetentionHandler({ get: async () => { throw new Error('secret'); }, secret: () => secret, repository: () => body.repository });
  assert.equal((await unavailable({ request: signed(body) })).status, 503);
});

test('cookie-authenticated writes refuse safelisted form content types before the setter', async () => {
  let writes = 0;
  const handlers = createPreviewRetentionHandlers({ requireAdmin: allowed, get: async () => saved, set: async () => { writes++; return saved; } });
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    const response = await handlers.action({ request: new Request(url, { method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify({ policy: DEFAULT_PREVIEW_RETENTION, expectedRevision: null }) }) });
    assert.equal(response.status, 415);
  }
  assert.equal(writes, 0);
});
test('unsigned chunked requests are bounded and cancelled before policy storage', async () => {
  let cancelled = false, reads = 0;
  const handler = createControllerPreviewRetentionHandler({ get: async () => { reads++; return saved; }, secret: () => 'synthetic', repository: () => 'lopugit/thingtime' });
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(2048)); }, cancel() { cancelled = true; } });
  const response = await handler({ request: new Request(url, { method: 'POST', body: stream, duplex: 'half' } as any) });
  assert.equal(response.status, 413); assert.equal(cancelled, true); assert.equal(reads, 0);
});
