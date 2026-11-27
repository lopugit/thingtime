'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const methods = new Set(['manifest', 'getIncomingShare', 'read', 'thumbnail', 'beginSubmission', 'recordOutcome', 'complete']);
const unavailable = () => Error('Shared content is unavailable for this window or account. Reopen the saved share in Thingtime.');
function incomingShareId(value) {
 if (typeof value !== 'string' || !/^thingtime-share:\/\/incoming\/[a-f0-9-]+$/iu.test(value)) return null;
 try { const url = new URL(value); return url.protocol === 'thingtime-share:' && url.hostname === 'incoming' && !url.port && !url.username && !url.password && !url.search && !url.hash && UUID.test(url.pathname.slice(1)) ? url.pathname.slice(1).toLowerCase() : null; } catch { return null; }
}
// Recovery contains no shared payload, filenames or account/session material.
class PendingShareStore {
 constructor(file) { this.file = file; }
 read() {
  let rows; try { rows = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw unavailable(); }
  if (!Array.isArray(rows) || rows.some(row => Object.keys(row || {}).sort().join(',') !== 'createdAt,endpoint,id' || !UUID.test(row?.id || '') || typeof row.endpoint !== 'string' ||
      new URL(row.endpoint).origin !== row.endpoint || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0)) throw unavailable();
  return rows;
 }
 write(rows) {
  fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
  const temporary = this.file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(rows), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, this.file); }
  finally { fs.rmSync(temporary, { force: true }); }
 }
 add(id, endpoint) {
  if (!UUID.test(id) || new URL(endpoint).origin !== endpoint) throw unavailable();
  const rows = this.read(), existing = rows.find(row => row.id === id);
  if (existing) { if (existing.endpoint !== endpoint) throw unavailable(); return; }
  rows.push({ id, endpoint, createdAt: Date.now() }); this.write(rows);
 }
 list(endpoint) { return this.read().filter(row => row.endpoint === endpoint).sort((a, b) => a.createdAt - b.createdAt); }
 remove(id, endpoint) { this.write(this.read().filter(row => row.id !== id || row.endpoint !== endpoint)); }
}
class NativeShareProcess {
 constructor({ executable, appGroup, requestId, origin, endpoint, testRoot, spawnProcess = spawn, timeoutMs = 30000 }) {
  this.closed = false; this.queue = Promise.resolve(); this.pending = null; this.timeoutMs = timeoutMs;
  this.child = spawnProcess(executable, ['--group', appGroup, '--request', requestId, '--origin', origin, '--endpoint', endpoint, ...(testRoot ? ['--test-root', testRoot] : [])], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  this.lines = createInterface({ input: this.child.stdout });
  this.lines.on('line', line => {
   const pending = this.pending;
   if (!pending) { this.close(); return; }
   this.pending = null; clearTimeout(pending.timer);
   try { const response = JSON.parse(line); if (response?.ok !== true) pending.reject(unavailable()); else pending.resolve(response.result); }
   catch { pending.reject(unavailable()); this.close(); }
  });
  this.child.once('error', () => this.close()); this.child.once('exit', () => this.close());
 }
 request(body) {
  const work = this.queue.then(() => new Promise((resolve, reject) => {
   if (this.closed) return reject(unavailable());
   const timer = setTimeout(() => this.close(), this.timeoutMs); timer.unref?.();
   this.pending = { resolve, reject, timer };
   this.child.stdin.write(JSON.stringify(body) + '\n', error => { if (error) this.close(); });
  }));
  this.queue = work.catch(() => {}); return work;
 }
 close() {
  if (this.closed) return; this.closed = true;
  if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(unavailable()); this.pending = null; }
  this.lines.close(); this.child.stdin.destroy(); this.child.kill();
 }
}
class IncomingShareSession {
 constructor({ requestId, window, origin, endpoint, context, verifyAccount, native }) {
  Object.assign(this, { requestId, window, origin, endpoint, context, verifyAccount, native }); this.closed = false; this.accountId = null; this.verified = false;
 }
 capture(event, body) {
  const current = this.context(), sender = this.window.webContents;
  let url; try { url = new URL(event?.senderFrame?.url); } catch { throw unavailable(); }
  if (this.closed || this.window.isDestroyed() || event.sender !== sender || event.senderFrame !== sender.mainFrame ||
      current.origin !== this.origin || current.endpoint !== this.endpoint || url.origin !== this.origin || url.pathname !== '/share' ||
      url.searchParams.get('requestId')?.toLowerCase() !== this.requestId || !body || !methods.has(body.method)) throw unavailable();
  if (body.method !== 'manifest' && (body.requestId?.toLowerCase() !== this.requestId || typeof body.accountId !== 'string' || !body.accountId ||
      /[\p{Cc}\p{Cf}]/u.test(body.accountId) || (this.accountId && this.accountId !== body.accountId))) throw unavailable();
  if (body.method === 'read' && (!Number.isSafeInteger(body.offset) || body.offset < 0 || !Number.isSafeInteger(body.length) || body.length < 1 || body.length > 262144 || typeof body.fileId !== 'string')) throw unavailable();
  return { window: this.window, appOrigin: this.origin, apiOrigin: this.endpoint, ownerId: body.accountId };
 }
 async request(event, body) {
  const context = this.capture(event, body);
  if (body.method !== 'manifest' && (!this.verified || ['beginSubmission', 'recordOutcome', 'complete'].includes(body.method))) {
   this.accountId = body.accountId; this.verified = false;
   try { await this.verifyAccount(context, AbortSignal.timeout(20000)); this.capture(event, body); this.verified = true; }
   catch (error) { this.verified = false; throw error; }
  }
  const result = await this.native.request(body); this.capture(event, body);
  if (body.method !== 'manifest' && !this.verified) throw unavailable();
  return result;
 }
 close() { this.closed = true; this.native.close(); }
}
module.exports = { incomingShareId, PendingShareStore, NativeShareProcess, IncomingShareSession };
