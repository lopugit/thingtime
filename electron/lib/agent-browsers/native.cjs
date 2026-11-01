'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { BrowserDriver } = require('./runtime/browser-driver.cjs');
const { resolveTaskNetworkPolicy } = require('./network-policy.cjs');

function profileInUse(profile) {
  const escaped = `--user-data-dir=${profile}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new Promise((resolve, reject) => {
    // Return only whether a process uses this exact owned profile. Never read
    // another browser's profile files or print process arguments.
    const child = spawn('/usr/bin/pgrep', ['-f', '--', `${escaped}( |$)`], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(true) : code === 1 ? resolve(false) : reject(new Error('Could not verify native browser cleanup.')));
  });
}

async function recoverNativeProfiles(stateRoot, inUse = profileInUse) {
  const root = path.join(stateRoot, 'native-sessions');
  let stat;
  try { stat = await fs.lstat(root); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isDirectory() || stat.uid !== process.getuid()) throw new Error('The native session directory is not device-owned.');
  // The caller holds the exclusive manager lock. Only UUID directories in
  // that manager's private namespace are eligible, and no active profile may
  // be removed even after its controller crashed.
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if ((await fs.lstat(directory)).uid !== process.getuid()) throw new Error('A native session has a different device owner.');
    if (await inUse(path.join(directory, 'profile'))) throw new Error('A previous native task browser is still exiting. Retry after that owned browser closes.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}

class NativeBrowser {
  constructor({ bundles, installId, stateRoot, networkPolicy }) {
    this.policy = resolveTaskNetworkPolicy(networkPolicy);
    if (this.policy.mode !== 'unrestricted') throw new Error('Native macOS browsers require an explicitly unrestricted task. Use a container runtime for protected testing.');
    this.id = randomUUID(); this.bundles = bundles; this.installId = installId;
    this.root = path.join(stateRoot, 'native-sessions', this.id); this.driver = new BrowserDriver();
  }
  async start() {
    this.executable = await this.bundles.executable(this.installId);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    this.proof = { isolated: false, mode: 'unrestricted', fingerprint: this.policy.fingerprint };
    this.ready = true;
  }
  call(method, params) {
    if (!this.ready || this.closed) throw new Error('The native browser session is unavailable.');
    if (method === 'launch') return this.driver.launch({ executable: this.executable, root: this.root,
      build: this.bundles.records.get(this.installId), environment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: this.root, TMPDIR: this.root, LANG: 'en_US.UTF-8' } });
    return this.driver.call(method, params);
  }
  async close() {
    this.closed = true; await this.driver.close();
    await fs.rm(this.root, { recursive: true, force: true }); this.ready = false;
  }
}
module.exports = { NativeBrowser, recoverNativeProfiles };
