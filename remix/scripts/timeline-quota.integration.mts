// Opt-in, disposable replica only. Accounts, entitlements and content use real APIs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const adminFixturePath = process.env.TIMELINE_TEST_ADMIN_FIXTURE;
if (!adminFixturePath) throw new Error('Set a private TIMELINE_TEST_ADMIN_FIXTURE file path');
const status = await fetch(`${base}/api/v1/mongodb/status`).then(response => response.json());
assert.equal(status.host, '127.0.0.1:20337'); assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false); assert.equal(status.connected, true);

async function call(cookie: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base!, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { response, data: await response.json() };
}
async function register(username: string, password = `Timeline-${randomUUID()}-9a!`) {
	const result = await call('', '/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
	assert.equal(result.data.ok, true, `Fresh synthetic registration failed (${result.response.status}): ${result.data.error}`);
	return { user: result.data.user, cookie: result.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
if (process.argv.includes('--prepare-admin')) {
	const username = `timeline-quota-admin-${randomUUID().slice(0, 8)}`;
	const password = `Timeline-${randomUUID()}-9a!`;
	const prepared = await register(username, password);
	assert.equal(prepared.user.isAdmin, false, 'Prepare an ordinary synthetic account before allowlisting it');
	await writeFile(adminFixturePath, JSON.stringify({ base, username, password, ownerId: prepared.user.id }), { mode: 0o600, flag: 'wx' });
	console.log(JSON.stringify({ ok: true, prepared: username, next: 'Restart only the disposable server with this ADMIN_USERNAMES value, then run without --prepare-admin' }));
	process.exit(0);
}
const adminFixture = JSON.parse(await readFile(adminFixturePath, 'utf8'));
assert.equal(adminFixture.base, base, 'Fixture must belong to this disposable API origin');
assert.match(adminFixture.username, /^timeline-quota-admin-[a-f0-9]{8}$/);
const login = await call('', '/api/v1/login', { username: adminFixture.username, password: adminFixture.password });
assert.equal(login.data.ok, true, 'Prepared synthetic account login failed');
assert.equal(login.data.user.id, adminFixture.ownerId, 'Fixture identity must remain unchanged');
assert.equal(login.data.user.isAdmin, true, 'Allowlist the prepared username only in the disposable server process');
const admin = { cookie: login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
const subject = await register(`timeline-quota-${randomUUID().slice(0, 8)}`);
assert.equal(subject.user.isAdmin, false);
const request = (path: string, body?: unknown, method?: string) => call(subject.cookie, path, body, method);
const ownerId = subject.user.id;
const query = `ownerId=${encodeURIComponent(ownerId)}&dataPlane=home`;
const version = (body: unknown) => request(`/api/v1/timeline?${query}`, body);
async function usage() {
	const result = await request('/api/v1/auth/me');
	assert.equal(result.response.status, 200);
	assert.equal(result.data.user.id, ownerId);
	assert.equal(result.data.user.storage.status, 'ready');
	assert.ok(Number.isSafeInteger(result.data.user.storage.usedBytes));
	return result.data.user.storage;
}
async function allowance(bytes: number) {
	const result = await call(admin.cookie, '/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: ownerId, tier: 'free', overrides: { userStorageBytes: bytes }, note: 'Disposable Timeline quota acceptance' });
	assert.equal(result.data.ok, true, result.data.error);
	assert.equal((await usage()).allowanceBytes, bytes);
}
async function history(id: string) {
	const result = await request(`/api/v1/timeline?${query}&thingId=${encodeURIComponent(id)}`);
	assert.equal(result.data.ok, true, result.data.error);
	return result.data.entries;
}
async function read(id: string) {
	const result = await request(`/api/v1/things?id=${encodeURIComponent(id)}`);
	assert.equal(result.data.ok, true, result.data.error);
	return result.data.thing;
}
async function create(kind: string, value: string) {
	const result = await request('/api/v1/things', { thingtime: [kind], crystal: { name: `Quota ${kind}`, value }, visibility: 'private' });
	assert.equal(result.data.ok, true, result.data.error);
	return result.data.thing;
}
// Ordinary accounts cannot grant themselves room; the fixture uses the real admin API.
assert.equal((await request('/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: ownerId, tier: 'free', overrides: { userStorageBytes: 1_000_000 } })).response.status, 403);
const folder = await create('folder', 'Destination');
const thing = await create('data', 'Original saved value');
const original = (await history(thing.id))[0].event;
assert.equal((await request('/api/v1/things', { id: thing.id, crystal: { value: 'Later saved value '.repeat(32) } }, 'PATCH')).data.ok, true);
const saved = await read(thing.id);
const initialHistory = await history(thing.id);
const baseline = (await usage()).usedBytes;
assert.ok(baseline > 0);
await allowance(baseline);
assert.equal((await usage()).remainingBytes, 0);

for (const value of ['Growing edit '.repeat(128), '']) {
	const denied = await request('/api/v1/things', { id: thing.id, crystal: { value }, expectedUpdatedAt: saved.updatedAt }, 'PATCH');
	assert.equal(denied.response.status, 507, denied.data.error);
	assert.deepEqual(await read(thing.id), saved, 'Refused growth or retained shrinking edit leaves content/head/timestamp unchanged');
	assert.deepEqual(await history(thing.id), initialHistory, 'No successful event or receipt for a refused mutation');
	assert.equal((await usage()).usedBytes, baseline, 'Refused transaction leaves the exact ledger unchanged');
}

const preview = await version({ command: 'preview-version', mode: 'restore', eventId: original.id });
assert.equal(preview.data.ok, true, preview.data.error);
assert.equal(preview.data.preview.result.value.crystal.value, 'Original saved value');
const restore = { command: 'apply-version', mode: 'restore', eventId: original.id, expectedHeadId: preview.data.preview.expectedHeadId, operationId: randomUUID() };
assert.equal((await version(restore)).response.status, 507, 'A preview remains readable but retaining a restored revision needs storage');
assert.deepEqual(await read(thing.id), saved);
assert.deepEqual(await history(thing.id), initialHistory);
assert.equal((await usage()).usedBytes, baseline);

// The canonical assignment guard refuses a downgrade below retained usage.
// Do not weaken that guard or seed an artificial entitlement around it.
const downgrade = await call(admin.cookie, '/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: ownerId, tier: 'free', overrides: { userStorageBytes: baseline - 1 } });
assert.equal(downgrade.response.status, 409);
assert.equal((await usage()).allowanceBytes, baseline);
assert.equal((await usage()).overageBytes, 0);
assert.deepEqual(await read(thing.id), saved);
assert.deepEqual(await history(thing.id), initialHistory);
const moved = await request('/api/v1/things', { id: thing.id, folderId: folder.id }, 'PATCH');
assert.equal(moved.data.ok, true, moved.data.error);
const placement = (await history(thing.id))[0].event;
assert.equal(placement.after.adapter, 'folder-placement');
assert.deepEqual(placement.after.value, { folderId: folder.id });
assert.equal((await usage()).usedBytes, baseline, 'Server-authored relational placement metadata adds no customer-content bytes');

const folderDeleted = await request('/api/v1/things', { id: folder.id }, 'DELETE');
assert.equal(folderDeleted.data.ok, true, folderDeleted.data.error);
assert.equal((await read(thing.id)).folderId, null);
const afterDrain = await history(thing.id);
assert.equal(afterDrain[0].event.label, 'Moved out of deleted folder');
assert.equal(afterDrain[0].event.operationId, (await history(folder.id))[0].event.operationId);
assert.equal((await usage()).usedBytes, baseline, 'Deleting a folder retains its content bytes and records the move');

const beforeDelete = await read(thing.id);
assert.equal((await request('/api/v1/things', { id: thing.id }, 'DELETE')).data.ok, true);
assert.equal((await request(`/api/v1/things?id=${thing.id}`)).response.status, 404);
const deletedHistory = await history(thing.id);
assert.equal(deletedHistory.length, afterDrain.length + 1);
assert.equal(deletedHistory[0].event.operation, 'delete');
assert.deepEqual(deletedHistory[0].event.before.value.crystal, beforeDelete.crystal);
assert.equal(deletedHistory[0].event.after, null);
assert.deepEqual(deletedHistory[0].event.parentIds, [beforeDelete.timelineHeadId]);
assert.equal((await usage()).usedBytes, baseline, 'Deletion transfers content into history; it does not falsely free allowance');
assert.equal((await request('/api/v1/things', { id: thing.id }, 'DELETE')).response.status, 404);
assert.deepEqual(await history(thing.id), deletedHistory, 'A repeated delete adds no event or accounting');
assert.equal((await usage()).usedBytes, baseline);

console.log(JSON.stringify({ ok: true, checks: ['normal-admin-entitlement-api', 'self-upgrade-refused', 'exact-ceiling-atomic-growth-refusal', 'retained-shrink-refusal', 'restore-preview-readable-at-ceiling', 'restore-refusal-atomic', 'below-usage-downgrade-refused-without-data-loss', 'at-ceiling-folder-move-and-drain', 'at-ceiling-delete-retains-exact-before', 'delete-retry-does-not-double-count'], baselineBytes: baseline }));
