#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mcp = resolve(here, '..');
const seccomp = resolve(mcp, '../electron/lib/agent-browsers/runtime/seccomp.json');
export function parseOptions(argv) {
  const options = {
    docker: '/opt/homebrew/bin/docker',
    'mcp-dist': join(mcp, 'dist'),
    'mcp-modules': join(mcp, 'node_modules'),
    renderer: resolve(mcp, '../remix/dist/draft-preview'),
    'lifetime-seconds': '600'
  };
  const allowed = new Set([...Object.keys(options), 'socket', 'image']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      throw new Error('Expected --socket PATH --image sha256:ID; optional --docker, --mcp-dist, --mcp-modules, --renderer, --lifetime-seconds.');
    }
    options[key] = argv[i + 1];
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(options.image || '')) throw new Error('An exact cached image sha256 ID is required.');
  for (const key of ['docker', 'socket', 'mcp-dist', 'mcp-modules', 'renderer']) {
    if (!isAbsolute(options[key] || '')) throw new Error(`--${key} must be an absolute path.`);
  }
  if (!/^\d+$/.test(options['lifetime-seconds']) || Number(options['lifetime-seconds']) < 1 ||
      !Number.isSafeInteger(Number(options['lifetime-seconds']) * 1000) ||
      Number(options['lifetime-seconds']) * 1000 > 2147483647) throw new Error('Invalid session lifetime (must fit a Node timer).');
  return options;
}

// A selected source tree must not smuggle dotenv files or escaping symlinks.
export async function verifyMount(root) {
  const actual = await realpath(root);
  async function walk(path) {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = relative(actual, await realpath(path));
      if (target === '..' || target.startsWith('../') || isAbsolute(target)) throw new Error('A mount contains an escaping symlink.');
    } else if (info.isDirectory()) {
      for (const entry of await readdir(path)) {
        if (entry === '.env' || entry.startsWith('.env.')) throw new Error('A mount contains a dotenv file.');
        await walk(join(path, entry));
      }
    }
  }
  await walk(actual);
  return actual;
}

export function runArguments(options, name, volume, labels = []) {
  return ['run', '--pull', 'never', '--rm', '-i', '--init', '--name', name, ...labels,
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--security-opt', `seccomp=${seccomp}`,
    '--user', '1001:1001', '--pids-limit', '256', '--memory', '1g', '--cpus', '2',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456,mode=1777',
    '--tmpfs', '/home/pwuser:rw,nosuid,nodev,size=67108864,uid=1001,gid=1001,mode=700',
    '--shm-size', '128m', '--workdir', '/opt/thingtime/MCP',
    '--mount', `type=volume,src=${volume},dst=/opt/thingtime,readonly`,
    '--entrypoint', '/usr/bin/env', options.image,
    '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/home/pwuser', 'TMPDIR=/tmp',
    'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', 'THINGTIME_RENDER_ISOLATED=1',
    '/usr/bin/timeout', '--signal=KILL', `${options['lifetime-seconds']}s`,
    'node', '/opt/thingtime/MCP/scripts/render-only-server.mjs'];
}

// Only the host-side guardian has Docker access. Its IPC descriptor is not
// inherited by Docker/tar; wrapper SIGKILL closes it even across process groups.
async function verifyCleanupDirectory(directory) {
  if (dirname(await realpath(directory)) !== await realpath(tmpdir()) ||
      !/^thingtime-render-docker-[A-Za-z0-9]+$/.test(basename(directory))) throw new Error('Invalid cleanup ownership');
}
export async function cleanupOwned(options, directory, name) {
  if (!/^thingtime-render-[a-f0-9-]{36}$/.test(name)) throw new Error('Invalid cleanup ownership');
  await verifyCleanupDirectory(directory);
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: directory, TMPDIR: tmpdir(), DOCKER_HOST: `unix://${options.socket}` };
  const deadline = Date.now() + 30000;
  const docker = args => spawnSync(options.docker, ['--config', directory, ...args], {
    env, cwd: directory, encoding: 'utf8', timeout: Math.max(1, Math.min(3000, deadline - Date.now())), killSignal: 'SIGKILL', maxBuffer: 65536
  });
  const resources = [['container', name], ['container', `${name}-stage`], ['volume', `${name}-assets`]];
  const missing = result => result.status !== 0 && /no such (container|volume|object)/i.test(result.stderr || '');
  const inspect = (kind, id) => docker([kind === 'volume' ? 'volume' : 'container', 'inspect', id, '--format', kind === 'volume' ? '{{json .Labels}}' : '{{json .Config.Labels}}']);
  let remaining = resources;
  // Recheck the complete set twice after initial teardown. A Docker create
  // already in flight when the wrapper dies may appear after a missing inspect.
  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
    const retry = [];
    for (const [kind, id] of resources) {
      if (Date.now() >= deadline) { retry.push([kind, id]); continue; }
      const before = inspect(kind, id);
      if (missing(before)) continue;
      let labels;
      try { labels = JSON.parse(before.stdout); } catch {}
      if (before.status !== 0 || !labels) { retry.push([kind, id]); continue; }
      if (labels['thingtime.render-isolated'] !== 'true' || labels['thingtime.render-session'] !== name) throw new Error(`Refusing cleanup with mismatched ownership: ${id}`);
      const removed = docker(kind === 'volume' ? ['volume', 'rm', id] : ['rm', '-f', id]);
      if (removed.status !== 0 && !missing(removed)) { retry.push([kind, id]); continue; }
      if (!missing(inspect(kind, id))) retry.push([kind, id]);
    }
    remaining = retry;
    if (attempt < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, Math.min(1000, Math.max(0, deadline - Date.now()))));
  }
  if (remaining.length) throw new Error(`Cleanup could not be verified; inspect only owned resources ${remaining.map(([,id]) => id).join(', ')}.`);
  await rm(directory, { recursive: true, force: true });
}

