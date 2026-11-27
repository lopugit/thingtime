import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { appendSnapshotCatalog, readSnapshotCatalogPage, readSnapshotCatalogState } from './backupCatalog';
test('catalogue resumes and pages all roots with immutable integrity checks',async()=>{
 const values=new Map<string,Uint8Array>();let revoked=false;
 const store:any={put:async(k:string,v:Uint8Array)=>{const old=values.get(k);if(old)assert.deepEqual(old,v);values.set(k,v.slice());},read:async(k:string)=>values.get(k)?.slice()??null};
 const access:any={authorize:async()=>{if(revoked)throw Error('revoked');}},id=randomUUID(),plan='a'.repeat(64);
 let state:string|null=null;
 for(let i=0;i<300;i+=30)state=await appendSnapshotCatalog(store,id,plan,state,Array.from({length:30},(_,j)=>({id:randomUUID(),name:'Root '+(i+j),path:'Root '+(i+j),kind:'folder',bytes:null,versions:null,selectable:true,reason:null})),access);
 state=await appendSnapshotCatalog(store,id,plan,state,[],access,true);
 const head=await readSnapshotCatalogState(store,id,plan,state,access);assert.equal(head.count,300);assert.equal(head.pages,3);assert.equal(head.pending.length,0);
 let hash=head.headHash!,count=0;for(let n=head.pages-1;n>=0;n--){const page=await readSnapshotCatalogPage(store,id,plan,hash,n,access);count+=page.entries.length;hash=page.previous!;}assert.equal(count,300);assert.equal(hash,null);
 revoked=true;await assert.rejects(readSnapshotCatalogState(store,id,plan,state,access),/revoked/);revoked=false;
 const key=[...values.keys()].find(k=>k.includes(head.headHash!))!;values.get(key)![0]^=1;await assert.rejects(readSnapshotCatalogPage(store,id,plan,head.headHash!,2,access),/changed/);
});
