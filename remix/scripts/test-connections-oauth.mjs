// Disposable replica only. No inherited app configuration or real credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise(done => probe.close(done));
const directory = await mkdtemp(join(tmpdir(), 'thingtime-connections-oauth-'));
await chmod(directory, 0o700);
await mkdir(join(directory, 'db'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir() };
const mongo = spawn(process.env.THINGTIME_TEST_MONGOD || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', join(directory, 'db'), '--replSet', 'connections-oauth', '--logpath', join(directory, 'mongod.log'), '--wiredTigerCacheSizeGB', '0.25', '--nounixsocket'], { env, stdio: 'ignore' });
const stopped = once(mongo, 'exit');
let child;
const terminate = () => { child?.kill('SIGTERM'); mongo.kill('SIGTERM'); };
process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
try {
  const deadline = Date.now() + 30000;
  while (!(await readFile(join(directory, 'mongod.log'), 'utf8').catch(() => '')).includes('"msg":"Waiting for connections"')) {
    assert.equal(mongo.exitCode, null, 'Disposable mongod exited');
    assert.ok(Date.now() < deadline, 'Disposable mongod readiness timed out');
    await new Promise(done => setTimeout(done, 100));
  }
  child = spawn('mongosh', ['--quiet', `mongodb://127.0.0.1:${port}/?directConnection=true`, '--eval', `rs.initiate({_id:'connections-oauth',members:[{_id:0,host:'127.0.0.1:${port}'}]}); while(!db.hello().isWritablePrimary){sleep(100)}`], { env, stdio: 'ignore' });
  let timer = setTimeout(() => child.kill('SIGTERM'), 30000);
  assert.equal((await once(child, 'exit'))[0], 0, 'Replica bootstrap failed'); clearTimeout(timer);
  child = spawn(process.execPath, ['--import', 'tsx', 'scripts/connections-oauth.integration.mts'], { cwd: resolve(import.meta.dirname, '..'), env: { ...env, NODE_ENV: 'test', THINGTIME_EMAIL_PROVIDER: 'console', MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${port}/thingtime?replicaSet=connections-oauth`, CONNECTIONS_TEST_DIRECTORY: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
  timer = setTimeout(() => child.kill('SIGTERM'), 180000);
  const [code] = await once(child, 'exit'); clearTimeout(timer);
  const proof = output.split('\n').find(line => line.startsWith('{"connectionsOAuthProof":'));
  // Never forward console mail links, fixture cookies, or registration output.
  if (code !== 0 || !proof) {
    const diagnostic = output.split('\n').filter(line => line.startsWith('CONNECTIONS_TEST_FAILURE ')).at(-1);
    throw Error(diagnostic || 'Disposable OAuth route proof failed without a sanitized diagnostic');
  }
  console.log(proof);
} finally {
  terminate(); await stopped; await rm(directory, { recursive: true, force: true });
}
