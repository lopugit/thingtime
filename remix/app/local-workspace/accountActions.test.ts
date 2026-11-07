import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalActions } from './actions';
import { AccountThingSync, type AccountThing, type AccountSyncTransport } from './accountSync';
import { WorkspaceDatabase } from './storage';
import { LocalThings } from './things';
import { AccountTimeline } from './accountTimeline';
import { AccountThemeSync } from './accountThemes';
import { AccountFileSync } from './accountFiles';
const scope = {kind:'account',origin:'https://thingtime.example',ownerId:'owner',dataPlane:'home'} as const;
const definition = (steps: unknown[], capabilities: unknown[] = [], extra = {}) => ({thingtime:['action'],crystal:{name:'Account local Action',version:1,steps,capabilities,...extra}});
const fixture = () => {
 const db = new WorkspaceDatabase(new IDBFactory());let active=true;
 const callbacks=new Set<()=>void>();
 const lease={assertCurrent(){if(!active)throw new Error('Workspace changed');},onInvalidate(fn:()=>void){callbacks.add(fn);return()=>{callbacks.delete(fn);};}};
 const sync = new AccountThingSync(db,scope,lease), actions=new LocalActions(db,scope,lease,sync);
 const calls:any[]=[], remote=new Map<string,AccountThing>();let time=Date.now();
 const transport:AccountSyncTransport={
  get:async id=>{if(!remote.has(id))throw {status:404};return structuredClone(remote.get(id)!);},
  write:async operation=>{calls.push(structuredClone(operation));const row={...operation.body,id:operation.id,author:{id:scope.ownerId},createdAt:remote.get(operation.id)?.createdAt||new Date(time).toISOString(),updatedAt:new Date(++time).toISOString(),revision:1} as AccountThing;remote.set(row.id,row);return row;},
  remove:async operation=>{calls.push(structuredClone(operation));remote.delete(operation.id);}
 };
 return {db,lease,sync,actions,calls,remote,transport,invalidate(){active=false;callbacks.forEach(fn=>fn());}};
};
test('account Action effects commit with the existing queue and sync without executing the Action again',async()=>{
 const f=fixture();try{
  const schema=await f.sync.things.create({thingtime:['schema'],crystal:{name:'Local note',fields:[{name:'text',type:'string'}]}});
  const target=await f.sync.things.create({thingtime:['data'],crystal:{schemaId:schema.id,text:'Delete me'}});
  const action=await f.sync.things.create(definition([
   {op:'things.create',schema:schema.id,values:{text:'Created offline'}},
   {op:'things.update',id:'$step.1.id',values:{text:'Updated offline'}},
   {op:'things.delete',id:target.id},
   {op:'things.get',id:'$step.1.id'}, {op:'return',value:'$step.4'}
  ],['things.create','things.update','things.delete','things.read'].map(capability=>({capability}))));
  await f.sync.sync(f.transport);f.calls.length=0;
  assert.equal(await f.actions.canRunLocally(action.id),true);
  const result=await f.actions.run({action:action.id});assert.equal(result.status,'ok',result.error);
  const data=result.result as any;assert.equal(data.crystal.text,'Updated offline');assert.equal((await f.sync.view(data.id))?.author.id,scope.ownerId);
  assert.equal(f.calls.length,0);assert.equal((await f.sync.status()).find(row=>row.id===data.id)?.state,'pending');
  assert.ok((await new AccountTimeline(f.db,scope,f.lease).rows({thingId:data.id})).length>0);
  assert.equal((await f.actions.runs({action:action.id})).runs.length,1);
  await f.sync.sync(f.transport);await f.sync.sync(f.transport);
  assert.equal(f.remote.get(data.id)?.crystal.text,'Updated offline');assert.equal(f.remote.has(target.id),false);
  assert.equal(f.calls.filter(call=>call.id===data.id).length,1,'sync sends content, never replays interpreter');
  assert.equal(f.calls.some(call=>call.id===result.runId),false,'device history has no forged server receipt');
  await assert.rejects(f.sync.remove([result.runId]),/dedicated deletion/);
  await f.sync.remove([action.id]);assert.equal((await f.actions.runs()).runs.length,0);
 }finally{await f.db.close();}
});
test('account browser and nested data Actions use the same queued adapter',async()=>{
 const f=fixture();try{
  const schema=await f.sync.things.create({thingtime:['schema'],crystal:{name:'offline-note',fields:[{name:'name',type:'string'}]}});
  const child=await f.sync.things.create(definition([{op:'things.create',schema:schema.id,values:{name:'Nested data'}},{op:'return',value:'$step.1.id'}],[{capability:'things.create'}]));
  const browser=await f.sync.things.create(definition([
   {op:'http.request',method:'POST',path:'/api/v1/actions/run',feature:'api.actions-run',minimumVersion:'1.10.0',body:{action:child.id}},
   {op:'http.request',method:'PATCH',path:'/api/v1/things',feature:'api.things',minimumVersion:'1.33.0',body:{id:'$step.1.result',crystal:{name:'Browser updated'}}},
   {op:'return',value:'$step.1.result'}
  ],[{capability:'http.request',endpoints:['POST /api/v1/actions/run','PATCH /api/v1/things']}],{runtime:'browser'}));
  assert.equal(await f.actions.canRunLocally(browser.id),true);
  const result=await f.actions.run({action:browser.id});assert.equal(result.status,'ok',result.error);
  assert.equal((await f.sync.things.get(result.result as string)).crystal.name,'Browser updated');
  assert.equal((await f.sync.status()).find(row=>row.id===result.result)?.state,'pending');assert.equal(f.calls.length,0);
 }finally{await f.db.close();}
});
test('account browser bulk operations retain per-item results and queue ordinary mutations without replay',async()=>{
 const f=fixture();try{
  const folder=await f.sync.things.create({thingtime:['folder'],crystal:{name:'Offline destination'}});
  const moved=await f.sync.things.create({thingtime:['data'],crystal:{name:'Move offline'}});
  const deleted=await f.sync.things.create({thingtime:['data'],crystal:{name:'Delete offline'}});
  const bulk=(body:unknown)=>({op:'http.request',method:'POST',path:'/api/v1/things/bulk',feature:'api.things-bulk',minimumVersion:'1.6.0',body});
  const action=await f.sync.things.create(definition([
   bulk({op:'move',ids:[moved.id],folderId:folder.id}),
   bulk({op:'delete',ids:[deleted.id,'foreign']}),
   {op:'return',value:'$step.2'}
  ],[{capability:'http.request',endpoints:['POST /api/v1/things/bulk']}],{runtime:'browser'}));
  await f.sync.sync(f.transport);f.calls.length=0;
  assert.equal(await f.actions.canRunLocally(action.id),true);
  const result=await f.actions.run({action:action.id});assert.equal(result.status,'ok',result.error);
  assert.equal((result.result as any).succeeded,1);assert.equal((result.result as any).failed,1);
  assert.equal((await f.sync.things.get(moved.id)).folderId,folder.id);
  assert.equal((await f.sync.status()).find(row=>row.id===moved.id)?.state,'pending');
  assert.equal(await f.sync.isDeleted(deleted.id),true);assert.equal(f.calls.length,0);
  await f.sync.sync(f.transport);await f.sync.sync(f.transport);
  assert.equal(f.remote.get(moved.id)?.folderId,folder.id);assert.equal(f.remote.has(deleted.id),false);
  assert.equal(f.calls.filter(call=>call.id===moved.id).length,1);assert.equal(f.calls.filter(call=>call.id===deleted.id).length,1);
  assert.equal((await f.actions.runs({action:action.id})).runs.length,1);
 }finally{await f.db.close();}
});
test('remote-only dependencies are classified before effects; later local failures retain completed effects',async()=>{
 const f=fixture();try{
  const remote=await f.sync.things.create(definition([{op:'http.request',method:'GET',path:'/api/v1/vault',feature:'api.vault',minimumVersion:'1.0.0'}],[{capability:'http.request',endpoints:['GET /api/v1/vault']}],{runtime:'browser'}));
  const sharedRead=await f.sync.things.create(definition([{op:'http.request',method:'GET',path:'/api/v1/things',feature:'api.things',minimumVersion:'1.33.0',query:{id:'foreign',sharedRoot:'shared-page'}}],[{capability:'http.request',endpoints:['GET /api/v1/things']}],{runtime:'browser'}));
  assert.equal(await f.actions.canRunLocally(sharedRead.id),false,'shared access retains the authorized remote adapter');
  const root=await f.sync.things.create(definition([{op:'compute',value:true},{op:'actions.invoke',action:remote.id}],[{capability:'actions.invoke',actions:[remote.id]}],{runtime:'browser'}));
  assert.equal(await f.actions.canRunLocally(root.id),false);assert.equal(await f.actions.canRunLocally('not-retained'),false);
  const schema=await f.sync.things.create({thingtime:['schema'],crystal:{name:'partial-note',fields:[{name:'name',type:'string'}]}});
  const failing=await f.sync.things.create(definition([{op:'things.create',schema:schema.id,values:{name:'Survives later failure'}},{op:'fail',message:'Stop here'}],[{capability:'things.create'}]));
  const result=await f.actions.run({action:failing.id});assert.equal(result.status,'error');assert.match(result.error!,/Stop here/);
  const data=(await f.sync.things.snapshot()).find(row=>row.crystal.name==='Survives later failure')!;
  assert.ok(data);assert.equal((await f.sync.status()).find(row=>row.id===data.id)?.state,'pending');assert.equal(f.calls.length,0);
 }finally{await f.db.close();}
});

