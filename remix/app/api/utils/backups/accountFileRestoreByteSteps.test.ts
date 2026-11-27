import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createSecretKey, randomBytes, randomUUID } from 'node:crypto';
import { BACKUP_CHUNK_BYTES, backupJson } from '../../../backups/manifest';
import { contentPartPlan, fingerprintSource } from '../../../fileSync/contentFingerprint';
import type { HashCheckpointRef } from './resumableHash';
import { advanceAccountFileRestoreBytes, type FileRestoreByteStepInput, type FileRestoreBytesState } from './accountFileRestoreByteSteps';

async function fixture(size = BACKUP_CHUNK_BYTES + 17) {
 const bytes = Buffer.alloc(size, 71), fingerprint = await fingerprintSource({ size, check: () => {}, read: async (o, l) => bytes.subarray(o, o + l) });
 const scope = { apiOrigin: 'https://restore.test', ownerId: 'owner', dataPlane: 'home' };
 const objects = new Map<string, Uint8Array>(), digests = new Map<number, string>(), refs = new Map<string, HashCheckpointRef>();
 const upload = randomUUID(), key = createSecretKey(randomBytes(32)), controller = new AbortController();
 const requests: { path: string; body?: any }[] = [], uploaded = new Map<number, Buffer>(), putCounts = new Map<number, number>();
 const reads: { offset: number; length: number }[] = [];
 let state: FileRestoreBytesState = null, allowed = true, currentScope = scope, corrupt = false, loseReserve = false, losePut = false, loseHash = false, loseCheckpoint = false, writes = 0, complete = false;
 const check = async () => { controller.signal.throwIfAborted(); if (!allowed) throw Error('revoked'); };
 const input: FileRestoreByteStepInput = {
  ctx: { jobId: randomUUID(), request: new Request(scope.apiOrigin, { signal: controller.signal }), cursor: {} as any, guard: check,
   hashKeys: { current: async () => ({ id: 'test-key', key }), get: async () => key },
   hashCoordinator: slot => ({ current: async binding => { const value = refs.get(slot) ?? null; if (value) assert.equal(value.bindingHash, binding); return value; },
    accept: async (_binding, prior, next) => { await check(); const current = refs.get(slot) ?? null;
     if (backupJson(current) === backupJson(next)) return 'already-accepted';
     if (backupJson(current) !== backupJson(prior)) return 'conflict'; refs.set(slot, structuredClone(next));
     if (loseHash) { loseHash = false; throw Error('accepted hash reply lost'); } return 'accepted'; }
   }) } as any,
  store: { read: async (k, max) => { const value = objects.get(k); if (!value) return null; assert.ok(value.length <= max); return Uint8Array.from(value); },
   put: async (k, value) => { await check(); const old = objects.get(k); if (old) assert.ok(Buffer.from(old).equals(value)); else objects.set(k, Uint8Array.from(value)); } },
  access: { scope, authorize: check }, snapshotId: randomUUID(), sourceSealHash: 'a'.repeat(64), streamId: 'current-file', commandId: randomUUID(), name: 'native-proof.bin',
  file: { id: randomUUID(), revision: 'current', name: 'native-proof.bin', folderId: null, trashed: false,
   content: { attachmentId: 'source-attachment', version: 'c'.repeat(64), size, fingerprint } },
  read: async (offset, length) => { reads.push({ offset, length }); const result = Uint8Array.from(bytes.subarray(offset, offset + length)); if (corrupt && result.length) result[0] ^= 1; return result; },
  state: null,
  checkpoint: async (next, clear = []) => { await check(); state = structuredClone(next); for (const slot of clear) refs.delete(slot); writes++;
   if (loseCheckpoint) { loseCheckpoint = false; throw Error('accepted phase reply lost'); } },
  putPartDigest: async (index, digest) => { const prior = digests.get(index); if (prior) assert.equal(prior, digest); digests.set(index, digest); },
  getPartDigest: async index => digests.get(index) ?? null,
  runtime: { scope, currentScope: () => currentScope, requireCapability: async () => check(), fetch: async (url, init) => {
   await check(); const parsed = new URL(String(url)), path = parsed.pathname;
   const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined; requests.push({ path, body });
   if (path === '/api/v1/attachments/uploads') {
    assert.equal(body.requestId, input.commandId); assert.equal(body.purpose, 'file-import'); assert.equal(body.fileSyncOrigin, undefined);
    if (loseReserve) { loseReserve = false; throw Error('accepted reserve reply lost'); }
    return Response.json({ upload: { id: upload, ...fingerprint, state: size === 0 || complete ? 'ready' : 'pending' } });
   }
   if (path === '/api/v1/attachments/uploads/parts') {
    const { partNumber, checksumSha256 } = body.parts[0]; assert.equal(body.uploadId, upload);
    return Response.json({ parts: [{ partNumber, url: `${scope.apiOrigin}/api/v1/attachments/local-object?part=${partNumber}`,
     headers: { 'x-amz-checksum-sha256': checksumSha256 } }] });
   }
   if (path === '/api/v1/attachments/local-object') {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const part = Number(parsed.searchParams.get('part')), reader = (init.body as ReadableStream<Uint8Array>).getReader(), chunks: Uint8Array[] = [];
    for (;;) { const value = await reader.read(); if (value.done) break; chunks.push(value.value); }
    const value = Buffer.concat(chunks), headers = new Headers(init.headers);
    assert.equal(value.length, Number(headers.get('content-length')));
    assert.equal(createHash('sha256').update(value).digest('base64'), headers.get('x-amz-checksum-sha256'));
    uploaded.set(part, value); putCounts.set(part, (putCounts.get(part) ?? 0) + 1);
    if (losePut) { losePut = false; throw Error('accepted PUT reply lost'); } return new Response(null, { status: 200 });
   }
   if (path === '/api/v1/attachments/uploads/complete') { assert.equal(body.uploadId, upload); assert.equal(uploaded.size, fingerprint.partCount); complete = true; return Response.json({ ok: true }); }
   if (path === '/api/v1/attachments/content') { assert.ok(size === 0 || complete); return Response.json({ id: upload, version: 'd'.repeat(64), size, fingerprint }); }
   throw Error('Unexpected request');
  } }
 };
 return { input, bytes, reads, requests, uploaded, putCounts, refs,
  state: () => state, writes: () => writes, setCorrupt: () => { corrupt = true; }, revoke: () => { allowed = false; },
  changeAccount: () => { currentScope = { ...scope, ownerId: 'different' }; }, abort: () => controller.abort(),
  lose: (which: 'reserve' | 'put' | 'hash' | 'checkpoint') => { if (which === 'reserve') loseReserve = true; if (which === 'put') losePut = true; if (which === 'hash') loseHash = true; if (which === 'checkpoint') loseCheckpoint = true; },
  step: () => advanceAccountFileRestoreBytes({ ...input, state: structuredClone(state) }) };
}
async function run(f: Awaited<ReturnType<typeof fixture>>) { for (let i = 0; i < 80; i++) { const value = await f.step(); if (value.done) return value.content; } throw Error('Unexpected continuation loop'); }
async function until(f: Awaited<ReturnType<typeof fixture>>, phase: FileRestoreBytesState['phase']) { for (let i = 0; i < 80; i++) { if (f.state()?.phase === phase) return; await f.step(); } throw Error('Missing phase'); }

