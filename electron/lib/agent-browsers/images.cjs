'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

const ID = /^[a-f0-9-]{36}$/;
const FILES = ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'install.mjs', 'runtime.cjs', 'application.cjs', 'browser-driver.cjs', 'prepare-native.cjs', 'seccomp.json'];

async function copyApplication(source, destination, { signal } = {}) {
  signal?.throwIfAborted();
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  if (!source) { await fs.writeFile(path.join(destination, '.keep'), ''); return false; }
  const root = await fs.realpath(source);
  await fs.access(path.join(source, 'server/index.mjs'));
  await fs.access(path.join(source, 'public/index.html'));
  async function copy(from, to, ancestors = new Set()) {
    signal?.throwIfAborted();
    const real = await fs.realpath(from), name = path.basename(from), targetName = path.basename(real);
    if (!real.startsWith(root + path.sep) || ancestors.has(real) || [name, targetName].some(value => value.startsWith('.env') || /\.(?:p8|p12|pfx|key|pem)$/i.test(value))) throw new Error('The packaged test app contains an unsafe build input.');
    const stat = await fs.stat(real);
    if (stat.isDirectory()) {
      await fs.mkdir(to, { recursive: true, mode: 0o700 });
      for (const entry of await fs.readdir(real)) await copy(path.join(real, entry), path.join(to, entry), new Set([...ancestors, real]));
    } else if (stat.isFile()) await fs.copyFile(real, to);
    else throw new Error('The packaged test app contains an unsupported file.');
  }
  // Only the verified packaged server and static client; never the worktree,
  // build environment, desktop endpoint settings or device runtime state.
  await copy(path.join(source, 'server'), path.join(destination, 'server'));
  await copy(path.join(source, 'public'), path.join(destination, 'public'));
  return true;
}

// The image is immutable and can be shared; each inventory copy grants an
// independent claim and launches its own writable profile and namespace.
class BrowserImages extends EventEmitter {
  constructor({ engine, stateRoot, sourceRoot = path.join(__dirname, 'runtime'), applicationRoot }) {
    super(); this.engine = engine; this.stateRoot = stateRoot; this.sourceRoot = sourceRoot; this.applicationRoot = applicationRoot;
    this.records = new Map(); this.jobs = new Map();
  }
  async initialize() {
    await fs.mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    for (const file of await fs.readdir(this.stateRoot)) {
      if (!file.endsWith('.json') || !ID.test(file.slice(0, -5))) continue;
      try {
        const record = JSON.parse(await fs.readFile(path.join(this.stateRoot, file), 'utf8'));
        if (record.id + '.json' === file && /^sha256:[a-f0-9]{64}$/.test(record.imageId)) this.records.set(record.id, record);
      } catch { /* An incomplete record never becomes launchable. */ }
    }
    return this;
  }
  snapshot() { return { installs: [...this.records.values()], downloads: [...this.jobs.values()].map(job => job.public) }; }
  async install({ browser = 'chromium', buildId = 'playwright-1.64.0', taskId }) {
    if (this.closing) throw new Error('The browser installer is closing.');
    if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('Choose the task that owns this install.');
    if (!(browser === 'chromium' && buildId === 'playwright-1.64.0') && !(browser === 'chrome' && /^\d+\.\d+\.\d+\.\d+$/.test(buildId))) throw new Error('Choose a supported pinned browser build.');
    const id = randomUUID(), context = path.join(this.stateRoot, 'staging', id);
    // Reserve the job before the first asynchronous copy so app shutdown and
    // cancellation own the entire operation, including build preparation.
    const job = { controller: new AbortController(), public: { id, taskId, browser, buildId, state: 'preparing' } };
    this.jobs.set(id, job); this.emit('change');
    job.completion = (async () => {
      const tag = `thingtime-agent-browser:${id}`;
      try {
        await fs.mkdir(context, { recursive: true, mode: 0o700 });
        // Only shipped inputs; no worktree, host profile or environment files.
        for (const file of FILES) {
          job.controller.signal.throwIfAborted();
          await fs.copyFile(path.join(this.sourceRoot, file), path.join(context, file));
        }
        const includesApplication = await copyApplication(this.applicationRoot, path.join(context, 'app'), { signal: job.controller.signal });
        job.controller.signal.throwIfAborted();
        job.public.state = 'building'; this.emit('change');
        await this.engine.run(['build', '--tag', tag, '--build-arg', `BROWSER=${browser}`, '--build-arg', `BUILD_ID=${buildId}`, context], {
          timeoutMs: 30 * 60 * 1000,
          signal: job.controller.signal,
          progress: () => { /* Build logs remain private; publish only phase. */ }
        });
        const [image] = JSON.parse(await this.engine.run(['image', 'inspect', tag]));
        job.controller.signal.throwIfAborted();
        if (!/^sha256:[a-f0-9]{64}$/.test(image?.Id)) throw new Error('The runtime did not return an immutable image.');
        const record = { id, taskId, browser, buildId, imageId: image.Id, platform: image.Architecture, includesApplication, installedAt: new Date().toISOString() };
        await this.save(record); job.public.state = 'installed';
      } catch (error) {
        job.public.state = job.controller.signal.aborted ? 'cancelled' : 'failed';
        // Do not send build output, URLs or host paths to task records.
        job.public.error = 'The isolated browser build failed. Check that this publisher build supports the device architecture and the runtime is available.';
        job.error = error;
      } finally { await fs.rm(context, { recursive: true, force: true }); this.emit('change'); }
      return { ...job.public };
    })();
    return { ...job.public };
  }
  async cancel(id, taskId) {
    const job = this.jobs.get(id);
    if (!job || job.public.taskId !== taskId) throw new Error('This task does not own the browser build.');
    job.controller.abort(); await job.completion; return { ...job.public };
  }
  async close() {
    this.closing = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(job => job.completion));
  }
  async save(record) {
    const file = path.join(this.stateRoot, `${record.id}.json`);
    await fs.writeFile(file + '.tmp', JSON.stringify(record), { mode: 0o600 });
    await fs.rename(file + '.tmp', file); this.records.set(record.id, record); this.emit('change');
  }
  async duplicate(id, taskId) {
    const source = this.records.get(id);
    if (!source) throw new Error('Choose an installed browser.');
    if (typeof taskId !== 'string' || !taskId.trim()) throw new Error('Choose the task that owns this install.');
    const record = { ...source, id: randomUUID(), taskId, installedAt: new Date().toISOString() };
    await this.save(record); return record;
  }
  async remove(id) {
    if (!ID.test(id) || !this.records.has(id)) throw new Error('This browser install is unavailable.');
    // The immutable image can still be used by another copy. Do not prune it.
    await fs.rm(path.join(this.stateRoot, `${id}.json`)); this.records.delete(id); this.emit('change');
  }
}
module.exports = { BrowserImages, copyApplication };
