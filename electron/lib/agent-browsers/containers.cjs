'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const readline = require('node:readline');
const { resolveTaskNetworkPolicy, firewallRules } = require('./network-policy.cjs');

const SESSION_LABEL = 'com.thingtime.agent.session';
const OWNER_LABEL = 'com.thingtime.agent.owner';
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;

async function inspectOptional(engine, target, { network = false } = {}) {
  try { return JSON.parse(await engine.run([...(network ? ['network'] : []), 'inspect', target]))[0]; }
  catch (error) {
    // A disconnected daemon is not evidence that an owned resource is gone.
    // Only Docker's explicit missing-object response permits successful cleanup.
    if (/\bNo such (?:object|container|network):/i.test(error.message)) return undefined;
    throw error;
  }
}

class DockerEngine {
  constructor({ executable, socketPath, stateRoot, seccompPath = path.join(__dirname, 'runtime/seccomp.json') }) {
    if (![executable, socketPath, stateRoot].every(path.isAbsolute)) throw new Error('Local absolute runtime paths are required.');
    this.executable = executable;
    this.socketPath = socketPath;
    this.stateRoot = stateRoot;
    this.seccompPath = seccompPath;
    this.owner = createHash('sha256').update(stateRoot).digest('hex');
  }

  async initialize() {
    const socket = await fs.stat(this.socketPath);
    if (!socket.isSocket() || socket.uid !== process.getuid()) throw new Error('The container runtime must belong to this device user.');
    await fs.mkdir(path.join(this.stateRoot, 'docker-client'), { recursive: true, mode: 0o700 });
    const info = JSON.parse(await this.run(['info', '--format', '{{json .}}']));
    if (info.OSType !== 'linux') throw new Error('The isolated browser runtime requires Linux containers.');
    return this;
  }

  async recoverOwnedSessions() {
    await this.initialize();
    const ids = (await this.run(['ps', '--all', '--quiet', '--filter', `label=${OWNER_LABEL}=${this.owner}`])).trim().split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const [record] = JSON.parse(await this.run(['inspect', id]));
      if (record?.Config?.Labels?.[OWNER_LABEL] === this.owner) await this.run(['rm', '--force', id]);
    }
    const networks = (await this.run(['network', 'ls', '--quiet', '--filter', `label=${OWNER_LABEL}=${this.owner}`])).trim().split(/\s+/).filter(Boolean);
    for (const id of networks) {
      const [record] = JSON.parse(await this.run(['network', 'inspect', id]));
      if (record?.Labels?.[OWNER_LABEL] === this.owner) await this.run(['network', 'rm', id]);
    }
  }

  spawn(args, { stdio = ['ignore', 'pipe', 'pipe'] } = {}) {
    // A dedicated empty client configuration prevents implicit registry-account
    // or context inheritance. The socket is local and is never mounted into a
    // task container. No personal environment or SSH agent is forwarded.
    return spawn(this.executable, ['--config', path.join(this.stateRoot, 'docker-client'), '--host', `unix://${this.socketPath}`, ...args], {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: this.stateRoot }, stdio
    });
  }

  run(args, { timeoutMs = 120000, progress, input, signal } = {}) {
    return new Promise((resolve, reject) => {
      const child = this.spawn(args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      let output = '', diagnostic = '';
      const abort = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('The container operation timed out.')); }, timeoutMs);
      const done = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
      child.stdout.on('data', chunk => { if (progress) progress(String(chunk)); else output += chunk; });
      child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16000); if (progress) progress(String(chunk)); });
      child.once('error', error => done(error));
      child.once('close', code => done(code === 0 ? null : new Error(`Container operation failed: ${diagnostic.trim() || code}`), output));
      if (input !== undefined) { child.stdin.on('error', error => done(error)); child.stdin.end(input); }
    });
  }
}

