/** Actual canonical uploads/files/Timeline -> sealed account archive -> new
 * account restore after source bytes and first vault are removed. Synthetic
 * accounts and a disposable replica/local object adapter only; no raw DB IO. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:28167\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING || ''));
const base = 'http://127.0.0.1:28167';
process.env.APP_URL = base; process.env.JWT_SECRET = randomUUID() + randomUUID(); process.env.ADMIN_USERNAMES = '';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(directory!, 'objects'); process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;
const register = await import('../app/routes/api/v1/auth/register/_register');
const migration = await import('../app/routes/api/v1/admin/migrations/run/_run');
const logout = await import('../app/routes/api/v1/auth/logout/_logout');
const bulk = await import('../app/routes/api/v1/things/bulk/_bulk');
const me = await import('../app/routes/api/v1/auth/me/_me');
const uploads = await import('../app/routes/api/v1/attachments/uploads/_uploads');
const parts = await import('../app/routes/api/v1/attachments/uploads/parts/_parts');
const complete = await import('../app/routes/api/v1/attachments/uploads/complete/_complete');
const content = await import('../app/routes/api/v1/attachments/content/_content');
const filesRoute = await import('../app/routes/api/v1/files/_files');
const timelineRoute = await import('../app/routes/api/v1/timeline/_timeline');
const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
const { createThing, deleteThing, getThing, updateThing, listThings } = await import('../app/api/utils/things/things');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { thingtimeCapabilityManifest, capabilitySatisfies } = await import('../app/api/utils/capabilities/thingtimeCapabilities');
const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
const { parseCloudFile } = await import('../app/fileSync/cloudFile');
const { stageCloudFileBytes } = await import('../app/fileSync/cloudTransport');
const { fileCommitEventId } = await import('../app/fileSync/fileVersions');
const { fingerprintSource } = await import('../app/fileSync/contentFingerprint');
const { createAccountInventoryProducer } = await import('../app/api/utils/backups/accountInventory');
const { resumeAccountBackup } = await import('../app/api/utils/backups/cloudFolderBackup');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');
const { copySealedBackup, openIndexedSealedBackup } = await import('../app/api/utils/backups/portableBackup');
const { openAccountBackupTimelineRecord, openAccountBackupFile } = await import('../app/api/utils/backups/accountFileRecovery');
const { openBackupThingSnapshot } = await import('../app/api/utils/backups/thingSnapshots');
const { joinTimelineEvent } = await import('../app/timeline/records');
const { executeOrdinaryRestoreTransaction, ordinaryRestoreTargetId, ordinaryRestoreGraphHash } = await import('../app/api/utils/backups/ordinaryRestoreTransaction');
const { CONTENT_CREATION_REQUIREMENTS } = await import('../app/backups/contentCreation');
const { executeAccountFileRestore, accountFileRestoreGraphHash, accountFileRestoreTargetId, accountFileRestoreHistoryId, accountFileRestoreBranchId, accountFileRestoreCommandId, ACCOUNT_FILE_RESTORE_REQUIREMENTS } = await import('../app/api/utils/backups/accountFileRestore');
const { createAccountFileRestoreStager } = await import('../app/api/utils/backups/accountFileRestoreBytes');
const { canonicalJsonBytes } = await import('../app/utils/canonicalJsonStream');
const hash = (value: unknown) => { const h = createHash('sha256'); for (const bytes of canonicalJsonBytes(value)) h.update(bytes); return h.digest('hex'); };
const request = (who: any, path = '/api/v1/things', body?: unknown) => new Request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: who.cookie, Origin: base, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function signup() { const username = 'file-restore-' + randomUUID().slice(0,8); const response = await register.action({ request: request({cookie:''}, '/api/v1/auth/register', { username, email: username+'@example.invalid', password: randomUUID()+'-Disposable!' }) } as any); const data = await response.json(); assert.equal(response.status,200); return { user:data.user, username, cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ') }; }
const source = await signup(), destination = await signup(), other = await signup();
process.env.ADMIN_USERNAMES = [source.username,destination.username].join(',');
const manifest = thingtimeCapabilityManifest(base);
const requireCapability = async (feature: string, minimum: string) => assert.ok(capabilitySatisfies(manifest.features[feature]?.version ?? '', minimum), feature);
const call = async (who: any, handler: any, path: string, body?: unknown) => { const response:Response = await handler({request:request(who,path,body)}); const data=await response.json(); assert.equal(response.status,200,JSON.stringify(data)); return data; };
await call(source,migration.action,'/api/v1/admin/migrations/run',{migration:'retire-legacy-thing-indexes',confirm:true});
await delay(60_100);
await call(source,migration.action,'/api/v1/admin/migrations/run',{migration:'retire-legacy-thing-indexes',confirm:true});
await ensureIndexes({force:true});

function transport(who: any, rootId: string) {
 const scope={origin:base,ownerId:who.user.id,dataPlane:'home',rootId,deviceId:'restore-fixture'},stats={putRequests:0};
 const fetcher: typeof fetch = async (url, init) => {
  const u=new URL(String(url),base); assert.equal(u.origin,base);if(u.pathname==='/api/v1/attachments/local-object'&&init?.method==='PUT')stats.putRequests++;
  const headers=new Headers(init?.headers); if(u.pathname!=='/api/v1/attachments/local-object') { headers.set('Cookie',who.cookie); headers.set('Origin',base); }
  const req=new Request(u,{...init,headers} as ConstructorParameters<typeof Request>[1]);
  if(u.pathname==='/api/v1/attachments/local-object') return handleLocalAttachmentStorageRequest(req);
  const handler= u.pathname==='/api/v1/auth/me'?me.loader:u.pathname==='/api/v1/attachments/uploads'?uploads.action:u.pathname.endsWith('/uploads/parts')?parts.action:u.pathname.endsWith('/uploads/complete')?complete.action:u.pathname==='/api/v1/attachments/content'?(req.method==='POST'?content.action:content.loader):u.pathname==='/api/v1/files'?(req.method==='POST'?filesRoute.action:filesRoute.loader):null;
  if(!handler) throw Error('Unexpected fixture route '+u.pathname); return handler({request:req} as any);
 };
 return {currentScope:()=>scope,origin:()=>base,fetch:fetcher,requireCapability,stats};
}
async function folder(who:any,name:string,parentId:string|null=null) { const result=await createThing(who.user.id,{thingtime:['folder'],acl:['tt:user'],crystal:{name,description:'Preserve '+name},tags:['backup-test'],folderId:parentId},who.user); assert.equal(result.ok,true); if(!result.ok) throw Error(result.error); return result.doc; }
const rootSource=await folder(source,'Source'), left=await folder(source,'Earlier',rootSource.shareId), right=await folder(source,'Current',rootSource.shareId);
const sourceRuntime=transport(source,rootSource.shareId), fileId=randomUUID();
const oldBytes=new Uint8Array(Buffer.from('historical original 🥰')), currentBytes=new Uint8Array(Buffer.from('current source bytes')), conflictBytes=new Uint8Array(Buffer.from('retained branch bytes'));
async function publish(bytes:Uint8Array,name:string,parent:any,path:string,before:any=null,retained=false,id=fileId,symbolicLink?:any) {
 const operationId=randomUUID(), fp=await fingerprintSource({size:bytes.length,read:async(o,n)=>bytes.slice(o,o+n),check:()=>{}});
 const staged=await stageCloudFileBytes(sourceRuntime,{scope:sourceRuntime.currentScope(),folderId:parent.shareId,before:null,cloudRootId:rootSource.shareId,operation:{id:operationId,confirmed:true,mutation:{kind:'copy',from:'local',path,expectedTarget:null,source:{kind:'file',path,id,version:'source',size:bytes.length,sha256:null,fingerprint:fp,...(symbolicLink?{symbolicLink}:{})}}}},id,{size:bytes.length,read:async(o,n)=>bytes.slice(o,o+n),check:()=>{}},undefined,{purpose:'file'});
 return (await call(source,filesRoute.action,'/api/v1/files',{id,operationId,expectedRevision:before?.revision??null,name,folderId:parent.shareId,attachmentId:staged.attachmentId,contentVersion:staged.version,trashed:false,...(symbolicLink?{symbolicLink}:{}),...(retained?{kind:'retained-version'}:{})})).file;
}
const old=await publish(oldBytes,'old.txt',left,'Earlier/old.txt');
let current=await publish(currentBytes,'renamed.txt',left,'Earlier/renamed.txt',old);
// Generic placement is a compact managed-folder-placement history record.
const moved=await call(source,bulk.action,'/api/v1/things/bulk',{op:'move',ids:[fileId],folderId:right.shareId}); assert.equal(moved.failed,0);
current=(await call(source,filesRoute.loader,'/api/v1/files?id='+fileId)).file;
const conflict=await publish(conflictBytes,current.name,right,'Current/'+current.name,current,true);
const { handleBranchRequest, getTimelineBranch }=await import('../app/api/utils/timeline/branches');
await handleBranchRequest(source.user.id,{command:'create-branch',operationId:randomUUID(),branchId:'branch-'+randomUUID(),thingId:fileId,eventId:old.revision,expectedRevision:0,name:'Original alternative'});
const linkId=randomUUID(),emptyId=randomUUID(),linkBytes=new Uint8Array(Buffer.from('../target'));
const symbolicLink={format:'posix-symlink-v1',targetBase64:Buffer.from(linkBytes).toString('base64')};
const link=await publish(linkBytes,'link',right,'Current/link',null,false,linkId,symbolicLink);
const empty=await publish(new Uint8Array(0),'empty.txt',right,'Current/empty.txt',null,false,emptyId);
const trashId=randomUUID(),trashBytes=new Uint8Array(Buffer.from('preserved trashed file'));
const liveTrash=await publish(trashBytes,'trashed.txt',right,'Current/trashed.txt',null,false,trashId);
const trash=(await call(source,filesRoute.action,'/api/v1/files',{id:trashId,operationId:randomUUID(),expectedRevision:liveTrash.revision,name:liveTrash.name,folderId:liveTrash.folderId,attachmentId:liveTrash.content.attachmentId,contentVersion:liveTrash.content.version,trashed:true})).file;
const sourceFileIds=new Set([fileId,linkId,emptyId,trashId]);
const sourceScope={apiOrigin:base,ownerId:source.user.id,dataPlane:'home'};
const access={scope:sourceScope,authorize:async()=>assert.equal((await getCurrentUser(request(source)))?.id,source.user.id)};
const first=await openLocalBackupStore(join(directory!,'first')), independent=await openLocalBackupStore(join(directory!,'independent')), snapshotId=randomUUID();
await ensureIndexes({force:true});
await createAccountInventoryProducer()(first,snapshotId,access);
const captured=await resumeAccountBackup(first,snapshotId,{scope:sourceScope,currentScope:()=>sourceScope,fetch:sourceRuntime.fetch,requireCapability});
await copySealedBackup(first,independent,snapshotId,access);
const indexed=await openIndexedSealedBackup(independent,snapshotId,access);
const seal=indexed.seal, sourceEvents:any[]=[], links:any[]=[], branchRecords:any[]=[], headRecords:any[]=[];
for await(const item of indexed.items()) if(item.snapshot.adapter==='backup-timeline-record') { const r=await openAccountBackupTimelineRecord(independent,snapshotId,item.thingId,access,indexed); if(r.kind==='timeline-event'&&sourceFileIds.has((r.value as any).event.thingId)) sourceEvents.push({thingId:item.thingId,...r.value as any}); if(r.kind==='timeline-link')links.push(r.value);if(r.kind==='timeline-branch')branchRecords.push({thingId:item.thingId,value:r.value});if(r.kind==='timeline-branch-head'&&sourceFileIds.has((r.value as any).thingId))headRecords.push({thingId:item.thingId,value:r.value}); }
const events=sourceEvents.map(r=>({thingId:r.thingId,event:'parentCount'in r.event?joinTimelineEvent(r.event,links.filter(l=>l.eventId===r.event.id)):r.event})).filter(r=>[r.event.before,r.event.after].some(s=>s&&['file-content','folder-placement','managed-folder-placement'].includes(s.adapter)));
assert.ok(events.some(r=>r.event.parentIds.length));assert.ok(events.some(r=>r.event.after?.adapter==='managed-folder-placement'));
const sourceFolders=[rootSource,left,right];
const snapshots=await Promise.all(sourceFolders.map(f=>openBackupThingSnapshot(independent,snapshotId,f.shareId,access)));
await indexed.close();
assert.equal((await deleteThing(source.user,rootSource.shareId)).ok,true);
await rm(join(directory!,'objects'),{recursive:true,force:true});await rm(join(directory!,'first'),{recursive:true});
await call(source,logout.action,'/api/v1/auth/logout',{});assert.equal(await getCurrentUser(request(source)),null);source.cookie='';
const vault=await stat(join(directory!,'independent'));
access.authorize=async()=>{const now=await stat(join(directory!,'independent'));assert.equal(now.ino,vault.ino);assert.equal(now.dev,vault.dev);assert.equal(now.mode&0o077,0);};
const destinationRoot=await folder(destination,'Restored destination');
const dest={scope:{apiOrigin:base,ownerId:destination.user.id,dataPlane:'home'},rootId:destinationRoot.shareId,rootRevision:destinationRoot.timelineHeadId,capabilities:{...CONTENT_CREATION_REQUIREMENTS,...ACCOUNT_FILE_RESTORE_REQUIREMENTS}};
const ordinary:any={format:'thingtime-selected-ordinary-restore-v1',referenceDomain:'ordinary-composition-v1',operationId:randomUUID(),sourceSealHash:hash(seal),reviewHash:'a'.repeat(64),graphHash:'',count:sourceFolders.length,destination:dest};
const ordinaryRows=sourceFolders.map((f,i)=>{ const {targetId: _targetId,...value}=snapshots[i].value as any; return {sourceId:f.shareId,input:{...value,shareId:ordinaryRestoreTargetId(ordinary,f.shareId),folderId:f.folderId?ordinaryRestoreTargetId(ordinary,f.folderId):dest.rootId,acl:['tt:user']}}; });
const iterable=<T>(rows:T[])=>(async function*(){yield*rows;})();
Object.assign(ordinary,await ordinaryRestoreGraphHash(iterable(ordinaryRows)));
const ordinaryResult=await executeOrdinaryRestoreTransaction(request(destination),ordinary,()=>iterable(ordinaryRows));
const records:any[]=[];
for(const f of sourceFolders){ const target=ordinaryRestoreTargetId(ordinary,f.shareId);const loaded=await getThing(destination.user,target);assert.equal(loaded.ok,true);if(!loaded.ok)throw Error('folder read');const doc:any=loaded.thing;const raw=ordinaryRows.find(r=>r.sourceId===f.shareId)!; records.push({kind:'folder',sourceId:f.shareId,targetId:target,targetRevision:doc.timelineHeadId,priorBinding:hash(ordinary),priorOperationId:ordinary.operationId,priorCompletionEventId:ordinaryResult.eventId,parentSourceId:f.folderId??null,name:f.crystal.name});assert.deepEqual(doc.tags,['backup-test']); }
records.push({kind:'current',file:current},{kind:'current',file:link},{kind:'current',file:empty},{kind:'current',file:trash});
const byteKeys=new Set([current,link,empty,trash].map(file=>file.content.attachmentId+':'+file.content.version));
for(const row of events)for(const side of ['before','after'] as const){const snapshot=row.event[side];if(snapshot?.adapter!=='file-content')continue;const file=parseCloudFile(snapshot.value);const k=file.content.attachmentId+':'+file.content.version;if(byteKeys.has(k))continue;byteKeys.add(k);records.push({kind:'version',eventThingId:row.thingId,side,file});}
// Canonical parent order; no source timestamps or receipt positions are authority.
const pending=[...events],seen=new Set<string>();while(pending.length){const i=pending.findIndex(r=>r.event.parentIds.every(id=>seen.has(id)));assert.ok(i>=0,'closed source ancestry');const[r]=pending.splice(i,1);records.push({kind:'history',eventThingId:r.thingId,event:r.event});seen.add(r.event.id);}
for(const head of headRecords){const branch=branchRecords.find(b=>b.value.id===head.value.branchId)!;records.push({kind:'branch',branchThingId:branch.thingId,headThingId:head.thingId,branch:branch.value,head:head.value});}
records.push({kind:'finalize-current',sourceId:trashId});
const review:any={format:'thingtime-selected-file-restore-v1',operationId:randomUUID(),sourceSealHash:hash(seal),graphHash:'',count:records.length,destination:dest};Object.assign(review,await accountFileRestoreGraphHash(iterable(records)));
const destinationRuntime=transport(destination,dest.rootId),privateStager=createAccountFileRestoreStager(independent,snapshotId,access,destinationRuntime);
let interruptStaging=true,stagedAttachmentId:string|undefined,firstStagedPutCount:number|undefined,probedPublic=false;
const stager=async(input:any)=>{const staged=await privateStager(input);const root=await listThings(destination.user,{folder:'root',limit:100});const all=await listThings(destination.user,{thingtime:['attachment'],limit:100});assert.equal(root.ok,true);assert.equal(all.ok,true);if(root.ok)assert.ok(!root.things.some(row=>row.id===staged.attachmentId));if(all.ok)assert.ok(!all.things.some(row=>row.id===staged.attachmentId));if(input.record.kind==='current'&&input.record.file.id===fileId){if(stagedAttachmentId){assert.equal(staged.attachmentId,stagedAttachmentId);assert.equal(destinationRuntime.stats.putRequests,firstStagedPutCount,'resuming a ready import must not PUT the same source bytes again');}stagedAttachmentId=staged.attachmentId;firstStagedPutCount=destinationRuntime.stats.putRequests;if(!probedPublic){probedPublic=true;const body={id:input.targetId,operationId:randomUUID(),expectedRevision:null,name:input.name,folderId:input.folderId,attachmentId:staged.attachmentId,contentVersion:staged.version,trashed:false};assert.equal((await filesRoute.action({request:request(destination,'/api/v1/files',{...body,consumeImportDraft:true})}as any)).status,400);assert.equal((await filesRoute.action({request:request(destination,'/api/v1/files',body)}as any)).status,409);}if(interruptStaging){interruptStaging=false;throw Error('interrupted private staged upload');}}return staged;};
const sourceInfo={store:independent,snapshotId,access};
await assert.rejects(executeAccountFileRestore(request(other),review,sourceInfo,()=>iterable(records),stager),/account|session/i);
await assert.rejects(executeAccountFileRestore(request(destination),review,sourceInfo,()=>iterable(records),stager),/interrupted private staged upload/);
let interrupted=false;
await assert.rejects(executeAccountFileRestore(request(destination),review,sourceInfo,()=>iterable(records),stager,{afterCommit:async ordinal=>{if(ordinal===records.findIndex(r=>r.kind==='version')&&!interrupted){interrupted=true;throw Error('simulated lost reply');}}}),/lost reply/);
const restored=await executeAccountFileRestore(request(destination),review,sourceInfo,()=>iterable(records),stager);assert.equal(restored.replayed,false);
assert.equal(destinationRuntime.stats.putRequests,5,'one PUT for each of five distinct nonempty source attachments, including interrupted stages');
const restoredId=accountFileRestoreTargetId(review,fileId),live=(await call(destination,filesRoute.loader,'/api/v1/files?id='+restoredId)).file;
assert.equal(live.name,current.name);assert.equal(live.folderId,ordinaryRestoreTargetId(ordinary,right.shareId));assert.equal(live.content.fingerprint.sha256,current.content.fingerprint.sha256);
async function readBytes(id:string,version?:string,size?:number){
 if(version&&size!==0)await call(destination,content.action,'/api/v1/attachments/content',{versions:[{id,version}]});
 if(version&&size===0){const fp=await call(destination,content.loader,'/api/v1/attachments/content?'+new URLSearchParams({id,fingerprint:'1'}));assert.equal(fp.version,version);assert.equal(fp.size,0);}
 const params=new URLSearchParams({id,...(version&&size!==0?{range:'1',retained:'1',version,offset:'0',length:String(size)}:{})});
 const response=await content.loader({request:request(destination,'/api/v1/attachments/content?'+params)}as any);
 if(version&&size!==0){assert.equal(response.status,206);assert.equal(response.headers.get('ETag'),`"${version}"`);return new Uint8Array(await response.arrayBuffer());}
 assert.equal(response.status,302);const result=await handleLocalAttachmentStorageRequest(new Request(response.headers.get('location')!));assert.equal(result.status,200);return new Uint8Array(await result.arrayBuffer());
}
assert.deepEqual(await readBytes(live.content.attachmentId),currentBytes);
const imported:any[]=[];
for(const sourceId of sourceFileIds){const id=accountFileRestoreTargetId(review,sourceId);const page=await call(destination,timelineRoute.loader,'/api/v1/timeline?'+new URLSearchParams({ownerId:destination.user.id,dataPlane:'home',thingId:id}));imported.push(...(page.entries??page.page?.entries??[]).filter((r:any)=>r.event.source==='system'));}
assert.equal(imported.length,events.length);
for(const row of imported){for(const parent of row.event.parentIds)assert.ok(imported.some(r=>r.event.id===parent&&r.event.thingId===row.event.thingId));for(const s of[row.event.before,row.event.after])if(s?.adapter==='file-content'){const actual=await readBytes(s.value.content.attachmentId,s.value.content.version,s.value.content.size);assert.ok([oldBytes,currentBytes,conflictBytes,linkBytes,trashBytes,new Uint8Array(0)].some(expected=>Buffer.from(actual).equals(Buffer.from(expected))));}}
for(const sourceRow of events){
 const actual=imported.find(row=>row.event.id===accountFileRestoreHistoryId(review,sourceRow.event.id))?.event;assert.ok(actual);
 assert.equal(actual.thingId,accountFileRestoreTargetId(review,sourceRow.event.thingId));assert.equal(actual.branchId,accountFileRestoreBranchId(review,sourceRow.event.branchId));assert.deepEqual(actual.parentIds,sourceRow.event.parentIds.map(id=>accountFileRestoreHistoryId(review,id)));
 for(const field of ['occurredAt','mode','operation','label'])assert.equal(actual[field],sourceRow.event[field]);
 for(const side of ['before','after']){const saved=sourceRow.event[side],restored=actual[side];if(!saved){assert.equal(restored,null);continue;}assert.equal(restored.adapter,saved.adapter);
  const sourceFolder=saved.value.folderId??null,expectedFolder=sourceFolder===null?dest.rootId:ordinaryRestoreTargetId(ordinary,sourceFolder);assert.equal(restored.value.folderId,expectedFolder);
  if(saved.adapter==='file-content'){for(const field of ['name','trashed','symbolicLink'])assert.deepEqual(restored.value[field],saved.value[field]);assert.equal(restored.value.revision,accountFileRestoreHistoryId(review,saved.value.revision));assert.equal(restored.value.content.size,saved.value.content.size);assert.deepEqual(restored.value.content.fingerprint,saved.value.content.fingerprint);assert.notEqual(restored.value.content.attachmentId,saved.value.content.attachmentId);}
 }
}
for(const sourceId of sourceFileIds){
 const targetId=accountFileRestoreTargetId(review,sourceId),file=(await call(destination,filesRoute.loader,'/api/v1/files?id='+targetId)).file;
 const branches=await call(destination,timelineRoute.loader,'/api/v1/timeline?'+new URLSearchParams({ownerId:destination.user.id,dataPlane:'home',thingId:targetId,branches:'1'}));
 const rows=branches.branches;assert.ok(Array.isArray(rows));const attachment=await getThing(destination.user,file.content.attachmentId);assert.equal(attachment.ok,true);if(attachment.ok)assert.equal(attachment.thing.targetId,targetId);
 const finalRecord=records.find(r=>r.kind==='finalize-current'&&r.sourceId===sourceId)??records.find(r=>r.kind==='current'&&r.file.id===sourceId);
 assert.equal(file.revision,await fileCommitEventId(destination.user.id,targetId,accountFileRestoreCommandId(review,finalRecord)));
 assert.equal((await getCurrentUser(request(destination)))?.id,destination.user.id);const published=await getTimelineBranch(destination.user.id,'main',targetId);assert.equal(published?.head.eventId,file.revision);
 for(const record of records.filter(r=>r.kind==='branch'&&r.head.thingId===sourceId)){const row=rows.find(row=>row.branch.id===accountFileRestoreBranchId(review,record.branch.id));assert.ok(row);assert.equal(row.branch.name,record.branch.name);assert.equal(row.head.eventId,accountFileRestoreHistoryId(review,record.head.eventId));assert.equal(row.head.thingId,targetId);}
 const page=await call(destination,timelineRoute.loader,'/api/v1/timeline?'+new URLSearchParams({ownerId:destination.user.id,dataPlane:'home',thingId:targetId}));
 assert.equal(page.entries.filter(row=>row.event.label==='Retained restored file bytes').length,records.filter(r=>r.kind==='version'&&r.file.id===sourceId).length);
 assert.equal(new Set(page.entries.map(row=>row.event.id)).size,page.entries.length);
}
const restoredLink=(await call(destination,filesRoute.loader,'/api/v1/files?id='+accountFileRestoreTargetId(review,linkId))).file;assert.deepEqual(restoredLink.symbolicLink,symbolicLink);assert.deepEqual(await readBytes(restoredLink.content.attachmentId),linkBytes);
const restoredEmpty=(await call(destination,filesRoute.loader,'/api/v1/files?id='+accountFileRestoreTargetId(review,emptyId))).file;assert.equal(restoredEmpty.content.size,0);assert.equal((await readBytes(restoredEmpty.content.attachmentId)).length,0);
assert.ok(imported.some(r=>r.event.after?.value?.name==='old.txt'));assert.ok(imported.some(r=>r.event.after?.adapter==='managed-folder-placement'&&r.event.after.value.folderId===ordinaryRestoreTargetId(ordinary,right.shareId)));
const restoredTrashId=accountFileRestoreTargetId(review,trashId),restoredTrash=(await call(destination,filesRoute.loader,'/api/v1/files?id='+restoredTrashId)).file;assert.equal(restoredTrash.trashed,true);assert.equal(restoredTrash.folderId,ordinaryRestoreTargetId(ordinary,right.shareId));assert.deepEqual(await readBytes(restoredTrash.content.attachmentId,restoredTrash.content.version,restoredTrash.content.size),trashBytes);
const ownerUntrashed=(await call(destination,filesRoute.action,'/api/v1/files',{id:restoredTrashId,operationId:randomUUID(),expectedRevision:restoredTrash.revision,name:'owner-untrashed.txt',folderId:restoredTrash.folderId,attachmentId:restoredTrash.content.attachmentId,contentVersion:restoredTrash.content.version,trashed:false})).file;
// Closed subsets cannot silently discard a real archived parent/version.
const missing=records.filter(r=>!(r.kind==='history'&&r.event.id===events[0].event.id));
const missingReview={...review,operationId:randomUUID(),...await accountFileRestoreGraphHash(iterable(missing))};
let rejectedUploads=0;await assert.rejects(executeAccountFileRestore(request(destination),missingReview,sourceInfo,()=>iterable(missing),async()=>{rejectedUploads++;throw Error('must not stage');}),/parent|history|revision|version|branch/i);assert.equal(rejectedUploads,0);
async function prepareExtra(who:any,name:string){
 const root=await folder(who,name),d={...dest,scope:{...dest.scope,ownerId:who.user.id},rootId:root.shareId,rootRevision:root.timelineHeadId};
 const o={...ordinary,operationId:randomUUID(),destination:d};
 const rows=sourceFolders.map((f,i)=>{const{targetId:_target,...value}=snapshots[i].value as any;return{sourceId:f.shareId,input:{...value,shareId:ordinaryRestoreTargetId(o,f.shareId),folderId:f.folderId?ordinaryRestoreTargetId(o,f.folderId):d.rootId,acl:['tt:user']}};});
 Object.assign(o,await ordinaryRestoreGraphHash(iterable(rows)));const prior=await executeOrdinaryRestoreTransaction(request(who),o,()=>iterable(rows));
 const commands:any[]=[];for(const r of records){if(r.kind!=='folder'){commands.push(r);continue;}const target=ordinaryRestoreTargetId(o,r.sourceId),read=await getThing(who.user,target);assert.equal(read.ok,true);if(!read.ok)throw Error('Missing reused folder');commands.push({...r,targetId:target,targetRevision:(read.thing as any).timelineHeadId,priorBinding:hash(o),priorOperationId:o.operationId,priorCompletionEventId:prior.eventId});}
 const r={...review,operationId:randomUUID(),destination:d,...await accountFileRestoreGraphHash(iterable(commands))};
 return{review:r,commands,stager:createAccountFileRestoreStager(independent,snapshotId,access,transport(who,d.rootId))};
}
const race=await prepareExtra(destination,'Final epoch race');
const raceId=accountFileRestoreTargetId(race.review,fileId);
await assert.rejects(executeAccountFileRestore(request(destination),race.review,sourceInfo,()=>iterable(race.commands),race.stager,{beforeCompletion:async()=>{const file=(await call(destination,filesRoute.loader,'/api/v1/files?id='+raceId)).file;await call(destination,filesRoute.action,'/api/v1/files',{id:raceId,operationId:randomUUID(),expectedRevision:file.revision,name:'later-owner-edit.txt',folderId:file.folderId,attachmentId:file.content.attachmentId,contentVersion:file.content.version,trashed:false});}}),/changed during final verification/);
assert.equal((await call(destination,filesRoute.loader,'/api/v1/files?id='+raceId)).file.name,'later-owner-edit.txt');
const revoked=await signup();process.env.ADMIN_USERNAMES+=','+revoked.username;
const revokedRun=await prepareExtra(revoked,'Destination revocation race');
await assert.rejects(executeAccountFileRestore(request(revoked),revokedRun.review,sourceInfo,()=>iterable(revokedRun.commands),revokedRun.stager,{beforeCompletion:async()=>{await call(revoked,logout.action,'/api/v1/auth/logout',{});}}),/account|session/i);
assert.equal(await getCurrentUser(request(revoked)),null);
// A later owner edit survives immutable completed replay with no source vault.
const ownerEdit=(await call(destination,filesRoute.action,'/api/v1/files',{id:restoredId,operationId:randomUUID(),expectedRevision:live.revision,name:'owner-edited-after-completion.txt',folderId:live.folderId,attachmentId:live.content.attachmentId,contentVersion:live.content.version,trashed:false})).file;
await rm(join(directory!,'independent'),{recursive:true});
const replay=await executeAccountFileRestore(request(destination),review,sourceInfo,()=>{throw Error('must not open source');},()=>{throw Error('must not upload');});assert.equal(replay.replayed,true);assert.deepEqual((await call(destination,filesRoute.loader,'/api/v1/files?id='+restoredId)).file,ownerEdit);assert.deepEqual((await call(destination,filesRoute.loader,'/api/v1/files?id='+restoredTrashId)).file,ownerUntrashed);
console.log(JSON.stringify({accountFileRestoreProof:true,records:records.length,history:events.length,checks:['actual-normalized-links','canonical-upload-approval','copied-vault-source-bytes-loss','revoked-source-session','ordinary-folder-metadata','rename-move-shared-and-named-branches','inert-symlink-and-empty-file','reviewed-Trash-finalization-and-owner-untrash-preserved','private-import-invisibility-and-stage-resume','public-draft-consumption-refusal','canonical-attachment-binding-and-no-repeated-PUT','interrupted-reply-no-duplicates','exact-current-and-historical-bytes','no-source-completed-replay-preserves-later-edit','final-owner-edit-epoch-refusal','destination-session-revocation-refusal','complete-history-subset-refusal'],boundary:'isolated real Request handlers/replica/local object adapter, not live S3 or installed UI'}));process.exit(0);