test('fresh workers restore all multipart bytes and recover accepted hash, upload, and phase reply loss', async () => {
 const f = await fixture(); await f.step(); f.lose('hash'); await assert.rejects(f.step(), /accepted hash/);
 await until(f, 'reserve'); assert.equal(f.requests.length, 0);
 f.lose('reserve'); await assert.rejects(f.step(), /accepted reserve/); await f.step();
 f.lose('put'); await assert.rejects(f.step(), /accepted PUT/); f.lose('checkpoint'); await assert.rejects(f.step(), /accepted phase/);
 const restored = await run(f);
 assert.equal(restored.size, f.bytes.length); assert.deepEqual(restored.fingerprint, f.input.file.content.fingerprint);
 assert.ok(Buffer.concat([...f.uploaded.values()]).equals(f.bytes)); assert.equal(f.putCounts.get(1), 2);
 assert.ok(f.reads.every(r => r.length <= BACKUP_CHUNK_BYTES)); assert.equal(f.refs.size, 0);
 assert.equal(f.requests.filter(r => r.path.endsWith('/uploads')).length, 2);
 assert.equal(f.requests.filter(r => r.path.endsWith('/complete')).length, 1);
});

test('empty files verify the empty composite and use canonical ready storage without multipart PUT or complete', async () => {
 const f = await fixture(0), restored = await run(f);
 assert.equal(restored.size, 0); assert.equal(f.reads.length, 0);
 assert.deepEqual(f.requests.map(r => r.path), ['/api/v1/attachments/uploads', '/api/v1/attachments/content']);
});

