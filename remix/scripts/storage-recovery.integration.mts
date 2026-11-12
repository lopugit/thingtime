// Driver is used only for disposable replica administration. All application
// records use production route handlers and canonical API utilities.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer as socketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '..');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const exec = promisify(execFile);
if (!process.argv.includes('--child')) {
  const runtime = process.env.THINGTIME_TEST_MONGO_RUNTIME || 'native';
  assert.ok(runtime === 'native' || runtime === 'docker', 'Select native or docker for the disposable MongoDB runtime');
  assert.ok(runtime !== 'docker' || process.platform === 'linux', 'Docker replica tests require Linux host networking');
  const dir = await mkdtemp(join(tmpdir(), 'tt-storage-recovery-'));
  const probe = socketServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as any).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  await mkdir(join(dir, 'db'));
  const env = { ...(process.env.THINGTIME_EXTENSION_ACCOUNTS_UI?{THINGTIME_EXTENSION_ACCOUNTS_UI:process.env.THINGTIME_EXTENSION_ACCOUNTS_UI}:{}), ...(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE?{THINGTIME_TEST_PLAYWRIGHT_MODULE:process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE}:{}), ...(process.env.PLAYWRIGHT_BROWSERS_PATH?{PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH}:{}), PATH: process.env.PATH!, HOME: dir, TMPDIR: dir, NODE_ENV: 'test', THINGTIME_DATA_ENV: 'development',
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${port}/thingtime?replicaSet=storage_recovery`, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_USER_VAULT_KEY: randomBytes(32).toString('base64url') };
  const containerName = `tt-storage-recovery-${randomUUID()}`;
  const mongoArgs = ['--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'storage_recovery', '--nounixsocket', '--wiredTigerCacheSizeGB', '0.25'];
  // Linux CI uses an owned foreground container and tmpfs, never the API
  // suite's Mongo service, a host data directory, or an inherited database URI.
  // Host networking preserves the same loopback member port inside and out.
  const mongo = runtime === 'docker'
    ? spawn('docker', ['run', '--rm', '--name', containerName, '--network', 'host', '--mount', 'type=tmpfs,destination=/data/db', 'mongo:7', 'mongod', '--dbpath', '/data/db', ...mongoArgs], { env, stdio: 'ignore' })
    : spawn(process.env.THINGTIME_TEST_MONGOD || 'mongod', ['--dbpath', join(dir, 'db'), ...mongoArgs], { env, stdio: 'ignore' });
  let launchError: Error | undefined;
  mongo.once('error', error => { launchError = error; });
  const admin = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    // Pulling the pinned major's image on a fresh runner can take longer than
    // launching a local binary; both paths have a finite startup deadline.
    const startDeadline = Date.now() + (runtime === 'docker' ? 120_000 : 20_000);
    for (;;) { try { await admin.connect(); break; } catch (error) { if (launchError) throw new Error(`Disposable MongoDB launcher unavailable (${runtime})`); if (Date.now() >= startDeadline || mongo.exitCode !== null) throw error; await delay(200); } }
    await admin.db('admin').command({ replSetInitiate: { _id: 'storage_recovery', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let n = 0; !(await admin.db('admin').command({ hello: 1 })).isWritablePrimary; n++) { if (n > 100) throw new Error('Replica primary timeout'); await delay(100); }
    await admin.close();
    child = spawn(process.execPath, ['--import', 'tsx', script, '--child', ...process.argv.filter(arg=>['--password-records','--password-verification','--verification-ui','--native-approval-ui'].includes(arg))], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout!.on('data', data => output += data); child.stderr!.on('data', data => output += data);
    const timeout = setTimeout(() => child?.kill('SIGTERM'), 180_000);
    const [code] = await once(child, 'exit'); clearTimeout(timeout);
    if (code !== 0) throw new Error(`Integration failed:\n${output.split('\n').filter(line=>!/(?:verify-email\?token=|^subject:|^to:|^Welcome to Thingtime)/i.test(line)).join('\n').slice(-10000)}`);
    console.log(output.split('\n').filter(line => line.startsWith('PASS:')).join('\n'));
  } finally {
    await admin.close().catch(() => {}); child?.kill('SIGTERM');
    if (runtime === 'docker') await exec('docker', ['rm', '--force', containerName], { env, timeout: 10_000 }).catch(() => {});
    if (mongo.pid && mongo.exitCode === null && mongo.signalCode === null) { const exit = once(mongo, 'exit'); mongo.kill('SIGTERM'); const force = setTimeout(() => mongo.kill('SIGKILL'), 3000); await exit; clearTimeout(force); }
    await rm(dir, { recursive: true, force: true });
  }
} else {
  assert.match(process.env.MONGODB_CONNECTION_STRING || '', /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=storage_recovery$/);
  const { createServer } = await import('vite');
  const vite = await createServer({ root, configFile: false, envDir: false, appType: 'custom', server: { middlewareMode: true, hmr: process.argv.includes('--verification-ui')?{host:'127.0.0.1',port:18091}:false, ...(process.argv.includes('--verification-ui')?{}:{ws:false}), watch: null }, resolve: { alias: { '~': join(root, 'app') } } });
  const load = (path: string) => vite.ssrLoadModule('/app/' + path);
  try {
    const register = await load('routes/api/v1/auth/register/_register.tsx'), route = await load('routes/api/v1/things/_things.tsx');
    const plans = await load('api/utils/subscriptions/subscriptions.ts'), storage = await load('api/utils/storage/userStorage.ts');
    const accounted = await load('api/utils/storage/accountedThings.ts'), core = await load('api/utils/storage/storageCore.ts');
    const db = await load('api/utils/mongodb/collections.ts'), recovery = await load('api/utils/storage/userStorageRecovery.ts'), registry = await load('schemas/registry.ts');
    const origin = process.argv.includes('--password-verification') ? 'https://verification-api.test' : 'http://127.0.0.1:19897', username = `storage-${randomUUID().slice(0, 8)}`;
    const fixturePassword = randomBytes(32).toString('hex');
    const response = await register.action({ request: new Request(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email: username + '@example.invalid', password: fixturePassword }) }) });
    const registered = await response.json(); assert.equal(registered.ok, true, registered.error);
    const ownerId = registered.user.id, cookie = response.headers.getSetCookie().map((value: string) => value.split(';')[0]).join('; ');
    const call = async (method: string, body?: any, id?: string) => {
      const request = new Request(origin + '/api/v1/things' + (id ? '?id=' + encodeURIComponent(id) : ''), { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await (method === 'GET' ? route.loader : route.action)({ request }); return { status: result.status, body: await result.json() };
    };
    if (process.argv.includes('--password-verification')) {
      await (await import('./password-verification.integration')).runPasswordVerificationIntegration({load,vite,origin,ownerId,cookie,password:fixturePassword,username});
    } else if (process.argv.includes('--password-records')) {
      const passwords = await load('routes/api/v1/passwords/_passwords.tsx');
      const material = await load('passwords/browserPasskey.ts');
      const model = await load('passwords/model.ts');
      const callPasswords = async (body: any, selectedCookie = cookie, selectedOwner = ownerId) => {
        const result = await passwords.action({ request: new Request(origin + '/api/v1/passwords', { method: 'POST', headers: { Cookie: selectedCookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, expectedOwnerId: selectedOwner }) }) });
        return { status: result.status, body: await result.json() };
      };
      const request = { type: 'create', origin: 'https://credential-fixture.test', publicKey: { challenge: randomBytes(32).toString('base64url'), rp: { id: 'credential-fixture.test', name: 'Fixture' }, user: { id: 'AQID', name: 'fixture', displayName: 'Fixture' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none' } };
      const first = await material.prepareBrowserPasskeyRegistration(request, true);
      const second = await material.prepareBrowserPasskeyRegistration(request, true, [first.entry]);
      assert.notEqual(first.response.id, second.response.id);
      const payloads = [first, second].map(prepared => ({ operation: 'save', id: randomUUID(), writeId: randomUUID(), revision: 0, entry: prepared.entry }));
      for (const payload of payloads) { const saved = await callPasswords(payload); assert.equal(saved.status, 200); assert.equal(saved.body.record.id, payload.id); }
      const firstBefore = await callPasswords({ operation: 'read', id: payloads[0].id });
      assert.equal(firstBefore.status, 200); assert.deepEqual(firstBefore.body.entry, model.validatePasswordEntry(first.entry));
      assert.equal((await callPasswords(payloads[0])).body.record.revision, 1, 'Same write retry does not replace a key');
      const both = await Promise.all(payloads.map(async payload => {
        const readback = await callPasswords({ operation: 'read', id: payload.id }); assert.equal(readback.status, 200);
        assert.deepEqual(readback.body.entry, model.validatePasswordEntry(payload.entry)); return readback.body;
      }));
      assert.deepEqual(both[0], firstBefore.body, 'Saving another same-account record leaves the first unchanged');
      const catalog = await callPasswords({ operation: 'catalog' }); assert.equal(catalog.status, 200);
      assert.equal(catalog.body.catalog.filter((item: any) => item.relyingParty === request.publicKey.rp.id && item.userHandle === request.publicKey.user.id).length, 2);
      assert.deepEqual(new Set(catalog.body.catalog.map((item: any) => item.id)), new Set(payloads.map(payload => payload.id)));
      const otherName = 'other-' + randomUUID().slice(0, 8);
      const otherResponse = await register.action({ request: new Request(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: otherName, email: otherName + '@example.invalid', password: randomBytes(32).toString('hex') }) }) });
      const other = await otherResponse.json(); assert.equal(other.ok, true);
      const otherCookie = otherResponse.headers.getSetCookie().map((value: string) => value.split(';')[0]).join('; ');
      for (const payload of payloads) assert.equal((await callPasswords({ operation: 'read', id: payload.id }, otherCookie, other.user.id)).status, 404);
      console.log('PASS: disposable replica; real registration/password route handlers; two independent record UUIDs with same RP/handle; exact encrypted readback of both; first record unchanged; immutable retry and cross-account refusal. Record storage only, not simultaneous discoverable-authenticator registration.');
    } else {
    const plan = await plans.getSubscription('user', ownerId);
    assert.equal((await plans.setSubscription({ subjectType: 'user', subjectId: ownerId, ownerId, tier: plan.tier, tierVersionId: plan.tierVersionId, overrides: { userStorageBytes: null }, updatedBy: ownerId })).ok, true);
    const created = await call('POST', { thingtime: ['data'], crystal: { text: 'original' }, visibility: 'private' });
    assert.equal(created.body.ok, true, created.body.error); const id = created.body.thing.id;
    const fence = () => db.withHomeMongoTransaction((session: any) => storage.markUserStorageNeedsReconcile(ownerId, session));
    await fence();
    const edited = await call('PATCH', { id, crystal: { text: 'source updated before the independent census' } }); assert.equal(edited.body.ok, true, edited.body.error);
    assert.equal((await storage.getUserStorageUsage(ownerId)).status, 'reconciling');
    const worker = recovery.createUserStorageRecoveryWorker({ collection: db.getHomeThingsCollection, now: () => new Date(), leaseId: randomUUID, recover: storage.recoverUserStorageAccounting });
    assert.equal(await worker.run(ownerId), 'ready');
    const baseline = await storage.getUserStorageUsage(ownerId); assert.equal(baseline.status, 'ready');
    assert.equal((await call('GET', undefined, id)).body.thing.crystal.text, 'source updated before the independent census');
    await fence();
    const make = (shareId: string, count: number) => ({ shareId, schemaVersion: registry.COLLECTION_SCHEMA_VERSIONS.things, ownerId, thingtime: ['data'], acl: [registry.ACL_OWNER], targetId: null, tags: [], crystal: { text: 'x'.repeat(count) }, extended: null, createdAt: new Date(), updatedAt: new Date() });
    const insert = (doc: any) => db.withHomeMongoTransaction(async (session: any) => accounted.insertAccountedThing(await db.getHomeThingsCollection(), doc, { session, accountedPlane: 'home' }));
    const cap = 100 * 1024 * 1024; let sourceBytes = 0;
    for (let n = 0; n < 7; n++) { const doc = make(`fixture-${n}`, 14 * 1024 * 1024); sourceBytes += core.thingStorageSizeBytes(doc); await insert(doc); }
    const overhead = core.thingStorageSizeBytes(make('empty', 0));
    const fill = make('fixture-fill', cap - 512 - sourceBytes - overhead); sourceBytes += core.thingStorageSizeBytes(fill); await insert(fill); assert.equal(sourceBytes, cap - 512);
    const racing = [make('fixture-race-a', 512 - overhead), make('fixture-race-b', 512 - overhead)];
    const results = await Promise.allSettled(racing.map(insert)); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'only one concurrent final reservation commits');
    const failed = results.findIndex(result => result.status === 'rejected'); assert.equal((await call('GET', undefined, racing[failed].shareId)).status, 404, 'rejected reservation rolls back source');
    const winner = results.findIndex(result => result.status === 'fulfilled');
    await assert.rejects(db.withHomeMongoTransaction(async (session: any) => accounted.updateAccountedThing(
      await db.getHomeThingsCollection(), { shareId: racing[winner].shareId, ownerId },
      { $set: { 'crystal.text': 'y'.repeat(1000), updatedAt: new Date() } }, { session, accountedPlane: 'home' }
    )), /recovery is busy/, 'source-before-accounting UPDATE fails at the full pending budget');
    assert.equal((await call('GET', undefined, racing[winner].shareId)).body.thing.crystal.text, racing[winner].crystal.text,
      'the earlier source UPDATE and its stamp roll back when deferred admission fails');
    assert.equal(await worker.run(ownerId), 'ready');
    const exact = await storage.getUserStorageUsage(ownerId); assert.equal(exact.status, 'ready'); assert.equal(exact.usedBytes, baseline.usedBytes + cap);
    assert.equal(await worker.run(ownerId), 'skipped'); assert.equal((await storage.getUserStorageUsage(ownerId)).usedBytes, exact.usedBytes);
    console.log('PASS: disposable replica; real registration and Things create/update/read; canonical unlimited plan; durable queue; concurrent100MiB cap and insert/update rollback; independent exact census and repeated drain without replay; isolated environment with no production data');
    }
  } finally { await vite.close(); }
  process.exit(0);
}
