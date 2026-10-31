import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalThings } from './things';
import { AccountFileSync } from './accountFiles';
import { AccountThingSync } from './accountSync';
import { exportAccountThings } from './accountExport';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { createQuotaFactory } from './storageTestFixture';
import { decodeTransferArchiveBlob, encodeTransferArchiveBlob, transferChecksum, type TransferBundle } from '../utils/thingTransfer/archive';
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

test('native ZIP decoding bounds browser Blob handles as well as byte buffers', async () => {
 const input=await fixture(3*1024*1024),archive=await encodeTransferArchiveBlob(input);
 const NativeBlob=globalThis.Blob;let handles=0;
 globalThis.Blob=new Proxy(NativeBlob,{construct(target,args,newTarget){handles++;return Reflect.construct(target,args,newTarget);}});
 try {
  const decoded=await decodeTransferArchiveBlob(archive);
  assert.deepEqual(decoded.manifest,input.manifest);
  for(const [id,bytes]of decoded.files)assert.equal(await transferChecksum(bytes),input.manifest.files.find(file=>file.id===id)!.sha256);
  // A separate browser-process handle per inflater callback makes native
  // imports spend most of their time in Blob registration/IPC.
  assert.ok(handles<100,`Six MiB should not require ${handles} browser Blob handles`);
 }finally{globalThis.Blob=NativeBlob;}
});

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
  const exported = await things.export(result.roots);
  assert.ok([...exported.files.values()].every(file => file instanceof Blob));
  const plan = { ...exported.manifest, assertCurrent: exported.assertCurrent,
   readLocalFile: async (id: string) => exported.files.get(id)! };
  const collected = await bundleFromPlan(plan, {fetch: async () => {throw Error('Anonymous export must not fetch');}});
  const reselected = await readTransferFile(await encodeTransferArchiveBlob(collected));
  assert.deepEqual(reselected.manifest, collected.manifest);
  const copy = await things.import(reselected.manifest,null,reselected.files);
  assert.ok(copy.roots.every(id => !result.roots.includes(id)));
  for (const id of copy.roots) assert.equal(await transferChecksum((await things.readFileBlob(id)).blob),input.manifest.files[0].sha256);
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

test('account export keeps scoped Blobs through collector and ZIP while upload stays pending', async context => {
 const input=await fixture(4*1024*1024), original=Blob.prototype.arrayBuffer;
 context.mock.method(Blob.prototype,'arrayBuffer',function(this:Blob){
  assert.ok(this.size<=1024*1024,'Account export must not buffer complete files');return original.call(this);
 });
 const db=new WorkspaceDatabase(new IDBFactory(),crypto.randomUUID(),undefined,IDBKeyRange);
 const account={kind:'account',ownerId:'fixture-owner',origin:'https://fixture.invalid',dataPlane:'home'} as const;
 let active=true;
 const scoped:WorkspaceLease={assertCurrent(){if(!active)throw Error('retired');},onInvalidate:()=>()=>{}};
 const files=new AccountFileSync(db,account,scoped),sync=new AccountThingSync(db,account,scoped);
 try {
  const imported=await files.things.import(input.manifest,null,input.files);
  const result=await exportAccountThings({ids:imported.roots},{db,lease:scoped,files,sync,canRefresh:()=>false,remote:async()=>{throw Error('No network');}});
  for(const file of result.plan.files)assert.ok(await result.plan.readLocalFile(file.id) instanceof Blob);
  const bundle=await bundleFromPlan(result.plan), archive=await encodeTransferArchiveBlob(bundle);
  const decoded=await readTransferFile(archive);
  assert.deepEqual(decoded.manifest,bundle.manifest);
  for(const file of decoded.manifest.files)assert.equal(file.sha256,input.manifest.files[0].sha256);
  assert.ok((await files.status()).every(row=>row.state==='pending'));
  assert.deepEqual(await db.transaction(scope,'readonly',lease,tx=>tx.list('things')),[]);
  active=false;await assert.rejects(encodeTransferArchiveBlob(bundle),/retired/);
 }finally{await db.close();}
});
