import { WorkspaceDatabase } from '../../remix/app/local-workspace/storage';
import { AccountThemeSync } from '../../remix/app/local-workspace/accountThemes';
import { AccountAlgorithmSync } from '../../remix/app/local-workspace/accountAlgorithms';
import { readCatalogueStream, writeCatalogueStream } from '../../remix/app/catalogue/catalogueStream';
const check = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
const scope = { kind: 'account', origin: location.origin, ownerId: 'synthetic-browser-owner', dataPlane: 'home' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const stamp = '2026-10-26T00:00:00.000Z', key = (i: number) => `profile-${String(i).padStart(5, '0')}`;
const saved = (domain: string, i: number, large = false) => {
 const common = { id: key(i), folderId: null, createdAt: stamp, updatedAt: stamp };
 return domain === 'themes' ? { ...common, name: 'Peach', title: null, theme: {}, visibility: 'private', version: 'theme-state-v1:' + 'a'.repeat(64) }
  : { ...common, version: 'algorithm-state-v1:' + 'a'.repeat(64), content: { name: 'Reading', emoji: '🧠', weights: { types: {}, tags: large ? Object.fromEntries(Array.from({length:600},(_,i)=>[`tag-${i}-${'x'.repeat(250)}`,1])) : {}, authors: {} }, eventCount: 0, lastTrainedAt: null }, description: '', parentId: null, shared: false, listed: false, legacy: false };
};
function transport(domain: 'themes'|'algorithms', rows: any[], afterEntry?: (id:string)=>Promise<void>|void) {
 return { snapshot: async ():Promise<never> => { throw Error('Legacy snapshot used'); }, write: async ():Promise<never> => { throw Error('Unexpected account write'); },
  catalogue: async (sink:any, signal:AbortSignal) => {
   const identity = { domain, origin:scope.origin, ownerId:scope.ownerId, dataPlane:scope.dataPlane, storagePlane:'home' } as const;
   const pipe = new TransformStream<Uint8Array,Uint8Array>(), writer = pipe.writable.getWriter();
   const produced = writeCatalogueStream({...identity,version:1,generation:crypto.randomUUID()}, (async function*(){for(const row of rows)yield {id:row.id,value:row};})(), bytes=>writer.write(bytes),{signal}).then(()=>writer.close()).catch(error=>writer.abort(error).catch(()=>{}));
   try {return await readCatalogueStream(pipe.readable,identity,{entry:async(id,value,current)=>{await sink.entry(id,value,current);await afterEntry?.(id);},complete:(receipt,current)=>sink.complete(receipt,current)},{signal});}
   finally {await produced;}
  }
 };
}
async function summaries(db:WorkspaceDatabase) {
 return db.transaction(scope,'readonly',lease,async tx=>{
  const rows:any[]=[];let after:string|undefined;
  for(;;){const page=await tx.scan<any>('things',{after});if(!page.length)break;for(const row of page)rows.push({id:row.id,name:row.value.crystal.name});after=page.at(-1)!.id;}
  const stages=await tx.scan('catalogue-staging'); return {rows,stages,usage:await tx.usage()};
 });
}
async function stageCount(name:string) {
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try {return await new Promise<number>((resolve,reject)=>{let count=0;const tx=db.transaction('records'),q=tx.objectStore('records').openKeyCursor();q.onerror=()=>reject(q.error);q.onsuccess=()=>{const c=q.result;if(!c)return;const collection=String((c.key as any[])[1]);if(collection==='catalogue-staging'||collection.startsWith('catalogue-stage-')||collection.startsWith('catalogue-references-'))count++;c.continue();};tx.oncomplete=()=>resolve(count);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
(window as any).catalogueAcceptance = {
 async run(domain:'themes'|'algorithms') {
  const name=`catalogue-browser-${domain}`,db=new WorkspaceDatabase(indexedDB,name),sync=domain==='themes'?new AccountThemeSync(db,scope,lease):new AccountAlgorithmSync(db,scope,lease);
  const rows=Array.from({length:domain==='themes'?145:60},(_,i)=>saved(domain,i,domain==='algorithms'));
  const bytes=new TextEncoder().encode(JSON.stringify(rows)).byteLength;
  if(domain==='algorithms')check(bytes>8*1024*1024,'Fixture must exceed legacy 8MiB response bound');
  const store=IDBObjectStore.prototype.getAll,index=IDBIndex.prototype.getAll;
  IDBObjectStore.prototype.getAll=IDBIndex.prototype.getAll=()=>{throw Error('getAll forbidden during admission');};
  try {check(await sync.refresh(transport(domain,rows))===true,'Admission failed');}finally{IDBObjectStore.prototype.getAll=store;IDBIndex.prototype.getAll=index;}
  check((await summaries(db)).rows.length===rows.length,'Missing admitted rows');
  if(sync instanceof AccountThemeSync)await sync.save({id:key(0),name:'Pending device edit',theme:{}});
  else await sync.algorithms.update({id:key(0),name:'Pending device edit'});
  check(await sync.refresh(transport(domain,rows))===true,'Pending refresh failed');
  const before=await summaries(db);check(before.rows.find(row=>row.id===key(0))?.name==='Pending device edit','Pending edit overwritten');
  const aborted=new AbortController();let cancelled=false;
  try{await sync.refresh(transport(domain,[saved(domain,200),saved(domain,201)],()=>aborted.abort(new DOMException('Synthetic cancellation','AbortError'))),aborted.signal);}catch{cancelled=true;}
  check(cancelled,'Cancellation was ignored');check(JSON.stringify((await summaries(db)).rows)===JSON.stringify(before.rows),'Cancelled stream changed content');
  check(await stageCount(name)===0,'Cancelled staging leaked');
  // Inject the actual platform exception at native put, after staging and inside
  // final admission. This proves rollback semantics, not physical quota capacity.
  const put=IDBObjectStore.prototype.put;let quota=false;
  IDBObjectStore.prototype.put=function(value:any,...rest:any[]){if(this.name==='records'&&value.collection==='things'&&value.id===key(203))throw new DOMException('Synthetic platform quota','QuotaExceededError');return put.call(this,value,...rest);};
  try{await sync.refresh(transport(domain,[saved(domain,202),saved(domain,203)]));}catch(error:any){quota=error.code==='LOCAL_QUOTA';}finally{IDBObjectStore.prototype.put=put;}
  check(quota,'Quota-style failure not normalized');const after=await summaries(db);
  check(JSON.stringify(after.rows)===JSON.stringify(before.rows),'Quota-style failure changed content');check(JSON.stringify(after.usage)===JSON.stringify(before.usage),'Quota-style failure changed accounting');check(await stageCount(name)===0,'Failed admission leaked staging');
  const admissionAbort=new AbortController();let admissionCancelled=false;
  IDBObjectStore.prototype.put=function(value:any,...rest:any[]){const result=put.call(this,value,...rest);if(this.name==='records'&&value.collection==='things'&&value.id===key(205))admissionAbort.abort(new DOMException('Cancelled native admission','AbortError'));return result;};
  try{await sync.refresh(transport(domain,[saved(domain,204),saved(domain,205)]),admissionAbort.signal);}catch{admissionCancelled=true;}finally{IDBObjectStore.prototype.put=put;}
  check(admissionCancelled,'Native admission cancellation ignored');const rolledBack=await summaries(db);check(JSON.stringify(rolledBack.rows)===JSON.stringify(before.rows),'Native cancelled admission committed rows');check(JSON.stringify(rolledBack.usage)===JSON.stringify(before.usage),'Native cancelled admission changed accounting');check(await stageCount(name)===0,'Native cancelled admission leaked stages');
  await db.close();return {domain,count:rows.length,serializedBytes:bytes,pendingPreserved:true,cancelled,admissionCancelled,quotaStyleRollback:quota,stagingRows:0,nativeIndexedDB:true};
 },
 async reload(domain:'themes'|'algorithms') {
  const db=new WorkspaceDatabase(indexedDB,`catalogue-browser-${domain}`);
  try{const result=await summaries(db);check(result.rows.length===(domain==='themes'?145:60),'Reload lost rows');check(result.rows[0].name==='Pending device edit','Reload lost pending edit');check(await stageCount(`catalogue-browser-${domain}`)===0,'Reload leaked stages');return {domain,count:result.rows.length,pendingName:result.rows[0].name,stagingRows:0};}finally{await db.close();}
 }
};
