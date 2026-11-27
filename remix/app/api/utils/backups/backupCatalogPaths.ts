import { createHash } from 'node:crypto';
import { backupJson, backupDigest } from '../../../backups/manifest';
import type { BackupWorkspaceEntry } from '../../../backups/workspace';
import type { BackupAccess,BackupObjectStore } from './portableBackup';
import { immutableReferenceIndex,validReferenceNodeRef,type ReferenceBlob } from './immutableReferenceIndex';
import { appendSnapshotCatalog,readSnapshotCatalogPage,readSnapshotCatalogState,snapshotCatalogDisplay } from './backupCatalog';
export type CatalogDescriptor={id:string;parentId:string|null;name:string;kind:'folder'|'file'|'data'};
type State={format:'snapshot-catalog-paths-v1';snapshotId:string;planHash:string;sourceHash:string;page:number;pageHash:string|null;entry:number;root:string|null;output:string|null;target:string|null;next:string|null;stack:ReferenceBlob|null;base:ReferenceBlob|null;mode:'walk'|'unwind'};
/** Ancestor work and cached paths live in immutable private objects. Each fresh
 * worker visits at most 32 edges; HTTP browsing only reads prepared pages. */
export async function advanceSnapshotCatalogPaths(store:BackupObjectStore,snapshotId:string,planHash:string,hash:string,initial:boolean,access:BackupAccess,descriptor:(id:string)=>Promise<CatalogDescriptor|null>){
 const check=async()=>{access.signal?.throwIfAborted();await access.authorize();access.signal?.throwIfAborted();};
 const index=immutableReferenceIndex(store,`snapshots/${snapshotId}/references`,check,()=>access.signal?.throwIfAborted(),createHash('sha256').update(backupJson(['catalog-paths',snapshotId,planHash,hash,initial])).digest('hex'));
 let state:State;
 if(initial){const raw=await readSnapshotCatalogState(store,snapshotId,planHash,hash,access);if(raw.pending.length)throw Error('Unfinished raw snapshot catalogue');
  state={format:'snapshot-catalog-paths-v1',snapshotId,planHash,sourceHash:hash,page:raw.pages-1,pageHash:raw.headHash,entry:0,root:null,output:null,target:null,next:null,stack:null,base:null,mode:'walk'};
 }else{state=await index.readState(hash);if(!state||state.format!=='snapshot-catalog-paths-v1'||state.snapshotId!==snapshotId||state.planHash!==planHash||!backupDigest(state.sourceHash)||!Number.isSafeInteger(state.page)||state.page< -1||!Number.isSafeInteger(state.entry)||state.entry<0||!(state.root===null||validReferenceNodeRef(state.root))||!['walk','unwind'].includes(state.mode))throw Error('Invalid snapshot catalogue path continuation');}
 const get=(...key:unknown[])=>index.get(state.root,index.key(key));
 const set=async(value:unknown,...key:unknown[])=>{state.root=await index.set(state.root,index.key(key),value);};
 let cachedPage:Awaited<ReturnType<typeof readSnapshotCatalogPage>>|null=null;
 for(let budget=0;budget<32;budget++){
  access.signal?.throwIfAborted();
  if(state.page<0){const output=await appendSnapshotCatalog(store,snapshotId,planHash,state.output,[],access,true);return {hash:output,done:true};}
  if(!state.pageHash)throw Error('Missing raw catalogue page');
  const page=cachedPage?.ordinal===state.page?cachedPage:await readSnapshotCatalogPage(store,snapshotId,planHash,state.pageHash,state.page,access);cachedPage=page;const entry=page.entries[state.entry];
  if(!entry)throw Error('Invalid raw catalogue position');
  if(state.target===null){state.target=entry.id;state.next=entry.id;state.mode='walk';state.base=null;state.stack=null;}
  if(state.mode==='walk'){
   const current=state.next;if(current===null){state.mode='unwind';continue;}
   const cached:ReferenceBlob|null=await get('catalog-path',current);if(cached){state.base=cached;state.mode='unwind';continue;}
   if(await get('catalog-seen',state.target,current))throw Error('Cyclic retained folder path');
   await set(true,'catalog-seen',state.target,current);
   const found=await descriptor(current);if(!found||found.id!==current||typeof found.name!=='string'||!(found.parentId===null||typeof found.parentId==='string'))throw Error('Retained source folder path is unavailable');
   state.stack=await index.blob({descriptor:found,previous:state.stack});state.next=found.parentId;
  }else if(state.stack){
   const link=await index.openBlob(state.stack),base=state.base?await index.openBlob(state.base):'';
   if(typeof base!=='string'||!link?.descriptor||typeof link.descriptor.name!=='string')throw Error('Invalid retained source path');
   const path=base?base+'/'+link.descriptor.name:link.descriptor.name;state.base=await index.blob(path);await set(state.base,'catalog-path',link.descriptor.id);state.stack=link.previous;
  }else{
   const found=await descriptor(entry.id),path=state.base?await index.openBlob(state.base):null;
   if(!found||typeof path!=='string')throw Error('Retained source path is missing');
   const name=snapshotCatalogDisplay(found.name),displayPath=snapshotCatalogDisplay(path);
   const prepared:BackupWorkspaceEntry={...entry,name,path:displayPath,kind:found.kind,reason:name!==found.name||displayPath!==path?'Display abbreviated; exact source names and hierarchy remain retained for restore.':entry.reason};
   state.output=await appendSnapshotCatalog(store,snapshotId,planHash,state.output,[prepared],access);
   state.target=null;state.next=null;state.base=null;state.entry++;
   if(state.entry===page.entries.length){state.page--;state.pageHash=page.previous;state.entry=0;}
  }
 }
 return {hash:await index.putState(state),done:false};
}
