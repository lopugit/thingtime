import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupAttachmentFixture } from './attachmentRecords.fixtures';
import { backupAttachmentFromDoc, backupAttachmentItem } from './attachmentRecords';
import { parseBackupItem } from '../../../backups/manifest';
import { createAccountFileRestoreStager } from './accountFileRestoreBytes';

async function fixture(failVerification = false, bytes = Buffer.from('verified restore bytes')) {
 const sourceId = 'source-file';
 const attachment = await backupAttachmentFixture('source', 'source-attachment', bytes, 'file', sourceId);
 const archived = await backupAttachmentFromDoc(attachment.doc, 'source', Date.now(), async () => bytes.length ? attachment.head : { ...attachment.head, checksumType: 'FULL_OBJECT', checksumSha256: Buffer.from(attachment.content.fingerprint.sha256,'hex').toString('base64') });
 const file = { id: sourceId, revision: 'original-event', folderId: null, name: 'saved.txt', trashed: false, content: attachment.content };
 const item = parseBackupItem({ ordinal: 0, thingId: sourceId, revision: file.revision, snapshot: { adapter: 'file-content', version: 1, value: file }, content: null });
 const reader = { async get(id: string) {
  if (id === sourceId) return { item, ranges: (async function* () {})() };
  assert.equal(id, attachment.doc.shareId);
  return { item: backupAttachmentItem(archived, 1), ranges: (async function* () { yield bytes; if (failVerification) throw Error('full fingerprint failed'); })() };
 } };
 const scope = { origin: 'https://restore.test', ownerId: 'destination', dataPlane: 'home', rootId: 'root', deviceId: 'restore-test' };
 const input = { destinationScope: { apiOrigin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane }, reader, rootId: 'root', record: { kind: 'current' as const, file }, targetId: randomUUID(), operationId: randomUUID(), folderId: 'root', path: file.name, name: file.name };
 const access = { scope: { apiOrigin: 'https://source.test', ownerId: 'source', dataPlane: 'home' }, authorize: async () => {} };
 return { attachment, input, access, scope };
}

test('restore staging refuses a failed final source fingerprint before reserving uploads', async () => {
 const f = await fixture(true), directory = await mkdtemp(join(tmpdir(), 'restore-stage-test-'));
 let requests = 0;
 try {
  const stage = createAccountFileRestoreStager({} as any, 'snapshot', f.access, { currentScope: () => f.scope, origin: () => f.scope.origin, requireCapability: async () => {}, fetch: async () => { requests++; throw Error('must not upload'); } }, undefined, { temporaryDirectory: directory });
  await assert.rejects(stage(f.input), /full fingerprint failed/);
  assert.equal(requests, 0); assert.deepEqual(await readdir(directory), []);
 } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stalled streaming restore PUT aborts and removes private staging without publication', async () => {
 const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'restore-stage-test-'));
 let putStarted!: () => void; const entered = new Promise<void>(resolve => { putStarted = resolve; }); let publications = 0;
 mock.timers.enable({ apis: ['setTimeout'] });
 try {
  const stage = createAccountFileRestoreStager({} as any, 'snapshot', f.access, {
   currentScope: () => f.scope, origin: () => f.scope.origin, requireCapability: async () => {},
   fetch: async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/uploads')) return Response.json({ ok: true, upload: { id: 'destination-attachment', partSizeBytes: f.attachment.content.fingerprint.partSizeBytes, partCount: 1 } });
    if (path.endsWith('/parts')) { const body = JSON.parse(String(init!.body)); return Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] }); }
    if (path === '/part') return new Promise<Response>((_resolve, reject) => { const signal = init!.signal!; signal.addEventListener('abort', () => reject(signal.reason), { once: true }); putStarted(); });
    publications++; throw Error('Unexpected publication');
   }
  }, undefined, { temporaryDirectory: directory });
  const rejected = assert.rejects(stage(f.input), /stalled/);
  await entered; mock.timers.tick(120_001); await rejected;
  assert.equal(publications, 0); assert.deepEqual(await readdir(directory), []);
 } finally { mock.timers.reset(); await rm(directory, { recursive: true, force: true }); }
});

