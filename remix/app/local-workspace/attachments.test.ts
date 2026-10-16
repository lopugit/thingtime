import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, WORKSPACE_LIMITS } from './storage';
import { LocalThings, localThingProjection } from './things';
import { AccountFileSync } from './accountFiles';
import { transferChecksum, encodeTransferArchive, decodeTransferArchive } from '../utils/thingTransfer/archive';
import { validateTransfer, type ThingTransfer } from '../utils/thingTransfer/format';
import { recordingTransferFile } from '../utils/thingTransfer/recording';
import { compositionAttachmentIds } from '../api/utils/actions/compositionMediaCore';
import { bundleFromPlan } from '../utils/thingTransfer/browser';

const scope = { kind: 'anonymous' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const fixture = () => { const db = new WorkspaceDatabase(new IDBFactory()); return { db, things: new LocalThings(db, scope, lease) }; };
const bytes = new TextEncoder().encode('Exact local file bytes\n\u0000\u00ff');
const bundle = async (standalone = true) => ({
 manifest: { format: 'thingtime.transfer', version: 1, roots: ['root'], things: [standalone
  ? { id: 'root', thingtime: ['attachment'], crystal: { recordingFileId: 'bytes', filePurpose: 'file' } }
  : { id: 'root', thingtime: ['component'], crystal: { name: 'Local image', render: { tag: 'img', props: { src: '/api/v1/attachments/content?id=bytes' } } } }],
 files: [{ id: 'bytes', targetId: 'root', path: 'files/000000', name: 'sample.txt', mime: 'text/plain', bytes: bytes.length, sha256: await transferChecksum(bytes) }] } as ThingTransfer,
 files: new Map([['bytes', bytes]])
});

test('binary and metadata writes share atomic quota, survive reopen, isolate scopes and refund deletion', async () => {
 const factory = new IDBFactory(); const db = new WorkspaceDatabase(factory);
 try {
  await db.transaction(scope, 'readwrite', lease, async tx => {
   const mutable = Uint8Array.from(bytes); const write = tx.putBytes('file', mutable); mutable.fill(0); await write;
   await tx.put('things', 'file', { name: 'file' });
  });
  await db.close();
  assert.deepEqual(await db.transaction(scope, 'readonly', lease, tx => tx.getBytes('file')), bytes);
  assert.equal(await db.transaction({ kind:'account', origin:'https://example.com', ownerId:'other', dataPlane:'home' }, 'readonly', lease, tx => tx.getBytes('file')), undefined);
  await assert.rejects(db.transaction(scope, 'readwrite', lease, tx => tx.put('@bytes', 'file', {})), /binary storage/);
  const full = new Uint8Array(WORKSPACE_LIMITS.binaryBytes);
  await assert.rejects(db.transaction(scope, 'readwrite', lease, async tx => {
   await Promise.all([0,1,2,3].map(n => tx.putBytes(`full-${n}`, full)));
  }), /workspace is full/);
  assert.equal(await db.transaction(scope, 'readonly', lease, tx => tx.getBytes('full-0')), undefined);
  await db.transaction(scope, 'readwrite', lease, async tx => { await tx.deleteBytes('file'); await tx.delete('things','file'); });
  await db.transaction(scope, 'readwrite', lease, async tx => { for (let n=0;n<4;n++) await tx.putBytes(`full-${n}`, full); });
  await assert.rejects(db.transaction(scope, 'readwrite', lease, tx => tx.put('things','too-full',{})), /workspace is full/);
 } finally { await db.close(); }
});

test('standalone files round-trip canonical ZIP bytes and metadata with fresh IDs', async () => {
 const { db, things } = fixture();
 try {
  const input = await bundle(); const created = await things.import(input.manifest, null, input.files);
  const exported = await things.export(created.roots); validateTransfer(exported.manifest);
  const file = recordingTransferFile(exported.manifest.things[0], exported.manifest);
  assert.deepEqual(exported.files.get(file.id), bytes);
  assert.notEqual(created.roots[0], 'root'); assert.equal(exported.manifest.things[0].crystal.filePurpose, 'file');
  assert.equal(JSON.stringify(exported.manifest).includes('localAttachment'), false);
  const decoded = await decodeTransferArchive(await encodeTransferArchive(exported));
  const copied = await things.import(decoded.manifest, null, decoded.files);
  assert.notEqual(copied.roots[0], created.roots[0]);
  await things.remove(created.roots);
  const second = await things.export(copied.roots);
  assert.deepEqual([...second.files.values()][0], bytes);
  await assert.rejects(things.export(copied.roots, { includeFiles:false }), /include file bytes/);
  await assert.rejects(things.update({ id:copied.roots[0], crystal:{ name:'generic bypass' } }), /dedicated/);
  await things.remove(copied.roots);
  assert.equal(await db.transaction(scope,'readonly',lease,tx=>tx.getBytes(copied.roots[0])),undefined);
 } finally { await db.close(); }
});

test('component media is rebound to copied local bytes and missing bytes never produce partial exports', async () => {
 const { db, things } = fixture();
 try {
  const input = await bundle(false); const created = await things.import(input.manifest, null, input.files);
  const root = await things.get(created.roots[0]);
  const ids = compositionAttachmentIds(root.thingtime,root.crystal); assert.equal(ids.size,1); assert.equal(ids.has('bytes'),false);
  const exported = await things.export(created.roots);
  assert.deepEqual([...exported.files.values()][0],bytes);
  assert.deepEqual([...compositionAttachmentIds(exported.manifest.things[0].thingtime,exported.manifest.things[0].crystal)], [exported.manifest.files[0].id]);
  const copied = await things.import(exported.manifest,null,exported.files);
  await things.remove(created.roots); // owned file children cascade with bytes
  assert.deepEqual([...((await things.export(copied.roots)).files.values())][0],bytes);
  const copiedFile = [...compositionAttachmentIds((await things.get(copied.roots[0])).thingtime,(await things.get(copied.roots[0])).crystal)][0];
  await db.transaction(scope,'readwrite',lease,tx=>tx.deleteBytes(copiedFile));
  await assert.rejects(things.export(copied.roots),/missing or changed/);
 } finally { await db.close(); }
});

test('invalid byte content and oversized local files fail before any metadata is imported', async () => {
 const { db, things } = fixture();
 try {
  const input = await bundle();
  await assert.rejects(things.import(input.manifest,null,new Map([['bytes', new Uint8Array(bytes.length)]])),/checksum/);
  await assert.rejects(things.import(input.manifest),/missing or unexpected/);
  await assert.rejects(things.import({ ...input.manifest,files:[{...input.manifest.files[0],bytes:WORKSPACE_LIMITS.binaryBytes+1}] },null,input.files),/16 MiB/);
  assert.equal((await things.snapshot()).length,0);
  let active=true; const fenced = new LocalThings(db,scope,{assertCurrent(){if(!active)throw new Error('retired')},onInvalidate:()=>()=>{}});
  const pending=fenced.import(input.manifest,null,input.files); active=false;
  await assert.rejects(pending,/retired/); assert.equal((await things.snapshot()).length,0);
 } finally { await db.close(); }
});

test('in-process transfer readers supply bytes without a remote fetch and remain cancellable', async () => {
 const input=await bundle(); let network=0;
 const plan={roots:input.manifest.roots,things:input.manifest.things,files:input.manifest.files,readLocalFile:async()=>bytes};
 const result=await bundleFromPlan(plan,{fetch:async()=>{network++;throw new Error('must not fetch')}});
 assert.equal(network,0); assert.deepEqual(result.files.get('bytes'),bytes);
 const controller=new AbortController();controller.abort();
 await assert.rejects(bundleFromPlan(plan,{signal:controller.signal}),/abort/i);
});


test('a folder containing standalone files still requires explicit recursive deletion', async () => {
 const { db, things } = fixture();
 try {
  const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Files' } });
  const input = await bundle(); const created = await things.import(input.manifest, folder.id, input.files);
  await assert.rejects(things.remove([folder.id]), /has children/);
  assert.deepEqual([...((await things.export(created.roots)).files.values())][0], bytes);
  await things.remove([folder.id], true);
  assert.equal(await db.transaction(scope, 'readonly', lease, tx => tx.getBytes(created.roots[0])), undefined);
 } finally { await db.close(); }
});

test('normal file saves are atomic, scoped, idempotent and preserve empty files', async () => {
 const {db,things}=fixture();
 try {
  const folder=await things.create({thingtime:['folder'],crystal:{name:'Files'}});
  const input={requestId:'12345678-1234-1234-1234-123456789abc',name:'normal.txt',contentType:'text/plain',bytes,folderId:folder.id};
  const first=await things.saveFile(input), retry=await things.saveFile(input);assert.equal(first.id,retry.id);
  assert.deepEqual((await things.readFile(first.id)).bytes,bytes);
  assert.equal((await things.snapshot()).length,2);
  await assert.rejects(things.saveFile({...input,name:'changed.txt'}),/different content/);
  await assert.rejects(things.saveFile({...input,requestId:'12345678-1234-1234-1234-123456789def',folderId:'missing'}),/Destination folder/);
  assert.equal((await things.snapshot()).length,2);
  const empty=await things.saveFile({...input,requestId:'12345678-1234-1234-1234-123456789000',bytes:new Uint8Array()});
  assert.equal((await things.readFile(empty.id)).bytes.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(things.saveFile(input,controller.signal),/abort/i);
  await db.transaction(scope,'readwrite',lease,tx=>tx.deleteBytes(first.id));await assert.rejects(things.saveFile(input),/missing or changed/);
 } finally {await db.close();}
});

test('imported standalone files derive edit capability from scoped records', async () => {
 const { db, things } = fixture();
 try {
  for (const purpose of ['file', 'recording'] as const) {
   const source = await bundle();
   if (purpose === 'recording') delete source.manifest.things[0].crystal.filePurpose;
   const imported = await things.import(source.manifest, undefined, source.files);
   const row = (await things.snapshot()).find(row => row.id === imported.roots[0])!;
   assert.ok(!row.id.startsWith('local-file-'));
   assert.equal(localThingProjection(row, 'local').canEditLocalFileDetails, true);
   await things.annotateFile({ id: row.id, title: 'Edited imported file', description: 'Device description', filenamePreview: 'renamed.txt' });
   const saved = (await things.snapshot()).find(saved => saved.id === row.id)!;
   assert.equal(saved.crystal.title, 'Edited imported file');
   assert.equal((saved as any).canEditLocalFileDetails, undefined);
   for (const patch of [{ targetId: 'post' }, { localAttachment: { ...(row as any).localAttachment, draftId: 'draft' } }, { localAttachment: { ...(row as any).localAttachment, expiresAt: '2099-01-01T00:00:00Z' } }, { localAttachment: { ...(row as any).localAttachment, purpose: 'post' } }, { localAttachment: undefined }]) {
    assert.equal(localThingProjection({ ...row, ...patch } as any, 'local').canEditLocalFileDetails, false);
   }
   const other = new AccountFileSync(db, { kind: 'account', origin: 'https://example.com', ownerId: 'other', dataPlane: 'home' }, lease).things;
   await assert.rejects(other.annotateFile({ id: row.id, title: 'Forbidden' }), /not stored in this workspace/);
  }
 } finally { await db.close(); }
});
