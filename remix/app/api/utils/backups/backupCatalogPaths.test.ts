import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {appendSnapshotCatalog,readSnapshotCatalogState,readSnapshotCatalogPage} from './backupCatalog';
import {advanceSnapshotCatalogPaths,type CatalogDescriptor} from './backupCatalogPaths';
test('retained full paths disambiguate duplicate names and resume deep ancestry in bounded units',async()=>{
 const objects=new Map<string,Uint8Array>(),store:any={put:async(k:string,v:Uint8Array)=>{const old=objects.get(k);if(old)assert.ok(Buffer.from(old).equals(v));objects.set(k,v.slice());},read:async(k:string)=>objects.get(k)?.slice()??null};
 const access:any={authorize:async()=>{}},id=randomUUID(),plan='a'.repeat(64),descriptors=new Map<string,CatalogDescriptor>();
 let parent:string|null=null;for(let i=0;i<75;i++){const key='deep-'+i;descriptors.set(key,{id:key,parentId:parent,name:'Level '+i,kind:'folder'});parent=key;}
 descriptors.set('a',{id:'a',parentId:parent,name:'Left',kind:'folder'});descriptors.set('b',{id:'b',parentId:parent,name:'Right',kind:'folder'});
 descriptors.set('one',{id:'one',parentId:'a',name:'same.txt',kind:'file'});descriptors.set('two',{id:'two',parentId:'b',name:'same.txt',kind:'file'});
 const entries=['one','two'].map(id=>({id,name:'same.txt',path:'same.txt',kind:'file' as const,bytes:5,versions:null,selectable:true,reason:null}));
 let hash=await appendSnapshotCatalog(store,id,plan,null,entries,access,true),initial=true,units=0;
 for(;;){let reads=0;const result=await advanceSnapshotCatalogPaths(store,id,plan,hash,initial,access,async id=>{reads++;return descriptors.get(id)??null;});assert.ok(reads<=32);units++;hash=result.hash;initial=false;if(result.done)break;assert.ok(units<30);}
 assert.ok(units>3);const state=await readSnapshotCatalogState(store,id,plan,hash,access),page=await readSnapshotCatalogPage(store,id,plan,state.headHash!,0,access);
 assert.equal(page.entries[0].path,Array.from({length:75},(_,i)=>'Level '+i).join('/')+'/Left/same.txt');assert.ok(page.entries[1].path.endsWith('/Right/same.txt'));assert.notEqual(page.entries[0].path,page.entries[1].path);
});

test('oversized Unicode display metadata is labelled and never truncates retained source',async()=>{
 const objects=new Map<string,Uint8Array>(),store:any={put:async(k:string,v:Uint8Array)=>{const old=objects.get(k);if(old)assert.ok(Buffer.from(old).equals(v));objects.set(k,v.slice());},read:async(k:string)=>objects.get(k)?.slice()??null};
 const access:any={authorize:async()=>{}},id=randomUUID(),plan='b'.repeat(64),fullName='🥰'.repeat(1048577),source={id:'large',parentId:null,name:fullName,kind:'folder' as const};
 let hash=await appendSnapshotCatalog(store,id,plan,null,[{id:'large',name:'large',path:'large',kind:'folder',bytes:null,versions:null,selectable:true,reason:null}],access,true),initial=true;
 for(let i=0;i<10;i++){const next=await advanceSnapshotCatalogPaths(store,id,plan,hash,initial,access,async()=>source);hash=next.hash;initial=false;if(next.done)break;}
 const state=await readSnapshotCatalogState(store,id,plan,hash,access),page=await readSnapshotCatalogPage(store,id,plan,state.headHash!,0,access),entry=page.entries[0];
 assert.equal(source.name,fullName);assert.equal(entry.id,'large');assert.equal(entry.selectable,true);assert.ok(Buffer.byteLength(entry.name)<4096);assert.ok(entry.name.endsWith('[display shortened; full text retained]'));assert.match(entry.reason!,/exact source names/);assert.ok(entry.path.endsWith('[display shortened; full text retained]'));
});
