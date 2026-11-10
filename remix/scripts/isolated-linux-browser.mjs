// Linux acceptance harness for the existing packaged app runtime. This is not
// the installed Mac app/agent-browser manager and must not be reported as such.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { closeSync, createReadStream, existsSync, openSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const remix = path.resolve(path.dirname(script), '..');
const repository = path.dirname(remix);
const runtime = path.join(repository, 'electron/lib/agent-browsers/runtime/application.cjs');
const [operation, directory, ...args] = process.argv.slice(2);
const origin = 'http://127.0.0.1:18721';
const runtimePath = `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

assert.equal(process.platform, 'linux', 'This harness requires Linux namespaces; no permissive fallback.');
assert.ok(directory && path.isAbsolute(directory), 'Supply a private absolute fixture directory.');
const state = path.resolve(directory);
const metadataPath = path.join(state, 'runtime.json');
const namespacePath = path.join(state, 'namespace.json');
const testUrls = new Set(['TT_DRAFT_TEST_BASE', 'TT_DRAFT_WEB_BASE', 'TT_BLOCKS_TEST_ORIGIN', 'TT_THEME_VERSIONS_URL', 'TT_ALGORITHM_HISTORY_URL',
  'TT_INHERITED_AUDIENCE_URL', 'TT_ANONYMOUS_THEME_HISTORY_URL', 'TT_ACCOUNT_THEME_HISTORY_URL',
  'TT_ACCOUNT_THEME_ORGANIZATION_URL', 'TT_ACCOUNT_THEME_IMPORT_URL', 'TT_LOCAL_ACCOUNT_DRAFTS_URL',
  'TT_LOCAL_INSTRUCTIONS_URL', 'TT_LOCAL_MAIL_SETTINGS_URL', 'TT_LINKED_GALLERY_URL']);
const testPaths = new Set(['PLAYWRIGHT_BROWSERS_PATH', 'TT_DRAFT_ARTIFACT_DIR', 'TT_BLOCKS_TEST_ARTIFACTS', 'TT_BLOCKS_TEST_FIXTURE', 'TT_BLOCKS_PUPPETEER',
  'TT_THEME_VERSIONS_ARTIFACTS', 'TT_ALGORITHM_HISTORY_ARTIFACTS', 'TT_INHERITED_AUDIENCE_ARTIFACTS',
  'TT_ANONYMOUS_THEME_HISTORY_ARTIFACTS', 'TT_ACCOUNT_THEME_HISTORY_ARTIFACTS',
  'TT_ACCOUNT_THEME_ORGANIZATION_ARTIFACTS', 'TT_ACCOUNT_THEME_IMPORT_ARTIFACTS', 'TT_LOCAL_ACCOUNT_DRAFTS_ARTIFACTS',
  'TT_LOCAL_INSTRUCTIONS_ARTIFACTS', 'TT_LOCAL_MAIL_SETTINGS_ARTIFACTS', 'TT_LINKED_GALLERY_ARTIFACTS']);

const childExit = child => new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});

async function liveOwner() {
  const namespace = JSON.parse(await readFile(namespacePath, 'utf8'));
  const command = (await readFile(`/proc/${namespace.supervisorPid}/cmdline`, 'utf8')).split('\0');
  assert.ok(command.includes(script) && command.includes(state) && command.includes('inside'), 'Fixture process identity changed.');
  for (const [kind, key] of [['net', 'net-namespace'], ['mnt', 'mnt-namespace'], ['pid', 'pid-namespace']]) {
    assert.equal(await readlink(`/proc/${namespace['child-pid']}/ns/${kind}`), `${kind}:[${namespace[key]}]`, 'Fixture namespace identity changed.');
  }
  return namespace;
}

async function isolationProof() {
  assert.ok(Object.values(os.networkInterfaces()).flat().every(address => address.internal), 'Only loopback may exist.');
  const denied = [];
  for (const host of ['203.0.113.1', '::ffff:203.0.113.1', '2001:db8::1', 'blocked.invalid']) {
    const code = await new Promise(resolve => {
      const socket = net.connect({ host, port: 443 });
      socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); });
      socket.once('error', error => resolve(error.code));
      socket.setTimeout(1500, () => { socket.destroy(); resolve('TIMEOUT'); });
    });
    assert.ok(['EPERM', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code), `Network isolation failed: ${host}: ${code}`);
    denied.push({ host, code });
  }
  const redirect = createServer((_request, response) => { response.writeHead(302, { Location: 'http://blocked.invalid/' }); response.end(); });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${redirect.address().port}`, { signal: AbortSignal.timeout(3000) }), error =>
      ['EPERM', 'EACCES', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.cause?.code));
  } finally { await new Promise(resolve => redirect.close(resolve)); }
  return { mode: 'linux-network-namespace', interfaces: ['loopback'], denied, backendRedirectDenied: true };
}

