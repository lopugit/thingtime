// Real API acceptance against a disposable local database. Never print tokens.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.argv[2];
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('A disposable local stack is required.');
let checks = 0;
const check = (condition, name) => {
  assert.ok(condition, name);
  checks++;
  console.log(`✓ ${name}`);
};
const api = async (path, cookie, body) => {
  const response = await fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: await response.json(), cookie: /tt_auth=[^;]+/.exec(response.headers.get('set-cookie'))?.[0] };
};
const username = `qa-vault-${randomUUID().slice(0, 8)}`,
  email = `${username}@example.test`;
const oldPassword = 'DisposableOriginal!2026',
  newPassword = 'DisposableRecovered!2026';
const created = await api('auth/register', null, { username, email, password: oldPassword });
check(created.body.ok && created.cookie, 'register with a password-backed account vault');
const cookie = created.cookie,
  owner = created.body.user.id;
const entries = [];
for (const name of ['personal', 'work']) {
  const saved = await api('lopu/vault', cookie, {
    action: 'save-provider',
    expectedOwnerId: owner,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    name,
    token: `sk-fixture-${name}`
  });
  check(saved.body.ok, `save independently encrypted ${name} account`);
  entries.push(saved.body.entry.id);
}
const reveal = (session, password, id = entries[0]) => api('vault/reveal', session, { vault: 'personal', id, action: 'reveal', password });
check((await reveal(cookie, oldPassword)).body.value === 'sk-fixture-personal', 'live session and fresh password decrypt the selected credential');
check((await reveal(cookie, 'wrong password')).status === 401, 'incorrect password cannot reveal the credential');
const reset = await api('auth/password-reset', null, { email });
check(!!reset.body.resetLink, 'local reset flow provides a one-use test link');
const token = new URL(reset.body.resetLink).searchParams.get('token');
check(
  (await api('auth/password-reset/confirm', null, { token, password: newPassword })).body.ok,
  'password recovery succeeds with saved credentials'
);
check((await api('lopu/vault', cookie)).status === 401, 'recovery revokes the previous session');
check((await api('login', null, { username, password: oldPassword })).status === 401, 'previous password no longer signs in');
const login = await api('login', null, { username, password: newPassword });
check(login.body.ok && login.cookie, 'new password signs in and restores access');
check((await reveal(login.cookie, newPassword)).body.value === 'sk-fixture-personal', 'first credential survives password recovery');
check((await reveal(login.cookie, newPassword, entries[1])).body.value === 'sk-fixture-work', 'second credential survives password recovery');
const listing = await api('lopu/vault', login.cookie);
check(
  listing.body.entries.length === 2 && !JSON.stringify(listing.body).includes('sk-fixture'),
  'normal listing remains metadata only after recovery'
);
check((await api('auth/password-reset/confirm', null, { token, password: oldPassword })).status === 400, 'reset token replay is rejected');
check((await api('lopu/vault', login.cookie, { action: 'delete', id: entries[0] })).body.ok, 'remove only the first saved account');
check((await api('lopu/vault', login.cookie)).body.entries.length === 1, 'second account remains after independent removal');
check((await reveal(login.cookie, newPassword, entries[1])).body.value === 'sk-fixture-work', 'remaining credential still decrypts');
await api('lopu/vault', login.cookie, { action: 'delete', id: entries[1] });
await api('auth/logout', login.cookie, {});
check((await api('lopu/vault', login.cookie)).status === 401, 'logout immediately denies old session access');
console.log(`${checks} vault recovery checks passed.`);
