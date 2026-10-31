// Real HTTP API acceptance, fenced to this task's disposable local replica.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const base = process.env.MAIL_TEST_BASE;
if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('Set MAIL_TEST_BASE to the disposable local server.');
const status = await fetch(base + '/api/v1/mongodb/status').then((response) => response.json());
assert.equal(status.host, '127.0.0.1:20437');
assert.equal(status.replicaSet, 'mail-qa-rs');
assert.equal(status.custom, false);
let cookie = '',
	ownerId = '';
async function call(path: string, body?: unknown, method = body ? 'POST' : 'GET', auth = true) {
	const response = await fetch(base + path, {
		method,
		headers: { ...(auth ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json', Origin: base } : {}) },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const data = await response.json();
	return { status: response.status, data, response };
}
const username = 'mail-qa-' + randomUUID().slice(0, 8),
	password = 'Synthetic-Mail-Fixture-2026-A!';
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid`, displayName: 'Mail QA' });
assert.equal(registered.data.ok, true, JSON.stringify(registered.data));
cookie = registered.response.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
ownerId = registered.data.user.id;
const endpoint = `/api/v1/mail?expectedOwnerId=${encodeURIComponent(ownerId)}`;
const command = (body: object) => call(endpoint, { ...body, expectedOwnerId: ownerId });
const account = {
	id: randomUUID(),
	revision: 0,
	name: 'Personal test inbox',
	address: 'reader@example.test',
	sync: { cloud: true, local: true },
	servers: {
		imap: { host: 'imap.example.test', port: 993, security: 'tls', username: 'reader', password: 'mail-credential-synthetic-' + randomUUID() }
	}
};
const save = { operation: 'save-account', account, writeId: randomUUID() };
const created = await command(save);
assert.equal(created.status, 200, JSON.stringify(created.data));
assert.equal(created.data.account.revision, 1);
assert.equal(JSON.stringify(created.data).includes(account.servers.imap.password), false);
assert.deepEqual((await command(save)).data, created.data, 'same request retries return the same record');
assert.equal((await command({ ...save, account: { ...account, name: 'Changed retry' } })).status, 409);
assert.equal((await command({ ...save, writeId: randomUUID() })).status, 409);
const listed = await call(endpoint);
assert.equal(listed.data.records.length, 1);
assert.equal(JSON.stringify(listed.data).includes(account.servers.imap.password), false);
assert.equal((await call(endpoint, undefined, 'GET', false)).status, 401);
assert.equal((await call('/api/v1/mail?expectedOwnerId=wrong')).status, 409);
const generic = await call(`/api/v1/things?id=${account.id}`);
assert.equal(generic.status, 404);
const search = await call(`/api/v1/things?q=${encodeURIComponent('Personal test inbox')}`);
assert.equal(JSON.stringify(search.data).includes(account.id), false);
assert.equal(
	(
		await command({
			operation: 'save-inbox',
			writeId: randomUUID(),
			inbox: { id: randomUUID(), name: 'Foreign folder', revision: 0, folderIds: ['foreign_folder_id'] }
		})
	).status,
	400
);
const disabled = { ...created.data.account, sync: { cloud: false, local: true } };
assert.equal((await command({ operation: 'save-account', account: disabled, writeId: randomUUID() })).status, 200);
assert.equal((await command({ operation: 'sync', id: account.id, protocol: 'imap' })).status, 403);
assert.equal((await command({ operation: 'delete', kind: 'mail-account', id: account.id, revision: 2 })).status, 200);
assert.equal((await command(save)).status, 410);
assert.equal((await call(endpoint)).data.records.length, 0);
// Retain a harmless paused account for browser layout verification.
const fixtureAccount = {
	...account,
	id: randomUUID(),
	name: 'Personal',
	sync: { cloud: false, local: false },
	servers: { imap: { ...account.servers.imap, password: undefined } }
};
assert.equal((await command({ operation: 'save-account', account: fixtureAccount, writeId: randomUUID() })).status, 200);
writeFileSync('/tmp/thingtime-mail-qa/browser-fixture.json', JSON.stringify({ username, password, ownerId }), { mode: 0o600 });
console.log(
	JSON.stringify({
		ok: true,
		checks: [
			'disposable replica',
			'real registration',
			'encrypted account CRUD',
			'secret-free projections',
			'stable retry',
			'stale revision',
			'anonymous/actor refusal',
			'generic Thing privacy',
			'foreign folder refusal',
			'cloud-off refusal',
			'delete tombstone'
		],
		username
	})
);
