'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { canonical, verifyEnvelope } = require('../../native-bundles/release.cjs');
const { verifyDirectory } = require('../../native-bundles/inventory.cjs');

const queues = new Map();
const ID = /^[a-f0-9]{64}$/;
const clone = value => JSON.parse(JSON.stringify(value));

async function directory(location) {
  const stat = await fs.lstat(location);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Bundle cache directory is unsafe');
}

async function syncDirectory(location) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(location, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function readJSON(location, maximumBytes) {
  const handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximumBytes) throw new Error('Bundle cache record is invalid');
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > maximumBytes) throw new Error('Bundle cache record is invalid');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { await handle.close(); }
}

async function atomicJSON(location, value) {
  const temporary = `${location}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${canonical(value)}\n`);
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temporary, location);
    await syncDirectory(path.dirname(location));
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

async function copyVerifiedFile(source, target, file, signal) {
  const parts = file.path.split('/');
  for (let i = 0; i < parts.length; i++) await directory(path.join(source, ...parts.slice(0, i)));
  const input = await fs.open(path.join(source, ...parts), constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  let output;
  try {
    const before = await input.stat();
    if (!before.isFile() || before.size !== file.bytes) throw new Error('Bundle source changed before staging');
    const destination = path.join(target, ...parts);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    output = await fs.open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (true) {
      signal?.throwIfAborted();
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > file.bytes) throw new Error('Bundle source changed while staging');
      hash.update(buffer.subarray(0, bytesRead));
      let offset = 0;
      while (offset < bytesRead) offset += (await output.write(buffer, offset, bytesRead - offset)).bytesWritten;
    }
    const after = await input.stat();
    if (bytes !== file.bytes || hash.digest('hex') !== file.sha256 || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('Bundle source changed while staging');
    }
    await output.sync();
  } finally { await input.close(); await output?.close(); }
}

/**
 * The host must hold its normal profile single-instance lock. This store also
 * serializes instances within that process. It neither downloads nor executes
 * code; callers supply staged bytes and report successful real application boot.
 */
