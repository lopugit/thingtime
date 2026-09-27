// Opt-in disposable replica only. Every fixture and mutation uses the real API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

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
const username = `timeline-folders-${randomUUID().slice(0, 8)}`;
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

const grandparent = await create('folder');
const folder = await create('folder', grandparent.id);
const child = await create('data', folder.id);
const nested = await create('folder', folder.id);
const grandchild = await create('data', nested.id);
const initial = (await history(child.id))[0].event;
await remove(folder.id);
assert.equal((await read(child.id)).folderId, grandparent.id);
assert.equal((await read(nested.id)).folderId, grandparent.id);
assert.equal((await read(grandchild.id)).folderId, nested.id);
assert.equal((await call(`/api/v1/things?id=${folder.id}`)).response.status, 404);
const moved = (await history(child.id))[0].event;
assert.equal((await history(child.id)).length, 2);
assert.equal(moved.after.adapter, 'folder-placement');
assert.deepEqual(moved.before.value, { folderId: folder.id });
assert.deepEqual(moved.after.value, { folderId: grandparent.id });
assert.deepEqual(moved.parentIds, [initial.id]);
assert.equal((await history(nested.id))[0].event.operationId, moved.operationId);
assert.equal((await history(folder.id))[0].event.operationId, moved.operationId);
assert.equal(JSON.stringify(await read(grandparent.id)).includes('folderMutationToken'), false);

const destination = await create('folder');
assert.equal((await call('/api/v1/things', { id: child.id, crystal: { value: 'At placement' } }, 'PATCH')).data.ok, true);
assert.equal((await call('/api/v1/things', { id: child.id, folderId: destination.id }, 'PATCH')).data.ok, true);
const placement = (await history(child.id))[0].event;
assert.equal(placement.after.adapter, 'folder-placement');
const draftAfterMove = { ...placement, id: randomUUID(), operationId: randomUUID(), source: 'client', clientId: 'folder-draft-integration', mode: 'draft', branchId: 'draft-after-move', parentIds: [placement.id], occurredAt: new Date().toISOString(), label: 'Draft after folder move', before: placement.after, after: { adapter: 'definition-source', version: 1, value: { source: JSON.stringify({ name: 'Moved draft', value: 'Draft content' }) } }, dependencies: [] };
assert.equal((await version(draftAfterMove)).data.ok, true);
const draftPreview = await version({ command: 'preview-version', mode: 'restore', eventId: draftAfterMove.id });
assert.equal(draftPreview.data.ok, true, draftPreview.data.error);
assert.equal(draftPreview.data.preview.result.value.crystal.value, 'Draft content');
assert.equal(draftPreview.data.preview.result.value.folderId, destination.id, 'Draft reconstruction must retain its intervening folder move');
assert.equal((await call('/api/v1/things', { id: child.id, crystal: { value: 'Later edit' } }, 'PATCH')).data.ok, true);
const preview = await version({ command: 'preview-version', mode: 'restore', eventId: placement.id });
assert.equal(preview.data.ok, true, preview.data.error);
assert.equal(preview.data.preview.result.value.crystal.value, 'At placement');
assert.equal(preview.data.preview.result.value.folderId, destination.id);
const apply = { command: 'apply-version', mode: 'restore', eventId: placement.id, expectedHeadId: preview.data.preview.expectedHeadId, operationId: randomUUID() };
const restored = await version(apply); assert.equal(restored.data.ok, true, restored.data.error);
assert.deepEqual((await version(apply)).data, restored.data);
assert.equal((await read(child.id)).crystal.value, 'At placement');
const missingFolderPreview = await version({ command: 'preview-version', mode: 'restore', eventId: initial.id });
assert.equal(missingFolderPreview.data.ok, true);
const count = (await history(child.id)).length;
assert.equal((await version({ command: 'apply-version', mode: 'restore', eventId: initial.id, expectedHeadId: missingFolderPreview.data.preview.expectedHeadId, operationId: randomUUID() })).response.status, 404);
assert.equal((await history(child.id)).length, count, 'Refused restoration leaves no success event');