async function guardianMain() {
  if (!process.send) throw new Error('Cleanup guardian requires a private parent IPC channel');
  let configuration, cleaning = false;
  let timer = setTimeout(clean, 5000);
  async function clean() {
    if (cleaning) return;
    cleaning = true; clearTimeout(timer);
    if (process.connected) try { process.send({ cleaning: true }, () => {}); } catch {}
    let error;
    try {
      if (configuration) await cleanupOwned(configuration.options, process.cwd(), configuration.name);
      else { await verifyCleanupDirectory(process.cwd()); await rm(process.cwd(), { recursive: true, force: true }); }
    }
    catch (failure) { error = failure.message; console.error(error); }
    if (process.connected) await new Promise(resolve => process.send({ cleaned: !error, error }, () => resolve()));
    process.exit(error ? 1 : 0);
  }
  process.on('message', message => {
    if (!configuration) {
      if (!message || !/^thingtime-render-[a-f0-9-]{36}$/.test(message.name) || !Number.isSafeInteger(message.deadline) || message.deadline <= Date.now()) process.exit(1);
      configuration = message;
      clearTimeout(timer); timer = setTimeout(clean, Math.min(2147483647, message.deadline - Date.now()));
      process.send({ ready: true });
    } else if (message?.stop === true) void clean();
  });
  process.once('disconnect', clean);
  process.once('SIGTERM', clean);
  process.once('SIGINT', clean);
  if (!process.connected) await clean();
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (!(await stat(options.socket)).isSocket()) throw new Error('Docker endpoint must be a local Unix socket.');
  options.docker = await realpath(options.docker);
  for (const key of ['mcp-dist', 'mcp-modules', 'renderer']) options[key] = await verifyMount(options[key]);
  const directory = await mkdtemp(join(tmpdir(), 'thingtime-render-docker-'));
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: directory, TMPDIR: tmpdir(), DOCKER_HOST: `unix://${options.socket}` };
  const docker = args => spawnSync(options.docker, ['--config', directory, ...args], {
    env, cwd: directory, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 65536
  });
  const name = `thingtime-render-${randomUUID()}`, volume = `${name}-assets`, stagingName = `${name}-stage`;
  const deadline = Date.now() + Number(options['lifetime-seconds']) * 1000;
  let child, tar, guardian, cleanupPromise, stopping = false, guardianReceipt;
  const stopChildren = () => { stopping = true; child?.kill('SIGTERM'); tar?.kill('SIGTERM'); };
  let guardianDone;
  const cleanup = () => cleanupPromise ||= (async () => {
    stopChildren();
    if (guardian?.connected) guardian.send({ stop: true }, () => {});
    if (guardianDone) await guardianDone;
    if (!guardianReceipt?.cleaned) {
      // Bounded fallback if the guardian itself failed. It uses the same exact
      // ownership checks and never widens cleanup to a label sweep or prune.
      try { await cleanupOwned(options, directory, name); }
      catch (error) { console.error(error.message); process.exitCode ||= 1; }
    }
  })();
  const terminate = () => { void cleanup(); };
  const assertActive = () => { if (stopping || Date.now() >= deadline) throw new Error('Isolated render session ended'); };
  try {
    const inspected = docker(['image', 'inspect', options.image, '--format', '{{.Id}}']);
    if (inspected.status !== 0 || inspected.stdout.trim() !== options.image) throw new Error('Pinned image is not cached at the selected Docker endpoint.');
    await stat(seccomp);
    guardian = spawn(process.execPath, [fileURLToPath(import.meta.url), '--cleanup-guardian'], {
      env, cwd: directory, detached: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    guardianDone = new Promise(resolve => {
      guardian.once('error', () => { stopChildren(); resolve(); });
      guardian.once('exit', stopChildren);
      guardian.once('close', resolve);
      guardian.on('message', message => { if (message.cleaning) stopChildren(); if ('cleaned' in message) guardianReceipt = message; });
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Cleanup guardian did not become ready')), 5000);
      guardian.on('message', message => { if (message.ready) { clearTimeout(timeout); resolve(); } });
      guardian.once('error', error => { clearTimeout(timeout); reject(error); });
      guardian.once('exit', () => { clearTimeout(timeout); reject(new Error('Cleanup guardian exited before readiness')); });
      guardian.send({ options: { docker: options.docker, socket: options.socket }, name, deadline });
    });
    process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
    const snapshot = join(directory, 'snapshot');
    await mkdir(join(snapshot, 'MCP/scripts'), { recursive: true });
    await mkdir(join(snapshot, 'remix/dist'), { recursive: true });
    const copyTree = { recursive: true, verbatimSymlinks: true };
    await cp(options['mcp-dist'], join(snapshot, 'MCP/dist'), copyTree);
    await cp(options['mcp-modules'], join(snapshot, 'MCP/node_modules'), copyTree);
    await cp(options.renderer, join(snapshot, 'remix/dist/draft-preview'), copyTree);
    await cp(join(here, 'render-only-server.mjs'), join(snapshot, 'MCP/scripts/render-only-server.mjs'));
    await cp(join(mcp, 'package.json'), join(snapshot, 'MCP/package.json'));
    await verifyMount(snapshot); assertActive();
    const expiry = new Date(deadline).toISOString();
    const labels = ['--label', 'thingtime.render-isolated=true', '--label', `thingtime.render-session=${name}`, '--label', `thingtime.expires-at=${expiry}`];
    const created = docker(['volume', 'create', ...labels, volume]);
    if (created.status !== 0) throw new Error('Could not create the task-owned asset volume.');
    assertActive();
    child = spawn(options.docker, ['--config', directory, 'run', '--pull', 'never', '--rm', '-i',
      '--name', stagingName, ...labels, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--user', '0:0', '--pids-limit', '16', '--memory', '128m',
      '--mount', `type=volume,src=${volume},dst=/payload`, '--entrypoint', '/usr/bin/env', options.image,
      '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', '/usr/bin/timeout', '--signal=KILL', '60s', 'tar', '--no-same-owner', '-xf', '-', '-C', '/payload'],
    { env, cwd: directory, stdio: ['pipe', 'ignore', 'inherit'] });
    tar = spawn('/usr/bin/tar', ['-C', snapshot, '-cf', '-', '.'], { env: { ...env, COPYFILE_DISABLE: '1' }, cwd: directory, stdio: ['ignore', 'pipe', 'inherit'] });
    tar.stdout.pipe(child.stdin); child.stdin.on('error', () => {});
    const staged = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { void cleanup(); reject(new Error('Asset staging exceeded 60 seconds.')); }, 60000);
      Promise.all([child, tar].map(process => new Promise((resolve, reject) => {
        process.once('error', reject); process.once('exit', code => resolve(code));
      }))).then(codes => { clearTimeout(timeout); resolve(codes.every(code => code === 0)); }, error => { clearTimeout(timeout); reject(error); });
    });
    if (!staged) throw new Error('Could not stage the isolated renderer assets');
    assertActive();
    const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    child = spawn(options.docker, ['--config', directory, ...runArguments({ ...options, 'lifetime-seconds': String(remaining) }, name, volume, labels)], { env, cwd: directory, stdio: 'inherit' });
    const result = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    process.exitCode ??= Date.now() >= deadline ? 124 : result;
  } catch (error) {
    if (Date.now() >= deadline) process.exitCode = 124;
    throw error;
  } finally {
    await cleanup();
    if (guardianReceipt?.cleaned) await rm(directory, { recursive: true, force: true });
    process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (process.argv[2] === '--cleanup-guardian' ? guardianMain() : main()).catch(error => { console.error(`Isolated renderer: ${error.message}`); process.exitCode ||= 1; });
}
