import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalThings } from './things';
import { AccountFileSync } from './accountFiles';
import { createQuotaFactory } from './storageTestFixture';
import { encodeTransferArchiveBlob, transferChecksum, type TransferBundle } from '../utils/thingTransfer/archive';
import { readTransferFile } from '../utils/thingTransfer/readFile';

const scope = {kind: 'anonymous'} as const;
const lease: WorkspaceLease = {assertCurrent() {}, onInvalidate: () => () => {}};
async function fixture(size: number): Promise<TransferBundle<Blob>> {
 const block = new Uint8Array(1024 * 1024).fill(137), parts: Blob[] = [];
 const hash = createHash('sha256');
 for (let offset = 0; offset < size; offset += block.byteLength) {
  const chunk = block.subarray(0, Math.min(block.byteLength, size - offset));
  parts.push(new Blob([chunk])); hash.update(chunk);
 }
 const blob = new Blob(parts), digest = hash.digest('hex');
 return {manifest: {format: 'thingtime.transfer', version: 1, roots: ['a','b'],
  things: ['a','b'].map(id => ({id,thingtime:['attachment'],crystal:{recordingFileId:`file-${id}`,filePurpose:'file'}})),
  files: ['a','b'].map((id,i)=>({id:`file-${id}`,targetId:id,path:`files/00000${i}`,name:`${id} 🦄.bin`,mime:'application/octet-stream',bytes:size,sha256:digest}))},
  files: new Map([['file-a',blob],['file-b',blob]])};
}

test('normal ZIP selection imports over 64 MiB as Blobs with bounded reads and fresh identities', async context => {
 const input = await fixture(33 * 1024 * 1024), original = Blob.prototype.arrayBuffer;
 let largestRead = 0;
 context.mock.method(Blob.prototype,'arrayBuffer',function(this: Blob) {
  largestRead = Math.max(largestRead,this.size);
  assert.ok(this.size <= 1024 * 1024,'No whole archive or file arrayBuffer');
  return original.call(this);
 });
 const db = new WorkspaceDatabase(new IDBFactory(),crypto.randomUUID(),undefined,IDBKeyRange), things = new LocalThings(db,scope,lease);
 try {
  const archive = await encodeTransferArchiveBlob(input);
  assert.ok(archive.size > 64 * 1024 * 1024);
  const decoded = await readTransferFile(archive);
  assert.deepEqual(decoded.manifest,input.manifest);
  const result = await things.import(decoded.manifest,null,decoded.files);
  assert.equal(result.roots.length,2); assert.notEqual(result.idMap.a,'a');
  await db.close();
  for (const [index,id] of result.roots.entries()) {
   const stored = await things.readFileBlob(id);
   assert.ok(stored.snapshot.value instanceof Blob);
   assert.equal(stored.blob.size,33*1024*1024);
   assert.equal(await transferChecksum(stored.blob),input.manifest.files[index].sha256);
  }
  assert.ok(largestRead <= 1024 * 1024);
 } finally { await db.close(); }
});

test('Blob import quota failure rolls back both metadata and bytes; exact retry succeeds', async () => {
 const input=await fixture(4096), factory=createQuotaFactory({bytes:5000});
 const db=new WorkspaceDatabase(factory,crypto.randomUUID(),undefined,IDBKeyRange), things=new LocalThings(db,scope,lease);
 try {
  await assert.rejects(things.import(input.manifest,null,input.files),{code:'LOCAL_QUOTA'});
  assert.deepEqual(await things.snapshot(),[]);
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.usage()),{records:0,bytes:0});
  factory.capacity.bytes=100000;
  assert.equal((await things.import(input.manifest,null,input.files)).roots.length,2);
 } finally {await db.close();}
});

for (const failure of ['cancel','retire'] as const) test(`Blob import ${failure} during hashing writes no partial data`,async context=>{
 const input=await fixture(2*1024*1024), controller=new AbortController();let active=true, reads=0;
 const current:WorkspaceLease={assertCurrent(){if(!active)throw Error('retired');},onInvalidate:()=>()=>{}};
 const db=new WorkspaceDatabase(new IDBFactory(),crypto.randomUUID(),undefined,IDBKeyRange),things=new LocalThings(db,scope,current);
 const original=Blob.prototype.arrayBuffer;
 context.mock.method(Blob.prototype,'arrayBuffer',async function(this:Blob){const bytes=await original.call(this);if(++reads===2){if(failure==='cancel')controller.abort();else active=false;}return bytes;});
 try {
  await assert.rejects(things.import(input.manifest,null,input.files,controller.signal),failure==='cancel'?{name:'AbortError'}:/retired/);
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.list('things')),[]);
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.usage()),{records:0,bytes:0});
 }finally{await db.close();}
});

test('Blob archive creation refuses corruption, cancellation and expired availability',async()=>{
 const input=await fixture(17);
 await assert.rejects(encodeTransferArchiveBlob({...input,files:new Map([['file-a',new Blob([new Uint8Array(17)])],['file-b',input.files.get('file-b')!]])}),/checksum/);
 await assert.rejects(encodeTransferArchiveBlob(input,AbortSignal.abort()),{name:'AbortError'});
 let checks=0;
 await assert.rejects(encodeTransferArchiveBlob({...input,assertCurrent:async()=>{if(++checks===2)throw Error('retired');}}),/retired/);
 assert.equal(checks,2);
});


test('download freezes caller-owned byte arrays, file maps and metadata before async checks', async () => {
 const bytes=new Uint8Array([1,2,3]), original=await fixture(3);
 original.manifest.files=original.manifest.files.slice(0,1);
 original.manifest.things=original.manifest.things.slice(0,1);original.manifest.roots=['a'];
 original.manifest.files[0].sha256=await transferChecksum(bytes);
 const expected=structuredClone(original.manifest), files=new Map([['file-a',bytes]]);
 let checks=0;
 const archive=await encodeTransferArchiveBlob({manifest:original.manifest,files,assertCurrent:async()=>{
  if(++checks===1){bytes.fill(9);files.clear();original.manifest.files[0].name='changed.bin';}
 }});
 const decoded=await readTransferFile(archive);
 assert.deepEqual(decoded.manifest,expected);
 assert.deepEqual(new Uint8Array(await decoded.files.get('file-a')!.arrayBuffer()),new Uint8Array([1,2,3]));
});


test('account Blob import finishes locally with scoped upload intent and atomic quota rollback', async () => {
 const input=await fixture(4096), factory=createQuotaFactory({bytes:5000});
 const db=new WorkspaceDatabase(factory,crypto.randomUUID(),undefined,IDBKeyRange);
 const account={kind:'account',ownerId:'fixture-owner',origin:'https://fixture.invalid',dataPlane:'home'} as const;
 const files=new AccountFileSync(db,account,lease);
 try {
  await assert.rejects(files.things.import(input.manifest,null,input.files),{code:'LOCAL_QUOTA'});
  assert.deepEqual(await files.status(),[]);
  assert.deepEqual(await files.things.snapshot(),[]);
  factory.capacity.bytes=100000;
  const imported=await files.things.import(input.manifest,null,input.files);
  const queued=await files.status();assert.equal(queued.length,2);
  assert.ok(queued.every(row=>row.state==='pending'));
  assert.deepEqual(new Set(queued.map(row=>row.id)),new Set(imported.roots));
  for(const id of imported.roots)assert.equal((await files.readFileBlob(id)).blob.size,4096);
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.list('things')),[]);
 }finally{await db.close();}
});
