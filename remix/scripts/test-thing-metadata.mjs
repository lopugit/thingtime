// Provision a private, disposable Mongo replica and use only synthetic accounts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const cwd = resolve(import.meta.dirname, '..');
const browser = process.argv.slice(2).includes('--browser');
const storagePolicy = process.argv.slice(2).includes('--storage-policy');
const storageBrowser = process.argv.slice(2).includes('--storage-browser');
const withBrowser = browser || storageBrowser;
assert.ok(process.argv.slice(2).every(arg => ['--browser', '--storage-policy', '--storage-browser'].includes(arg)), 'Unknown Thing metadata fixture mode');
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const { port } = probe.address();
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const directory = await mkdtemp(join(tmpdir(), 'thingtime-metadata-'));
const db = join(directory, 'db'), log = join(directory, 'mongo.log');
await mkdir(db, { mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir() };
const mongo = spawn('mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', db, '--replSet', 'thing-metadata',
  '--logpath', log, '--wiredTigerCacheSizeGB', '0.25', '--nounixsocket'], { cwd, env, stdio: 'ignore' });
const stopped = once(mongo, 'exit').catch(() => []);
let child;
const terminate = () => { child?.kill('SIGTERM'); mongo.kill('SIGTERM'); };
process.once('SIGTERM', terminate);
process.once('SIGINT', terminate);

async function run(command, args, extra = {}, timeout = 30_000) {
  child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = chunk => { output = (output + chunk).slice(-32_768); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timer = setTimeout(() => child?.kill('SIGTERM'), timeout);
  try {
    const [code] = await once(child, 'exit');
    // Fixture verification mail and presigns may contain one-use values.
    const safe = output.split('\n').filter(line => !line.includes('http')).join('\n');
    assert.equal(code, 0, safe.slice(-6000));
    return safe;
  } finally { clearTimeout(timer); child = undefined; }
}

try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    assert.equal(mongo.exitCode, null, 'Disposable MongoDB stopped before readiness');
    ready = (await readFile(log, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; })).includes('Waiting for connections');
    if (!ready) await delay(100);
  }
  assert.ok(ready, 'Disposable MongoDB did not become ready');
  await run('mongosh', ['--quiet', `mongodb://127.0.0.1:${port}/?directConnection=true`, '--eval',
    `rs.initiate({_id:'thing-metadata',members:[{_id:0,host:'127.0.0.1:${port}'}]}); while(!db.hello().isWritablePrimary){sleep(100)}`]);
  const output = await run(process.execPath, ['--import', 'tsx', 'scripts/thing-metadata.integration.mts'], {
    MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${port}/thingtime?replicaSet=thing-metadata`,
    THINGTIME_METADATA_TEST_DIRECTORY: directory, THINGTIME_EMAIL_PROVIDER: 'console', THINGTIME_METADATA_BROWSER: browser ? '1' : '0', THINGTIME_STORAGE_POLICY_TEST: storagePolicy ? '1' : '0', THINGTIME_STORAGE_BROWSER_TEST: storageBrowser ? '1' : '0',
    ...(withBrowser && process.env.TT_PLAYWRIGHT_MODULE ? { TT_PLAYWRIGHT_MODULE: process.env.TT_PLAYWRIGHT_MODULE } : {}),
    ...(withBrowser && process.env.THINGTIME_METADATA_BROWSER_EVIDENCE ? { THINGTIME_METADATA_BROWSER_EVIDENCE: process.env.THINGTIME_METADATA_BROWSER_EVIDENCE } : {})
  }, 180_000);
  for (const line of output.split('\n')) if (line.startsWith('Thing metadata ') || line.startsWith('Thing storage policy ') || line.startsWith('THING_METADATA_BROWSER_PASS') || line.startsWith('THING_STORAGE_BROWSER_PASS')) console.log(line);
} finally {
  terminate();
  await stopped;
  await rm(directory, { recursive: true, force: true });
}
