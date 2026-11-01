import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopOperationGate } from './desktopOperationGate';
import { legacyDeviceSettingsDocument, localSettingsDocumentAdapter, settingsDocumentBlocks, settingsDocumentKey, settingsDocumentSeed } from './settingsDocument';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { accountSettingsDocumentAdapter } from './settingsDocument.client';
import { DESKTOP_CONNECTION_BLOCKS, DESKTOP_RECOVERY_BLOCKS } from './desktopSettingsDocuments';
import { syncConflictReviewBlocks } from '../Devices/syncConflictReviewBlocks';

const scope = { origin: 'https://settings.example.test', ownerId: 'owner', dataPlane: 'home', documentKey: 'desktop-connection' };
const document = { name: 'Layout', blocks: [{ id: 'title', type: 'element' as const, tag: 'p', text: 'Private settings' }], revision: null };
const signal = () => new AbortController().signal;
const features = { 'api.things': { version: '1.36.0' }, 'api.webpages-resolve': { version: '1.6.0' }, 'api.actions-run': { version: '1.7.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } };
const page = (id = 'settings-layout-1', overrides = {}) => ({ id, author: { id: scope.ownerId }, updatedAt: '2026-10-19T00:00:00Z', crystal: { name: document.name, blocks: document.blocks, pageKey: `settings-${scope.documentKey}` }, ...overrides });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function localFixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let tail = Promise.resolve();
  const locks = { request(_key: string, _options: unknown, operation: () => unknown) {
    const next = tail.then(operation); tail = next.then(() => {}, () => {}); return next;
  } } as unknown as Pick<LockManager, 'request'>;
  let revision = 0;
  return { values, storage, locks, adapter: () => localSettingsDocumentAdapter(scope, storage, locks, () => `r${++revision}`) };
}

test('authored desktop and recovery documents survive canonical sanitization without private values', () => {
  for (const blocks of [DESKTOP_CONNECTION_BLOCKS, DESKTOP_RECOVERY_BLOCKS, syncConflictReviewBlocks]) {
    const saved = settingsDocumentBlocks(blocks);
    assert.deepEqual(settingsDocumentBlocks(saved), saved);
    assert.ok(JSON.stringify(saved).includes(blocks === syncConflictReviewBlocks ? '$transient' : 'runtime.save'));
    assert.ok(!JSON.stringify(saved).includes('mongodb://user:password'));
  }
});

test('sensitive layouts refuse autoloads, native slots, opaque markup and persisted private input values', () => {
  const unsafe = [
    { id: 'x', type: 'html', html: '<tt-service-workspace />' },
    { id: 'x', type: 'native', slot: 'service-workspace' },
    { id: 'x', type: 'component', component: 'secret' },
    { ...document.blocks[0], source: { action: 'load-secret' } },
    { id: 'x', type: 'element', tag: 'tt-service-workspace' },
    { id: 'x', type: 'text', html: '<tt-service-workspace />' },
    { id: 'x', type: 'collection', props: { source: { action: 'secret' } } },
    { id: 'x', type: 'element', tag: 'input', props: { type: 'password', value: 'synthetic-only' } },
    { id: 'x', type: 'element', tag: 'input', props: { type: 'file', defaultValue: 'synthetic-only' } }
  ];
  for (const block of unsafe) assert.throws(() => settingsDocumentBlocks([{ id: 'outer', type: 'container', children: [block] }]));
});

test('offline adapter separates every authority and fences concurrent cross-tab saves', async () => {
  const fixture = localFixture(), first = fixture.adapter(), second = fixture.adapter();
  for (const changed of [{ origin: 'https://other.example.test' }, { ownerId: 'other' }, { dataPlane: 'other' }])
    assert.notEqual(settingsDocumentKey(scope), settingsDocumentKey({ ...scope, ...changed }));
  const outcomes = await Promise.allSettled([first.save(document, signal()), second.save(document, signal())]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
  const stored = await second.load(signal());
  assert.equal(stored?.revision, 'r1');
  assert.deepEqual(stored?.blocks, document.blocks);
  await assert.rejects(second.save(document, signal()), /another window/);
  const aborted = AbortSignal.abort();
  await assert.rejects(second.save(stored!, aborted));
  assert.equal((await first.load(signal()))?.revision, 'r1');
  await assert.rejects(localSettingsDocumentAdapter(scope, fixture.storage, undefined).save(stored!, signal()), /cannot safely save/);
});

test('account reads negotiate exact origin and preserve owner/data-plane fences', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const adapter = accountSettingsDocumentAdapter(scope, { fetch: async (input, init) => {
    const url = String(input); calls.push({ url, init });
    return url.includes('.well-known') ? response({ schemaVersion: 1, origin: scope.origin, features }) : response({ ok: true, source: 'user', page: page() });
  } });
  assert.equal((await adapter.load(signal()))?.id, 'settings-layout-1');
  assert.ok(calls.every(call => call.url.startsWith(`${scope.origin}/`)));
  const headers = new Headers(calls[1].init?.headers);
  assert.equal(headers.get('X-Thingtime-Expected-Actor'), scope.ownerId);
  assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), scope.dataPlane);
  assert.equal(calls[1].init?.redirect, 'error');
  for (const bad of [page('x', { author: { id: 'other' } }), page('x', { crystal: { ...page().crystal, pageKey: 'other' } })]) {
    const wrong = accountSettingsDocumentAdapter(scope, { fetch: async input => String(input).includes('.well-known') ? response({ schemaVersion: 1, origin: scope.origin, features }) : response({ ok: true, source: 'user', page: bad }) });
    await assert.rejects(wrong.load(signal()), /does not belong/);
  }
});

