import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwnedListClient, ownedProfileImportMinimumVersion, type OwnedListScope } from './ownedListClient';
const row = (id: number) => ({ id: `profile-${id}` });
function fixture(resource: 'themes' | 'algorithms' = 'themes') {
 let current: OwnedListScope = { actor: 'owner', dataPlane: null, generation: 1, pending: false };
 const requests: any[] = [], capabilities: string[][] = [], pages: any[] = [];
 let after = () => {};
 const client = createOwnedListClient({ resource, minimumVersion: resource === 'themes' ? '1.3.0' : '1.2.0',
  scope: () => current, requireCapability: async (...args) => { capabilities.push(args); },
  request: async (url, options) => { requests.push({ url, options }); const result = pages.shift(); after(); if (result instanceof Error) throw result; return result; } });
 return { client, pages, requests, capabilities, change: (next: Partial<OwnedListScope>) => { current = { ...current, ...next }; }, after: (fn: () => void) => { after = fn; } };
}
for (const resource of ['themes', 'algorithms'] as const) test(`${resource} drains 192 profiles, deduplicates and pins actor without selected database`, async () => {
 const f = fixture(resource), metadata = resource === 'algorithms' ? { activeAlgorithmId: 'profile-100' } : {};
 for (let start = 0; start < 192; start += 63) f.pages.push({ ok: true, ...metadata, [resource]: Array.from({ length: Math.min(63, 192 - start) }, (_, n) => row(start + n)), nextCursor: start < 189 ? `cursor-${start}` : null });
 f.pages[1][resource].unshift(row(62));
 const result = await f.client.list();
 assert.equal(result[resource].length, 192); assert.equal(result.nextCursor, null);
 assert.equal(result.activeAlgorithmId, metadata.activeAlgorithmId);
 assert.equal(f.requests.length, 4); assert.equal(f.requests[0].url, `/api/v1/${resource}?page=1`);
 assert.equal(f.requests[1].url, `/api/v1/${resource}?page=1&cursor=cursor-0`);
 assert.equal(f.requests[0].options.expectedActor, 'owner'); assert.equal(f.requests[0].options.expectedDataPlane, null);
 assert.deepEqual(f.capabilities[0], [`api.${resource}`, resource === 'themes' ? '1.3.0' : '1.2.0']);
});
test('listPage preserves metadata and scoped options', async () => {
 const f = fixture('algorithms'), controller = new AbortController();
 const page = { ok: true, algorithms: [row(1)], nextCursor: 'next', activeAlgorithmId: 'profile-1' }; f.pages.push(page);
 assert.deepEqual(await f.client.listPage({ cursor: 'opaque +/=' }, { signal: controller.signal, expectedActor: 'character', expectedDataPlane: 'home' }), page);
 assert.equal(new URL(f.requests[0].url, 'https://example.test').searchParams.get('cursor'), 'opaque +/=');
 assert.equal(f.requests[0].options.signal, controller.signal); assert.equal(f.requests[0].options.expectedActor, 'character'); assert.equal(f.requests[0].options.expectedDataPlane, 'home');
});
for (const failure of [undefined, { ok: false, themes: [], nextCursor: null }, { ok: true, themes: [], nextCursor: 3 }, new Error('tail failed')]) test('invalid or failed later page rejects complete listing', async () => {
 const f = fixture(); f.pages.push({ ok: true, themes: [row(1)], nextCursor: 'next' }, failure); await assert.rejects(f.client.list());
});
test('repeated cursor rejects without looping', async () => {
 const f = fixture(); f.pages.push({ ok: true, themes: [row(1)], nextCursor: 'next' }, { ok: true, themes: [row(2)], nextCursor: 'next' });
 await assert.rejects(f.client.list(), /non-progressing/); assert.equal(f.requests.length, 2);
});
for (const resource of ['themes', 'algorithms'] as const) test(`${resource} continues through empty and duplicate-only windows with advancing cursors`, async () => {
 const f = fixture(resource), metadata = resource === 'algorithms' ? { activeAlgorithmId: 'profile-1' } : {};
 f.pages.push(
  { ok: true, ...metadata, [resource]: [], nextCursor: 'suppressed-first' },
  { ok: true, ...metadata, [resource]: [row(1)], nextCursor: 'second' },
  { ok: true, ...metadata, [resource]: [], nextCursor: 'suppressed-middle' },
  { ok: true, ...metadata, [resource]: [row(1)], nextCursor: 'duplicate-live-observation' },
  { ok: true, ...metadata, [resource]: [row(2)], nextCursor: null });
 const result = await f.client.list(); assert.deepEqual(result[resource], [row(1), row(2)]); assert.equal(f.requests.length, 5);
});
for (const resource of ['themes', 'algorithms'] as const) test(`${resource} rejects oversized transport pages`, async () => {
 const f = fixture(resource); f.pages.push({ ok: true, [resource]: Array.from({ length: 65 }, (_, id) => row(id)), nextCursor: null, activeAlgorithmId: null });
 await assert.rejects(f.client.list(), /invalid/);
});
test('cancellation rejects after transport and prevents next page', async () => {
 const f = fixture(), controller = new AbortController(); f.pages.push({ ok: true, themes: [row(1)], nextCursor: 'next' }); f.after(() => controller.abort());
 await assert.rejects(f.client.list(undefined, { signal: controller.signal }), { name: 'AbortError' }); assert.equal(f.requests.length, 1);
});
for (const changed of [{ actor: 'other' }, { dataPlane: 'other' }, { generation: 2 }, { pending: true }]) test(`scope change during transport rejects ${JSON.stringify(changed)}`, async () => {
 const f = fixture(); f.pages.push({ ok: true, themes: [row(1)], nextCursor: 'next' }); f.after(() => f.change(changed));
 await assert.rejects(f.client.list(), /account or database changed/); assert.equal(f.requests.length, 1);
});
test('old callbacks cannot begin after account switches', async () => {
 const f = fixture(); f.change({ actor: 'other' }); await assert.rejects(f.client.list(), /account or database changed/); assert.equal(f.requests.length, 0);
});
test('changed active selection refuses mixed snapshots', async () => {
 const f = fixture('algorithms'); f.pages.push({ ok: true, algorithms: [row(1)], nextCursor: 'next', activeAlgorithmId: 'profile-1' }, { ok: true, algorithms: [row(2)], nextCursor: null, activeAlgorithmId: 'profile-2' });
 await assert.rejects(f.client.list(), /active algorithm changed/);
});
test('empty catalogues and null selection complete', async () => {
 const f = fixture('algorithms'); const page = { ok: true, algorithms: [], nextCursor: null, activeAlgorithmId: null }; f.pages.push(page); assert.deepEqual(await f.client.list(), page);
});

test('only protected profile imports require the new capacity contract', () => {
 for (const kind of ['theme', 'feed-algorithm']) assert.equal(ownedProfileImportMinimumVersion({ things: [{ thingtime: [kind] }] }), '1.14.0');
 for (const manifest of [null, {}, { things: [{ thingtime: ['webpage'] }] }]) assert.equal(ownedProfileImportMinimumVersion(manifest), '1.13.0');
});
