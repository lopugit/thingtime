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
  const env = { PATH: process.env.PATH!, HOME: dir, TMPDIR: dir, NODE_ENV: 'test', THINGTIME_DATA_ENV: 'development',
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${port}/thingtime?replicaSet=storage_recovery`, JWT_SECRET: randomBytes(48).toString('hex') };
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
    child = spawn(process.execPath, ['--import', 'tsx', script, '--child'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout!.on('data', data => output += data); child.stderr!.on('data', data => output += data);
    const timeout = setTimeout(() => child?.kill('SIGTERM'), 180_000);
    const [code] = await once(child, 'exit'); clearTimeout(timeout);
    if (code !== 0) throw new Error(`Integration failed:\n${output.slice(-10000)}`);
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
  const vite = await createServer({ root, configFile: false, envDir: false, appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, resolve: { alias: { '~': join(root, 'app') } } });
  const load = (path: string) => vite.ssrLoadModule('/app/' + path);
  try {
    const register = await load('routes/api/v1/auth/register/_register.tsx'), route = await load('routes/api/v1/things/_things.tsx');
    const plans = await load('api/utils/subscriptions/subscriptions.ts'), storage = await load('api/utils/storage/userStorage.ts');
    const accounted = await load('api/utils/storage/accountedThings.ts'), core = await load('api/utils/storage/storageCore.ts');
    const db = await load('api/utils/mongodb/collections.ts'), recovery = await load('api/utils/storage/userStorageRecovery.ts'), registry = await load('schemas/registry.ts');
    const origin = 'http://127.0.0.1:19897', username = `storage-${randomUUID().slice(0, 8)}`;
    const response = await register.action({ request: new Request(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, email: username + '@example.invalid', password: randomBytes(32).toString('hex') }) }) });
    const registered = await response.json(); assert.equal(registered.ok, true, registered.error);
    const ownerId = registered.user.id, cookie = response.headers.getSetCookie().map((value: string) => value.split(';')[0]).join('; ');
    const call = async (method: string, body?: any, id?: string) => {
      const request = new Request(origin + '/api/v1/things' + (id ? '?id=' + encodeURIComponent(id) : ''), { method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await (method === 'GET' ? route.loader : route.action)({ request }); return { status: result.status, body: await result.json() };
    };
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
  } finally { await vite.close(); }
  process.exit(0);
}