test('corrupt independent backup bytes are refused before any upload reservation', async () => {
 const f = await fixture(128); f.setCorrupt(); await assert.rejects(run(f), /expected SHA-256/); assert.equal(f.requests.length, 0);
});

test('changed bytes between verification and upload cannot complete or publish content', async () => {
 const f = await fixture(128); await until(f, 'upload-part'); f.setCorrupt();
 await assert.rejects(f.step(), /continuation changed/); assert.equal(f.state().phase, 'upload-part');
 assert.equal(f.requests.some(r => r.path.endsWith('/complete') || r.path.endsWith('/content')), false);
});

test('revocation, cancellation and account change refuse resumed effects without advancing state', async () => {
 for (const action of ['revoke', 'abort', 'changeAccount'] as const) {
  const f = await fixture(64); await until(f, 'upload-part'); const count = f.requests.length, state = f.state(), writes = f.writes();
  f[action](); await assert.rejects(f.step()); assert.equal(f.requests.length, count); assert.deepEqual(f.state(), state); assert.equal(f.writes(), writes);
 }
});

test('saved byte state cannot be reused with another file, source seal, command, or destination scope', async () => {
 const f = await fixture(64); await f.step();
 for (const changed of [{ sourceSealHash: 'b'.repeat(64) }, { commandId: randomUUID() }, { file: { ...f.input.file, id: randomUUID() } }])
  await assert.rejects(advanceAccountFileRestoreBytes({ ...f.input, ...changed, state: f.state() }), /continuation changed/);
 assert.equal(f.requests.length, 0);
});

test('canonical parts larger than a hash unit resume without buffering the full part or imposing a file size cap', async () => {
 const f = await fixture(64), size = 90_000_000_000, plan = contentPartPlan(size);
 f.input.file.content = { ...f.input.file.content, size, fingerprint: { algorithm: 'sha256-parts-v1', ...plan, sha256: 'f'.repeat(64) } };
 const lengths: number[] = []; f.input.read = async (_offset, length) => { lengths.push(length); return new Uint8Array(length); };
 await f.step(); await f.step(); assert.equal(f.state().partIndex, 0);
 assert.equal(f.refs.get('part').offset, String(BACKUP_CHUNK_BYTES));
 await f.step(); assert.equal(f.state().partIndex, 1);
 assert.deepEqual(lengths, [BACKUP_CHUNK_BYTES, plan.partSizeBytes - BACKUP_CHUNK_BYTES]);
 assert.equal(f.requests.length, 0);
});

test('lost completion reply reuses the same upload and part identities; stored fingerprint mismatch refuses content', async () => {
 const f = await fixture(64), fetch = f.input.runtime.fetch; let lose = true, mismatch = true;
 f.input.runtime.fetch = async (url, init) => {
  const result = await fetch(url, init), path = new URL(String(url)).pathname;
  if (path.endsWith('/complete') && lose) { lose = false; throw Error('accepted complete reply lost'); }
  if (path.endsWith('/content') && mismatch) { const body = await result.json(); body.fingerprint.sha256 = 'f'.repeat(64); return Response.json(body); }
  return result;
 };
 await until(f, 'complete'); await assert.rejects(f.step(), /accepted complete/); await f.step();
 await assert.rejects(f.step(), /continuation changed/); assert.equal(f.state().phase, 'fingerprint');
 mismatch = false; await run(f);
 assert.equal(f.putCounts.get(1), 1);
 assert.equal(f.requests.filter(r => r.path.endsWith('/uploads')).length, 1);
 assert.equal(new Set(f.requests.filter(r => r.path.endsWith('/complete')).map(r => r.body.uploadId)).size, 1);
});

test('missing part-signing capability refuses admission and resumed uploads before effects', async () => {
 for (const phase of ['reserve', 'upload-part'] as const) {
  const f = await fixture(64); await until(f, phase); const prior = f.requests.length;
  f.input.runtime.requireCapability = async (feature, minimum) => {
   if (feature === 'api.attachment-upload-parts') { assert.equal(minimum, '1.1.0'); throw Error('missing part-signing capability'); }
  };
  await assert.rejects(f.step(), /missing part-signing capability/); assert.equal(f.requests.length, prior); assert.equal(f.state().phase, phase);
 }
});