function verifyContainerBoundary(inspect, id, { parentId, networkName = 'none' } = {}) {
  const host = inspect.HostConfig;
  const expectedNetwork = parentId ? `container:${parentId}` : networkName;
  const tmpfs = Object.keys(host.Tmpfs || {});
  if (inspect.Config?.Labels?.[SESSION_LABEL] !== id || inspect.Config?.User !== '1001:1001' || host.NetworkMode !== expectedNetwork || host.Privileged || !host.ReadonlyRootfs ||
      !host.CapDrop?.includes('ALL') || (host.CapAdd?.length || 0) !== 0 || host.PidMode || host.IpcMode === 'host' ||
      Object.keys(host.PortBindings || {}).length || (host.Binds?.length || 0) ||
      (inspect.Mounts || []).some(mount => mount.Type !== 'tmpfs') ||
      !host.SecurityOpt?.some(option => option.startsWith('no-new-privileges')) ||
      tmpfs.some(location => !['/tmp', '/home/pwuser', '/data/db', '/data/configdb'].includes(location))) {
    throw new Error('The test container failed isolation verification.');
  }
  if (!parentId && Object.keys(inspect.NetworkSettings?.Networks || {}).some(name => name !== networkName)) throw new Error('The test container has an unexpected network.');
  return { network: parentId ? 'task-loopback' : networkName, hostMounts: false, hostPorts: false, privileged: false };
}

class BrowserContainer {
  constructor(engine, { imageId, id = randomUUID(), memoryMb = 2048, cpu = 1, networkPolicy = { mode: 'isolated' } } = {}) {
    if (!IMAGE_ID.test(imageId || '')) throw new Error('Choose a verified immutable browser image.');
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('A unique task session is required.');
    if (!Number.isSafeInteger(memoryMb) || memoryMb < 512 || !Number.isFinite(cpu) || cpu <= 0) throw new Error('Invalid runtime resource budget.');
    this.engine = engine; this.imageId = imageId; this.id = id; this.memoryMb = memoryMb; this.cpu = cpu;
    this.name = `tt-agent-${id}`; this.pending = new Map(); this.sequence = 0; this.closed = false;
    // Copy the effective policy: edits to task/default settings cannot mutate a
    // running namespace. Only a new session may apply a different policy.
    this.policy = resolveTaskNetworkPolicy(networkPolicy);
    this.networkName = this.policy.mode === 'isolated' ? 'none' : `${this.name}-network`;
  }

