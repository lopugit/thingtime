// Opt-in disposable replica only. Content and history use the real HTTP API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(`${base}/api/v1/mongodb/status`).then(response => response.json());
assert.equal(status.host, '127.0.0.1:20337'); assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false); assert.equal(status.connected, true);
let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', authenticated = true, extraHeaders: Record<string, string> = {}) {
	const response = await fetch(base + path, { method, headers: { ...(authenticated ? { Cookie: cookie } : {}), Origin: base!, 'Content-Type': 'application/json', ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { response, data: await response.json() };
}
const username = `timeline-themes-${randomUUID().slice(0, 8)}`;
const password = `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registered.data.ok, true, registered.data.error);
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registered.data.user.id;
const query = `ownerId=${encodeURIComponent(ownerId)}&dataPlane=home`;
// A separate empty database on the same strictly guarded disposable replica.
// Theme content/history must still be home-pinned and charged to the home ledger.
const customHeaders = { 'x-tt-mongo-url': `mongodb://127.0.0.1:20337/timeline_theme_${randomUUID().replaceAll('-', '')}?replicaSet=timeline-rs` };
const usedInitial = (await call('/api/v1/auth/me')).data.user.storage.usedBytes;
const created = await call('/api/v1/themes', { name: 'Original theme', theme: { colors: { accent: '#123456' } }, visibility: 'private', source: 'ai', actorId: 'forged' }, 'POST', true, customHeaders);
assert.equal(created.data.ok, true, created.data.error);
const id = created.data.theme.id;
const history = async () => {
	const result = await call(`/api/v1/timeline?${query}&thingId=${id}`);
	assert.equal(result.data.ok, true, result.data.error); return result.data.entries;
};
const read = async () => {
	const result = await call(`/api/v1/things?id=${id}`);
	assert.equal(result.data.ok, true, result.data.error); return result.data.thing;
};
const first = (await history())[0].event;
assert.equal(first.operation, 'create'); assert.equal(first.source, 'api'); assert.equal(first.actorId, ownerId);
assert.equal(first.before, null); assert.equal(first.after.adapter, 'theme-content');
assert.deepEqual(first.after.value.crystal.theme, created.data.theme.theme);
assert.equal((await read()).timelineHeadId, first.id);
assert.equal((await history()).length, 1);
const livePayloadBytes = Buffer.byteLength(JSON.stringify({ crystal: (await read()).crystal, extended: null, tags: [] }));
assert.equal((await call('/api/v1/auth/me')).data.user.storage.usedBytes - usedInitial, livePayloadBytes * 2, 'Custom selection cannot skip charging the home theme revision');
const unchanged = await call('/api/v1/themes', { id, name: 'Original theme', theme: created.data.theme.theme, visibility: 'private' });
assert.equal(unchanged.data.ok, true, unchanged.data.error);
assert.equal((await history()).length, 1, 'Saving identical theme tokens adds no event');

assert.equal((await call('/api/v1/things', { id, displayTitle: 'My theme' }, 'PATCH')).data.ok, true);
const title = (await history())[0].event;
assert.equal(title.after.adapter, 'library-title'); assert.deepEqual(title.parentIds, [first.id]);
const folder = await call('/api/v1/things', { thingtime: ['folder'], crystal: { name: 'Themes' }, visibility: 'private' });
assert.equal(folder.data.ok, true, folder.data.error);
const move = await call('/api/v1/things/bulk', { op: 'move', ids: [id], folderId: folder.data.thing.id });
assert.equal(move.data.succeeded, 1);
const placement = (await history())[0].event;
assert.equal(placement.after.adapter, 'managed-folder-placement'); assert.deepEqual(placement.parentIds, [title.id]);

const changed = await call('/api/v1/themes', { id, name: 'Edited theme', theme: { colors: { accent: '#654321' }, general: { motion: false } }, visibility: 'public' });
assert.equal(changed.data.ok, true, changed.data.error);
const edited = (await history())[0].event;
assert.deepEqual(edited.parentIds, [placement.id]); assert.equal(edited.operation, 'update');
assert.equal(edited.before.value.crystal.theme.colors.accent, '#123456');
assert.deepEqual(edited.after.value.crystal.theme, changed.data.theme.theme);
assert.equal(edited.after.value.crystal.title, 'My theme'); assert.equal(edited.after.value.folderId, folder.data.thing.id);
assert.equal(edited.after.value.visibility, 'public'); assert.equal(edited.before.value.visibility, 'private');
const count = (await history()).length;
assert.equal((await call('/api/v1/themes', { id, name: '', theme: {} })).response.status, 400);
assert.equal((await history()).length, count);
assert.equal((await call(`/api/v1/timeline?${query}&thingId=${id}`, undefined, 'GET', false)).response.status, 401, 'Public themes still have private history');
assert.equal((await call(`/api/v1/timeline?ownerId=another-account&dataPlane=home&thingId=${id}`)).response.status, 409);
assert.equal((await call(`/api/v1/timeline?${query}`, { command: 'preview-version', mode: 'restore', eventId: edited.id })).response.status, 404, 'No generic protected-content restore bypass');

const beforeDelete = await read();
const usedBefore = (await call('/api/v1/auth/me')).data.user.storage.usedBytes;
assert.equal((await call('/api/v1/themes/delete', { id })).data.ok, true);
const deleted = (await history())[0].event;
assert.equal(deleted.operation, 'delete'); assert.equal(deleted.after, null); assert.deepEqual(deleted.parentIds, [edited.id]);
assert.deepEqual(deleted.before.value.crystal, beforeDelete.crystal);
assert.equal((await call('/api/v1/auth/me')).data.user.storage.usedBytes, usedBefore, 'Retained supported theme payload exactly replaces the deleted bytes');
assert.equal((await call(`/api/v1/things?id=${id}`)).response.status, 404);
assert.equal((await call('/api/v1/themes/delete', { id })).response.status, 404);
assert.equal((await history()).length, count + 1, 'Repeated delete adds no event');

const visible = await call('/api/v1/themes', { name: 'Browser theme', theme: { colors: { accent: '#9173bb' } }, visibility: 'private' });
assert.equal(visible.data.ok, true, visible.data.error);
await writeFile('/tmp/thingtime-timeline-themes-fixture.json', JSON.stringify({ base, username, password, cookie, ownerId, thingId: visible.data.theme.id, deletedId: id }), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, checks: ['create-normalized-token-history', 'custom-selection-home-history-and-accounting', 'trusted-provenance', 'same-content-no-event', 'rename-move-content-parent-chain', 'visibility-change-history', 'invalid-save-no-event', 'public-theme-private-history', 'generic-restore-refused', 'delete-exact-before-and-bytes', 'delete-retry-no-event'] }));
