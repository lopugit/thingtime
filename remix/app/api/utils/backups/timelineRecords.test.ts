import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { BACKUP_FORMAT, backupJson, type BackupHeader, type BackupItem } from '../../../backups/manifest';
import { timelineBackupFixture } from './timelineRecords.fixtures';
import { retainTimelineBackupRecord, timelineBackupRecordFromDoc, timelineBackupJson, parseInlineBackupTimelineRecord, openBackupTimelineRecord } from './timelineRecords';
import { prepareBackup, sealBackup, retainBackupPayload, type BackupObjectStore } from './portableBackup';
import { readAccountRestoreRecord } from './accountRestoreRecord';
function fixture(){
 const id=randomUUID(),objects=new Map<string,Uint8Array>(),counts={puts:0};
 const store:BackupObjectStore={read:async(key,max)=>{const value=objects.get(key);if(!value)return null;assert.ok(value.length<=max);return Uint8Array.from(value);},put:async(key,bytes)=>{counts.puts++;const prior=objects.get(key);if(prior)assert.ok(Buffer.from(prior).equals(bytes),'immutable object changed');else objects.set(key,Uint8Array.from(bytes));}};
 const scope={ownerId:'owner',apiOrigin:'https://timeline-inline.test',dataPlane:'home'},access={scope,authorize:async()=>{}};
 const header:BackupHeader={format:BACKUP_FORMAT,snapshotId:id,scope,boundary:{kind:'point-in-time',token:'pinned',startedAt:'2026-11-06T00:00:00.000Z',completedAt:'2026-11-06T00:00:00.000Z'},coverage:{selectionId:'fixture',description:'Synthetic canonical Timeline'}};
 return {id,store,objects,counts,access,header};
}
test('small canonical Timeline uses explicit inline v2 with zero provider IO; large records keep v1 and both readers recover exact records',async()=>{
 const f=fixture(),docs=timelineBackupFixture().docs.sort((a,b)=>a.shareId<b.shareId?-1:1),items:BackupItem[]=[];let inline=0,retained=0;
 await prepareBackup(f.store,f.header,(async function*(){for(const [ordinal,doc]of docs.entries()){
  const before=f.counts.puts,item=await retainTimelineBackupRecord(f.store,f.id,ordinal,doc,f.access);items.push(item);
  if(item.snapshot.version===2){inline++;assert.equal(item.content,null);assert.equal(f.counts.puts,before);assert.deepEqual(parseInlineBackupTimelineRecord(item,'owner'),timelineBackupRecordFromDoc(doc));}
  else{retained++;assert.equal(item.snapshot.version,1);assert.ok(item.content);}yield item;
 }})(),f.access);
 assert.ok(inline>0);assert.ok(retained>0);await sealBackup(f.store,f.id,f.access);
 for(const [ordinal,item]of items.entries()){
  assert.deepEqual(await openBackupTimelineRecord(f.store,f.id,item.thingId,f.access),timelineBackupRecordFromDoc(docs[ordinal]));
  if(item.snapshot.version===2){const decoded=await readAccountRestoreRecord(item,(async function*(){throw Error('Inline records must not fetch payload');})(),'owner');assert.equal(decoded?.family,'timeline');assert.deepEqual(decoded?.value,timelineBackupRecordFromDoc(docs[ordinal]));}
 }
 for(const bytes of f.objects.values())assert.ok(!Buffer.from(bytes).toString().includes('NEVER_EXPORT'));
});
test('existing retained v1 Timeline remains readable without inline conversion',async()=>{
 const f=fixture(),doc=timelineBackupFixture().docs.find(doc=>doc.thingtime[0]==='timeline-link')!,record=timelineBackupRecordFromDoc(doc),text=timelineBackupJson(record),sha256=createHash('sha256').update(text).digest('hex');
 await prepareBackup(f.store,f.header,(async function*(){yield await retainBackupPayload(f.store,f.id,{ordinal:0,thingId:doc.shareId,revision:'snapshot-'+sha256,snapshot:{adapter:'backup-timeline-record',version:1,value:{kind:record.kind,sha256}}},Buffer.from(text),f.access);})(),f.access);
 await sealBackup(f.store,f.id,f.access);assert.deepEqual(await openBackupTimelineRecord(f.store,f.id,doc.shareId,f.access),record);
});
test('inline Timeline rejects owner/id/kind/SHA/revision/content substitution and reauthorizes before return',async()=>{
 const f=fixture(),doc=timelineBackupFixture().docs.find(doc=>doc.thingtime[0]==='timeline-link')!,item=await retainTimelineBackupRecord(f.store,f.id,0,doc,f.access);assert.equal(item.snapshot.version,2);
 for(const mutate of [(v:any)=>v.thingId='other',(v:any)=>v.revision='snapshot-'+'a'.repeat(64),(v:any)=>v.snapshot.value.sha256='b'.repeat(64),(v:any)=>v.snapshot.value.kind='timeline-event',(v:any)=>v.snapshot.value.record.value.ownerId='other',(v:any)=>v.content={size:0,fingerprint:null}]){
  const forged=structuredClone(item);mutate(forged);assert.throws(()=>parseInlineBackupTimelineRecord(forged,'owner'));await assert.rejects(readAccountRestoreRecord(forged,(async function*(){})(),'owner'));
 }
 assert.throws(()=>parseInlineBackupTimelineRecord(item,'other'));
 let calls=0;await assert.rejects(retainTimelineBackupRecord(f.store,f.id,0,doc,{...f.access,authorize:async()=>{if(++calls===2)throw Error('revoked');}}),/revoked/);
 assert.equal(f.counts.puts,0);assert.match(backupJson(item),/"version":2/);
});