test('account browser bulk copy uses complete device closures and queues independent effects once', async () => {
 const f = fixture(); try {
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Copy source' } });
  const child = await f.sync.things.create({ thingtime: ['data'], folderId: folder.id, crystal: { name: 'Independent child' } });
  const action = await f.sync.things.create(definition([
   { op: 'http.request', method: 'POST', path: '/api/v1/things/bulk', feature: 'api.things-bulk', minimumVersion: '1.6.0', body: { op: 'copy', ids: [folder.id, 'foreign'] } },
   { op: 'return', value: '$step.1' }
  ], [{ capability: 'http.request', endpoints: ['POST /api/v1/things/bulk'] }], { runtime: 'browser' }));
  assert.equal(await f.actions.canRunLocally(action.id), true);
  const result = await f.actions.run({ action: action.id }); assert.equal(result.status, 'ok', result.error);
  const copy = result.result as any; assert.equal(copy.succeeded, 1); assert.equal(copy.failed, 1);
  const copiedFolder = copy.results[0].newId;
  const copiedChild = (await f.sync.things.snapshot()).find(row => row.folderId === copiedFolder)!;
  assert.notEqual(copiedChild.id, child.id); assert.equal(copiedChild.crystal.name, 'Independent child');
  assert.equal(f.calls.length, 0);
  await f.sync.sync(f.transport); await f.sync.sync(f.transport);
  for (const id of [copiedFolder, copiedChild.id]) {
   assert.equal(f.calls.filter(call => call.id === id).length, 1);
   assert.deepEqual(f.remote.get(id)?.acl, ['tt:user']);
  }
  assert.equal((await f.actions.runs({ action: action.id })).runs.length, 1);
  const remoteFolder: AccountThing = { id: 'incomplete-folder', thingtime: ['folder'], crystal: { name: 'Partial cache' }, author: { id: scope.ownerId }, acl: ['tt:user'], visibility: 'private', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1 };
  await f.sync.remember(remoteFolder);
  const incomplete = await f.sync.things.create(definition([
   { op: 'http.request', method: 'POST', path: '/api/v1/things/bulk', feature: 'api.things-bulk', minimumVersion: '1.6.0', body: { op: 'copy', ids: [remoteFolder.id] } },
   { op: 'return', value: '$step.1' }
  ], [{ capability: 'http.request', endpoints: ['POST /api/v1/things/bulk'] }], { runtime: 'browser' }));
  const refused = await f.actions.run({ action: incomplete.id });
  assert.equal((refused.result as any).failed, 1); assert.match((refused.result as any).results[0].error, /Complete export content/);
 } finally { await f.db.close(); }
});
test('account Action adapter preserves account, anonymous, cancellation and identity boundaries',async()=>{
 const f=fixture();try{
  const action=await f.sync.things.create(definition([{op:'return',value:true}]));
  await assert.rejects(new LocalActions(f.db,scope,f.lease).run({action:action.id}),/matching sync adapter/);
  await assert.rejects(new LocalActions(f.db,{...scope,ownerId:'someone-else'},f.lease,f.sync).run({action:action.id}),/matching sync adapter/);
  await assert.rejects(new LocalActions(f.db,{kind:'anonymous'},f.lease,f.sync).run({action:action.id}),/never use an account adapter/);
  const anonymous=new LocalThings(f.db,{kind:'anonymous'},f.lease);assert.equal((await anonymous.snapshot()).length,0);
  let cancelled=false;
  const scoped=f.sync.withLease({assertCurrent(){if(cancelled)throw new Error('Cancelled');},onInvalidate:()=>()=>{}});
  cancelled=true;await assert.rejects(scoped.things.create({thingtime:['data'],crystal:{}}),/Cancelled/);
  f.invalidate();await assert.rejects(f.actions.run({action:action.id}),/Workspace changed/);
 }finally{await f.db.close();}
});

