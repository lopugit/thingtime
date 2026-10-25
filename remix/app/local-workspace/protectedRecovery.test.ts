import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceScope, type WorkspaceLease } from './storage';
import { LocalThemes } from './themes';
import { LocalAlgorithms } from './algorithms';
import { LocalThings } from './things';
import { LocalTimeline } from './timeline';
import { LocalTimelineVersions } from './timelineVersions';
import { AccountThemeSync } from './accountThemes';
import { AccountAlgorithmSync } from './accountAlgorithms';
import { AccountThingSync } from './accountSync';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import { themeVersionWriter } from './themeVersions';
import { algorithmVersionWriter } from './algorithmVersions';
import { parsePublishedVersionPreview, type VersionRequest } from '../timeline/publishedVersion';
import { protectedRecoveryContent, recoveredProtectedRow } from './protectedRecovery';

const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
async function fixture(kind: 'theme' | 'feed-algorithm', account = false) {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), backend = new IndexedDbTimelineBackend(factory);
 const scope: WorkspaceScope = account ? {kind:'account',ownerId:'protected-owner',origin:'https://protected.test',dataPlane:'home'} : {kind:'anonymous'};
 const themeSync = scope.kind === 'account' ? new AccountThemeSync(db,scope,lease) : undefined;
 const algorithmSync = scope.kind === 'account' ? new AccountAlgorithmSync(db,scope,lease) : undefined;
 const themes = themeSync?.themes ?? new LocalThemes(db,lease), algorithms = algorithmSync?.algorithms ?? new LocalAlgorithms(db,lease);
 const things = scope.kind === 'account' ? new AccountThingSync(db,scope,lease,undefined,undefined,undefined,themeSync,algorithmSync).things : new LocalThings(db,scope,lease);
 const history = scope.kind === 'account' ? new AccountTimeline(db,scope,lease) : new LocalTimeline(db,lease,'https://protected.test');
 const writers=[themeVersionWriter(themes,themeSync),algorithmVersionWriter(algorithms,!!algorithmSync)];
 const versions=scope.kind==='account' ? new AccountTimelineVersions(db,scope,lease,things,new AccountTimelineStore(accountTimelineScope(scope),backend,history as AccountTimeline),writers) : new LocalTimelineVersions(db,lease,things,undefined,writers);
 const saved = kind==='theme' ? (await (themeSync ?? themes).save({name:'Original',theme:{colors:{accent:'#775533'}}})).theme : (await algorithms.create({name:'Original'})).algorithm;
 const row = () => db.transaction(scope,'readonly',lease,tx=>tx.get<any>('things',saved.id));
 const rows = () => history instanceof AccountTimeline ? history.rows({thingId:saved.id}) : history.page({thingId:saved.id,before:null,after:null,limit:40}).then(result=>result.entries);
 const head = async () => { const id=await db.transaction(scope,'readonly',lease,tx=>tx.get<string>('timeline-meta',`head:${saved.id}`)); return (await rows()).find(row=>row.event.id===id)!.event; };
 const sync = kind==='theme'?themeSync:algorithmSync;
 const acknowledge = async () => { if(sync)await sync.sync({snapshot:async()=>[],write:async(command:any)=>({id:command.id,writeId:command.writeId,action:command.action,expectedVersion:command.expectedVersion,resultVersion:command.action==='delete'?null:(kind==='theme'?'theme-state-v1:':'algorithm-state-v1:')+'1'.repeat(64)})} as any); };
 const remove = () => kind==='theme'?themes.remove(saved.id):algorithms.remove(saved.id);
 const preview = async (eventId:string) => {
  const request:VersionRequest={command:'preview-version',mode:'restore',eventId,recover:true,componentMode:'current',componentChoices:{},choices:{}};
  const result=await versions.request(request);assert.ok('preview' in result);
  const checked=parsePublishedVersionPreview(result.preview,eventId,saved.id,request);
  return {preview:checked,apply:{...request,command:'apply-version',operationId:randomUUID(),expectedHeadId:checked.expectedHeadId,expectedComponents:checked.components!.fingerprint,...(checked.recovery ? {expectedRecovery:checked.recoveryFingerprint} : {})} as VersionRequest};
 };
 return {db,scope,themes,algorithms,things,versions,saved,row,rows,head,acknowledge,remove,preview,writers,close:async()=>{await backend.close();await db.close();}};
}

