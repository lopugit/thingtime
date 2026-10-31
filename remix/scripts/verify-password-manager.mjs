import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.argv[2];
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use an explicitly disposable local deployment.');
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); console.log(`✓ ${label}`); checks++; };
async function api(path, cookie, body, headers = {}) {
 const response = await fetch(`${base}/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
 return { status: response.status, body: await response.json(), cookie: /tt_auth=[^;]+/.exec(response.headers.get('set-cookie'))?.[0], cache: response.headers.get('cache-control') };
}
const users = [];
for (let i = 0; i < 2; i++) {
 const username = `qa-password-${randomUUID().slice(0, 8)}`, email = `${username}@example.test`, password = 'DisposablePassword!2026';
 const result = await api('auth/register', null, { username, email, password }); if (!result.body.ok) console.log({ status: result.status, error: result.body.error }); check(result.body.ok && result.cookie, `register synthetic owner ${i + 1}`); users.push({ username, email, password, cookie: result.cookie, id: result.body.user.id });
}
const [owner, other] = users, id = randomUUID(), writeId = randomUUID(), secret = `fixture-only-${randomUUID()}`;
const entry = { title: 'Facebook QA [literal].*', passwordType: 'login', fields: [{ id: 'username', label: 'Username', type: 'text', value: 'fixture@example.test' }, { id: 'password', label: 'Password', type: 'password', value: secret }, { id: 'totp', label: 'Code', type: 'totp', value: 'otpauth://totp/QA?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }] };
const save = { operation: 'save', expectedOwnerId: owner.id, id, writeId, revision: 0, entry };
const result = await api('passwords', owner.cookie, save); if (!result.body.ok) console.log({ status: result.status, error: result.body.error }); check(result.body.ok, 'save encrypted entry through real API');
check((await api('passwords', owner.cookie, save)).body.record.revision === 1, 'same save retry is idempotent');
check((await api('passwords', owner.cookie, { ...save, entry: { ...entry, title: 'Changed replay' } })).status === 409, 'changed retry payload is rejected');
const listing = await api('passwords', owner.cookie); check(listing.body.entries.length === 1 && !JSON.stringify(listing.body).includes(secret), 'metadata list excludes plaintext credentials');
check(listing.cache?.includes('private') && listing.cache.includes('no-store'), 'private responses are not cacheable');
const read = { operation: 'read', id, expectedOwnerId: owner.id };
check((await api('passwords', owner.cookie, read)).body.entry.fields[1].value === secret, 'session unlock reads exact password without another password prompt');
check((await api('passwords', other.cookie, { ...read, expectedOwnerId: other.id })).status === 404, 'another account cannot read entry');
check((await api('passwords', other.cookie, read)).status === 409, 'account-switch request fence rejects stale form');
check((await api('passwords', null, read)).status === 401, 'signed-out session cannot read entry');
check((await api('passwords', owner.cookie, read, { Origin: 'https://attacker.example' })).status === 403, 'cross-origin read rejected');
check((await api('passwords', owner.cookie, { ...save, writeId: randomUUID() })).status === 409, 'stale revision cannot overwrite');
for (const path of [`things?id=${id}`, `things?q=${encodeURIComponent(secret)}`, 'data']) {
 const generic = await api(path, owner.cookie); check(!JSON.stringify(generic.body).includes(secret), `generic ${path.split('?')[0]} does not disclose plaintext`);
 if (path.startsWith('things?id')) check(generic.status === 404 || generic.body.ok === false, 'generic exact Thing read is refused');
}
const ids = [id];
for (let i = 0; i < 51; i++) {
 const nextId = randomUUID(); ids.push(nextId);
 const added = await api('passwords', owner.cookie, { ...save, id: nextId, writeId: randomUUID(), entry: { ...entry, title: `Additional account ${i}` } });
 assert.equal(added.status, 200, 'save paginated fixture');
}
let cursor, listed = [];
do { const page = await api(`passwords${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, owner.cookie); listed.push(...page.body.entries.map(item => item.id)); cursor = page.body.nextCursor; } while (cursor);
check(listed.length === 52 && new Set(listed).size === 52 && ids.every(value => listed.includes(value)), 'stable creation cursors page every account exactly once');
// The only initial Facebook match is older than a full page of nonmatches.
check(!(await api('passwords', owner.cookie)).body.entries.some(item => item.id === id), 'search target is beyond the initial unfiltered page');
for (const q of ['facebook', 'FACEBOOK', ' facebook ', '[literal].*']) {
 const result = await api(`passwords?q=${encodeURIComponent(q)}`, owner.cookie);
 check(result.body.entries.length === 1 && result.body.entries[0].id === id && !result.body.nextCursor, 'whole-vault title search: ' + q);
 check(!JSON.stringify(result.body).includes(secret), 'search returns metadata only');
}
check((await api('passwords?q=facebook', other.cookie)).body.entries.length === 0, 'title search remains owner-private');
check((await api(`passwords?q=${encodeURIComponent(secret)}`, owner.cookie)).body.entries.length === 0, 'search never searches encrypted field values');
check((await api('passwords?q=no-such-title', owner.cookie)).body.entries.length === 0, 'missing title yields an empty successful page');
const matchingIds = [id];
for (let i = 0; i < 51; i++) {
 const nextId = randomUUID(); matchingIds.push(nextId);
 assert.equal((await api('passwords', owner.cookie, { ...save, id: nextId, writeId: randomUUID(), entry: { ...entry, title: `Facebook additional ${i}` } })).status, 200);
}
let searchCursor, matches = [];
do {
 const page = await api(`passwords?q=facebook${searchCursor ? `&cursor=${encodeURIComponent(searchCursor)}` : ''}`, owner.cookie);
 assert.equal(page.status, 200); matches.push(...page.body.entries.map(item => item.id)); searchCursor = page.body.nextCursor;
} while (searchCursor);
check(matches.length === matchingIds.length && new Set(matches).size === matches.length && matchingIds.every(id => matches.includes(id)), 'filtered pagination contains all matches once, with no nonmatches');
const catalog = await api('passwords', owner.cookie, { operation: 'catalog', expectedOwnerId: owner.id });
check(catalog.body.catalog.length === 50 && !!catalog.body.nextCursor && !JSON.stringify(catalog.body).includes(secret) && !JSON.stringify(catalog.body).includes('GEZDGNBV'), 'native catalog pages names without passwords or TOTP seeds');
const exported = await api('passwords', owner.cookie, { operation: 'export', expectedOwnerId: owner.id });
check(exported.body.entries.length === 50 && exported.body.entries.every(item => item.entry.fields[1].value === secret), 'explicit backup exports a bounded decrypted page');
check((await api('passwords?cursor=invalid', owner.cookie)).status === 400, 'malformed page cursor is rejected');
const reset = await api('auth/password-reset', null, { email: owner.email }); check(!!reset.body.resetLink, 'disposable password reset link available');
const token = new URL(reset.body.resetLink).searchParams.get('token'), newPassword = 'RecoveredPassword!2026';
check((await api('auth/password-reset/confirm', null, { token, password: newPassword })).body.ok, 'recover account password');
check((await api('passwords', owner.cookie, read)).status === 401, 'recovery revokes original session');
const login = await api('login', null, { username: owner.username, password: newPassword }); check(login.body.ok && login.cookie, 'recovered password logs in');
check((await api('passwords', login.cookie, read)).body.entry.fields[1].value === secret, 'encrypted entry survives recovery');
check((await api('passwords', login.cookie, { operation: 'delete', id, revision: 1, expectedOwnerId: owner.id })).body.ok, 'delete exact entry');
check((await api('passwords', login.cookie, save)).status === 410, 'delayed save cannot resurrect deleted entry');
check((await api('passwords', login.cookie, read)).status === 404, 'deleted secret is unavailable');
check((await api('passwords', login.cookie, { ...read, id: ids[1] })).body.entry.fields[1].value === secret, 'deleting one account preserves another account at the same service');
await api('auth/logout', login.cookie, {}); check((await api('passwords', login.cookie)).status === 401, 'logout denies session immediately');
await api('auth/logout', other.cookie, {});
console.log(`${checks} password manager API checks passed.`);