test('wrong-origin and old capability manifests fail before any account document request', async () => {
  for (const manifest of [{ schemaVersion: 1, origin: 'https://other.example.test', features }, { schemaVersion: 1, origin: scope.origin, features: { ...features, 'api.things': { version: '1.34.0' } } }]) {
    let calls = 0;
    const adapter = accountSettingsDocumentAdapter(scope, { fetch: async () => { calls++; return response(manifest); } });
    await assert.rejects(adapter.save(document, signal()), /does not support/);
    assert.equal(calls, 1);
  }
});

test('uncertain creates retry the same identity and recover only identical committed content', async () => {
  let committed: ReturnType<typeof page> | null = null;
  const ids: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('.well-known')) return response({ schemaVersion: 1, origin: scope.origin, features });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); ids.push(body.shareId);
      if (!committed) { committed = page(body.shareId); throw new Error('synthetic lost response'); }
      return response({ ok: false }, 409);
    }
    return response({ ok: true, source: 'user', page: committed });
  };
  const first = await accountSettingsDocumentAdapter(scope, { fetch: fetcher }).save(document, signal());
  const again = await accountSettingsDocumentAdapter(scope, { fetch: fetcher }).save(document, signal());
  assert.equal(first.id, again.id); assert.equal(ids[0], ids[1]);
  committed = page(first.id, { crystal: { ...page().crystal, name: 'Changed elsewhere' } });
  await assert.rejects(accountSettingsDocumentAdapter(scope, { fetch: fetcher }).save(document, signal()), /changed/);
});

test('updates retain revision CAS and refuse changed-session conflicts', async () => {
  let body: any;
  const adapter = accountSettingsDocumentAdapter(scope, { fetch: async (input, init) => {
    if (String(input).includes('.well-known')) return response({ schemaVersion: 1, origin: scope.origin, features });
    if (init?.method === 'PATCH') { body = JSON.parse(String(init.body)); return response({ ok: false }, 409); }
    return response({ ok: false }, 403);
  } });
  await assert.rejects(adapter.save({ ...document, id: 'existing', revision: 'before' }, signal()), /changed/);
  assert.equal(body.expectedUpdatedAt, 'before');
  await assert.rejects(adapter.save({ ...document, id: 'existing' }, signal()), /Reload/);
});

test('remote endpoints require the existing same-origin proxy and scope changes stop writes', async () => {
  let current = scope.origin, calls = 0;
  const dependencies = { currentOrigin: () => current, fetch: async () => {
    calls++; current = 'https://other.example.test';
    return response({ schemaVersion: 1, origin: scope.origin, features });
  } };
  const adapter = accountSettingsDocumentAdapter(scope, dependencies);
  await assert.rejects(adapter.save(document, signal()), /origin changed/);
  assert.equal(calls, 1);
  assert.throws(() => accountSettingsDocumentAdapter(scope, dependencies), /origin changed/);
});

test('changing native authority releases old busy state without allowing stale completion to unlock new work', () => {
  const gate = createDesktopOperationGate(); gate.setScope('first');
  const old = gate.begin('first')!; assert.ok(old); assert.equal(gate.busy, true);
  assert.equal(gate.begin('first'), null);
  gate.setScope('second'); assert.equal(gate.busy, false);
  assert.equal(gate.begin('first'), null);
  const current = gate.begin('second')!;
  assert.equal(gate.finish(old), false); assert.equal(gate.busy, true);
  assert.equal(gate.finish(current), true); assert.equal(gate.busy, false);
});

