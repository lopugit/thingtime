import { createHash } from 'node:crypto';
import { BACKUP_PAGE_BYTES, backupDigest, backupId, backupJson, type BackupItem } from '../../../backups/manifest';
import type { BackupWorkspaceEntry } from '../../../backups/workspace';
import type { BackupAccess, BackupObjectStore } from './portableBackup';
export type SnapshotCatalogState = { version:1; snapshotId:string; planHash:string; count:number; pages:number; headHash:string|null; pending:BackupWorkspaceEntry[] };
type CatalogPage={version:1;snapshotId:string;planHash:string;ordinal:number;previous:string|null;entries:BackupWorkspaceEntry[]};
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const key=(id:string,digest:string)=>{if(!backupId(id)||!backupDigest(digest))throw Error('Invalid snapshot catalogue key');return `snapshots/${id}/references/blobs/${digest}/0`;};
/** Display previews bound picker rendering only. Full names, paths and restore
 * metadata remain losslessly retained in the source descriptor/content blobs. */
export function snapshotCatalogDisplay(value:string){
 if(Buffer.byteLength(value)<=4096)return value;
 let bytes=0,prefix='';for(const char of value){const size=Buffer.byteLength(char);if(bytes+size>4000)break;prefix+=char;bytes+=size;}
 return prefix+' … [display shortened; full text retained]';
}
const validEntry=(entry:any):entry is BackupWorkspaceEntry=>!!entry&&Object.keys(entry).sort().join(',')==='bytes,id,kind,name,path,reason,selectable,versions'&&
 typeof entry.id==='string'&&entry.id.length>0&&typeof entry.name==='string'&&typeof entry.path==='string'&&['file','folder','data'].includes(entry.kind)&&
 (entry.bytes===null||(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0))&&(entry.versions===null||(Number.isSafeInteger(entry.versions)&&entry.versions>=0))&&
 typeof entry.selectable==='boolean'&&(entry.reason===null||typeof entry.reason==='string');
async function put(store:BackupObjectStore,id:string,value:unknown,access:BackupAccess){
 const bytes=Buffer.from(backupJson(value)),digest=hash(bytes);await access.authorize();access.signal?.throwIfAborted();
 await store.put(key(id,digest),bytes);await access.authorize();access.signal?.throwIfAborted();return digest;
}
async function read(store:BackupObjectStore,id:string,digest:string,access:BackupAccess){
 await access.authorize();access.signal?.throwIfAborted();const bytes=await store.read(key(id,digest),BACKUP_PAGE_BYTES);
 await access.authorize();access.signal?.throwIfAborted();if(!bytes||hash(bytes)!==digest)throw Error('Snapshot catalogue changed');
 const value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));if(backupJson(value)!==new TextDecoder().decode(bytes))throw Error('Invalid snapshot catalogue encoding');return value;
}
/** Presentation metadata is derived from verified plan pages. It grants no
 * restore authority; selection is always re-certified against the source seal. */
export function snapshotCatalogEntry(item:BackupItem):BackupWorkspaceEntry|null{
 const value=item.snapshot.value as any,adapter=item.snapshot.adapter;
 if(adapter==='file-content'&&item.snapshot.version===1)return {id:item.thingId,name:String(value.name),path:String(value.name),kind:'file',bytes:value.content?.size??null,versions:null,selectable:true,reason:null};
 if(!['thing-content','backup-thing-content'].includes(adapter))return null;
 const kinds=Array.isArray(value?.thingtime)?value.thingtime:[],name=typeof value?.crystal?.name==='string'?value.crystal.name:item.thingId;
 return {id:item.thingId,name,path:name,kind:kinds.includes('folder')?'folder':'data',bytes:null,versions:null,selectable:true,reason:null};
}
export async function readSnapshotCatalogState(store:BackupObjectStore,id:string,planHash:string,stateHash:string,access:BackupAccess):Promise<SnapshotCatalogState>{
 const state=await read(store,id,stateHash,access);
 if(!state||Object.keys(state).sort().join(',')!=='count,headHash,pages,pending,planHash,snapshotId,version'||state.version!==1||state.snapshotId!==id||state.planHash!==planHash||
  ![state.count,state.pages].every(v=>Number.isSafeInteger(v)&&v>=0)||!Array.isArray(state.pending)||state.pending.length>128||!state.pending.every(validEntry)||state.count<state.pending.length||((state.pages===0)!==(state.headHash===null))||!(state.headHash===null||backupDigest(state.headHash)))throw Error('Invalid snapshot catalogue state');
 return state;
}
export async function appendSnapshotCatalog(store:BackupObjectStore,id:string,planHash:string,previous:string|null,entries:BackupWorkspaceEntry[],access:BackupAccess,finish=false){
 const state:SnapshotCatalogState=previous?await readSnapshotCatalogState(store,id,planHash,previous,access):{version:1,snapshotId:id,planHash,count:0,pages:0,headHash:null,pending:[]};
 const flush=async()=>{if(!state.pending.length)return;state.headHash=await put(store,id,{version:1,snapshotId:id,planHash,ordinal:state.pages,previous:state.headHash,entries:state.pending},access);state.pages++;state.pending=[];};
 for(const entry of entries){
  if(!validEntry(entry))throw Error('Invalid snapshot catalogue entry');
  if(state.pending.length&&(state.pending.length===128||Buffer.byteLength(backupJson(state.pending))+Buffer.byteLength(backupJson(entry))+2048>BACKUP_PAGE_BYTES))await flush();
  state.pending.push(entry);state.count++;
 }
 if(finish)await flush();return put(store,id,state,access);
}
export async function readSnapshotCatalogPage(store:BackupObjectStore,id:string,planHash:string,digest:string,ordinal:number,access:BackupAccess):Promise<CatalogPage>{
 const page=await read(store,id,digest,access);
 if(!page||Object.keys(page).sort().join(',')!=='entries,ordinal,planHash,previous,snapshotId,version'||page.version!==1||page.snapshotId!==id||page.planHash!==planHash||page.ordinal!==ordinal||
  !Array.isArray(page.entries)||page.entries.length<1||page.entries.length>128||!page.entries.every(validEntry)||((ordinal===0)!==(page.previous===null))||!(page.previous===null||backupDigest(page.previous)))throw Error('Invalid snapshot catalogue page');
 return page;
}
