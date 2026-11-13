import assert from 'node:assert/strict';
import { join } from 'node:path';

// Reuses the real HTTP harness's disposable replica and API-created users.
// No direct Mongo access or business-data fixtures bypass the API.
export async function runAclProvisioningAcceptance({ request, owner, stranger, checks, start, port, waitFor, cwd, ports }) {
  const adminOrigin = `http://127.0.0.1:${await port()}`;
  const server = start(process.execPath, [join(cwd, '.output/server/index.mjs')], {
    PORT: new URL(adminOrigin).port, ADMIN_USERNAMES: owner.data.user.username
  });
  await waitFor(async () => {
    assert.equal(server.exitCode, null, 'Provisioning acceptance server stays running');
    try { return (await fetch(adminOrigin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
  }, 'admin provisioning HTTP server');
  const call = (path, args = {}) => request(path, { ...args, targetOrigin: adminOrigin, requestOrigin: adminOrigin });
  const manifest = (await call('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.features['api.admin-migrations-run'].version, '1.6.1');
  assert.equal(manifest.features['api.admin-migrations'].version, '1.5.0');
  const path = '/api/v1/admin/migrations/run', migration = 'provision-relational-acl-validator';
  await call(path, { body: { migration, dryRun: true }, status: 401 });
  await call(path, { cookie: stranger.cookie, body: { migration, dryRun: true }, status: 403 });
  const run = (dryRun, args = {}) => call(path, { cookie: owner.cookie, body: { migration, dryRun }, ...args });
  for (let n = 0; n < 2; n++) {
    const dry = await run(true);
    assert.equal(dry.data.report.matched, 1, 'Repeated dry run must leave protection unprovisioned');
    assert.equal(dry.data.report.migrated, 0);
    assert.match(dry.response.headers.get('cache-control'), /no-store/);
  }
  checks.push('real built admin API authenticates admin, refuses anonymous/non-admin and repeated dry run leaves collection protection pending without DDL');
  const result = await run(false);
  assert.equal(result.data.report.migrated, 1);
  assert.equal((await run(true)).data.report.matched, 0);
  assert.equal((await run(false)).data.report.migrated, 0);
  const status = (await call('/api/v1/admin/migrations', { cookie: owner.cookie })).data;
  assert.equal(status.migrations.find(item => item.id === migration)?.pending, 0);
  checks.push('real built admin API provisions canonical validator, independently reads ready metadata and repeated real run is idempotent');
  const selected = await call('/api/v1/mongodb/endpoint', { cookie: owner.cookie,
    body: { url: `mongodb://127.0.0.1:${ports.db}/provisioning_custom_fixture?replicaSet=agentreporting` } });
  const customCookie = owner.cookie + '; ' + selected.cookie;
  for (const dryRun of [true, false]) {
    const refused = await run(dryRun, { cookie: customCookie, status: 503 });
    assert.match(refused.data.error, /selection\/wrong-plane/);
    assert.equal(refused.data.outcome, 'rejected');
  }
  assert.equal((await run(true)).data.report.matched, 0, 'Home readiness remains intact');
  checks.push('custom data-plane requests fail before migration lease/provisioning and preserve home protection');
  const created = (await call('/api/v1/things', { cookie: owner.cookie, body: {
    thingtime: ['data'], acl: ['tt:user'], crystal: { text: 'Provisioned runtime ACL acceptance' }
  } })).data;
  const id = created.thing?.id || created.id; assert(id);
  const entry = `tt:user/${stranger.data.user.username}`;
  await call('/api/v1/things/acl', { cookie: owner.cookie, body: { id, operation: 'add', entries: [entry] } });
  await call('/api/v1/things?id=' + id, { cookie: stranger.cookie });
  await call('/api/v1/things/acl', { cookie: owner.cookie, body: { id, operation: 'remove', entries: [entry] } });
  await call('/api/v1/things?id=' + id, { cookie: stranger.cookie, status: 404 });
  checks.push('canonical real HTTP ACL grant/read/revoke works after admin provisioning and revocation remains enforced');
}
