'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { uploadFolderSingle } = require('../lib/folder-upload-single.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
 const bytes = Buffer.from('immutable source'), raw = hash(bytes), fingerprint = { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: hash(Buffer.from(raw, 'hex')) };
 const configuration = { configurationVersion: 1, name: 'Two way', deviceId: 'device', localRootId: randomUUID(), remoteFolderId: 'cloud', mode: 'two-way', paused: false, propagateDeletes: false, network: 'wifi', chargingOnly: false, excludedPaths: [] };
 const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
 const authorization = { id: 'connection', updatedAt: '2026-11-06T00:00:00Z', scope, configuration };
 const input = { requestId: randomUUID(), rootId: configuration.localRootId, ownerId: 'owner', deviceId: 'device', origin: scope.origin, action: 'upload-single', upload: { uploadId: 'attachment', requestId: randomUUID(), source: { id: 'inode', path: 'file', version: 'stamp', kind: 'file', size: bytes.length, fingerprint }, authorization } };
 const row = { ...authorization, author: { id: 'owner' }, thingtime: ['file-sync'], acl: ['tt:user'], crystal: configuration };
 const content = { id: 'attachment', version: 'c'.repeat(64), size: bytes.length, fingerprint };
 const calls = []; let puts = 0, ready = false;
 const args = { input, context: { ownerId: 'owner', apiOrigin: scope.origin }, signal: new AbortController().signal, authorize: async () => {}, assertCurrent: () => {},
 json: async (path, body) => { calls.push({ path, body }); if (path.startsWith('/api/v1/things?')) return { ok: true, thing: row };
  if (path === '/api/v1/attachments/uploads') return { upload: { id: 'attachment', state: ready ? 'ready' : 'uploading', partCount: 1, partSizeBytes: 8388608 } };
  if (path.includes('/complete')) { ready = true; return { ok: true }; }
  return content; },
 signPart: async body => { assert.equal(body.uploadId, input.upload.uploadId); return { parts: [{ partNumber: 1, url: 'https://store.test/part', headers: { 'x-amz-checksum-sha256': Buffer.from(raw, 'hex').toString('base64') } }] }; },
 fetchUpload: async (_target, options) => { puts++; assert.equal(Buffer.from(await new Response(options.body).arrayBuffer()).toString(), bytes.toString()); return new Response(null, { status: 200 }); },
 requestNative: async (request, { onBatchFrame: exchange }) => {
  assert.equal(request.upload.requestId, input.upload.requestId);
  const prepared = await exchange({ kind: 'prepare-ready', checksums: [{ ordinal: 0, sha256: raw }] });
  let verified = prepared.content;
  if (!prepared.ready) {
   await exchange({ kind: 'chunk', ordinal: 0, offset: 0, data: bytes.toString('base64') });
   await exchange({ kind: 'put-ready', ordinal: 0, sha256: raw });
   verified = (await exchange({ kind: 'verify-ready' })).content;
  }
  return { ...request, roots: [], uploadedSingle: verified };
 } };
 return { args, input, row, calls, counts: () => ({ puts }), setReady: () => { ready = true; } };
}
test('compound transport keeps original reservation and verifies stored content without publishing a file', async () => {
 const f = fixture(), result = await uploadFolderSingle(f.args);
 assert.equal(f.counts().puts, 1); assert.equal(result.uploadedSingle.payloadBytes, f.input.upload.source.size);
 assert.ok(f.calls.every(c => !c.path.startsWith('/api/v1/files')));
 assert.deepEqual(f.calls.find(c => c.path === '/api/v1/attachments/uploads').body.requestId, f.input.upload.requestId);
 f.setReady(); const replay = await uploadFolderSingle(f.args); assert.equal(f.counts().puts, 1); assert.equal(replay.uploadedSingle.payloadBytes, 0);
});
test('source payload corruption and stored proof mismatch fail closed', async () => {
 for (const failure of ['chunk', 'content']) {
  const f = fixture();
  if (failure === 'chunk') { const native = f.args.requestNative; f.args.requestNative = (r, o) => native(r, { ...o, onBatchFrame: frame => o.onBatchFrame(frame.kind === 'chunk' ? { ...frame, data: Buffer.from('bad').toString('base64') } : frame) }); }
  else { const json = f.args.json; f.args.json = async (...a) => { const v = await json(...a); return a[0].includes('/content?') ? { ...v, version: 'invalid' } : v; }; }
  await assert.rejects(uploadFolderSingle(f.args));
 }
});
test('config/account/frame revocation during PUT prevents completion and cancels active body', async () => {
 for (const failure of ['configuration', 'account', 'frame']) {
  const f = fixture(); let revoked = false, completed = false;
  const json = f.args.json; f.args.json = async (...a) => { if (a[0].endsWith('/complete')) completed = true; return json(...a); };
  f.args.authorize = async () => { if (revoked && failure === 'account') throw Error('revoked'); };
  f.args.assertCurrent = () => { if (revoked && failure === 'frame') throw Error('frame changed'); };
  f.args.fetchUpload = async (_target, options) => {
   revoked = true; if (failure === 'configuration') f.row.updatedAt = 'changed';
   await assert.rejects(new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }), /verified|revoked|frame/);
   throw options.signal.reason;
  };
  await assert.rejects(uploadFolderSingle(f.args)); assert.equal(completed, false);
 }
});
test('lost PUT response completes immutable attachment; receipt retry sends no duplicate payload', async () => {
 const f = fixture(); let puts = 0;
 f.args.fetchUpload = async () => { puts++; throw Object.assign(Error('lost response'), { code: 'ECONNRESET' }); };
 const result = await uploadFolderSingle(f.args); assert.equal(result.uploadedSingle.payloadBytes, null);
 await uploadFolderSingle(f.args); assert.equal(puts, 1);
});