  async start() {
    try {
    await this.engine.initialize();
    if (this.networkName !== 'none') {
      this.networkId = (await this.engine.run(['network', 'create', '--driver', 'bridge', '--label', `${SESSION_LABEL}=${this.id}`,
        '--label', `${OWNER_LABEL}=${this.engine.owner}`,
        '--opt', 'com.docker.network.bridge.enable_icc=false', this.networkName])).trim();
    }
    const args = ['create', '--name', this.name, '--label', `${SESSION_LABEL}=${this.id}`, '--label', `${OWNER_LABEL}=${this.engine.owner}`, '--network', this.networkName, '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--security-opt', `seccomp=${this.engine.seccompPath}`,
      '--user', '1001:1001', '--init', '-i', '--memory', `${this.memoryMb}m`, '--cpus', String(this.cpu), '--pids-limit', '512', '--shm-size', '512m',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m', '--tmpfs', '/home/pwuser:rw,nosuid,nodev,uid=1001,gid=1001,mode=700,size=1g',
      '--env', `THINGTIME_NETWORK_MODE=${this.policy.mode}`, '--env', `THINGTIME_AGENT_SESSION=${this.id}`, this.imageId];
      this.containerId = (await this.engine.run(args)).trim();
      const [inspect] = JSON.parse(await this.engine.run(['inspect', this.containerId]));
      this.boundary = verifyContainerBoundary(inspect, this.id, { networkName: this.networkName });
      this.process = this.engine.spawn(['start', '--attach', '--interactive', this.containerId], { stdio: ['pipe', 'pipe', 'pipe'] });
      this.process.stderr.on('data', chunk => { this.diagnostic = ((this.diagnostic || '') + chunk).slice(-8000); });
      readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity }).on('line', line => {
        let response; try { response = JSON.parse(line); } catch { return; }
        const pending = this.pending.get(response.id); if (!pending) return;
        this.pending.delete(response.id); clearTimeout(pending.timer);
        response.error ? pending.reject(new Error(response.error)) : pending.resolve(response.result);
      });
      const failPending = () => {
        for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('The isolated browser process ended.')); }
        this.pending.clear();
      };
      this.process.once('error', failPending);
      this.process.once('close', failPending);
      // Wait for the namespace to be running. This trusted preflight does not
      // start a browser or backend and contains no user credentials/data.
      const proof = await this.call('preflight');
      if (this.policy.mode === 'isolated' && !proof.isolated) throw new Error('The runtime did not establish its isolation boundary.');
      if (this.policy.mode === 'restricted') await this.installFirewall();
      this.proof = { ...proof, mode: this.policy.mode, fingerprint: this.policy.fingerprint, firewall: this.firewallProof };
      this.ready = true;
      return { id: this.id, boundary: this.boundary, policy: this.policy, proof: this.proof };
    } catch (error) { await this.close(); throw error; }
  }

  async installFirewall() {
    const guardName = `${this.name}-guard`;
    const args = ['run', '--rm', '-i', '--name', guardName, '--label', `${SESSION_LABEL}=${this.id}`,
      '--label', `${OWNER_LABEL}=${this.engine.owner}`,
      '--network', `container:${this.containerId}`, '--read-only', '--cap-drop', 'ALL', '--cap-add', 'NET_ADMIN',
      '--security-opt', 'no-new-privileges=true', '--user', '0:0', '--entrypoint', '/usr/sbin/nft', this.imageId];
    try {
      await this.engine.run([...args, '-f', '-'], { input: firewallRules(this.policy) });
      const rules = JSON.parse(await this.engine.run([...args, '--json', 'list', 'table', 'inet', 'thingtime_agent']));
      const chains = (rules.nftables || []).map(value => value.chain).filter(Boolean);
      if (!chains.some(chain => chain.name === 'output' && chain.policy === 'drop' && chain.prio === -150) ||
          !chains.some(chain => chain.name === 'input' && chain.policy === 'drop')) throw new Error('The kernel did not install the task firewall.');
      this.firewallProof = { installed: true, outputPolicy: 'drop', inputPolicy: 'drop', rules: rules.nftables };
    } finally {
      const guard = await inspectOptional(this.engine, guardName);
      if (guard?.Config?.Labels?.[SESSION_LABEL] === this.id) await this.engine.run(['rm', '--force', guardName]);
    }
  }

  call(method, params = {}, { timeoutMs = 45000 } = {}) {
    if (!this.ready && method !== 'preflight') return Promise.reject(new Error('Task security preflight must finish before browser operations.'));
    if (!this.process || this.closed || this.process.exitCode !== null) return Promise.reject(new Error('This task runtime is unavailable.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The browser operation timed out. Inspect the current page before retrying.')); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.cleanup().catch(error => { this.closePromise = null; throw error; });
    return this.closePromise;
  }
  async cleanup() {
    this.process?.stdin.end();
    {
      const target = this.containerId || this.name;
      const record = await inspectOptional(this.engine, target);
      if (record) {
        if (record.Config?.Labels?.[SESSION_LABEL] !== this.id || record.Config?.Labels?.[OWNER_LABEL] !== this.engine.owner) throw new Error('The container ownership changed; cleanup refused.');
        await this.engine.run(['rm', '--force', target]);
        if (await inspectOptional(this.engine, target)) throw new Error('The owned container still exists after cleanup.');
      }
    }
    if (this.networkName !== 'none') {
      const target = this.networkId || this.networkName;
      const network = await inspectOptional(this.engine, target, { network: true });
      if (network) {
        if (network.Labels?.[SESSION_LABEL] !== this.id || network.Labels?.[OWNER_LABEL] !== this.engine.owner) throw new Error('The task network ownership changed; cleanup refused.');
        await this.engine.run(['network', 'rm', target]);
        if (await inspectOptional(this.engine, target, { network: true })) throw new Error('The owned network still exists after cleanup.');
      }
    }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('This task runtime was released.')); }
    this.pending.clear();
  }
}

module.exports = { DockerEngine, BrowserContainer, verifyContainerBoundary, SESSION_LABEL };
