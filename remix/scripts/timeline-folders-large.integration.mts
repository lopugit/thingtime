// Opt-in disposable replica only. Every fixture and mutation uses the real API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(`${base}/api/v1/mongodb/status`).then(response => response.json());
assert.equal(status.host, '127.0.0.1:20337'); assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false); assert.equal(status.connected, true);
let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base!, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() };
}
const username = `timeline-large-${randomUUID().slice(0, 8)}`;
const password = `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registered.data.ok, true);
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registered.data.user.id;
const query = `ownerId=${encodeURIComponent(ownerId)}&dataPlane=home`;
const history = async (id: string) => {
  const result = await call(`/api/v1/timeline?${query}&thingId=${encodeURIComponent(id)}`);
  assert.equal(result.data.ok, true); return result.data.entries;
};
const read = async (id: string) => {
  const result = await call(`/api/v1/things?id=${encodeURIComponent(id)}`);
  assert.equal(result.data.ok, true, result.data.error); return result.data.thing;
};
const create = async (kind: string, folderId: string | null = null) => {
  const result = await call('/api/v1/things', { thingtime: [kind], crystal: { name: `Folder history ${kind}`, value: 'Original' }, folderId, visibility: 'private' });
  assert.equal(result.data.ok, true, result.data.error); return result.data.thing;
};
const remove = async (id: string) => {
  const result = await call('/api/v1/things', { id }, 'DELETE');
  assert.equal(result.data.ok, true, result.data.error);
};
const version = (body: unknown) => call(`/api/v1/timeline?${query}`, body);

// Bulk copies exercise the ordinary API's supported batch path under its
// normal request quota; no database seeding or test quota override is used.
const parent = await create('folder');
const folder = await create('folder', parent.id);
const seed = await create('data', folder.id);
const children = [seed.id];
while (children.length < 105) {
  const ids = children.slice(0, Math.min(children.length, 105 - children.length));
  const result = await call('/api/v1/things/bulk', { op: 'copy', ids, folderId: folder.id });
  assert.equal(result.data.ok, true, result.data.error);
  assert.equal(result.data.succeeded, ids.length, JSON.stringify(result.data));
  children.push(...result.data.results.map((item: any) => item.newId));
}
assert.equal(new Set(children).size, 105);
await remove(folder.id);
assert.equal((await call(`/api/v1/things?id=${folder.id}`)).response.status, 404);
const deletion = (await history(folder.id))[0].event;
for (const id of children) {
  assert.equal((await read(id)).folderId, parent.id, 'Every child survives across drain batches');
  const events = await history(id);
  assert.equal(events.length, 2, 'Exactly one move follows creation, including the second batch');
  assert.equal(events[0].event.after.adapter, 'folder-placement');
  assert.equal(events[0].event.operationId, deletion.operationId);
}
// Compact versions must walk through several placement ancestors without
// borrowing content from the current Thing, which may have changed meanwhile.
const destination = await create('folder');
const edited = await call('/api/v1/things', { id: seed.id, crystal: { value: 'Saved before several moves' } }, 'PATCH');
assert.equal(edited.data.ok, true, edited.data.error);
for (const folderId of [destination.id, null, parent.id, destination.id]) {
  const result = await call('/api/v1/things', { id: seed.id, folderId }, 'PATCH');
  assert.equal(result.data.ok, true, result.data.error);
}
const placement = (await history(seed.id))[0].event;
assert.equal(placement.after.adapter, 'folder-placement');
assert.equal(placement.label, 'Moved Thing');
assert.equal((await call('/api/v1/things', { id: seed.id, crystal: { value: 'Content written later' } }, 'PATCH')).data.ok, true);
const preview = await version({ command: 'preview-version', mode: 'restore', eventId: placement.id });
assert.equal(preview.data.ok, true, preview.data.error);
assert.equal(preview.data.preview.result.value.crystal.value, 'Saved before several moves');
assert.equal(preview.data.preview.result.value.folderId, destination.id);
const restore = { command: 'apply-version', mode: 'restore', eventId: placement.id, expectedHeadId: preview.data.preview.expectedHeadId, operationId: randomUUID() };
const result = await version(restore);
assert.equal(result.data.ok, true, result.data.error);
assert.deepEqual((await version(restore)).data, result.data);
assert.equal((await read(seed.id)).crystal.value, 'Saved before several moves');
const merge = await version({ command: 'preview-version', mode: 'merge', eventId: placement.id });
assert.equal(merge.data.ok, true, merge.data.error);
assert.equal(merge.data.preview.baseEventId, placement.id);
assert.deepEqual(merge.data.preview.conflicts, []);
assert.deepEqual(merge.data.preview.result.value, merge.data.preview.current.value);
console.log(JSON.stringify({ ok: true, checks: ['105-child-transactional-drain', 'one-operation-across-batches', 'no-duplicate-child-events', 'four-consecutive-placement-ancestors', 'historical-content-restore-and-retry', 'compact-placement-merge-base'], children: children.length }));
