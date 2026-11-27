/** Disposable real signup/API capture proof. No raw Mongo reads/writes, fake
 * users, replacement auth, direct content insertion or injected source cursor. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:28162\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING || ''));
const base = 'https://reference-fixture.test';
process.env.APP_URL = base;
process.env.JWT_SECRET = randomUUID() + randomUUID();
const register = await import('../app/routes/api/v1/auth/register/_register');
const things = await import('../app/routes/api/v1/things/_things');
const migration = await import('../app/routes/api/v1/admin/migrations/run/_run');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { createThing, updateThing, deleteThing } = await import('../app/api/utils/things/things');
const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
const { createAccountInventoryProducer } = await import('../app/api/utils/backups/accountInventory');
const { openBackupThingSnapshot } = await import('../app/api/utils/backups/thingSnapshots');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { sealBackup, copySealedBackup } = await import('../app/api/utils/backups/portableBackup');
const { openBackupNotification } = await import('../app/api/utils/backups/notificationSnapshots');
const { emitSystemNotification } = await import('../app/api/utils/notifications/notifications');
const notifications = await import('../app/routes/api/v1/notifications/_notifications');
const { inspectActionProgram } = await import('../app/api/utils/actions/execute');
const { resolveSharedComposition } = await import('../app/api/utils/actions/sharedComposition');
const { openSealedBackup } = await import('../app/api/utils/backups/portableBackup');
const request = (cookie: string, path: string, body?: unknown) => new Request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function signup() {
	const username = 'reference-' + randomUUID().slice(0, 8);
	const response = await register.action({ request: request('', '/api/v1/auth/register', { username, email: username + '@example.invalid', password: randomUUID() + '-NeverExport!', displayName: 'Reference fixture' }) });
	assert.equal(response.status, 200);
	const data = await response.json(); assert.equal(data.ok, true);
	return { username, user: data.user, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
const source = await signup(), other = await signup();
// Documented fixture-only configuration, set AFTER signup so the public
// registration path cannot mint an allowlisted administrator.
process.env.ADMIN_USERNAMES = source.username;
async function migrate() {
	const response = await migration.action({ request: request(source.cookie, '/api/v1/admin/migrations/run', { migration: 'retire-legacy-thing-indexes', confirm: true }) });
	const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.ok, true);
}
await migrate();
// Actual supported cache-drain interval, never a synthetic readiness marker.
await delay(60_100);
await migrate();
await ensureIndexes({ force: true });

const rows = [
	{ shareId: 'reference-action', thingtime: ['action'], crystal: { name: 'Read', actionKey: 'reference-read', steps: [{ op: 'things.get', id: 'reference-data' }], capabilities: [{ capability: 'things.read' }] } },
	{ shareId: 'reference-schema', thingtime: ['schema'], crystal: { name: 'reference-schema-name', fields: [{ name: 'text', type: 'string' }], render: { tag: 'button', ttAction: 'reference-action', children: 'Read' } } },
	{ shareId: 'reference-data', thingtime: ['data'], crystal: { schemaId: 'reference-schema', text: 'Independent pinned content' } },
	{ shareId: 'reference-component', thingtime: ['component'], crystal: { name: 'Original card', componentKey: 'reference-card', savedArgs: { action: 'reference-read' }, render: { tag: 'button', ttAction: '{action}', children: 'Read' } } },
	{ shareId: 'reference-page', thingtime: ['webpage'], crystal: { name: 'Reference page', blocks: [{ id: 'card', type: 'component', component: 'reference-component', args: { action: 'reference-action' } }] } }
];
const created: any[] = [];
for (const row of rows) {
	const result = await createThing(source.user.id, { ...row, acl: ['tt:user'] }, source.user);
	assert.equal(result.ok, true, JSON.stringify(result)); if (result.ok) created.push(result.doc);
}
await emitSystemNotification({ recipientId: source.user.id, type: 'system-message', title: 'Large source history', detail: 'Real API notification detail 🥰\n'.repeat(300_000), historyOnly: true });
const notificationResponse = await notifications.loader({ request: request(source.cookie, '/api/v1/notifications?history=1&limit=100') });
assert.equal(notificationResponse.status, 200);
const notificationExpected = (await notificationResponse.json()).notifications;
const expected = new Map<string, any>();
for (const row of rows) {
	const response = await things.loader({ request: request(source.cookie, '/api/v1/things?id=' + row.shareId) });
	assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.ok, true); expected.set(row.shareId, data.thing.crystal);
	const denied = await things.loader({ request: request(other.cookie, '/api/v1/things?id=' + row.shareId) });
	assert.equal(denied.status, 404);
}

const scope = { ownerId: source.user.id, apiOrigin: base, dataPlane: 'home' };
const access = { scope, authorize: async () => { assert.equal((await getCurrentUser(request(source.cookie, '/api/v1/auth/me')))?.id, source.user.id); } };
const first = await openLocalBackupStore(join(directory!, 'reference-first')), independent = await openLocalBackupStore(join(directory!, 'reference-independent'));
const snapshotId = randomUUID();
let changed = false;
const racingStore = { ...first, put: async (key: string, bytes: Uint8Array) => {
	if (!changed && key === `snapshots/${snapshotId}/header.json`) {
		changed = true;
		const component = created.find(row => row.shareId === 'reference-component');
		const result = await updateThing(source.user, component.shareId, { crystal: { ...component.crystal, name: 'Changed after snapshot', render: { tag: 'button', ttAction: 'uncaptured-new-action' } } });
		assert.equal(result.ok, true, JSON.stringify(result));
	}
	await first.put(key, bytes);
} };
await createAccountInventoryProducer()(racingStore, snapshotId, access);
assert.equal(changed, true);
await sealBackup(first, snapshotId, access);
await copySealedBackup(first, independent, snapshotId, access);
await rm(join(directory!, 'reference-first'), { recursive: true });
for (const row of [...created].reverse()) assert.equal((await deleteThing(source.user, row.shareId)).ok, true);
for (const row of rows) {
	const retained = await openBackupThingSnapshot(independent, snapshotId, row.shareId, access);
	assert.deepEqual((retained.value as any).crystal, expected.get(row.shareId), 'Retained content equals independent pre-capture API readback');
}
for (const expected of notificationExpected) {
	const retained = await openBackupNotification(independent, snapshotId, expected.id, access), value = retained.value as any;
	assert.equal(value.crystal.title ?? null, expected.title); assert.equal(value.crystal.detail ?? null, expected.detail);
	assert.equal(value.createdAt, expected.createdAt); assert.equal(value.readAt, expected.readAt);
}
// An owner may store an inaccessible pointer; discovery is not permission to
// fetch another account's private content. The archive records it unresolved.
const privateAction = await createThing(other.user.id, { thingtime: ['action'], crystal: { name: 'Foreign', actionKey: 'foreign', steps: [{ op: 'return', value: 'private' }], capabilities: [] }, acl: ['tt:user'] }, other.user);
assert.equal(privateAction.ok, true);
if (!privateAction.ok) throw Error('Foreign fixture creation failed');
const bad = await createThing(source.user.id, { thingtime: ['component'], crystal: { name: 'Unavailable pointer', componentKey: 'unavailable', render: { tag: 'button', ttAction: privateAction.doc.shareId } }, acl: ['tt:user'] }, source.user);
assert.equal(bad.ok, true);
const unresolvedId = randomUUID();
await createAccountInventoryProducer()(independent, unresolvedId, access);
await sealBackup(independent, unresolvedId, access);
if (!bad.ok) throw Error('Dangling fixture failed');
assert.equal(((await openBackupThingSnapshot(independent, unresolvedId, bad.doc.shareId, access)).value as any).crystal.render.ttAction, privateAction.doc.shareId);
const unresolvedBackup = await openSealedBackup(independent, unresolvedId, access);
let unresolved = false;
for await (const entry of unresolvedBackup.entries) if (entry.item.snapshot.adapter === 'backup-reference-coverage') unresolved ||= (entry.item.snapshot.value as any).coverage.resolution === 'unresolved';
assert.equal(unresolved, true);
// Compare real runtime alias entry points rather than assuming identical sort
// rules. Both contents remain captured; duplicate aliases are evidence issues.
const aliasKey = 'runtime-alias';
const older = await createThing(source.user.id, { thingtime: ['action'], crystal: { name: 'Older', actionKey: aliasKey, version: 1, steps: [{ op: 'return', value: 'older' }], capabilities: [] } }, source.user);
await delay(5);
const newer = await createThing(source.user.id, { thingtime: ['action'], crystal: { name: 'Newer', actionKey: aliasKey, version: 1, steps: [{ op: 'return', value: 'newer' }], capabilities: [] } }, source.user);
assert.equal(older.ok && newer.ok, true); if (!older.ok || !newer.ok) throw Error('Alias fixture failed');
await delay(5);
assert.equal((await updateThing(source.user, older.doc.shareId, { crystal: { ...older.doc.crystal, name: 'Updated older' } })).ok, true);
const aliasPage = await createThing(source.user.id, { thingtime: ['component'], crystal: { name: 'Alias', componentKey: 'runtime-alias-card', render: { tag: 'button', ttAction: aliasKey } } }, source.user);
assert.equal(aliasPage.ok, true); if (!aliasPage.ok) throw Error('Alias component failed');
const direct = await inspectActionProgram(source.user, aliasKey), shared = await resolveSharedComposition(source.user, aliasPage.doc.shareId);
assert.equal(direct.ok, true);
if (!direct.ok || 'ok' in shared) throw Error('Alias resolution unavailable');
assert.equal(direct.id, newer.doc.shareId); assert.equal(shared.actions.get(aliasKey)?.shareId, older.doc.shareId);
console.log(JSON.stringify({ accountReferenceBackupProof: 'passed', records: rows.length, notifications: notificationExpected.length, source: 'real signup and canonical API handlers/utils', boundary: 'one real Mongo snapshot across concurrent API update', independentReadback: true, sourceDeleted: 'ordinary-source-records-and-first-vault', foreignPointerPreservedWithUnresolvedEvidence: true, runtimeAliasMismatchVerified: true, wholeAccountReady: false }));
process.exit(0);