test('account Action folder copy never silently omits dedicated theme or file children', async () => {
 const f = fixture(); try {
  const themes = new AccountThemeSync(f.db, scope, f.lease), files = new AccountFileSync(f.db, scope, f.lease);
  const sync = new AccountThingSync(f.db, scope, f.lease, undefined, undefined, files.contentHooks, themes);
  for (const kind of ['theme', 'file']) {
   const folder = await sync.things.create({ thingtime: ['folder'], crystal: { name: `Contains ${kind}` } });
   if (kind === 'theme') {
    const { theme } = await themes.save({ name: 'Protected child', theme: {} });
    await sync.things.move([theme.id], folder.id);
   } else await files.things.saveFile({ requestId: crypto.randomUUID(), name: 'child.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('Never drop this file'), folderId: folder.id });
   const action = await sync.things.create(definition([
    { op: 'http.request', method: 'POST', path: '/api/v1/things/bulk', feature: 'api.things-bulk', minimumVersion: '1.6.0', body: { op: 'copy', ids: [folder.id] } },
    { op: 'return', value: '$step.1' }
   ], [{ capability: 'http.request', endpoints: ['POST /api/v1/things/bulk'] }], { runtime: 'browser' }));
   const before = (await sync.things.snapshot()).filter(row => !row.thingtime.includes('action-run')).map(row => row.id).sort();
   const outcome = await new LocalActions(f.db, scope, f.lease, sync).run({ action: action.id });
   assert.equal(outcome.status, 'ok', outcome.error);
   assert.equal((outcome.result as any).failed, 1);
   assert.match((outcome.result as any).results[0].error, /dedicated export adapter/);
   assert.deepEqual((await sync.things.snapshot()).filter(row => !row.thingtime.includes('action-run')).map(row => row.id).sort(), before);
   assert.equal(f.calls.length, 0);
  }
 } finally { await f.db.close(); }
});
