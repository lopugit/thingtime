'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { verifyEnvelope } = require('../../native-bundles/release.cjs');
const { verifyDirectory } = require('../../native-bundles/inventory.cjs');
const { supportsVersion } = require('./endpoint-compatibility.cjs');

const REQUIRED = Object.freeze({ 'api.releases-native-web': '^1.0.0', 'api.releases-native-web-content': '^1.0.0' });
const WINDOW_BYTES = 2 * 1024 * 1024;
const queues = new Map();
function selectedOrigin(value) {
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username || parsed.password ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)))) {
    throw new Error('Bundle updates require an exact HTTPS origin or local test origin');
  }
  return parsed.origin;
}
async function directory(location) {
  await fs.mkdir(location, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(location);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe bundle download directory');
}
async function nestedDirectory(root, relative) {
  let current = root;
  for (const part of relative.split('/').filter(Boolean)) { current = path.join(current, part); await directory(current); }
}
async function digestHandle(handle) {
  const stat = await handle.stat();
  if (!stat.isFile()) throw new Error('Bundle download is not a regular file');
  const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
  let offset = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
  }
  const after = await handle.stat();
  if (offset !== stat.size || after.size !== stat.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error('Bundle bytes changed during verification');
  return { bytes: offset, sha256: hash.digest('hex') };
}
async function completed(location, file) {
  let handle;
  try {
    handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const actual = await digestHandle(handle);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) throw new Error('Previously downloaded bundle file failed integrity');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  finally { await handle?.close(); }
}
async function boundedBytes(response, maximum, signal) {
  if (!response.body) throw new Error('Bundle response has no body');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.length;
      if (bytes > maximum) throw new Error('Bundle response exceeded its declared processing window');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Credential-free origin-bound delivery. No URL comes from the catalogue;
 * signed paths are only selectors for fixed registered API routes. A process
 * restart resumes verified complete files and durable partial byte windows. */
function createWebBundleDownload({ origin, host, trustedKeys, downloadDirectory, fetchImpl = globalThis.fetch, requestTimeoutMs = 30000 }) {
  origin = selectedOrigin(origin);
  const policy = structuredClone({ host, trustedKeys });
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120000) throw new Error('Invalid bundle request deadline');
  async function request(route, { signal, headers = {}, maximum, json = false }, attempt = 0) {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const url = new URL(route, origin);
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit',
      signal: combined, headers: { Accept: json ? 'application/json' : 'application/octet-stream', 'Accept-Encoding': 'identity', ...headers } });
    if (response.url && response.url !== url.href) { await response.body?.cancel(); throw new Error('Bundle response crossed its selected origin or route'); }
    if (response.status === 429 && attempt < 3) {
      const retry = response.headers.get('retry-after');
      const milliseconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : NaN;
      if (Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 5 * 60 * 1000) {
        await response.body?.cancel();
        // Backpressure is not a failed update. Retain the exact range/hash and
        // make the wait cancellable by the enclosing update-operation deadline.
        await delay(milliseconds, undefined, { signal });
        return request(route, { signal, headers, maximum, json }, attempt + 1);
      }
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Bundle API returned HTTP ${response.status}`); }
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') {
      await response.body?.cancel(); throw new Error('Encoded bundle responses are not exact byte ranges');
    }
    if (json && !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw new Error('Bundle API did not return JSON');
    }
    const bytes = await boundedBytes(response, maximum, combined);
    let value = bytes;
    if (json) {
      try { value = JSON.parse(bytes.toString('utf8')); }
      catch { throw new Error('Bundle API returned invalid JSON'); }
    }
    return { response, value };
  }
  async function check({ signal, minimumSequence = policy.host.minimumSequence } = {}) {
    if (!Number.isSafeInteger(minimumSequence) || minimumSequence < 0) throw new Error('Invalid bundle sequence floor');
    const currentHost = { ...policy.host, minimumSequence: Math.max(policy.host.minimumSequence, minimumSequence) };
    const { value: manifest } = await request('/.well-known/thingtime-capabilities.json', { signal, maximum: 1024 * 1024, json: true });
    if (manifest.origin !== origin || !Object.entries(REQUIRED).every(([name, range]) => supportsVersion(manifest.features?.[name]?.version, range))) throw new Error('Bundle API capability or origin mismatch');
    const query = new URLSearchParams(Object.entries(currentHost).map(([key, value]) => [key, String(value)]));
    const { value } = await request(`/api/v1/releases/native-web?${query}`, { signal, maximum: 16 * 1024 * 1024, json: true });
    if (!value || Object.keys(value).sort().join(',') !== 'ok,release' || value.ok !== true) throw new Error('Invalid bundle catalogue response');
    if (value.release === null) return null;
    verifyEnvelope(value.release, { ...policy, host: currentHost });
    if (value.release.descriptor.sequence <= currentHost.minimumSequence) return null;
    return structuredClone(value.release);
  }
  async function download(supplied, { signal, onProgress = () => {} } = {}) {
    const envelope = structuredClone(supplied);
    const descriptor = verifyEnvelope(envelope, policy);
    const root = path.resolve(downloadDirectory), prior = queues.get(root) || Promise.resolve();
    const operation = prior.then(async () => {
      signal?.throwIfAborted();
      await directory(root);
      const releaseRoot = path.join(root, envelope.releaseId); await directory(releaseRoot);
      const payload = path.join(releaseRoot, 'payload'), partials = path.join(releaseRoot, 'partials');
      await directory(payload); await directory(partials);
      let completeBytes = 0;
      for (const file of descriptor.files) {
        signal?.throwIfAborted();
        const location = path.join(payload, ...file.path.split('/'));
        await nestedDirectory(payload, path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path));
        if (await completed(location, file)) { completeBytes += file.bytes; onProgress({ completeBytes, path: file.path, reused: true }); continue; }
        const partial = path.join(partials, createHash('sha256').update(file.path).digest('hex'));
        let handle = await fs.open(partial, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0), 0o600);
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > file.bytes) throw new Error('Invalid partial bundle file');
          let offset = stat.size;
          while (offset < file.bytes) {
            signal?.throwIfAborted();
            const end = Math.min(file.bytes - 1, offset + WINDOW_BYTES - 1);
            const query = new URLSearchParams({ releaseId: envelope.releaseId, path: file.path });
            const { response, value: bytes } = await request(`/api/v1/releases/native-web/content?${query}`, { signal, maximum: end - offset + 1,
              headers: { Range: `bytes=${offset}-${end}`, 'If-Match': `"${file.sha256}"` } });
            if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${end}/${file.bytes}` ||
                response.headers.get('content-length') !== String(end - offset + 1) || response.headers.get('etag') !== `"${file.sha256}"` || bytes.length !== end - offset + 1) throw new Error('Bundle content range or identity mismatch');
            let written = 0;
            while (written < bytes.length) { const result = await handle.write(bytes, written, bytes.length - written, offset + written); if (!result.bytesWritten) throw new Error('Bundle download write stalled'); written += result.bytesWritten; }
            await handle.sync(); offset += bytes.length;
            onProgress({ completeBytes: completeBytes + offset, path: file.path, reused: false });
          }
          const actual = await digestHandle(handle);
          if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) {
            await handle.close(); handle = null; await fs.unlink(partial);
            throw new Error('Downloaded bundle file failed its signed integrity check');
          }
          await handle.sync(); await handle.close(); handle = null;
          await fs.rename(partial, location);
          completeBytes += file.bytes;
        } finally { await handle?.close(); }
      }
      await verifyDirectory(payload, descriptor);
      return { directory: payload, envelope, completeBytes };
    });
    const tail = operation.catch(() => {}); queues.set(root, tail);
    return operation.finally(() => { if (queues.get(root) === tail) queues.delete(root); });
  }
  async function discard(releaseId) {
    if (typeof releaseId !== 'string' || !/^[a-f0-9]{64}$/.test(releaseId)) throw new Error('Invalid staged download identity');
    const root = path.resolve(downloadDirectory);
    const operation = (queues.get(root) || Promise.resolve()).then(async () => {
      // Only the duplicate transport copy is removed, after store.stage has
      // committed its independently verified copy. Store/profile data is never
      // under this directory. Partial failed transfers remain resumable.
      await directory(root);
      const location = path.join(root, releaseId);
      let stat; try { stat = await fs.lstat(location); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe staged download cleanup');
      await fs.rm(location, { recursive: true });
    });
    const tail = operation.catch(() => {}); queues.set(root, tail);
    return operation.finally(() => { if (queues.get(root) === tail) queues.delete(root); });
  }
  return { check, download, discard };
}
module.exports = { createWebBundleDownload, REQUIRED, WINDOW_BYTES };
