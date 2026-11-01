'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const CHANNELS = Object.freeze(['stable', 'beta', 'dev', 'canary']);
const ID = /^[a-f0-9-]{36}$/;
const run = (executable, args) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('error', reject);
  child.once('close', code => {
    if (code === 0) return resolve(output);
    const error = new Error(`Browser verification failed (${path.basename(executable)}, ${code}).`);
    error.diagnostic = output;
    reject(error);
  });
});

async function verifyBundle(bundlePath, browser) {
  if (process.platform !== 'darwin') throw new Error('Browser bundles currently require macOS.');
  const signature = await run('/usr/bin/codesign', ['-dvv', bundlePath]);
  // Official testing archives can ship linker-signed, without a resource seal.
  // Preserve that artifact; do not "repair" it by re-signing or disabling
  // Gatekeeper. Its provenance is the pinned official HTTPS archive, whose
  // storage checksum is checked by the worker, plus our full installed digest.
  if (/^Signature=adhoc$/m.test(signature) && /^TeamIdentifier=not set$/m.test(signature)) {
    return 'publisher-download-adhoc';
  }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundlePath]);
  if (!/^TeamIdentifier=EQHXZ8M8AV$/m.test(signature)) throw new Error('The browser does not have the expected Google signature.');
  return 'google-signed';
}

async function bundleDigest(root) {
  const hash = createHash('sha256');
  const walk = async relative => {
    const current = path.join(root, relative);
    const stat = await fs.lstat(current);
    hash.update(JSON.stringify([relative, stat.mode & 0o777, stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : 'file', stat.isFile() ? stat.size : null]) + '\n');
    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(current);
      const resolved = path.resolve(path.dirname(current), target);
      if (!resolved.startsWith(root + path.sep)) throw new Error('A browser bundle link escapes its installation.');
      hash.update(target + '\n');
    } else if (stat.isDirectory()) {
      for (const child of (await fs.readdir(current)).sort()) await walk(path.join(relative, child));
    } else if (stat.isFile()) {
      for await (const chunk of createReadStream(current)) hash.update(chunk);
    } else throw new Error('Unexpected file type in browser bundle.');
  };
  await walk('');
  return hash.digest('hex');
}

class BrowserBundles extends EventEmitter {
  constructor({ stateRoot, applicationsRoot }) {
    super();
    if (!path.isAbsolute(stateRoot) || !path.isAbsolute(applicationsRoot)) throw new Error('Absolute browser directories are required.');
    this.stateRoot = stateRoot;
    this.applicationsRoot = applicationsRoot;
    this.jobs = new Map();
    this.records = new Map();
    this.operations = new Set();
  }

