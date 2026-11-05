import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalThings } from './things';
import { LocalDrafts } from './drafts';
import { localPostInput } from './posts';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { blobChecksum, sameBinary } from './binary';
import { createQuotaFactory } from './storageTestFixture';

const scope = { kind: 'anonymous' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const fixture = (factory = new IDBFactory(), active = lease) => {
 const db = new WorkspaceDatabase(factory, crypto.randomUUID(), undefined, IDBKeyRange);
 return { db, things: new LocalThings(db, scope, active) };
};
const input = (bytes: Blob, purpose: 'file' | 'post' = 'file') => ({ requestId: crypto.randomUUID(), name: 'Exact 🦄 file.bin', contentType: 'application/octet-stream', bytes, purpose });
const draftContent = (id: string) => ({ name: 'File draft', surface: 'post' as const, context: 'post:new:', snapshot: JSON.stringify({ text: 'Draft', attachments: [{ id }] }), attachmentIds: [id] });

// This catches a regression to whole-file arrayBuffer() on save/read/clone.
// It does not simulate browser quota or claim a browser performance result.
test('70 MiB Blob files save, reopen and replay exactly without a whole-file read', async context => {
 const f = fixture(), chunk = new Uint8Array(1024 * 1024).fill(73), parts = Array.from({length:70}, () => chunk);
 const source = new Blob(parts), hash = createHash('sha256'); for (const part of parts) hash.update(part);
 const expected = hash.digest('hex'), original = Blob.prototype.arrayBuffer; let largestRead = 0;
 context.mock.method(Blob.prototype, 'arrayBuffer', function (this: Blob) {
  largestRead = Math.max(largestRead, this.size); assert.ok(this.size <= 1024 * 1024); return original.call(this);
 });
 try {
  const save = input(source), row = await f.things.saveFile(save);
  assert.equal(row.crystal.size, source.size); assert.equal(row.localAttachment.sha256, expected);
  assert.deepEqual(await f.things.saveFile(save), row);
  await f.db.close(); const loaded = await f.things.readFileBlob(row.id);
  assert.equal(loaded.blob.size, source.size); assert.equal(await blobChecksum(loaded.blob), expected);
  assert.ok(loaded.snapshot.value instanceof Blob); assert.ok(loaded.snapshot.revision);
  assert.ok(largestRead <= 1024 * 1024);
  const other = {kind:'account',ownerId:'other',origin:'https://fixture.invalid',dataPlane:'home'} as const;
  assert.equal(await f.db.transaction(other,'readonly',lease,tx=>tx.getBinary(row.id)), undefined);
 } finally { await f.db.close(); }
});

test('cancelled chunk hashing cannot commit a file or upload intent', async context => {
 const f = fixture(), controller = new AbortController(), original = Blob.prototype.arrayBuffer;
 let reads = 0;
 context.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
  const result = await original.call(this); if (++reads === 2) controller.abort(); return result;
 });
 try {
  await assert.rejects(f.things.saveFile(input(new Blob([new Uint8Array(4 * 1024 * 1024)])), controller.signal), {name:'AbortError'});
  assert.equal(reads,2); assert.deepEqual(await f.things.snapshot(),[]);
  assert.deepEqual(await f.db.transaction(scope,'readonly',lease,tx=>tx.usage()),{records:0,bytes:0});
 } finally { await f.db.close(); }
});

test('Blob capacity failure rolls back metadata and retry uses the same request', async () => {
 const factory = createQuotaFactory({bytes:128}), f = fixture(factory), save = input(new Blob([new Uint8Array(4096)]));
 try {
  await assert.rejects(f.things.saveFile(save), {code:'LOCAL_QUOTA',status:507});
  assert.deepEqual(await f.things.snapshot(),[]);
  assert.deepEqual(await f.db.transaction(scope,'readonly',lease,tx=>tx.usage()),{records:0,bytes:0});
  factory.capacity.bytes = 10000;
  const row = await f.things.saveFile(save); assert.equal((await f.things.readFileBlob(row.id)).blob.size,4096);
 } finally { await f.db.close(); }
});

