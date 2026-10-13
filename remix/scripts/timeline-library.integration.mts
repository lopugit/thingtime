// Opt-in disposable replica only. Fixtures and mutations use the real API.
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
const username = `timeline-library-${randomUUID().slice(0, 8)}`;
const password = `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registered.data.ok, true);
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registered.data.user.id;
const created = await call('/api/v1/themes', { name: 'Original theme identity', theme: {}, visibility: 'private' });
assert.equal(created.data.ok, true, created.data.error);
const id = created.data.theme.id;
const history = async () => {
	const result = await call(`/api/v1/timeline?ownerId=${encodeURIComponent(ownerId)}&dataPlane=home&thingId=${encodeURIComponent(id)}`);
	assert.equal(result.data.ok, true, result.data.error); return result.data.entries;
};
const baseline = (await history()).length;
const rename = (displayTitle: string, expectedUpdatedAt?: string) => call('/api/v1/things', { id, displayTitle, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }, 'PATCH');
const first = await rename('Friendly library title', created.data.theme.updatedAt);
assert.equal(first.data.ok, true, first.data.error);
const firstEntries = await history();
assert.equal(firstEntries.length, baseline + 1);
const firstEvent = firstEntries[0].event;
assert.equal(firstEvent.label, 'Renamed theme'); assert.equal(firstEvent.source, 'api');
assert.equal(firstEvent.actorId, ownerId); assert.equal(firstEvent.after.adapter, 'library-title');
assert.deepEqual(firstEvent.before.value, { title: null });
assert.deepEqual(firstEvent.after.value, { title: 'Friendly library title' });
assert.equal(JSON.stringify(firstEvent).includes('Original theme identity'), false);

const stale = await rename('Stale overwrite', created.data.theme.updatedAt);
assert.equal(stale.response.status, 409);
const forged = await call('/api/v1/things', { id, displayTitle: 'Forged source', source: 'ai' }, 'PATCH');
assert.equal(forged.response.status, 400);
assert.equal((await history()).length, baseline + 1, 'Refused writes create no successful history');

const second = await rename('Second library title', first.data.updatedAt);
assert.equal(second.data.ok, true, second.data.error);
const latest = (await history())[0].event;
assert.deepEqual(latest.parentIds, [firstEvent.id]);
assert.notEqual(latest.operationId, firstEvent.operationId);
assert.deepEqual(latest.before.value, { title: 'Friendly library title' });
assert.deepEqual(latest.after.value, { title: 'Second library title' });
const unchanged = await rename('Second library title', second.data.updatedAt);
assert.equal(unchanged.data.ok, true, unchanged.data.error);
assert.equal((await history()).length, baseline + 2, 'Unchanged display metadata does not fabricate another content change');
const read = await call(`/api/v1/things?id=${encodeURIComponent(id)}`);
assert.equal(read.data.thing.crystal.name, 'Original theme identity');
assert.equal(read.data.thing.crystal.title, 'Second library title');
assert.equal(read.data.thing.timelineHeadId, latest.id, 'The owner sees the saved head for synchronization; unchanged titles do not advance it');
await writeFile('/tmp/thingtime-timeline-library-fixture.json', JSON.stringify({ base, username, password, cookie, ownerId, thingId: id }), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, checks: ['managed-rename-history', 'metadata-only-projection', 'stale-and-forged-write-refusal', 'exact-parent-chain', 'separate-api-operations', 'unchanged-title-no-event', 'original-identity-preserved'] }));