test('stager retains its original full destination identity across calls and refuses a mismatched reviewed baseline', async () => {
 const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'restore-stage-test-'));
 let current = f.scope, requests = 0, reads = 0;
 const reader = { async get(id: string) { reads++; return f.input.reader.get(id); } };
 const runtime = { currentScope: () => current, origin: () => current.origin, requireCapability: async () => {}, fetch: async (url: any) => {
  requests++; const path = new URL(String(url)).pathname;
  if (path.endsWith('/uploads')) return Response.json({ ok: true, upload: { id: 'destination-attachment', state: 'ready', partSizeBytes: f.attachment.content.fingerprint.partSizeBytes, partCount: 1 } });
  if (path.endsWith('/content')) return Response.json({ ok: true, id: 'destination-attachment', version: 'a'.repeat(64), size: f.attachment.content.size, fingerprint: f.attachment.content.fingerprint });
  throw Error('Unexpected staging route');
 } };
 try {
  const stage = createAccountFileRestoreStager({} as any, 'snapshot', f.access, runtime, undefined, { temporaryDirectory: directory });
  await stage({ ...f.input, reader }); const previous = { requests, reads };
  current = { ...f.scope, ownerId: 'other-account' };
  await assert.rejects(stage({ ...f.input, reader }), /account changed/);
  assert.deepEqual({ requests, reads }, previous);
  const mismatched = createAccountFileRestoreStager({} as any, 'snapshot', f.access, runtime, undefined, { temporaryDirectory: directory });
  await assert.rejects(mismatched({ ...f.input, reader }), /destination account changed/);
  assert.deepEqual({ requests, reads }, previous); assert.deepEqual(await readdir(directory), []);
 } finally { await rm(directory, { recursive: true, force: true }); }
});

test('successful restore PUT remains successful when aborted response-body cleanup rejects', async () => {
 const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'restore-stage-test-'));
 let puts = 0, completed = 0;
 try {
  const stage = createAccountFileRestoreStager({} as any, 'snapshot', f.access, { currentScope: () => f.scope, origin: () => f.scope.origin, requireCapability: async () => {}, fetch: async (url, init) => {
   const path = new URL(String(url)).pathname;
   if (path.endsWith('/uploads')) return Response.json({ ok: true, upload: { id: 'destination-attachment', partSizeBytes: f.attachment.content.fingerprint.partSizeBytes, partCount: 1 } });
   if (path.endsWith('/parts')) { const body = JSON.parse(String(init!.body)); return Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] }); }
   if (path === '/part') { puts++; return new Response(new ReadableStream({ start(controller) { controller.error(Error('already-aborted response body')); } }), { status: 200 }); }
   if (path.endsWith('/complete')) { completed++; return Response.json({ ok: true }); }
   if (path.endsWith('/content')) return Response.json({ ok: true, id: 'destination-attachment', version: 'a'.repeat(64), size: f.attachment.content.size, fingerprint: f.attachment.content.fingerprint });
   throw Error('Unexpected publication');
  } }, undefined, { temporaryDirectory: directory });
  const content = await stage(f.input); assert.equal(content.attachmentId, 'destination-attachment'); assert.equal(puts, 1); assert.equal(completed, 1); assert.deepEqual(await readdir(directory), []);
 } finally { await rm(directory, { recursive: true, force: true }); }
});

test('empty restored bytes stage with the canonical single empty-content identity', async () => {
 const f = await fixture(false, Buffer.alloc(0)), directory = await mkdtemp(join(tmpdir(), 'restore-stage-test-'));
 const paths: string[] = [];
 try {
  const stage = createAccountFileRestoreStager({} as any, 'snapshot', f.access, { currentScope: () => f.scope, origin: () => f.scope.origin, requireCapability: async () => {}, fetch: async url => {
   const path = new URL(String(url)).pathname; paths.push(path);
   if (path.endsWith('/uploads')) return Response.json({ ok: true, upload: { id: 'empty-attachment', state: 'ready', partSizeBytes: f.attachment.content.fingerprint.partSizeBytes, partCount: 0 } });
   if (path.endsWith('/content')) return Response.json({ ok: true, id: 'empty-attachment', version: 'a'.repeat(64), size: 0, fingerprint: f.attachment.content.fingerprint });
   throw Error('Empty files must not PUT multipart bytes');
  } }, undefined, { temporaryDirectory: directory });
  assert.equal((await stage(f.input)).size, 0); assert.equal(paths.length, 2); assert.deepEqual(await readdir(directory), []);
 } finally { await rm(directory, { recursive: true, force: true }); }
});
