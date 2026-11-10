'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const VERSION = '1.0.0';
const NODE_ID = 'native.node-service';

/** Explicit native owners, never inferred from arbitrary processes or arguments. */
class DesktopActivityManager {
  constructor({ filePath, app, nodeAvailable, nodeStatus, controlNode, browserGuardActive = () => false }) {
    Object.assign(this, { filePath, app, nodeAvailable, nodeStatus, controlNode, browserGuardActive });
    this.disabled = new Set(); this.serial = Promise.resolve(); this.ready = false;
  }
  async initialize() {
    try {
      const state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (state.version !== VERSION || !Array.isArray(state.disabled) || state.disabled.some(id => id !== NODE_ID)) throw Error('Invalid activity preferences.');
      this.disabled = new Set(state.disabled);
    } catch (error) { if (error.code !== 'ENOENT') throw Error('Native activity preferences could not be read; controls remain unavailable.'); }
    this.ready = true;
  }
  nodeEnabled() { if (!this.ready) throw Error('Native activity controls are not ready.'); return !this.disabled.has(NODE_ID); }
  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.filePath + '.tmp', JSON.stringify({ version: VERSION, disabled: [...this.disabled] }), { mode: 0o600 });
    await fs.rename(this.filePath + '.tmp', this.filePath);
  }
  request(input) {
    if (!this.ready) return Promise.reject(Error('Native activity controls are not ready.'));
    if (!input || input.version !== VERSION || !['list', 'set-enabled'].includes(input.action)) return Promise.reject(Error('Unsupported native activity contract.'));
    const allowed = input.action === 'list' ? ['version', 'action'] : ['version', 'action', 'id', 'enabled'];
    if (Object.keys(input).some(key => !allowed.includes(key))) return Promise.reject(Error('Invalid native activity request.'));
    if (input.action === 'list') return this.snapshot();
    if (input.id !== NODE_ID || typeof input.enabled !== 'boolean' || !this.nodeAvailable()) return Promise.reject(Error('This native activity cannot be changed.'));
    const operation = this.serial.catch(() => {}).then(async () => {
      // Save the stop intent before touching launchd. A failed stop stays visible
      // as enabled:false / running:true, and a repeated Disable retries cleanup.
      if (!input.enabled) {
        const wasDisabled = this.disabled.has(NODE_ID);
        this.disabled.add(NODE_ID);
        try { await this.persist(); }
        catch (error) { if (!wasDisabled) this.disabled.delete(NODE_ID); throw error; }
        await this.controlNode(false);
      } else {
        const wasDisabled = this.disabled.has(NODE_ID);
        try { await this.controlNode(true); }
        catch (error) {
          // Starting launchd can succeed before a subsequent settings write
          // fails. Keep a previously disabled owner stopped on partial enable.
          if (wasDisabled) { try { await this.controlNode(false); } catch { /* observed running state remains available for Retry disable */ } }
          throw error;
        }
        this.disabled.delete(NODE_ID);
        try { await this.persist(); }
        catch (error) { this.disabled.add(NODE_ID); await this.controlNode(false); throw error; }
      }
      return this.snapshot();
    });
    this.serial = operation; return operation;
  }
  async snapshot() {
    const available = this.nodeAvailable();
    let status = null;
    if (available) { try { status = await this.nodeStatus(); } catch { /* report unknown, never a fabricated stopped state */ } }
    const running = !status ? null : ['stopped', 'absent'].includes(status.serviceStatus) ? false : status.serviceStatus === 'running' || status.rawStatus ? true : null;
    const browserGuardActive = await this.browserGuardActive();
    const metrics = this.app.getAppMetrics();
    const total = read => metrics.length > 0 && metrics.every(item => Number.isFinite(read(item)) && read(item) >= 0) ? metrics.reduce((sum, item) => sum + read(item), 0) : null;
    return { version: VERSION, collectedAt: new Date().toISOString(), activities: [
      { id: NODE_ID, label: 'Thingtime Node background service', kind: 'service', scope: 'native-node', enabled: this.nodeEnabled(), running,
        controllable: available && status?.serviceStatus !== 'absent',
        description: !available || status?.serviceStatus === 'absent' ? 'Unavailable in this platform or build.' : 'Separate macOS service; remains alive when the desktop window closes. Disable stops its process and disables its login launch. Includes telemetry/action scheduling, connector events, chat polling, live AI sync and native folder backup monitors. These children currently share this owner control.' },
      { id: 'desktop.browser-lease-guard', label: 'Agent browser lease expiry', kind: 'security-guard', scope: 'desktop', enabled: browserGuardActive, running: browserGuardActive, controllable: false,
        description: 'Ten-second expiry cleanup while the browser manager exists; required to reclaim expired task browsers and preserve isolation.' },
      { id: 'desktop.request-deadlines', label: 'Native request deadlines and lifecycle listeners', kind: 'security-guard', scope: 'desktop', enabled: true, running: null, controllable: false,
        description: 'On-demand IPC, transfer cancellation, confirmation deadlines, app quit/navigation cleanup and session guards. Essential guards cannot be disabled independently.' }
    ], metrics: { scope: 'electron-processes', processCount: metrics.length,
      cpuPercent: total(item => item.cpu?.percentCPUUsage),
      rssBytes: total(item => typeof item.memory?.workingSetSize === 'number' ? item.memory.workingSetSize * 1024 : NaN) },
    limitations: ['CPU and memory cover Electron processes only; the separate native Node and its children are excluded.', 'Native Node child activities share a service control; individual native task counts and per-task resource attribution are unavailable.', 'Local MongoDB, the bundled API runtime and external services are outside these activity controls.'] };
  }
}
module.exports = { DesktopActivityManager, VERSION, NODE_ID };