test('compound JSON retains strict origin, account headers and bounded allowlisted finalization waits', async () => {
 const { singleJson } = require('../lib/folder-upload-single.cjs');
 for (const [code, retryable, waits] of [['finalization_in_progress', true, true], ['finalization_in_progress', false, false], ['arbitrary-secret', true, false]]) {
  const context = { apiOrigin: 'https://sync.test', appOrigin: 'http://127.0.0.1:12345', ownerId: 'owner', window: { webContents: { session: { fetch: async (_url, options) => {
   assert.equal(options.headers['X-Thingtime-Expected-Actor'], 'owner'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'include');
   return Response.json({ ok: false, code, retryable }, { status: 409, headers: { 'x-thingtime-api-fallback': 'https://sync.test' } });
  } } } } };
  await assert.rejects(singleJson(context, '/api/v1/attachments/uploads/complete', { uploadId: 'upload' }, new AbortController().signal), error => /folder_upload_retry/.test(error.message) === waits && !error.message.includes(code));
 }
});

test('explicit cancellation during PUT retains the unfinished operation and cannot finalize', async () => {
 const f = fixture(), controller = new AbortController(); f.args.signal = controller.signal;
 let completed = false; const json = f.args.json;
 f.args.json = async (...args) => { if (args[0].endsWith('/complete')) completed = true; return json(...args); };
 f.args.fetchUpload = async (_target, options) => {
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  options.signal.throwIfAborted(); throw Error('Unreachable');
 };
 await assert.rejects(uploadFolderSingle(f.args), { name: 'AbortError' }); assert.equal(completed, false);
});

test('finishing PUT cancels an in-flight monitor HTTP read without delaying or refusing success', async () => {
 const f = fixture(); let releasePut, held = false, monitorCancelled = false, heldAt;
 const json = f.args.json;
 f.args.json = async (path, body, signal) => {
  if (path.startsWith('/api/v1/things?') && releasePut && !held) {
   held = true; heldAt = performance.now(); const release = releasePut; releasePut = undefined;
   setTimeout(release, 0);
   return new Promise((resolve, reject) => signal.addEventListener('abort', () => { monitorCancelled = true; reject(signal.reason); }, { once: true }));
  }
  return json(path, body, signal);
 };
 f.args.fetchUpload = async () => { await new Promise(resolve => { releasePut = resolve; }); return new Response(null, { status: 200 }); };
 const result = await uploadFolderSingle(f.args);
 assert.ok(held && monitorCancelled); assert.ok(performance.now() - heldAt < 500); assert.equal(result.uploadedSingle.payloadBytes, f.input.upload.source.size);
});
test('connection without local resource limits inherits the same global 5MB/s and CPU15 governor', async () => {
 const { governorFor } = require('../lib/folder-resource-governor.cjs');
 const f = fixture();
 f.input.deviceResourceLimits = { transferBytesPerSecond: 5000000, scanBytesPerSecond: 5000000, cpuPercent: 15 };
 assert.equal(f.input.upload.authorization.configuration.resourceLimits, undefined);
 await uploadFolderSingle(f.args);
 const governor = governorFor({ ...f.input, action: 'resources', rootId: undefined, deviceResourceLimits: undefined }, f.args.context);
 assert.equal(governor.totalBytesPerSecond, 5000000); assert.equal(governor.policy.cpuPercent, 15);
});