const theme = await call('/api/v1/themes', { name: 'Private placement theme', theme: {}, visibility: 'private' });
assert.equal(theme.data.ok, true, theme.data.error);
const themeId = theme.data.theme.id;
assert.ok(themeId);
const themeCreateHistory = await history(themeId);
assert.equal(themeCreateHistory[0].event.after.adapter, 'theme-content');
const managedFolder = await create('folder');
const managedMove = await call('/api/v1/things/bulk', { op: 'move', ids: [themeId], folderId: managedFolder.id });
assert.equal(managedMove.data.succeeded, 1, JSON.stringify(managedMove.data));
const managedEvent = (await history(themeId))[0].event;
assert.equal(managedEvent.after.adapter, 'managed-folder-placement');
assert.deepEqual(managedEvent.before.value, { folderId: null });
assert.deepEqual(managedEvent.after.value, { folderId: managedFolder.id });
await remove(managedFolder.id);
assert.equal((await read(themeId)).folderId, null);
assert.equal((await history(themeId)).length, themeCreateHistory.length + 2);
assert.equal((await version({ command: 'preview-version', mode: 'restore', eventId: managedEvent.id })).response.status, 404);

let committedCreates = 0, refusedCreates = 0;
// Stay below the account's normal 60-write/minute limit; no QA quota bypass.
for (let round = 0; round < 3; round++) {
  const target = await create('folder');
  const results = await Promise.all([...Array.from({ length: 8 }, () => call('/api/v1/things', {
    thingtime: ['data'], crystal: { name: 'Concurrent child' }, folderId: target.id, visibility: 'private'
  })), call('/api/v1/things', { id: target.id }, 'DELETE')]);
  const deleted = results.pop()!;
  if (!deleted.data.ok) { assert.equal(deleted.response.status, 409); await remove(target.id); }
  for (const result of results) {
    if (result.data.ok) {
      committedCreates++;
      const id = result.data.thing.id;
      assert.equal((await read(id)).folderId, null, 'No committed child references a deleted folder');
      assert.equal((await history(id)).length, 2, 'A committed child has creation and move history');
    } else { refusedCreates++; assert.ok([404, 409].includes(result.response.status), `${result.response.status}: ${result.data.error}`); }
  }
}

// Disjoint source/destination rows still need ancestor write fences: without
// them, these two moves can both pass a preflight read and form a four-node cycle.
for (let round = 0; round < 2; round++) {
  const a = await create('folder'), c = await create('folder');
  const b = await create('folder', a.id), d = await create('folder', c.id);
  const moves = await Promise.all([call('/api/v1/things', { id: a.id, folderId: d.id }, 'PATCH'), call('/api/v1/things', { id: c.id, folderId: b.id }, 'PATCH')]);
  assert.equal(moves.filter(result => result.data.ok).length, 1);
  assert.ok(moves.filter(result => !result.data.ok).every(result => [400, 409].includes(result.response.status)));
  const rows = new Map(await Promise.all([a, b, c, d].map(async row => [row.id, await read(row.id)] as const)));
  for (const row of rows.values()) {
    const seen = new Set(); let next = row;
    while (next) { assert.equal(seen.has(next.id), false, 'Folder moves cannot create a cycle'); seen.add(next.id); next = rows.get(next.folderId); }
  }
}

await writeFile('/tmp/thingtime-timeline-folders-fixture.json', JSON.stringify({ base, username, password, cookie, ownerId, childId: child.id, folderId: destination.id }), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, checks: ['folder-delete-history-before-removal', 'shared-operation', 'preserved-subtree', 'compact-placement-reconstruction', 'restore-and-retry', 'missing-destination-refusal', 'managed-placement-private-projection', 'create-delete-race', 'four-folder-cycle-race'], committedCreates, refusedCreates }));
