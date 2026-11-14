import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let rows:any[]=[],roots:any[]=[],delta=new Map<string,number>(),batchSizes:number[]=[],afterRowRead=()=>{},afterCursorRead=()=>{};
const session={};
const matches=(doc:any,query:any):boolean=>Object.entries(query).every(([key,value]:any)=>{
  if(key==='$or')return value.some((part:any)=>matches(doc,part));
  const actual=key.split('.').reduce((at,part)=>at?.[part],doc);
  if(value&&typeof value==='object'&&'$exists'in value)return (actual!==undefined)===value.$exists;
  if(value&&typeof value==='object'&&'$in'in value)return value.$in.includes(actual);
  return Array.isArray(actual)?actual.includes(value):actual===value;
});
const set=(doc:any,key:string,value:any)=>{const parts=key.split('.');let at=doc;for(const part of parts.slice(0,-1))at=at[part]||={};at[parts.at(-1)!]=value;};
const things:any={
  find(query:any){const found=()=>rows.filter(row=>matches(row,query)).map(row=>structuredClone(row));const cursor={batchSize:()=>cursor,toArray:async()=>found(),async *[Symbol.asyncIterator](){yield*found();afterCursorRead();}};return cursor;},
  findOne:async(query:any)=>{const row=[...rows,...roots].find(row=>matches(row,query))||null;if(query.thingtime==='subspace-definition')afterRowRead();return row;},
  insertMany:async(docs:any[],options:any)=>{assert.equal(options.session,session);batchSizes.push(docs.length);rows.push(...docs.map(doc=>({...doc,_id:doc.shareId})));return{insertedCount:docs.length};},
  deleteMany:async(query:any)=>{const before=rows.length;rows=rows.filter(row=>!matches(row,query));return{deletedCount:before-rows.length};},
  updateOne:async(query:any,update:any)=>{const row=rows.find(row=>matches(row,query));if(!row)return{matchedCount:0};for(const [key,value]of Object.entries(update.$set||{}))set(row,key,value);return{matchedCount:1};},
  updateMany:async(query:any,update:any)=>{let matchedCount=0;for(const row of rows.filter(row=>matches(row,query))){matchedCount++;for(const [key,value]of Object.entries(update.$set||{}))set(row,key,value);}return{matchedCount};}
};
mock.module(new URL('../mongodb/collections.ts',import.meta.url).href,{namedExports:{withMongoTransaction:async(work:any)=>work(session),withHomeMongoTransaction:async(work:any)=>work(session)}});
mock.module(new URL('../mongodb/endpoint.ts',import.meta.url).href,{namedExports:{isCustomMongoEndpointActive:()=>false}});
mock.module(new URL('../storage/userStorage.ts',import.meta.url).href,{namedExports:{applyUserStorageDelta:async(owner:string,bytes:number,transaction:any)=>{assert.equal(transaction,session);delta.set(owner,(delta.get(owner)||0)+bytes);},markUserStorageNeedsReconcile:async()=>{throw new Error('unexpected unaccounted content');}}});
const {replaceSubspaceDefinitions,hydrateSubspaceDefinitions,findSubspaceDefinition,transferSubspaceDefinitions,deleteSubspaceDefinitions}=await import('./definitions.ts');
const {thingStorageSizeBytes}=await import('../storage/storageCore.ts');
const root=()=>{const doc={shareId:'subspace',ownerId:'owner',thingtime:['subspace'],crystal:{rules:Array.from({length:151},(_,i)=>({title:`Rule ${i}`,text:'detail'.repeat(500)})),flairs:Array.from({length:151},(_,i)=>({id:`flair-${i}`,label:`Flair ${i}`})),userFlairs:[{id:'member',label:'Member'}],removalReasons:[{id:'spam',title:'Spam',message:'text'}]}};roots.push(doc);return doc;};
const apply=(doc:any,result:any)=>{Object.assign(doc,result.set);for(const path of Object.keys(result.unset)){delete doc.crystal[path.split('.')[1]];}return doc;};
beforeEach(()=>{rows=[];roots=[];delta=new Map();batchSizes=[];afterRowRead=()=>{};afterCursorRead=()=>{};});
test('legacy definitions migrate atomically to ordered billable children beyond former caps',async()=>{
  const doc=root(),expected=structuredClone(doc.crystal);
  apply(doc,await replaceSubspaceDefinitions(things,doc,{},session));
  assert.equal(doc.crystal.rules,undefined);
  assert.equal(rows.length,304);
  assert.ok(batchSizes.every(size=>size<=100));
  assert.deepEqual((await hydrateSubspaceDefinitions(things,[doc],session))[0].crystal,expected);
  assert.equal(delta.get('owner'),rows.reduce((sum,row)=>sum+thingStorageSizeBytes(row),0));
  assert.equal((await findSubspaceDefinition(things,doc,'flairs','flair-150')).label,'Flair 150');
});
test('replacement preserves other ordered families and authoritative empty lists never restore legacy values',async()=>{
  const doc=root();apply(doc,await replaceSubspaceDefinitions(things,doc,{},session));
  apply(doc,await replaceSubspaceDefinitions(things,doc,{'crystal.rules':[]},session));
  doc.crystal.rules=[{title:'stale embedded rule'}];
  const [loaded]=await hydrateSubspaceDefinitions(things,[doc],session);
  assert.deepEqual(loaded.crystal.rules,[]);
  assert.equal(loaded.crystal.flairs.length,151);
  assert.equal(rows.length,153);
  assert.equal(delta.get('owner'),rows.reduce((sum,row)=>sum+thingStorageSizeBytes(row),0));
});
test('ownership transfer and deletion preserve the accounted ledger and access identity',async()=>{
  const doc=root();apply(doc,await replaceSubspaceDefinitions(things,doc,{},session));
  await transferSubspaceDefinitions(things,doc.shareId,'owner','next-owner',session);
  assert.equal(delta.get('owner'),0);
  assert.ok((delta.get('next-owner')||0)>0);
  assert.equal(await findSubspaceDefinition(things,doc,'flairs','flair-0'),null);
  doc.ownerId='next-owner';
  assert.equal((await findSubspaceDefinition(things,doc,'flairs','flair-0')).label,'Flair 0');
  await deleteSubspaceDefinitions(things,doc.shareId,doc.ownerId,session);
  assert.equal(rows.length,0);
  assert.equal(delta.get('next-owner'),0);
});

test('a missing or raced generation cannot masquerade as an empty editor selection',async()=>{
  const doc=root();apply(doc,await replaceSubspaceDefinitions(things,doc,{},session));
  rows=[];
  await assert.rejects(hydrateSubspaceDefinitions(things,[doc]),/changed while loading/);
});
test('a replaced flair generation rejects a stale posting lookup',async()=>{
  const doc=root();apply(doc,await replaceSubspaceDefinitions(things,doc,{},session));
  const stale=structuredClone(doc);
  afterRowRead=()=>{doc.definitionGeneration='new-generation';};
  await assert.rejects(findSubspaceDefinition(things,stale,'flairs','flair-0'),/changed while loading/);
});
test('a complete definition projection rejects a root changed during iteration',async()=>{
  const doc=root();apply(doc,await replaceSubspaceDefinitions(things,doc,{},session));
  const stale=structuredClone(doc);
  afterCursorRead=()=>{doc.definitionGeneration='new-generation';};
  await assert.rejects(hydrateSubspaceDefinitions(things,[stale]),/changed while loading/);
});