async function createWebBundleStore({ cacheDirectory, bundledDirectory, trustedKeys, host }) {
  const policy = { trustedKeys: clone(trustedKeys), host: clone(host) };
  await fs.mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  await directory(cacheDirectory);
  const root = await fs.realpath(cacheDirectory);
  const releases = path.join(root, 'releases');
  await fs.mkdir(releases, { recursive: true, mode: 0o700 });
  await directory(releases);
  const stateFile = path.join(root, 'state.json');
  const scope = canonical(Object.fromEntries(['platform', 'arch', 'runtimeId', 'nativeAbi', 'channel'].map(key => [key, policy.host[key]])));
  const initial = () => ({ format: 1, scope, highestSequence: 0, active: null, previous: null, pending: null, failed: null });

  async function readState() {
    let state;
    try { state = await readJSON(stateFile, 8192); } catch (error) { if (error.code === 'ENOENT') return initial(); throw error; }
    if (Object.keys(state).sort().join(',') !== 'active,failed,format,highestSequence,pending,previous,scope' ||
        state.format !== 1 || state.scope !== scope || !Number.isSafeInteger(state.highestSequence) || state.highestSequence < 0 ||
        ['active', 'previous', 'failed'].some(key => state[key] !== null && (typeof state[key] !== 'string' || !ID.test(state[key]))) ||
        (state.pending !== null && (Object.keys(state.pending).sort().join(',') !== 'attempted,releaseId' ||
          typeof state.pending.releaseId !== 'string' || !ID.test(state.pending.releaseId) || typeof state.pending.attempted !== 'boolean'))) {
      throw new Error('Bundle cache state is invalid; preserve it for recovery');
    }
    return state;
  }

  function serialized(operation) {
    const result = (queues.get(root) || Promise.resolve()).then(async () => {
      await directory(root); await directory(releases);
      return operation();
    });
    const tail = result.catch(() => {});
    queues.set(root, tail);
    return result.finally(() => { if (queues.get(root) === tail) queues.delete(root); });
  }

  async function installed(releaseId) {
    if (!ID.test(releaseId)) throw new Error('Invalid bundle identity');
    const base = path.join(releases, releaseId);
    await directory(releases); await directory(base);
    // The manifest is already bounded by the signed inventory created by the
    // build. The large limit is a parser work budget, not a content-size limit.
    const envelope = await readJSON(path.join(base, 'release.json'), 16 * 1024 * 1024);
    if (envelope.releaseId !== releaseId) throw new Error('Bundle cache identity mismatch');
    const descriptor = verifyEnvelope(envelope, policy);
    const payload = path.join(base, 'payload');
    await verifyDirectory(payload, descriptor);
    return { releaseId, directory: payload, descriptor };
  }

  async function retained(state) {
    let changed = false;
    for (const key of ['active', 'previous']) {
      if (!state[key]) continue;
      let result;
      try { result = await installed(state[key]); } catch {
        state.failed = state[key]; state[key] = null; changed = true;
        continue;
      }
      if (key === 'previous') { state.active = state.previous; state.previous = null; changed = true; }
      if (changed) await atomicJSON(stateFile, state);
      return { ...result, source: 'retained' };
    }
    if (changed) await atomicJSON(stateFile, state);
    await directory(bundledDirectory);
    return { releaseId: null, directory: bundledDirectory, source: 'bundled' };
  }

  return {
    inspect: () => serialized(async () => clone(await readState())),
    stage: (source, suppliedEnvelope, { signal } = {}) => {
      // Freeze caller-owned objects when enqueued, including behind another save.
      const envelope = clone(suppliedEnvelope);
      return serialized(async () => {
      signal?.throwIfAborted();
      const descriptor = verifyEnvelope(envelope, policy);
      const state = await readState();
      if (state.pending?.releaseId === envelope.releaseId) { await installed(envelope.releaseId); return envelope.releaseId; }
      if (state.pending) throw new Error('A bundle trial is already pending');
      if (descriptor.sequence <= state.highestSequence) throw new Error('Bundle release sequence did not advance');
      await verifyDirectory(source, descriptor);
      const temporary = path.join(releases, `.stage-${randomUUID()}`);
      const destination = path.join(releases, envelope.releaseId);
      await fs.mkdir(path.join(temporary, 'payload'), { recursive: true, mode: 0o700 });
      try {
        for (const file of descriptor.files) await copyVerifiedFile(source, path.join(temporary, 'payload'), file, signal);
        await verifyDirectory(path.join(temporary, 'payload'), descriptor);
        const directories = new Set(['']);
        for (const file of descriptor.files) {
          const parts = file.path.split('/');
          for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
        }
        for (const relative of [...directories].sort((a, b) => b.split('/').length - a.split('/').length)) {
          await syncDirectory(path.join(temporary, 'payload', relative));
        }
        await atomicJSON(path.join(temporary, 'release.json'), envelope);
        signal?.throwIfAborted();
        try { await fs.rename(temporary, destination); }
        catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
          await installed(envelope.releaseId);
        }
        await syncDirectory(releases);
        state.highestSequence = descriptor.sequence;
        state.pending = { releaseId: envelope.releaseId, attempted: false };
        await atomicJSON(stateFile, state);
        return envelope.releaseId;
      } finally { await fs.rm(temporary, { recursive: true, force: true }); }
      });
    },
    prepareLaunch: () => serialized(async () => {
      const state = await readState();
      if (state.pending) {
        const candidate = state.pending;
        if (!candidate.attempted) {
          let result;
          try { result = await installed(candidate.releaseId); } catch { /* Keep the known-good bundle below. */ }
          if (result) {
            state.pending.attempted = true;
            await atomicJSON(stateFile, state);
            return { ...result, source: 'trial' };
          }
        }
        state.failed = candidate.releaseId;
        state.pending = null;
        await atomicJSON(stateFile, state);
      }
      return retained(state);
    }),
    confirmLaunch: releaseId => serialized(async () => {
      const state = await readState();
      if (!state.pending?.attempted || state.pending.releaseId !== releaseId) throw new Error('No matching bundle launch trial');
      await installed(releaseId);
      state.previous = state.active;
      state.active = releaseId;
      state.pending = null;
      state.failed = null;
      await atomicJSON(stateFile, state);
      return clone(state);
    })
  };
}

module.exports = { createWebBundleStore };