  async initialize() {
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.applicationsRoot, { recursive: true, mode: 0o700 });
    for (const file of await fs.readdir(this.stateRoot)) {
      if (!file.endsWith('.json') || !ID.test(file.slice(0, -5))) continue;
      try {
        const record = JSON.parse(await fs.readFile(path.join(this.stateRoot, file), 'utf8'));
        if (record.id + '.json' !== file || !['chrome', 'chromium'].includes(record.browser)) continue;
        this.records.set(record.id, record);
      } catch { /* A partial/corrupt inventory entry never becomes launchable. */ }
    }
    return this;
  }

  snapshot() {
    return { installs: [...this.records.values()].map(record => ({ ...record })), downloads: [...this.jobs.values()].map(job => ({ ...job.public })) };
  }

  async catalog() {
    const { resolveBuildId, detectBrowserPlatform } = await import('@puppeteer/browsers');
    const platform = detectBrowserPlatform();
    if (!['mac', 'mac_arm'].includes(platform)) throw new Error('This device does not support the macOS browser catalogue.');
    return Promise.all([...CHANNELS.map(channel => ({ browser: 'chrome', channel })), { browser: 'chromium', channel: 'latest' }].map(async entry => {
      try { return { ...entry, platform, buildId: await resolveBuildId(entry.browser, platform, entry.channel) }; }
      catch { return { ...entry, platform, error: 'The publisher catalogue is currently unavailable.' }; }
    }));
  }

  track(operation) {
    this.operations.add(operation);
    return operation.finally(() => this.operations.delete(operation));
  }

  async install(params) {
    if (this.closing) throw new Error('The browser installer is closing.');
    return this.track(this.installBundle(params));
  }

  async installBundle({ browser, buildId, taskId }) {
    if (!['chrome', 'chromium'].includes(browser)) throw new Error('Choose Chrome for Testing or Chromium.');
    if (typeof buildId !== 'string' || !(browser === 'chrome' ? /^\d+\.\d+\.\d+\.\d+$/ : /^\d+$/).test(buildId)) throw new Error('Select a pinned build from the publisher catalogue.');
    if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('A task must own the install request.');
    const id = randomUUID();
    const staging = path.join(this.stateRoot, 'staging', id);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    if (this.closing) {
      await fs.rm(staging, { recursive: true, force: true });
      throw new Error('The browser installer is closing.');
    }
    const job = { public: { id, taskId, browser, buildId, state: 'downloading', downloaded: 0, total: 0 }, child: null, cancelled: false, staging };
    this.jobs.set(id, job);
    const child = spawn(process.execPath, [path.join(__dirname, 'install-worker.cjs')], {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: staging, TMPDIR: staging, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    job.child = child;
    // Start returns immediately; the UI can observe progress or cancel a large
    // download without blocking the Electron main process.
    job.completion = new Promise(resolve => {
      let installed;
      child.on('message', message => {
        if (message.type === 'progress') {
          Object.assign(job.public, { downloaded: message.downloaded, total: message.total });
          this.emit('change');
        } else if (message.type === 'installed') installed = message;
      });
      const finish = async code => {
        try {
          if (job.cancelled) throw new Error('Browser installation cancelled.');
          if (code !== 0 || !installed) throw new Error('The publisher build could not be downloaded or extracted.');
          job.public.state = 'verifying';
          this.emit('change');
          const relativeBundle = browser === 'chrome'
            ? `chrome-${installed.platform === 'mac_arm' ? 'mac-arm64' : 'mac-x64'}/Google Chrome for Testing.app`
            : 'chrome-mac/Chromium.app';
          const source = path.join(staging, browser, `${installed.platform}-${buildId}`, relativeBundle);
          const signature = await verifyBundle(source, browser);
          const treeSha256 = await bundleDigest(source);
          if (job.cancelled) throw new Error('Browser installation cancelled.');
          const destinationDirectory = path.join(this.applicationsRoot, id);
          await fs.mkdir(destinationDirectory, { mode: 0o700 });
          const bundlePath = path.join(destinationDirectory, path.basename(source));
          try {
            // ditto preserves vendor signatures, resource forks and extended
            // attributes; never modify the downloaded app's identity.
            await run('/usr/bin/ditto', [source, bundlePath]);
            await verifyBundle(bundlePath, browser);
            if (await bundleDigest(bundlePath) !== treeSha256) throw new Error('The installed browser does not match its downloaded contents.');
            if (job.cancelled) throw new Error('Browser installation cancelled.');
            const record = { id, taskId, browser, buildId, platform: installed.platform, signature, sourceUrl: installed.sourceUrl, archiveSha256: installed.archiveSha256, treeSha256, installedAt: new Date().toISOString() };
            const recordPath = path.join(this.stateRoot, `${id}.json`);
            await fs.writeFile(recordPath + '.tmp', JSON.stringify(record), { mode: 0o600 });
            await fs.rename(recordPath + '.tmp', recordPath);
            this.records.set(id, record);
            job.public.state = 'installed';
          } catch (error) { await fs.rm(destinationDirectory, { recursive: true, force: true }); throw error; }
        } catch (error) {
          job.diagnostic = error.diagnostic;
          job.public.state = job.cancelled ? 'cancelled' : 'failed';
          job.public.error = error.message;
        } finally {
          await fs.rm(staging, { recursive: true, force: true });
          this.emit('change');
          resolve({ ...job.public });
        }
      };
      child.once('error', () => { /* close follows error and owns cleanup */ });
      child.once('close', finish);
    });
    child.send({ browser, buildId, cacheDir: staging });
    this.emit('change');
    return { ...job.public };
  }

  async cancel(id, taskId) {
    const job = this.jobs.get(id);
    if (!job || job.public.taskId !== taskId) throw new Error('This task does not own the download.');
    if (['installed', 'failed', 'cancelled'].includes(job.public.state)) return { ...job.public };
    job.cancelled = true;
    job.child.kill('SIGTERM');
    return job.completion;
  }

  async executable(id) {
    const record = this.records.get(id);
    if (!record || !ID.test(id)) throw new Error('Browser install is not available on this device.');
    const appName = record.browser === 'chrome' ? 'Google Chrome for Testing' : 'Chromium';
    const bundlePath = path.join(this.applicationsRoot, id, `${appName}.app`);
    if (await bundleDigest(bundlePath) !== record.treeSha256) throw new Error('The browser installation has changed. Install a fresh copy before launching.');
    await verifyBundle(bundlePath, record.browser);
    return path.join(bundlePath, 'Contents', 'MacOS', appName);
  }

  async remove(id) {
    if (!this.records.has(id) || !ID.test(id)) throw new Error('Browser install does not exist.');
    await fs.rm(path.join(this.applicationsRoot, id), { recursive: true });
    await fs.rm(path.join(this.stateRoot, `${id}.json`));
    this.records.delete(id);
    this.emit('change');
  }

  async duplicate(id, taskId) {
    if (this.closing) throw new Error('The browser installer is closing.');
    return this.track(this.duplicateBundle(id, taskId));
  }

  async duplicateBundle(id, taskId) {
    await this.executable(id);
    if (this.closing) throw new Error('The browser installer is closing.');
    if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('Choose the task that owns this browser copy.');
    const source = this.records.get(id), copyId = randomUUID();
    const destination = path.join(this.applicationsRoot, copyId);
    try {
      await run('/usr/bin/ditto', [path.join(this.applicationsRoot, id), destination]);
      const record = { ...source, id: copyId, taskId, installedAt: new Date().toISOString() };
      this.records.set(copyId, record);
      await this.executable(copyId);
      await fs.writeFile(path.join(this.stateRoot, `${copyId}.json`), JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      this.emit('change'); return record;
    } catch (error) { this.records.delete(copyId); await fs.rm(destination, { recursive: true, force: true }); throw error; }
  }

  async close() {
    this.closing = true;
    await Promise.allSettled([...this.operations]);
    await Promise.all([...this.jobs.values()].filter(job => ['downloading', 'verifying'].includes(job.public.state)).map(job => this.cancel(job.public.id, job.public.taskId)));
  }
}

module.exports = { BrowserBundles, verifyBundle, bundleDigest };