test('legacy device menu import preserves authored blocks but never imports identity or another authority', () => {
 const menuScope = { ...scope, documentKey: 'custom-drawer-menu' };
 const legacyScope = { ...menuScope, ownerId: 'device', dataPlane: `${scope.origin}:${scope.ownerId}:${scope.dataPlane}` };
 const values = new Map([[settingsDocumentKey(legacyScope), JSON.stringify({ ...document, id: 'device-only', revision: 'local-revision' })]]);
 const storage = { getItem: (key: string) => values.get(key) ?? null };
 assert.deepEqual(legacyDeviceSettingsDocument(menuScope, storage), document);
 for (const change of [{ ownerId: 'other' }, { origin: 'https://other.example.test' }, { dataPlane: 'other' }, { ownerId: 'anonymous' }])
  assert.equal(legacyDeviceSettingsDocument({ ...menuScope, ...change }, storage), null);
 assert.equal(values.size, 1);
 assert.equal(JSON.parse(values.get(settingsDocumentKey(legacyScope))!).revision, 'local-revision');
});

test('first paint seeds scoped authored legacy blocks without borrowing local write authority', () => {
 const legacy = { ...document, name: 'Authored menu', revision: 'local-revision', id: 'local-only' };
 const defaults = [{ id: 'default', type: 'element' as const, tag: 'span', text: 'Default' }];
 assert.deepEqual(settingsDocumentSeed(defaults, 'Default menu', null, () => legacy), { ...document, name: 'Authored menu' });
 const cached = { ...document, id: 'account-thing', revision: 'account-revision' };
 assert.deepEqual(settingsDocumentSeed(defaults, 'Default menu', cached, () => legacy), cached);
 assert.deepEqual(settingsDocumentSeed(defaults, 'Default menu', { invalid: true }, () => { throw new Error('invalid legacy'); }), { blocks: defaults, name: 'Default menu', revision: null });
});

test('different UI/API origins use the existing authenticated same-origin proxy for private layout load/save', async () => {
  const uiOrigin = 'https://desktop.example.test';
  const selected = { ...scope, dataPlane: `custom-${'a'.repeat(64)}` };
  let current = true;
  const calls: { url: string; init?: RequestInit }[] = [];
  const controller = new AbortController();
  const transport = createFolderHostFetch({ origin: selected.origin, localOrigin: uiOrigin, ownerId: selected.ownerId,
    expectedDataPlane: selected.dataPlane, signal: controller.signal,
    check: () => { if (!current) throw new Error('Changed selected origin'); },
    fetch: async (target, init) => {
      calls.push({ url: String(target), init });
      if (String(target).includes('.well-known')) return response({ schemaVersion: 1, origin: selected.origin, features });
      const result = Response.json(init?.method === 'PATCH' ? { ok: true, thing: page('settings-layout-1', { updatedAt: 'after' }) } : { ok: true, source: 'user', page: page() });
      result.headers.set('x-thingtime-api-fallback', selected.origin); return result;
    }
  });
  const adapter = accountSettingsDocumentAdapter(selected, { fetch: transport, currentOrigin: () => selected.origin });
  const loaded = await adapter.load(signal());
  await adapter.save(loaded!, signal());
  const privateCalls = calls.filter(call => !call.url.includes('.well-known'));
  assert.equal(privateCalls.length, 2);
  assert.ok(privateCalls.every(call => call.url.startsWith(uiOrigin + '/api/v1/')));
  assert.ok(privateCalls.every(call => call.init?.credentials === 'same-origin'));
  for (const call of privateCalls) {
    const headers = new Headers(call.init?.headers);
    assert.equal(headers.get('x-thingtime-expected-actor'), selected.ownerId);
    assert.equal(headers.get('x-thingtime-expected-data-plane'), selected.dataPlane);
    assert.equal(headers.get('x-thingtime-expected-api-origin'), selected.origin);
  }
  await assert.rejects(transport(selected.origin + '/api/v1/things', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'X-Thingtime-Expected-Actor': selected.ownerId, 'X-Thingtime-Expected-Data-Plane': 'wrong-plane' } }));
  current = false;
  await assert.rejects(adapter.save(loaded!, signal()), /Changed selected origin/);
  assert.equal(privateCalls.length, 2);
});
