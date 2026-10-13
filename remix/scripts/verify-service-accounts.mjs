// Disposable local database only. Exercises real routes, storage, session walls
// and concurrent connect/unlink without making calls to paid provider APIs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.argv[2];
if (!base || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('Pass the disposable local stack URL. Remote targets are refused.');
}
let checks = 0;
const check = (condition, name) => {
  assert.ok(condition, name);
  checks++;
  console.log(`✓ ${name}`);
};
const request = async (path, cookie, body, extra = {}) => {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, data: await response.json() };
};
const register = async () => {
  const username = `qa-library-${randomUUID().slice(0, 8)}`;
  const { response, data } = await request('auth/register', null, { username, password: 'DisposableQA!2026', email: `${username}@example.test` });
  assert.equal(response.status, 200);
  return { id: data.user.id, cookie: /tt_auth=[^;]+/.exec(response.headers.get('set-cookie'))?.[0] };
};
const a = await register(),
  b = await register();
check(a.id !== b.id && a.cookie && b.cookie, 'two independently authenticated test users');
const save = (name, expectedOwnerId = a.id) =>
  request('lopu/vault', a.cookie, {
    action: 'save-provider',
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    name,
    token: `sk-test-${name}`,
    expectedOwnerId
  });
const first = await save('personal'),
  second = await save('work');
check(first.data.ok && second.data.ok && first.data.entry.id !== second.data.entry.id, 'two API accounts saved separately');
let vault = await request('lopu/vault', a.cookie);
check(vault.data.ownerId === a.id && vault.data.entries.length === 2, 'vault metadata is bound to the session owner');
check(!JSON.stringify(vault.data).includes('sk-test-'), 'no plaintext tokens in vault projection');
check(vault.response.headers.get('cache-control').includes('no-store'), 'vault projection is not HTTP cached');
check((await request('lopu/vault', b.cookie)).data.entries.length === 0, 'another account sees no saved entries');
check(!(await request('lopu/vault', b.cookie, { action: 'delete', id: first.data.entry.id })).data.ok, 'another owner cannot delete the credential');
check((await save('wrong-session', b.id)).response.status === 409, 'a stale form cannot save into a different signed-in account');
check(
  (await request('connections/oauth/begin', a.cookie, { provider: 'google', expectedOwnerId: b.id })).response.status === 409,
  'OAuth start refuses a stale account context'
);
check(
  (await request('connections/oauth/begin', a.cookie, { provider: 'google' }, { 'Content-Type': 'text/plain' })).response.status === 415,
  'OAuth start refuses cross-site simple form requests'
);
const firstLinks = await Promise.all(
  Array.from({ length: 6 }, () => request('connections', a.cookie, { provider: 'demo', fields: { handle: 'race-fixture' } }))
);
check(
  firstLinks.every((result) => result.data.ok),
  'concurrent first connections all complete idempotently'
);
const linked = await request('connections', a.cookie, { provider: 'demo', fields: { handle: 'race-fixture' }, expectedOwnerId: a.id });
check(linked.data.ok, 'public fixture linked through real API');
const id = linked.data.connection.id;
await Promise.all([
  request('connections', a.cookie, { provider: 'demo', fields: { handle: 'race-fixture' } }),
  request('connections/unlink', a.cookie, { id })
]);
const reconnected = await request('connections', a.cookie, { provider: 'demo', fields: { handle: 'race-fixture' } });
const list = await request('connections', a.cookie);
check(
  reconnected.data.ok && list.data.connections.length === 1 && list.data.connections[0].account.displayName,
  'concurrent reconnect/disconnect recovers a complete account and link'
);
check(list.data.ownerId === a.id, 'connection list identifies its owner');
const feed = await request('connections/feed?sync=defer', a.cookie);
check(feed.data.ownerId === a.id, 'feed response identifies its owner');
check((await request('connections/filters', a.cookie)).data.ownerId === a.id, 'filter response identifies its owner');
check(
  (await request('connections/request', b.cookie, { connectionId: id, operation: 'account.profile' })).response.status === 404,
  'connection operation refuses another owner'
);
check(
  (await request('connections/request', a.cookie, { connectionId: id, operation: 'https://example.test' })).response.status === 400,
  'arbitrary operation URLs are refused'
);
check(
  (await request('connections/request', a.cookie, { connectionId: id, operation: 'account.profile' }, { 'Content-Type': 'text/plain' })).response
    .status === 415,
  'provider operations require JSON'
);
const docs = await request('connections/request-docs');
check(docs.response.ok && docs.data.docs.endpoint === '/api/v1/connections/request', 'new route and docs registry agree');
await request('connections/unlink', a.cookie, { id });
for (const entry of [first.data.entry, second.data.entry]) await request('lopu/vault', a.cookie, { action: 'delete', id: entry.id });
vault = await request('lopu/vault', a.cookie);
check(
  vault.data.entries.length === 0 && (await request('connections', a.cookie)).data.connections.length === 0,
  'test credentials and links removed through their APIs'
);
console.log(`${checks} service-account checks passed.`);
