// Real HTTP/session/route checks. POP3 discovery resolves public DNS but does
// not log in to a provider; actual TLS protocol coverage lives in transport.integration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const base = process.env.MAIL_TEST_BASE;
if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('Use the disposable local mail test app.');
const status = await fetch(base + '/api/v1/mongodb/status').then(r => r.json());
assert.equal(status.replicaSet, 'mail-qa-rs');
const fixture = JSON.parse(readFileSync('/tmp/thingtime-mail-qa/browser-fixture.json', 'utf8'));
const login = await fetch(base + '/api/v1/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
  body: JSON.stringify({ username: fixture.username, password: fixture.password })
});
assert.equal(login.status, 200);
const cookie = login.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
const ownerId = fixture.ownerId;
const account = { id: randomUUID(), name: 'Transient relay fixture', address: 'relay@example.invalid', revision: 0,
  sync: { cloud: false, local: true, transport: 'relay' },
  servers: { pop3: { host: 'pop.gmail.com', port: 995, security: 'tls', username: 'relay@example.invalid', password: 'synthetic-never-authenticated' } } };
const list = async () => fetch(`${base}/api/v1/mail?expectedOwnerId=${ownerId}`, { headers: { Cookie: cookie } }).then(r => r.json());
const before = await list(); assert.equal(before.ok, true);
const relay = async (patch = {}, origin = base) => fetch(`${base}/api/v1/mail/sync?expectedOwnerId=${ownerId}`, {
  method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation: 'relay', expectedOwnerId: ownerId, account, protocol: 'pop3', discover: true, ...patch })
});
const response = await relay(); assert.equal(response.status, 200);
assert.match(response.headers.get('Cache-Control') || '', /private, no-store/);
const batch = await response.json(); assert.equal(batch.ownerId, ownerId); assert.equal(batch.version, 1);
assert.equal(batch.folders.length, 1); assert.equal(batch.folders[0].accountId, account.id); assert.equal(batch.messages.length, 0);
assert.equal(JSON.stringify(batch).includes(account.servers.pop3.password), false);
assert.deepEqual(await list(), before, 'relay must not create cloud accounts or change stored mail');
assert.equal((await relay({}, 'https://other.invalid')).status, 403);
assert.equal((await relay({ expectedOwnerId: 'other_owner' })).status, 409);
assert.equal((await relay({ account: { ...account, sync: { ...account.sync, transport: 'native' } } })).status, 403);
console.log('PASS: real API relay, current session/owner, origin and explicit mode checks; no cloud persistence. DNS-only discovery; no provider login.');