for (const operation of ['post','draft'] as const) test(`${operation} rejects a same-sized Blob replacement after checksum preparation`, async context => {
 const f=fixture();
 try {
  const row=await f.things.saveFile(input(new Blob(['original']), 'post'));
  const read=f.things.readFileBlob.bind(f.things);
  const replace=async (id: string) => { const result=await read(id); await f.db.transaction(scope,'readwrite',lease,tx=>tx.putBlob(id,new Blob(['replaced']))); return result; };
  if(operation==='post') {
   context.mock.method(f.things,'readFileBlob',replace);
   await assert.rejects(f.things.savePost(localPostInput({type:'text',text:'Keep file',attachmentIds:[row.id],shareId:'local-post-race'})),/files changed/);
  } else {
   const drafts=new LocalDrafts(f.db,scope,lease,undefined,{readFile:replace});
   await assert.rejects(drafts.createTemplate('template',draftContent(row.id)),/attachment changed/);
  }
  assert.equal((await f.things.snapshot()).length,1);
  await assert.rejects(read(row.id),/missing or changed/);
 } finally { await f.db.close(); }
});

test('native Blob draft copies are independent and post completion does not wait for draft saving', async () => {
 const f=fixture(), drafts=new LocalDrafts(f.db,scope,lease);
 try {
  const source=await f.things.saveFile(input(new Blob(['Independent original 🦄']), 'post'));
  const template=await drafts.createTemplate('template',draftContent(source.id));
  const copy=await drafts.request({operation:'instantiate',sourceId:'template',id:'working'});
  const id=copy.draft.attachmentIds[0], retained=await f.things.readFileBlob(id);
  const post=await f.things.savePost(localPostInput({type:'text',text:'Posted independently',attachmentIds:[id],shareId:'local-post-blob'}));
  await drafts.request({operation:'delete',id:'working',revision:1});
  await f.db.transaction(scope,'readwrite',lease,tx=>tx.putBlob(source.id,new Blob(['changed original'])));
  assert.equal((await f.things.readFileBlob(id)).row.targetId,post.id);
  assert.equal(await (await f.things.readFileBlob(id)).blob.text(),'Independent original 🦄');
  const original=await f.things.readFileBlob(template.attachmentIds[0]);
  assert.equal(await original.blob.text(),'Independent original 🦄');
  assert.notEqual(retained.snapshot.revision,original.snapshot.revision);
 } finally { await f.db.close(); }
});

test('legacy byte snapshots compare exactly and every new binary write fences older snapshots', async () => {
 const f=fixture();
 try {
  assert.equal(sameBinary({value:new Uint8Array([1,2])},{value:new Uint8Array([1,2])}),true);
  assert.equal(sameBinary({value:new Uint8Array([1,3])},{value:new Uint8Array([1,2])}),false);
  await f.db.transaction(scope,'readwrite',lease,tx=>tx.putBytes('legacy',new Uint8Array([1,2])));
  const before=(await f.db.transaction(scope,'readonly',lease,tx=>tx.getBinary('legacy')))!;
  await f.db.transaction(scope,'readwrite',lease,tx=>tx.putBlob('legacy',new Blob([new Uint8Array([1,2])])));
  const after=await f.db.transaction(scope,'readonly',lease,tx=>tx.getBinary('legacy'));
  assert.equal(sameBinary(after,before),false);
  assert.deepEqual(await f.db.transaction(scope,'readonly',lease,tx=>tx.usage()),{records:1,bytes:2});
 } finally { await f.db.close(); }
});

test('Blob uploads pass exact native parts beyond 100 parts without reading the whole file', async () => {
 const f=fixture(), account={kind:'account',ownerId:'fixture',origin:'https://fixture.invalid',dataPlane:'home'} as const;
 const files=new AccountFileSync(f.db,account,lease), chunk=new Uint8Array(8192).fill(29), blob=new Blob(Array.from({length:101},()=>chunk));
 let uploaded=0;
 try {
  const row=await files.things.saveFile(input(blob));
  const transport:AccountFileTransport={
   start:async()=>({id:'server-file',partSizeBytes:chunk.length,partCount:101}),
   parts:async(_id,parts)=>parts.map(part=>({...part,url:'https://fixture.invalid/upload',headers:{},expiresAt:'2026-10-18'})),
   put:async(_part,body)=>{assert.ok(body instanceof Blob);assert.equal(body.size,chunk.length);assert.deepEqual(new Uint8Array(await body.arrayBuffer()),chunk);uploaded++;},
   complete:async()=>({id:'server-file',name:row.crystal.name as string,contentType:'application/octet-stream',size:blob.size,mediaKind:'file'})
  };
  assert.equal((await files.sync(transport)).completed,1);assert.equal(uploaded,101);
  assert.equal(await files.remoteId(row.id),'server-file');
 } finally { await f.db.close(); }
});