if (operation === 'start') {
  const mongod = args[0];
  assert.ok(args.slice(1).every(value => ['--admin-fixture', '--vault-fixture'].includes(value)), 'Unsupported fixture option.');
  const prepareAdministrator = args.includes('--admin-fixture');
  const configureVault = args.includes('--vault-fixture');
  assert.ok(mongod && path.isAbsolute(mongod), 'Supply a verified absolute mongod executable.');
  assert.ok(existsSync(path.join(remix, '.output/server/index.mjs')), 'Build the node-server app first.');
  // Never reuse a fixture's browser profile, database or generated credentials.
  await mkdir(state, { mode: 0o700 });
  await chmod(state, 0o700);
  await mkdir(path.join(state, 'home'), { mode: 0o700 });
  await mkdir(path.join(state, 'artifacts'), { mode: 0o700 });
  const application = path.join(state, 'application');
  const { copyApplication } = createRequire(import.meta.url)(path.join(repository, 'electron/lib/agent-browsers/images.cjs'));
  await copyApplication(path.join(remix, '.output'), application);
  const buildHash = createHash('sha256');
  let fileCount = 0, byteCount = 0;
  async function fingerprint(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await fingerprint(file);
      else {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) { hash.update(chunk); byteCount += chunk.length; }
        buildHash.update(path.relative(application, file) + '\0' + hash.digest('hex') + '\0');
        fileCount++;
      }
    }
  }
  await fingerprint(application);
  await writeFile(path.join(state, 'artifacts/build.json'), JSON.stringify({ format: 'thingtime.linux-test-build.v1',
    sha256: buildHash.digest('hex'), files: fileCount, bytes: byteCount }, null, 2));
  await mkdir(path.join(state, 'system'), { mode: 0o700 });
  for (const [name, content] of Object.entries({
    passwd: `pwuser:x:${process.getuid()}:${process.getgid()}:Disposable fixture:/home/pwuser:/bin/sh\n`,
    group: `pwuser:x:${process.getgid()}:\n`,
    hosts: '127.0.0.1 localhost\n::1 localhost\n203.0.113.1 blocked.invalid\n',
    'resolv.conf': 'nameserver 192.0.2.1\noptions attempts:1 timeout:1\n',
    'nsswitch.conf': 'passwd: files\ngroup: files\nhosts: files dns\n'
  })) await writeFile(path.join(state, 'system', name), content, { mode: 0o600 });
  const mounts = [
    '--unshare-user', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--unshare-pid', '--die-with-parent', '--info-fd', '3',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin',
    '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--tmpfs', '/usr/local/bin',
    '--dir', '/home', '--dir', '/root', '--dir', '/run', '--tmpfs', '/tmp',
    '--bind', state, state, '--ro-bind', application, application, '--bind', path.join(state, 'home'), '/home/pwuser'
  ];
  // MongoDB's bundled allocator requires the kernel's CPU topology files.
  mounts.push('--ro-bind', '/sys/devices/system/cpu', '/sys/devices/system/cpu');
  // Read-only diagnostics cover the managed workspace cgroup, including other
  // concurrent jobs; they are not per-fixture memory or OOM counters.
  for (const name of ['memory.current', 'memory.events']) {
    const source = `/sys/fs/cgroup/${name}`;
    if (existsSync(source)) mounts.push('--ro-bind', source, source);
  }
  // Mount only the executing Node installation, system libraries/fonts, the
  // explicit test sources and packaged application. No host root, home, /run,
  // .git, project configuration, browser profile or credential tree is mounted.
  const nodeInstallation = path.dirname(path.dirname(process.execPath));
  if (!nodeInstallation.startsWith('/usr/')) mounts.push('--ro-bind', nodeInstallation, nodeInstallation);
  if (path.dirname(process.execPath) === '/usr/local/bin') mounts.push('--ro-bind', process.execPath, process.execPath);
  for (const name of ['app', 'scripts', 'node_modules', 'package.json', 'tsconfig.json']) {
    mounts.push('--ro-bind', path.join(remix, name), path.join(remix, name));
  }
  for (const name of ['dist', 'test', 'node_modules', 'package.json']) {
    const source = path.join(repository, 'MCP', name);
    if (existsSync(source)) mounts.push('--ro-bind', source, source);
  }
  mounts.push('--ro-bind', runtime, runtime);
  for (const name of ['ld.so.cache', 'fonts']) if (existsSync(`/etc/${name}`)) mounts.push('--ro-bind', `/etc/${name}`, `/etc/${name}`);
  for (const name of await readdir(path.join(state, 'system'))) mounts.push('--ro-bind', path.join(state, 'system', name), `/etc/${name}`);
  mounts.push('--ro-bind', application, '/opt/thingtime-app',
    '--ro-bind', mongod, '/usr/local/bin/mongod', '--proc', '/proc', '--dev', '/dev');
  // Source/dependency fixtures occasionally include dotenv examples. Mask all
  // dotenv filenames in mounted project trees, including nested ones.
  async function maskEnvironmentFiles(source, destination) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name), to = path.join(destination, entry.name);
      if (entry.isDirectory()) await maskEnvironmentFiles(from, to);
      else if (entry.name === '.env' || entry.name.startsWith('.env.')) mounts.push('--ro-bind', '/dev/null', to);
    }
  }
  for (const name of ['app', 'scripts', 'node_modules']) await maskEnvironmentFiles(path.join(remix, name), path.join(remix, name));
  for (const name of ['dist', 'test', 'node_modules']) {
    const source = path.join(repository, 'MCP', name);
    if (existsSync(source)) await maskEnvironmentFiles(source, source);
  }
  await maskEnvironmentFiles(application, '/opt/thingtime-app');
  mounts.push('--clearenv', '--setenv', 'PATH', runtimePath, '--setenv', 'HOME', '/home/pwuser',
    '--setenv', 'TMPDIR', '/tmp', '--setenv', 'NODE_PATH', path.join(remix, 'node_modules'),
    '--chdir', remix, process.execPath, script, 'inside', state,
    ...(prepareAdministrator ? ['--admin-fixture'] : []), ...(configureVault ? ['--vault-fixture'] : []));
  const child = spawn('/usr/bin/bwrap', mounts, { stdio: ['ignore', 'inherit', 'inherit', 'pipe'] });
  let info = '', namespaceInfo;
  child.stdio[3].on('data', chunk => { info += chunk; });
  child.stdio[3].on('end', () => {
    try {
      namespaceInfo = { ...JSON.parse(info), supervisorPid: child.pid };
      void writeFile(namespacePath, JSON.stringify(namespaceInfo), { mode: 0o600 });
    }
    catch { child.kill('SIGTERM'); }
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  process.exitCode = await childExit(child);
  // Artifacts survive; all mutable account, database and browser state is gone.
  await rm(path.join(state, 'home'), { recursive: true, force: true });
  await rm(application, { recursive: true, force: true });
  await rm(metadataPath, { force: true });
  await rm(namespacePath, { force: true });
  let namespaceRemains = false;
  if (namespaceInfo) {
    try { namespaceRemains = await readlink(`/proc/${namespaceInfo['child-pid']}/ns/net`) === `net:[${namespaceInfo['net-namespace']}]`; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.equal(namespaceRemains, false, 'Fixture namespace did not terminate.');
  await writeFile(path.join(state, 'artifacts/cleanup.json'), JSON.stringify({ namespaceStopped: true,
    privateHomeAndDatabaseRemoved: !existsSync(path.join(state, 'home')), runtimeMetadataRemoved: !existsSync(metadataPath),
    artifactsRetained: true }, null, 2));
} else if (operation === 'inside') {
  const proof = await isolationProof();
  console.log('Linux network isolation preflight passed.');
  const childProcesses = createRequire(import.meta.url)('node:child_process');
  const spawnRuntimeChild = childProcesses.spawn;
  childProcesses.spawn = (command, argv, options) => {
    let diagnostic;
    if (path.basename(command) === 'mongod') {
      diagnostic = openSync(path.join(state, 'mongod-startup.log'), 'a', 0o600);
      options = { ...options, stdio: ['ignore', diagnostic, diagnostic] };
    }
    const child = spawnRuntimeChild(command, argv, options);
    if (diagnostic !== undefined) closeSync(diagnostic);
    child.once('error', error => console.error(`Disposable ${path.basename(command)} failed to start: ${error.code}`));
    child.once('exit', (code, signal) => { if (code !== 0) console.error(`Disposable ${path.basename(command)} exited: ${code ?? signal}`); });
    return child;
  };
  const { startApplication, stopApplication } = createRequire(import.meta.url)(runtime);
  const sessionId = randomUUID();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopApplication();
    await rm(metadataPath, { force: true });
    process.exit(0);
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const application = await startApplication(sessionId, { prepareAdministrator: args.includes('--admin-fixture'),
      configureVault: args.includes('--vault-fixture') });
    assert.ok(application, 'The packaged application is required.');
    if (application.administrator) await writeFile(path.join(state, 'home/admin-fixture.json'),
      JSON.stringify(application.administrator), { mode: 0o600, flag: 'wx' });
    await rm(path.join(state, 'mongod-startup.log'), { force: true });
    const metadata = { pid: process.pid, uid: process.getuid(), origin, sessionId, proof };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
    await writeFile(path.join(state, 'artifacts/isolation.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify({ ready: true, origin, state, proof }));
    await new Promise(() => {});
  } finally {
    await stopApplication();
  }
} else if (operation === 'run') {
  const namespace = await liveOwner();
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.uid, process.getuid(), 'Fixture must belong to the executing user.');
  assert.equal(metadata.origin, origin);
  const command = args[0] === '--' ? args.slice(1) : args;
  assert.ok(command.length, 'Supply the test command after --.');
  // Test-specific switches are explicit; inherited credentials/configuration
  // never enter the browser/backend environment.
  const testEnvironment = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (testUrls.has(key)) { assert.equal(value, origin, `${key} must select this fixture.`); testEnvironment.push([key, value]); }
    if (testPaths.has(key)) { assert.ok(path.isAbsolute(value) && path.resolve(value).startsWith(state + path.sep), `${key} must stay inside this fixture.`); testEnvironment.push([key, value]); }
    if (key === 'TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE') {
      assert.equal(value, path.join(state, 'home/admin-fixture.json'), 'Use only this fixture\'s generated administrator.');
      assert.ok(existsSync(value), 'Start this fixture with --admin-fixture first.');
      testEnvironment.push([key, value]);
    }
    if (key === 'TT_SHARED_PLAYWRIGHT_PATH') {
      assert.ok(path.resolve(value).startsWith(path.dirname(path.dirname(process.execPath)) + path.sep));
      testEnvironment.push([key, value]);
    }
    if (key === 'TT_SHARED_CHROME_PATH' || key === 'TT_BLOCKS_CHROME') {
      assert.ok(['/usr/bin/chromium', '/usr/lib/chromium/chromium'].includes(value));
      testEnvironment.push([key, value]);
    }
  }
  const child = spawn('/usr/bin/nsenter', [
    '--target', String(namespace['child-pid']), '--user', '--net', '--mount', '--pid', '--root', '--preserve-credentials',
    '/usr/bin/env', `--chdir=${remix}`, '-i', `PATH=${runtimePath}`, 'HOME=/home/pwuser', 'TMPDIR=/tmp',
    ...testEnvironment.map(([key, value]) => `${key}=${value}`),
    `TT_RENDER_ORIGIN=${origin}`, `TT_RENDER_SESSION=${metadata.sessionId}`,
    `TT_DRAFT_TEST_SESSION=${metadata.sessionId}`, `TT_BLOCKS_TEST_SESSION=${metadata.sessionId}`, ...command
  ], { cwd: remix, stdio: 'inherit' });
  process.exitCode = await childExit(child);
} else if (operation === 'stop') {
  const namespace = await liveOwner();
  process.kill(namespace.supervisorPid, 'SIGTERM');
} else if (operation === 'inside-check') {
  const proof = await isolationProof();
  const namespace = JSON.parse(await readFile(namespacePath, 'utf8'));
  assert.equal(await readlink('/proc/self/ns/pid'), `pid:[${namespace['pid-namespace']}]`);
  assert.equal((await readFile('/proc/1/comm', 'utf8')).trim(), 'bwrap');
  assert.deepEqual(await readdir('/home'), ['pwuser']);
  assert.deepEqual(await readdir('/root'), []);
  assert.ok(!existsSync(path.join(repository, '.git')) && !existsSync(path.join(remix, '.env')));
  assert.ok(!existsSync('/var/run/docker.sock'));
  assert.ok(!Object.keys(process.env).some(key => /TOKEN|PASSWORD|SECRET|COOKIE|AUTHORIZATION/.test(key)));
  const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
  const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, chromiumSandbox: true, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin + '/login');
    const blocked = [];
    const browserRefusal = /ERR_(ADDRESS_UNREACHABLE|NETWORK_CHANGED|CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/;
    for (const target of ['http://203.0.113.1/', 'http://[::ffff:203.0.113.1]/', 'http://[2001:db8::1]/', 'http://blocked.invalid/']) {
      await assert.rejects(page.goto(target, { timeout: 5000 }), browserRefusal);
      blocked.push(target);
    }
    const redirect = createServer((_request, response) => { response.writeHead(302, { Location: 'http://blocked.invalid/' }); response.end(); });
    await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
    try { await assert.rejects(page.goto(`http://127.0.0.1:${redirect.address().port}`, { timeout: 5000 }), browserRefusal); }
    finally { redirect.closeAllConnections(); await new Promise(resolve => redirect.close(resolve)); }
    const verification = { ...proof, browserSandbox: true, browserDenied: blocked, hostProfilesAbsent: true,
      browserRedirectDenied: true, inheritedCredentialsAbsent: true, gitAndEnvironmentAbsent: true, isolatedPidNamespace: true,
      cgroupDiagnostics: ['memory.current', 'memory.events'].filter(name => existsSync(`/sys/fs/cgroup/${name}`)),
      cgroupDiagnosticsScope: 'managed workspace, including concurrent jobs' };
    await writeFile(path.join(state, 'artifacts/isolation-verification.json'), JSON.stringify(verification, null, 2));
    console.log(JSON.stringify(verification));
  } finally { await browser.close(); }
} else {
  throw new Error('Use start <state> <mongod>, run <state> -- <command>, or stop <state>.');
}