for(const kind of ['theme','feed-algorithm'] as const)for(const account of [false,true])test(`${account?'account':'anonymous'} ${kind} deletion recovery keeps identity, private intent and retry/redo history`,async t=>{
 const f=await fixture(kind,account);t.after(f.close);
 await f.acknowledge();
 const original=await f.head();
 if(kind==='theme')await f.themes.setActive(f.saved.id);else await f.algorithms.setActive(f.saved.id);
 await f.things.renameLibrary({id:f.saved.id,displayTitle:'Retained title'});
 const folder=await f.things.create({thingtime:['folder'],crystal:{name:'Looks'}});
 await f.things.move([f.saved.id],folder.id);
 if(kind==='theme')await f.themes.save({id:f.saved.id,name:'Deleted design',theme:{colors:{accent:'#553377'}}});else await f.algorithms.update({id:f.saved.id,name:'Deleted design'});
 await f.remove();const deletion=await f.head();
 if(account)await assert.rejects(f.preview(deletion.id),/acknowledged/);
 await f.acknowledge();
 const p=await f.preview(deletion.id);
 const invalid=structuredClone(p.preview);invalid.thingtime=['user'];
 assert.throws(()=>parsePublishedVersionPreview(invalid,deletion.id,f.saved.id,{command:'preview-version',mode:'restore',eventId:deletion.id,recover:true,componentMode:'current'}),/exact dedicated schema/);
 assert.equal(p.preview.current,null);assert.equal(p.preview.result.adapter,kind==='theme'?'theme-content':'algorithm-content');
 if(kind==='theme')assert.equal((p.preview.result.value as any).visibility,'private');
 const recovered=await f.versions.request(p.apply);
 assert.equal((await f.row()).id,f.saved.id);assert.equal((await f.row()).crystal.name,'Deleted design');assert.equal((await f.row()).crystal.title,'Retained title');assert.equal((await f.row()).folderId,folder.id);
 assert.equal(kind==='theme'?(await f.themes.list()).activeThemeId:(await f.algorithms.list()).activeAlgorithmId,null);
 assert.deepEqual(await f.versions.request(p.apply),recovered);
 const event=(await f.head());assert.equal(event.operation,'create');assert.ok(event.parentIds.includes(deletion.id));
 if(account){assert.equal((recovered as any).entry.receipt,null);assert.equal(event.mode,'draft');}
 // Recovery is a normal dedicated edit. Restoring another design and restoring
 // the recovered design again retain the original immutable deletion.
 const old=await f.preview(original.id);await f.versions.request(old.apply);assert.equal((await f.row()).crystal.name,'Original');
 const redo=await f.preview(event.id);await f.versions.request(redo.apply);
 assert.equal((await f.row()).crystal.name,'Deleted design');assert.ok((await f.rows()).some(row=>row.event.id===deletion.id));
 await assert.rejects(f.things.update({id:f.saved.id,crystal:{name:'Bypass'}}),/dedicated/);
});

for(const kind of ['theme','feed-algorithm'] as const)test(`${kind} recovery rechecks account tombstone and in-flight intent inside commit`,async t=>{
 const f=await fixture(kind,true);t.after(f.close);await f.acknowledge();await f.remove();await f.acknowledge();
 const p=await f.preview((await f.head()).id),collection=kind==='theme'?'account-theme-sync':'account-algorithm-sync';
 const prior=await f.db.transaction(f.scope,'readonly',lease,tx=>tx.get<any>(collection,f.saved.id));
 await f.db.transaction(f.scope,'readwrite',lease,tx=>tx.put(collection,f.saved.id,{...prior,claim:{token:'other-writer',expiresAt:Date.now()+60_000}}));
 await assert.rejects(f.versions.request(p.apply),/acknowledged/);assert.equal(await f.row(),undefined);
 await f.db.transaction(f.scope,'readwrite',lease,tx=>tx.put(collection,f.saved.id,prior));
 await f.versions.request(p.apply);assert.ok(await f.row());
});

for(const kind of ['theme','feed-algorithm'] as const)test(`${kind} recovery refuses occupied IDs, mismatched schemas and workspace scopes`,async t=>{
 const f=await fixture(kind);t.after(f.close);await f.remove();const p=await f.preview((await f.head()).id);
 await f.db.transaction(f.scope,'readwrite',lease,tx=>tx.put('things',f.saved.id,{id:f.saved.id,thingtime:['user'],crystal:{secret:'untouched'},createdAt:'',updatedAt:'',revision:1}));
 await assert.rejects(f.versions.request(p.apply),/not available|already present|changed/);assert.deepEqual((await f.row()).crystal,{secret:'untouched'});
 await f.db.transaction(f.scope,'readwrite',lease,tx=>tx.delete('things',f.saved.id));
 const mismatched={...f.writers[kind==='theme'?0:1],scope:{kind:'account',ownerId:'foreign',origin:'https://foreign.test',dataPlane:'home'} as const};
 await assert.rejects(new LocalTimelineVersions(f.db,lease,f.things,undefined,[mismatched]).request({command:'preview-version',mode:'restore',eventId:p.apply.eventId,recover:true,componentMode:'current',componentChoices:{},choices:{}}),/another workspace/);
 assert.throws(()=>protectedRecoveryContent(p.preview.result,kind==='theme'?'feed-algorithm':'theme'),/Invalid/);
 await f.db.transaction(f.scope,'readwrite',lease,async tx=>{
  await assert.rejects(recoveredProtectedRow(tx,f.scope,'foreign-id',{crystal:(p.preview.result.value as any).crystal},kind,new Date().toISOString()),/recorded deletion/);
 });
});


for(const kind of ['theme','feed-algorithm'] as const)for(const account of [false,true])test(`${account?'account':'anonymous'} ${kind} recovery rolls content, queue and history back on storage failure`,async t=>{
 const f=await fixture(kind,account);t.after(f.close);await f.acknowledge();await f.remove();await f.acknowledge();
 const plan=await f.preview((await f.head()).id),before=await f.rows();
 const collection=kind==='theme'?'account-theme-sync':'account-algorithm-sync';
 const state=await f.db.transaction(f.scope,'readonly',lease,tx=>tx.get(collection,f.saved.id));
 const transaction=f.db.transaction.bind(f.db);
 f.db.transaction=((scope,mode,lease,run)=>transaction(scope,mode,lease,tx=>run({...tx,put:async(collection,id,value)=>{
  if(collection==='timeline-events')throw Error('Recovery History quota');return tx.put(collection,id,value);
 }}))) as typeof f.db.transaction;
 await assert.rejects(f.versions.request(plan.apply),/Recovery History quota/);assert.equal(await f.row(),undefined);
 assert.deepEqual(await f.rows(),before);assert.deepEqual(await f.db.transaction(f.scope,'readonly',lease,tx=>tx.get(collection,f.saved.id)),state);
 f.db.transaction=transaction;await f.versions.request(plan.apply);assert.ok(await f.row());
});
