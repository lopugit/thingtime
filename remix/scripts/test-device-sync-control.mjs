/** Own a disposable replica and invoke the compiled server with synthetic users.
 * Never load .env, inherit credentials, modify an existing DB, or start Vite. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, chmod, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
const [bundleArgument, mongodArgument] = process.argv.slice(2);
assert.ok(bundleArgument && mongodArgument && process.argv.length === 4, 'Usage: test-device-sync-control.mjs <compiled server/index.mjs> <mongod executable>');
const bundle = await realpath(resolve(bundleArgument)), mongod = await realpath(resolve(mongodArgument));
const directory = await mkdtemp(join(tmpdir(), 'thingtime-sync-control-'));
await chmod(directory, 0o700); await mkdir(join(directory, 'db'));
const cleanEnv = { PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir(), NODE_ENV: 'test' };
let mongo, worker;
try {
  for (const port of [28179, 28180]) {
    const probe = createServer(); probe.listen(port, '127.0.0.1'); await once(probe, 'listening'); await new Promise(resolve => probe.close(resolve));
  }
  mongo = spawn(mongod, ['--bind_ip', '127.0.0.1', '--port', '28179', '--dbpath', join(directory, 'db'), '--replSet', 'sync-control-fixture',
    '--logpath', join(directory, 'mongo.log'), '--wiredTigerCacheSizeGB', '0.25', '--nounixsocket'], { env: cleanEnv, stdio: 'ignore' });
  const deadline = Date.now() + 30_000;
  while (!(await readFile(join(directory, 'mongo.log'), 'utf8').catch(() => '')).includes('Waiting for connections')) {
    assert.ok(Date.now() < deadline && mongo.exitCode === null, 'Disposable mongod failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const client = new MongoClient('mongodb://127.0.0.1:28179/?directConnection=true', { serverSelectionTimeoutMS: 1000 });
  try {
    await client.connect();
    await client.db('admin').command({ replSetInitiate: { _id: 'sync-control-fixture', members: [{ _id: 0, host: '127.0.0.1:28179' }] } });
    while (!(await client.db('admin').command({ hello: 1 })).isWritablePrimary) {
      assert.ok(Date.now() < deadline, 'Disposable replica election timed out'); await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally { await client.close(); }
  worker = spawn(process.execPath, ['scripts/device-sync-control.integration.mjs'], { cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit', env: {
    ...cleanEnv, MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:28179/thingtime?replicaSet=sync-control-fixture',
    THINGTIME_SYNC_CONTROL_TEST_DIRECTORY: directory, THINGTIME_SYNC_CONTROL_BUNDLE: bundle,
    JWT_SECRET: randomUUID() + randomUUID(), APP_URL: 'http://127.0.0.1:28180', THINGTIME_EMAIL_PROVIDER: 'console'
  } });
  const timer = setTimeout(() => worker.kill('SIGTERM'), 120_000);
  try { const [code] = await once(worker, 'exit'); assert.equal(code, 0, 'Compiled replica acceptance failed'); } finally { clearTimeout(timer); }
} finally {
  worker?.kill('SIGTERM');
  if (mongo && mongo.exitCode === null) { mongo.kill('SIGTERM'); await once(mongo, 'exit'); }
  await rm(directory, { recursive: true, force: true });
}
