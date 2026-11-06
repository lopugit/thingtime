import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
import { bundleFromPlan } from '../../../utils/thingTransfer/browser';
import { decodeTransferArchive, encodeTransferArchive } from '../../../utils/thingTransfer/archive';
import type { ThingTransfer } from '../../../utils/thingTransfer/format';
import { resolveTheme, THINGTIME_THEME } from '../../../theme/tokens';

test('real mixed library preserves content and remaps references through two ZIP imports', {
  skip: process.env.TT_TRANSFER_LIBRARY_TEST !== '1', timeout: 180_000
}, async () => {
  const origin = new URL(process.env.TT_TRANSFER_TEST_URL!);
  const cookie = process.env.TT_TRANSFER_TEST_COOKIE, username = process.env.TT_TRANSFER_TEST_USERNAME;
  assert.equal(process.env.TT_TRANSFER_REMOTE_DEV_TEST, '1'); assert.ok(cookie && username);
  assert.equal(origin.protocol, 'https:'); assert.equal(origin.pathname, '/');
  assert.equal(origin.username + origin.password + origin.port + origin.search + origin.hash, '');
  assert.ok(origin.hostname === 'dev.thingtime.com' || /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname));
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => fetch(new URL(path, origin), {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json', Origin: origin.origin, ...(authenticated ? { Cookie: cookie! } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = async (path: string, method = 'GET', body?: unknown) => {
    const response = await request(path, method, body), data = await response.json();
    assert.equal(response.status, 200, `${method} ${path.split('?')[0]} HTTP ${response.status}: ${data.error || ''}`);
    return data;
  };
  const capabilities = await json(THINGTIME_CAPABILITY_MANIFEST_PATH);
  assert.equal(capabilities.origin, origin.origin);
  for (const [feature, version] of Object.entries({ 'api.things-export': '1.12.0', 'api.things-import': '1.9.1',
    'api.things': '1.16.1', 'api.themes-delete': '1.0.0', 'api.algorithms-delete': '1.0.0' }))
    assert.ok(capabilitySatisfies(capabilities.features?.[feature]?.version, version), `Missing ${feature}; no fixture writes`);
  const me = (await json('/api/v1/auth/me')).user;
  assert.equal(me.username, username); assert.equal(me.accountKind, 'user');
  const marker = randomUUID().slice(0, 8);
  console.log(JSON.stringify({ libraryFixtureMarker: marker }));
  const manifest: ThingTransfer = { format: 'thingtime.transfer', version: 1, roots: ['folder'], files: [], things: [
    { id: 'folder', thingtime: ['folder'], crystal: { name: `Transfer library ${marker}` } },
    { id: 'schema', folderId: 'folder', thingtime: ['schema'], crystal: { name: `transfer-${marker}`, fields: [] } },
    { id: 'data', folderId: 'folder', thingtime: ['data'], crystal: { schemaId: 'schema', name: 'Nested data', text: 'Exact 🥰', nested: { enabled: false, values: [0, null, 'kept'] } }, extended: { custom: 42 } },
    { id: 'component', folderId: 'folder', thingtime: ['component'], crystal: { name: 'Transfer card', componentKey: `transfer-card-${marker}`, args: [{ name: 'label', type: 'string', default: 'Card' }], render: { tag: 'div', children: ['{label}'] } } },
    { id: 'page', folderId: 'folder', thingtime: ['webpage'], crystal: { name: 'Transfer page', pageKey: `transfer-page-${marker}`, blocks: [{ id: 'card', type: 'component', component: 'component', args: { label: 'Exact card 🥰' } }] } },
    { id: 'action', folderId: 'folder', thingtime: ['action'], crystal: { name: 'Transfer return', actionKey: `transfer-return-${marker}`, steps: [{ op: 'return', value: 'No execution' }] } },
    { id: 'post', folderId: 'folder', thingtime: ['post'], crystal: { type: 'text', text: 'Private post 🥰' } },
    { id: 'theme', folderId: 'folder', thingtime: ['theme'], crystal: { name: `Palette ${marker}`, theme: JSON.parse(JSON.stringify(resolveTheme(THINGTIME_THEME, { name: `Palette ${marker}`, colors: { accent: '#123456' } }))) } },
    { id: 'algorithm', folderId: 'folder', thingtime: ['feed-algorithm'], crystal: { name: `Weights ${marker}`, emoji: '🧠', weights: { types: { text: 4 }, tags: {}, authors: {} }, eventCount: 2, lastTrainedAt: null } }
  ] };
  const created: { id: string; kind: string }[] = [];
  const failures: unknown[] = [];
  const importBundle = async (source: ThingTransfer) => {
    console.log(JSON.stringify({ phase: 'import', rootNames: source.things.filter(row => source.roots.includes(row.id)).map(row => row.crystal.name) }));
    const response = await request('/api/v1/things/import', 'POST', { manifest: source });
    const result = await response.json();
    for (const thing of source.things) if (typeof result.ids?.[thing.id] === 'string') created.push({ id: result.ids[thing.id], kind: thing.thingtime[0] });
    if (result.remainingIds?.length) throw new Error(`Import requires cleanup of ${result.remainingIds.join(', ')}`);
    assert.equal(response.status, 200, `Import HTTP ${response.status}: ${result.error || ''}`);
    return result;
  };
  const exportBundle = async (root: string) => {
    console.log(JSON.stringify({ phase: 'export', root }));
    const result = await json('/api/v1/things/export', 'POST', { ids: [root] });
    return (await decodeTransferArchive(await encodeTransferArchive(await bundleFromPlan(result.plan)))).manifest;
  };
  const verify = (content: ThingTransfer, source: ThingTransfer, ids: Record<string, string>) => {
    assert.equal(content.things.length, 9); assert.equal(content.files.length, 0);
    const row = (id: string) => content.things.find(thing => thing.id === ids[id])!;
    for (const thing of source.things) {
      assert.ok(row(thing.id), `Missing ${thing.thingtime[0]}`);
      assert.notEqual(ids[thing.id], thing.id);
      assert.deepEqual(row(thing.id).thingtime, thing.thingtime);
      if (thing.folderId) assert.equal(row(thing.id).folderId, ids[thing.folderId]);
    }
    const sourceKind = (kind: string) => source.things.find(thing => thing.thingtime[0] === kind)!;
    const data = row(sourceKind('data').id), page = row(sourceKind('webpage').id);
    assert.equal(data.crystal.schemaId, ids[sourceKind('schema').id]);
    assert.deepEqual(data.crystal.nested, sourceKind('data').crystal.nested);
    assert.deepEqual(data.extended, { custom: 42 });
    assert.equal((page.crystal.blocks as any[])[0].component, ids[sourceKind('component').id]);
    assert.deepEqual((page.crystal.blocks as any[])[0].args, { label: 'Exact card 🥰' });
    for (const [kind, field] of [['theme', 'theme'], ['feed-algorithm', 'weights'], ['action', 'steps'], ['post', 'text'], ['component', 'render']])
      assert.deepEqual(row(sourceKind(kind).id).crystal[field], sourceKind(kind).crystal[field]);
    assert.doesNotMatch(JSON.stringify(content), /"(?:ownerId|userId|acl|tokenAcl|secure|linkKey)"/);
  };
  try {
    const first = await importBundle(manifest), exported = await exportBundle(first.ids.folder);
    verify(exported, manifest, first.ids);
    const second = await importBundle(exported), copied = await exportBundle(second.ids[first.ids.folder]);
    verify(copied, exported, second.ids);
    assert.equal(new Set(created.map(row => row.id)).size, 18);
    for (const id of [first.ids.folder, second.ids[first.ids.folder]]) {
      const denied = await request('/api/v1/things/export', 'POST', { ids: [id] }, false);
      assert.ok([401, 403, 404].includes(denied.status));
    }
    console.log(JSON.stringify({ mixedLibraryZipRoundTrip: true, nineKinds: true, copyOfCopyReferences: true }));
  } catch (error) { failures.push(error); }
  finally {
    // Reverse order keeps children before their folders and data before schema.
    for (const { id, kind } of created.reverse()) try {
      const endpoint = kind === 'theme' ? '/api/v1/themes/delete' : kind === 'feed-algorithm' ? '/api/v1/algorithms/delete' : '/api/v1/things';
      const response = await request(endpoint, endpoint === '/api/v1/things' ? 'DELETE' : 'POST', { id });
      assert.ok([200, 404].includes(response.status), `Cleanup ${kind} ${id}: ${response.status}`);
      assert.equal((await request(`/api/v1/things?id=${encodeURIComponent(id)}`)).status, 404);
    } catch (error) { failures.push(error); }
    if (failures.length) throw Object.assign(new Error('Mixed library acceptance or cleanup failed'), { errors: failures });
    console.log(JSON.stringify({ mixedLibraryCleanup: true, removed: created.length }));
  }
});
