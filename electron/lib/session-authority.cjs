'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { endpointPartition, assertFreePort } = require('./local-runtime.cjs');

function remoteOrigin(value) {
 if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid workspace origin.');
 const url = new URL(value);
 if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
  /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) || url.hostname.endsWith('.localhost'))
  throw new Error('Choose the exact HTTPS account API used by the previous workspace.');
 return url.origin;
}
function contentOrigin(value) {
 if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid workspace origin.');
 const url = new URL(value);
 const port = Number(url.port);
 if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash ||
  url.pathname !== '/' || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Enter the previous workspace URL as http://127.0.0.1:<port>.');
 return url.origin;
}
function validate(value) {
 if (!value || value.version !== 1 || !['partitioned', 'legacy'].includes(value.mode)) throw new Error('Session storage settings are invalid.');
 if (value.legacy === null) {
  if (value.mode !== 'partitioned') throw new Error('Session storage settings are invalid.');
 } else if (!value.legacy || remoteOrigin(value.legacy.apiOrigin) !== value.legacy.apiOrigin || contentOrigin(value.legacy.contentOrigin) !== value.legacy.contentOrigin) {
  throw new Error('Session storage settings are invalid.');
 }
 return { version: 1, mode: value.mode, legacy: value.legacy ? { apiOrigin: value.legacy.apiOrigin, contentOrigin: value.legacy.contentOrigin } : null };
}

// A legacy workspace is adopted only through explicit, origin-specific recovery.
// Never infer ownership from the current endpoint or inspect/copy stored secrets.
class SessionAuthority {
 constructor({ userData, isolated = false, checkPort = assertFreePort }) {
  if (!path.isAbsolute(userData)) throw new Error('Session storage requires an absolute app data directory.');
  this.file = path.join(userData, 'session-authority.json');
  this.isolated = isolated;
  this.checkPort = checkPort;
  this.state = { version: 1, mode: 'partitioned', legacy: null };
  this.running = this.state;
  this.pending = Promise.resolve();
 }
 async initialize() {
  if (!this.isolated) {
   try {
    const stat = await fs.lstat(this.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw new Error('Session storage settings are invalid.');
    this.state = validate(JSON.parse(await fs.readFile(this.file, 'utf8')));
   } catch (error) { if (error.code !== 'ENOENT') throw new Error('Session storage settings could not be read safely. Existing workspaces were preserved.'); }
  }
  this.running = this.state;
 }
 legacyFor(apiOrigin, local = false) {
  return !this.isolated && !local && this.running.mode === 'legacy' && this.running.legacy?.apiOrigin === new URL(apiOrigin).origin ? this.running.legacy : null;
 }
 partition(apiOrigin, { local = false, databaseIdentity = '' } = {}) {
  return this.legacyFor(apiOrigin, local) ? '' : endpointPartition(apiOrigin, databaseIdentity);
 }
 rendererOrigin(apiOrigin, fallback, local = false) {
  return this.legacyFor(apiOrigin, local)?.contentOrigin || fallback;
 }
 snapshot(apiOrigin, local = false) {
  let recoveryAvailable = false;
  try { recoveryAvailable = !this.isolated && !local && remoteOrigin(apiOrigin) === new URL(apiOrigin).origin; } catch {}
  return {
   mode: this.legacyFor(apiOrigin, local) ? 'legacy' : 'partitioned',
   legacyApiOrigin: this.state.legacy?.apiOrigin || null,
   legacyContentOrigin: this.state.legacy?.contentOrigin || null,
   recoveryAvailable,
   restartRequired: JSON.stringify(this.running) !== JSON.stringify(this.state)
  };
 }
 async save(value) {
  const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
  try {
   const handle = await fs.open(temporary, 'wx', 0o600);
   try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
   await fs.rename(temporary, this.file);
   this.state = value; // A failed directory fsync must not allow rebinding an already replaced file.
   const directory = await fs.open(path.dirname(this.file), 'r');
   try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.rm(temporary, { force: true }); }
 }
 change(operation) {
  const next = this.pending.then(operation);
  this.pending = next.catch(() => {});
  return next;
 }
 recover(request, beforeCommit) {
  return this.change(async () => {
   if (this.isolated) throw new Error('Isolated development cannot adopt a previous app workspace.');
   const legacy = { apiOrigin: remoteOrigin(request.apiOrigin), contentOrigin: contentOrigin(request.contentOrigin) };
   if (this.state.legacy && JSON.stringify(this.state.legacy) !== JSON.stringify(legacy)) throw new Error('The previous workspace is already bound to another API or content origin.');
   if (this.running.mode !== 'legacy' || JSON.stringify(this.running.legacy) !== JSON.stringify(legacy)) await this.checkPort(Number(new URL(legacy.contentOrigin).port));
   await beforeCommit();
   await this.save({ version: 1, mode: 'legacy', legacy });
  });
 }
 useCurrent(apiOrigin, beforeCommit) {
  return this.change(async () => {
   if (this.isolated || !this.state.legacy || this.state.legacy.apiOrigin !== remoteOrigin(apiOrigin)) throw new Error('Choose the API associated with the previous workspace.');
   await beforeCommit();
   await this.save({ ...this.state, mode: 'partitioned' });
  });
 }
}
module.exports = { SessionAuthority, remoteOrigin, contentOrigin };
