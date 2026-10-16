import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { accountImportSupported } from './accountImport';
import { exportAccountThings } from './accountExport';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';

async function fixture() {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', origin: 'https://import.test', ownerId: 'owner', dataPlane: 'home' } as const;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const files = new AccountFileSync(db, scope, lease), sync = new AccountThingSync(db, scope, lease, undefined, undefined, files.contentHooks);
 const bytes = new TextEncoder().encode('Independent imported portrait');
 const manifest = validateTransfer({format:'thingtime.transfer',version:1,roots:['post','reply'],things:[
  {id:'reply',thingtime:['post','comment'],targetId:'post',crystal:{type:'text',text:'Reply with original bytes'}},
  {id:'post',thingtime:['post'],crystal:{type:'image',images:[]}}
 ],files:await Promise.all(['first','second','reply-image'].map(async(id,n)=>({id,targetId:n===2?'reply':'post',path:`files/${String(n).padStart(6,"0")}`,name:id+'.png',mime:'image/png',bytes:bytes.length,sha256:await transferChecksum(bytes)}))),attachmentOrder:['second','first','reply-image']});
 const contentBytes = new Map(manifest.files.map(file=>[file.id,bytes]));
 const remote = new Map<string,AccountThing>(), receipts = new Map<string,any>(), writes:any[] = [], uploads:any[] = [];
 const upload:AccountFileTransport = {
  start:async request=>{uploads.push(structuredClone(request));const id='account-'+request.requestId;receipts.set(id,{id,name:request.filename,contentType:request.contentType,size:request.sizeBytes,mediaKind:'image'});return {id,partSizeBytes:bytes.length,partCount:1};},
  parts:async(_id,parts)=>parts.map(part=>({...part,url:'https://storage.test/part',expiresAt:'2026-10-17',headers:{}})),
  put:async(_part,body)=>assert.deepEqual(body,bytes),complete:async id=>receipts.get(id)
 };
 const content:AccountSyncTransport = {get:async id=>{if(!remote.has(id))throw {status:404};return structuredClone(remote.get(id)!);},write:async op=>{
  writes.push(structuredClone(op));const {attachmentIds,...body}=op.body;
  const row={...body,id:op.id,author:{id:scope.ownerId},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:1,attachments:(attachmentIds as string[] || []).map(id=>receipts.get(id))} as unknown as AccountThing;
  remote.set(op.id,row);return row;
 }};
 const importing=()=>sync.things.import(manifest,null,contentBytes);
 return {db,scope,lease,files,sync,bytes,manifest,contentBytes,remote,writes,uploads,upload,content,importing};
}

test('post and reply ZIP import commits ordered exact bytes and independent queues before any network work',async()=>{
 const f=await fixture();try {
  assert.equal(accountImportSupported(f.manifest),true);
  const imported=await f.importing();
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.uploads,[]);
  assert.equal((await f.sync.status()).length,2);assert.equal((await f.files.status()).length,3);
  const attachments=imported.things.filter(row=>row.thingtime[0]==='attachment');
  for(const file of attachments){const saved=await f.files.readFile(file.id);assert.deepEqual(saved.bytes,f.bytes);assert.equal(saved.row.localAttachment.purpose,saved.row.targetId===imported.idMap.reply?'comment':'post');assert.equal(saved.row.localAttachment.requestId,file.id.slice('local-file-'.length));}
  const independent=await f.sync.things.create({thingtime:['data'],crystal:{name:'Independent'}});
  await f.sync.sync(f.content);assert.deepEqual([...f.remote.keys()],[independent.id]);
  await f.files.sync(f.upload);await f.sync.sync(f.content);
  assert.equal(f.uploads.length,3);assert.deepEqual(f.uploads.map(row=>row.purpose).sort(),['comment','post','post']);
  const post=f.remote.get(imported.idMap.post)!,reply=f.remote.get(imported.idMap.reply)!;
  assert.deepEqual(post.acl,['tt:user']);assert.deepEqual(reply.acl,['tt:inherit']);assert.equal(reply.targetId,post.id);
  assert.deepEqual((post as any).attachments.map((row:any)=>row.name),['second.png','first.png']);
  assert.deepEqual((reply as any).attachments.map((row:any)=>row.name),['reply-image.png']);
  assert.ok((await f.sync.status()).every(row=>row.state==='synced'));
  const exported=await exportAccountThings({ids:imported.roots},{...f,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected remote export');}});
  assert.equal((await bundleFromPlan(exported.plan)).files.size,3,'verified binding receipts preserve offline export without a prior export snapshot');
 }finally{await f.db.close();}
});

test('bound-media exports round-trip through anonymous and account import with independent IDs and byte bindings',async()=>{
 const f=await fixture();try {
  const imported=await f.importing();
  const result=await exportAccountThings({ids:imported.roots},{sync:f.sync,files:f.files,db:f.db,lease:f.lease,canRefresh:()=>false,remote:async()=>{throw Error('Unexpected network');}});
  const bundle=await bundleFromPlan(result.plan);assert.equal(bundle.files.size,3);assert.equal(accountImportSupported(bundle.manifest),true);
  assert.doesNotMatch(serializeTransfer(bundle.manifest),/"author"|"acl"|"localAttachment"|"requestId"|"accountFileId"|"revision"/);
  for(const target of [new LocalThings(f.db,{kind:'anonymous'},f.lease),f.sync.things]){
   const copied=await target.import(bundle.manifest,null,bundle.files);assert.notEqual(copied.idMap[imported.idMap.post],imported.idMap.post);
   assert.equal((await target.get(copied.idMap[imported.idMap.reply])).targetId,copied.idMap[imported.idMap.post]);
   const again=await target.export(copied.roots);assert.equal(again.manifest.files.length,3);
   assert.deepEqual((again.manifest.attachmentOrder || again.manifest.files.map(file=>file.id)).map(id=>again.manifest.files.find(file=>file.id===id)!.name),['second.png','first.png','reply-image.png']);
   for(const bytes of again.files.values())assert.deepEqual(bytes,f.bytes);
  }
 }finally{await f.db.close();}
});

test('bound imports reject missing targets, corrupt bytes, excess attachments and unsupported mixed content atomically',async()=>{
 for(const failure of ['target','bytes','count','managed']){
  const f=await fixture();try {
   if(failure==='target')f.manifest.files[0].targetId='missing';
   if(failure==='bytes')f.contentBytes.set('first',new Uint8Array(f.bytes.length));
   if(failure==='count')for(let n=0;n<30;n++){const id='excess-'+n;f.manifest.files.push({...f.manifest.files[0],id,targetId:'reply',path:'files/'+String(n+3).padStart(6,'0')});f.manifest.attachmentOrder!.push(id);f.contentBytes.set(id,f.bytes);}
   if(failure==='managed')f.manifest.things.push({id:'managed',thingtime:['action-run'],crystal:{}});
   await assert.rejects(f.importing(), undefined, failure);
   assert.deepEqual(await f.sync.things.snapshot(),[]);assert.deepEqual(await f.sync.status(),[]);assert.deepEqual(await f.files.status(),[]);
   await f.db.transaction(f.scope,'readonly',f.lease,async tx=>assert.equal((await tx.usage()).bytes,0));
  }finally{await f.db.close();}
 }
});
