'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { BrowserLeases } = require('./leases.cjs');
const { BrowserContainer } = require('./containers.cjs');
const { NativeBrowser, recoverNativeProfiles } = require('./native.cjs');
const { acquireOwnership } = require('./ownership.cjs');
const { DEFAULT_NETWORK_POLICY, NETWORK_MODES, normalizeNetworkPolicy, resolveTaskNetworkPolicy } = require('./network-policy.cjs');

const BROWSER_OPERATIONS = new Set(['tabs', 'newPage', 'navigate', 'frame', 'click', 'type', 'key', 'scroll', 'viewport', 'evaluate', 'closePage', 'probe']);

class AgentBrowserManager extends EventEmitter {
  constructor({ engine, images, bundles, stateRoot, createSession = options => options.native
    ? new NativeBrowser({ bundles, stateRoot, ...options }) : new BrowserContainer(engine, options), now }) {
    super(); Object.assign(this, { engine, images, bundles, stateRoot, createSession });
    this.leases = new BrowserLeases({ now }); this.sessions = new Map(); this.tasks = new Map();
    this.launches = new Map(); this.removingInstalls = new Set(); this.settingsWrite = Promise.resolve();
    this.defaults = normalizeNetworkPolicy(DEFAULT_NETWORK_POLICY);
    this.images.on('change', () => this.emit('change')); this.bundles?.on('change', () => this.emit('change'));
  }
  async initialize() {
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    this.ownership = await acquireOwnership(this.stateRoot);
    try {
    try { this.defaults = normalizeNetworkPolicy(JSON.parse(await fs.readFile(path.join(this.stateRoot, 'network-defaults.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Saved task security settings could not be read. Correct them before starting a session.'); }
    await this.images.initialize(); await this.bundles?.initialize();
    await recoverNativeProfiles(this.stateRoot);
    this.timer = setInterval(() => this.expire().catch(() => {}), 10000); this.timer.unref?.();
    return this;
    } catch (error) { await this.ownership.release(); throw error; }
  }
  async ensureRuntime() {
    if (!this.runtimeReady) this.runtimeReady = this.engine?.recoverOwnedSessions?.().catch(error => { this.runtimeReady = null; throw error; });
    await this.runtimeReady;
  }
  snapshot() {
    return { version: '1.0.0', defaults: structuredClone(this.defaults), networkModes: NETWORK_MODES,
      tasks: [...this.tasks].map(([taskId, setting]) => ({ taskId, policy: resolveTaskNetworkPolicy(this.defaults, setting) })),
      ...this.images.snapshot(), nativeBundles: this.bundles?.snapshot(), leases: this.leases.list(),
      sessions: [...this.sessions].map(([leaseId, session]) => ({ leaseId, id: session.id, state: session.launched ? 'ready' : 'starting',
        policy: structuredClone(session.policy), application: session.application, proof: session.proof ? { isolated: session.proof.isolated, mode: session.proof.mode, fingerprint: session.proof.fingerprint } : null })) };
  }
  async setDefaults(policy) {
    const next = normalizeNetworkPolicy(policy), file = path.join(this.stateRoot, 'network-defaults.json');
    const write = this.settingsWrite.catch(() => {}).then(async () => {
      await fs.writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
      await fs.rename(file + '.tmp', file); this.defaults = next; this.emit('change'); return this.snapshot();
    });
    this.settingsWrite = write; return write;
  }
  registerTask({ taskId, useCustomSecurity = false, network }) {
    if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('A task Thing identity is required.');
    const setting = { useCustomSecurity: useCustomSecurity === true, network: normalizeNetworkPolicy(network || DEFAULT_NETWORK_POLICY) };
    this.tasks.set(taskId, setting); return resolveTaskNetworkPolicy(this.defaults, setting);
  }
  claim({ taskId, installId, agentId }) {
    if (this.closing) throw new Error('The browser manager is closing.');
    if (!this.tasks.has(taskId)) throw new Error('Open this task in Thingtime before claiming its browser.');
    const native = this.bundles?.records.has(installId);
    if ((!this.images.records.has(installId) && !native) || this.removingInstalls.has(installId)) throw new Error('Choose an installed browser.');
    if (this.leases.list().some(lease => lease.taskId === taskId)) throw new Error('This task already has an agent browser claim.');
    const policy = resolveTaskNetworkPolicy(this.defaults, this.tasks.get(taskId));
    if (native && policy.mode !== 'unrestricted') throw new Error('Native macOS browsers require an explicitly unrestricted task. Choose a container runtime for this security level.');
    const lease = this.leases.claim({ taskId, installId, agentId });
    // Freeze the effective settings at claim time, including inherited defaults.
    this.leases.leases.get(lease.id).policy = policy;
    this.emit('change'); return { ...lease, policy: this.leases.require({ leaseId: lease.id, token: lease.token }).policy };
  }
  async launch(credentials) {
    if (this.closing) throw new Error('The browser manager is closing.');
    const lease = this.leases.require(credentials);
    if (this.sessions.has(lease.id)) throw new Error('This claim already has a session. Inspect it before retrying.');
    const install = this.images.records.get(lease.installId);
    const session = this.createSession({ imageId: install?.imageId, native: !install, installId: lease.installId, networkPolicy: lease.policy });
    this.sessions.set(lease.id, session); this.emit('change');
    const launch = (async () => {
      // Cover the runtime's bounded database, app, asset and browser stages.
      // The old 120-second envelope could expire before those stages did.
      try { if (install) await this.ensureRuntime(); await session.start(); this.leases.require(credentials); const browser = await session.call('launch', {}, { timeoutMs: 330000 }); this.leases.require(credentials); session.application = browser.application; session.launched = true; this.emit('change'); return { ...browser, sessionId: session.id, policy: session.policy }; }
      catch (error) { await session.close(); this.sessions.delete(lease.id); this.emit('change'); throw error; }
    })();
    this.launches.set(lease.id, launch);
    try { return await launch; } finally { this.launches.delete(lease.id); }
  }
  command(credentials, operation, params) {
    const lease = this.leases.require(credentials);
    if (!BROWSER_OPERATIONS.has(operation)) throw new Error('Unsupported agent browser operation.');
    const session = this.sessions.get(lease.id);
    if (!session) throw new Error('Start this task’s browser first.');
    return session.call(operation, params);
  }
  async release(credentials) {
    const lease = this.leases.require(credentials, { allowExpired: true });
    await this.launches.get(lease.id)?.catch(() => {});
    const session = this.sessions.get(lease.id);
    if (session) await session.close();
    this.sessions.delete(lease.id); this.leases.release(credentials); this.emit('change'); return { released: true };
  }
  async removeInstall(id) {
    if (this.leases.list().some(lease => lease.installId === id)) throw new Error('Release this browser’s claim before removing it.');
    if (this.removingInstalls.has(id)) throw new Error('This install is already being removed.');
    this.removingInstalls.add(id);
    try { await (this.images.records.has(id) ? this.images : this.bundles).remove(id); return this.snapshot(); } finally { this.removingInstalls.delete(id); }
  }
  async releaseExpired({ leaseId, taskId }) {
    const lease = this.leases.list().find(value => value.id === leaseId && value.taskId === taskId && value.expired);
    if (!lease) throw new Error('Only an expired claim for this task can be cleared.');
    await this.launches.get(lease.id)?.catch(() => {});
    await this.sessions.get(lease.id)?.close();
    this.sessions.delete(lease.id); this.leases.leases.delete(lease.id); this.emit('change');
    return { released: true };
  }
  async expire() {
    for (const lease of this.leases.list()) {
      if (!lease.expired) continue;
      await this.launches.get(lease.id)?.catch(() => {});
      const session = this.sessions.get(lease.id);
      if (session) { await session.close(); this.sessions.delete(lease.id); this.emit('change'); }
      // Keep the claim until its owner releases it. Expiry is not takeover.
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.launches.values()]);
    // One unavailable daemon must not skip installer cancellation or abandon
    // other cleanup operations. Keep failed sessions and ownership retryable.
    const results = await Promise.allSettled([
      ...[...this.sessions].map(async ([id, session]) => { await session.close(); this.sessions.delete(id); }),
      this.bundles?.close(), this.images.close?.(), this.settingsWrite
    ]);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Some owned browser resources could not be released. Cleanup remains retryable.');
    await this.ownership.release();
  }
}
module.exports = { AgentBrowserManager, BROWSER_OPERATIONS };
