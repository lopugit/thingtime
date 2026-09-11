import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TT_TRANSFER_TEST_URL;
const cookie = process.env.TT_TRANSFER_TEST_COOKIE;

// Opt-in real API test. Only a local test server and disposable records;
// credentials stay in the environment, never in assertions or test output.
test('real import preserves private folders, schema provenance, extended data and executable app references', { skip: !base || !cookie }, async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
  const request = async (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const response = await fetch(new URL(path, base), { method,
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie! } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000) });
    return { status: response.status, data: await response.json() };
  };
  const me = await request('/api/v1/auth/me');
  assert.equal(me.status, 200);
  assert.ok(me.data.user?.id, 'Test session must be signed in');
  const label = `transfer-fixture-${randomUUID()}`;
  const manifest = { format: 'thingtime.transfer', version: 1, roots: ['folder'], files: [], things: [
    { id: 'data', thingtime: ['data'], folderId: 'folder', crystal: { schemaId: 'schema', message: 'kept' }, extended: { portable: true } },
    { id: 'schema', thingtime: ['schema'], folderId: 'folder', crystal: { name: label, fields: [{ name: 'message', type: 'string' }] } },
    { id: 'folder', thingtime: ['folder'], crystal: { name: label } },
    { id: 'action', thingtime: ['action'], folderId: 'folder', crystal: { name: label, actionKey: label, version: 1, capabilities: [], steps: [{ op: 'return', value: 'transfer-ok' }] } },
    { id: 'component', thingtime: ['component'], folderId: 'folder', crystal: { name: label, componentKey: label, version: 1, render: { tag: 'button', ttAction: 'action', children: ['Run'] } } },
    { id: 'page', thingtime: ['webpage'], folderId: 'folder', crystal: { name: label, blocks: [{ id: 'button', type: 'component', component: 'component' }] } }
  ] };
  let ids: Record<string, string> = {};
  try {
    const imported = await request('/api/v1/things/import', 'POST', { manifest });
    if (imported.data.ids) ids = imported.data.ids;
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.imported, 6);
    assert.equal(new Set(Object.values(ids)).size, 6);
    const docs: Record<string, any> = {};
    for (const [original, id] of Object.entries(ids)) {
      assert.notEqual(id, original);
      const read = await request(`/api/v1/things?id=${id}`);
      assert.equal(read.status, 200, JSON.stringify(read.data));
      docs[original] = read.data.thing;
      assert.equal(read.data.thing.author.id, me.data.user.id);
      assert.deepEqual(read.data.thing.acl, ['tt:user']);
      assert.equal((await request(`/api/v1/things?id=${id}`, 'GET', undefined, false)).status, 404);
    }
    assert.equal(docs.data.folderId, ids.folder);
    assert.equal(docs.data.crystal.schemaId, ids.schema);
    assert.deepEqual(docs.data.extended, { portable: true });
    assert.equal(docs.component.crystal.render.ttAction, ids.action);
    assert.equal(docs.page.crystal.blocks[0].component, ids.component);
    const run = await request('/api/v1/actions/run', 'POST', { action: ids.action, source: 'component' });
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.equal(run.data.result, 'transfer-ok');
  } finally {
    // Dependency order, then the enclosing folder. Only IDs returned for this
    // invocation are eligible; never delete source manifest IDs or other data.
    const failures: string[] = [];
    for (const key of ['page', 'component', 'action', 'data', 'schema', 'folder']) {
      if (!ids[key]) continue;
      try {
        const removed = await request('/api/v1/things', 'DELETE', { id: ids[key] });
        if (![200, 404].includes(removed.status) || (await request(`/api/v1/things?id=${ids[key]}`)).status !== 404) failures.push(key);
      } catch { failures.push(key); }
    }
    assert.deepEqual(failures, [], 'Disposable import cleanup failed');
  }
});
