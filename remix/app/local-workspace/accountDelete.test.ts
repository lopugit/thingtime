import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { randomUUID } from 'node:crypto';
import { AccountTimeline, AccountTimelineStore, accountTimelineScope } from './accountTimeline';
import { AccountTimelineVersions } from './accountTimelineVersions';
import { IndexedDbTimelineBackend } from '../timeline/indexedDb';
import type { VersionRequest } from '../timeline/publishedVersion';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { WorkspaceDatabase } from './storage';
const fixture = () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory);
 const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
 const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 let time = Date.now(); const remote = new Map<string, AccountThing>(), calls: any[] = [];
 const sync = new AccountThingSync(db, scope, lease, () => time);
 const transport: AccountSyncTransport = {
  get: async id => { const row = remote.get(id); if (!row) throw { status: 404 }; return structuredClone(row); },
  write: async operation => {
   calls.push(structuredClone(operation)); const old = remote.get(operation.id);
   if ((operation.method === 'create' && old) || (operation.method === 'update' && (!old || old.updatedAt !== operation.body.expectedUpdatedAt))) throw { status: 409 };
   const row = { ...operation.body, id: operation.id, author: { id: 'owner' }, createdAt: old?.createdAt || new Date(time).toISOString(), updatedAt: new Date(++time).toISOString(), revision: 1 } as AccountThing;
   remote.set(row.id, row); return row;
  },
  remove: async operation => {
   calls.push(structuredClone(operation)); const old = remote.get(operation.id);
   if (!old) throw { status: 404 }; if (old.updatedAt !== operation.body.expectedUpdatedAt) throw { status: 409 };
   remote.delete(operation.id);
  }
 };
 const create = (name = 'Delete fixture', kind = 'data', extra = {}) => sync.things.create({ thingtime: [kind], crystal: { name }, ...extra });
 return { factory, db, scope, lease, sync, remote, calls, transport, create, now: () => time, tick: () => { time += 120_000; } };
};
test('target-linked deletion waits for a conflicting child before removing its parent', async () => {
 const f = fixture(); try {
  const parent = await f.create('Parent'), child = await f.create('Linked child', 'data', { targetId: parent.id });
  await f.sync.sync(f.transport); f.calls.length = 0;
  await f.sync.remove([parent.id]); assert.equal(await f.sync.view(child.id), null);
  const remote = f.remote.get(child.id)!;
  f.remote.set(child.id, { ...remote, updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString() });
  await f.sync.sync(f.transport); await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.map(call => [call.method, call.id]), [['delete', child.id]]);
  assert.equal(f.remote.has(parent.id), true);
  const review = await f.sync.inspectConflict(f.transport, child.id);
  await f.sync.resolveConflict(f.transport, { id: child.id, keep: 'local', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.slice(1).map(call => [call.method, call.id]), [['delete', child.id], ['delete', parent.id]]);
 } finally { await f.db.close(); }
});
test('identity retirement fences a delayed delete acknowledgment', async () => {
 const f = fixture(); let active = true;
 f.lease.assertCurrent = () => { if (!active) throw new Error('Workspace changed'); };
 try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]);
  let finish!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  const run = f.sync.sync({ ...f.transport, remove: async operation => { await f.transport.remove!(operation, new AbortController().signal); started(); await held; } });
  await ready; active = false; finish(); await assert.rejects(run, /Workspace changed/);
  active = true;
  assert.equal((await f.sync.status())[0].state, 'syncing'); assert.equal(await f.sync.view(row.id), null);
  f.tick(); await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'synced');
 } finally { active = true; await f.db.close(); }
});
test('keeping a linked account version prevents its pending parent deletion from cascading it away', async () => {
 const f = fixture(); try {
  const parent = await f.create('Parent'), child = await f.create('Linked child', 'data', { targetId: parent.id });
  await f.sync.sync(f.transport); await f.sync.remove([parent.id]);
  const remote = f.remote.get(child.id)!;
  f.remote.set(child.id, { ...remote, updatedAt: new Date(Date.parse(remote.updatedAt) + 1).toISOString() });
  await f.sync.sync(f.transport);
  const review = await f.sync.inspectConflict(f.transport, child.id);
  await f.sync.resolveConflict(f.transport, { id: child.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport);
  assert.equal(f.remote.has(child.id), true); assert.equal(f.remote.has(parent.id), true);
  const parentStatus = (await f.sync.status()).find(row => row.id === parent.id)!;
  assert.equal(parentStatus.state, 'error'); assert.match(parentStatus.error!, /linked Thing/);
  await f.sync.remove([child.id]); await f.sync.retry(parent.id); await f.sync.sync(f.transport);
  assert.equal(f.remote.has(parent.id), false); assert.equal(f.remote.has(child.id), false);
 } finally { await f.db.close(); }
});
test('never-sent creates delete atomically without remote mutation or orphaned queue', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.remove([row.id]); await f.sync.sync(f.transport);
  assert.deepEqual(f.calls, []); assert.deepEqual(await f.sync.status(), []); assert.equal(await f.sync.view(row.id), null);
 } finally { await f.db.close(); }
});
test('deletion survives reload, lost responses and stale readback without resurrection', async () => {
 const f = fixture(); let reopened: WorkspaceDatabase | undefined;
 try {
  const row = await f.create(); await f.sync.sync(f.transport); const stale = structuredClone(f.remote.get(row.id)!);
  await f.sync.remove([row.id]); await f.sync.remember(stale); assert.equal(await f.sync.view(row.id), null);
  await f.sync.sync({ ...f.transport, get: async () => { throw new Error('offline'); }, remove: async op => { await f.transport.remove!(op, new AbortController().signal); throw new Error('lost'); } });
  const operation = structuredClone(f.calls.at(-1)); f.tick(); await f.db.close(); reopened = new WorkspaceDatabase(f.factory);
  const resumed = new AccountThingSync(reopened, f.scope, f.lease);
  await resumed.retry(row.id); await resumed.sync(f.transport);
  assert.deepEqual(f.calls.at(-1), operation); assert.equal((await resumed.status())[0].state, 'synced');
  await resumed.remember(stale); assert.equal(await resumed.view(row.id), null); assert.equal(await resumed.isDeleted(row.id), true);
 } finally { await (reopened || f.db).close(); }
});
for (const refused of [false, true]) test(`delete during in-flight create preserves intent (create refused: ${refused})`, async () => {
 const f = fixture(); try {
  const row = await f.create(); let finish!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), held = new Promise<void>(resolve => { finish = resolve; });
  const run = f.sync.sync({ ...f.transport, write: async op => { started(); await held; if (refused) throw { status: 422 }; return f.transport.write(op, new AbortController().signal); } });
  await ready; await f.sync.remove([row.id]); finish(); await run;
  if (refused) { await f.sync.retry(row.id); await f.sync.sync(f.transport); assert.deepEqual(f.calls, []); }
  else assert.deepEqual(f.calls.map(call => call.method), ['create', 'delete']);
  assert.equal(f.remote.has(row.id), false); assert.equal(await f.sync.view(row.id), null); assert.equal((await f.sync.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});
test('folder deletion drains children before removal and preserves nested content', async () => {
 const f = fixture(); try {
  const parent = await f.create('Parent', 'folder'), folder = await f.create('Folder', 'folder', { folderId: parent.id });
  const child = await f.create('Child', 'folder', { folderId: folder.id }), nested = await f.create('Nested', 'data', { folderId: child.id });
  await f.sync.sync(f.transport); f.calls.length = 0;
  await f.sync.remove([folder.id]); assert.equal((await f.sync.view(child.id))!.folderId, parent.id); assert.equal((await f.sync.view(nested.id))!.folderId, child.id);
  await f.sync.sync(f.transport); assert.deepEqual(f.calls.map(call => [call.method, call.id]), [['update', child.id], ['delete', folder.id]]);
  assert.equal(f.remote.get(child.id)!.folderId, parent.id); assert.equal(f.remote.has(nested.id), true);
 } finally { await f.db.close(); }
});
test('delete conflicts require review; keep-account restores and keep-local deletes only the reviewed version', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]);
  const changed = { ...f.remote.get(row.id)!, crystal: { name: 'Changed elsewhere' }, updatedAt: new Date(Date.now() + 10_000).toISOString() }; f.remote.set(row.id, changed);
  await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'conflict'); assert.equal(await f.sync.view(row.id), null);
  let review = await f.sync.inspectConflict(f.transport, row.id); assert.equal(review.deleted, true);
  await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  assert.equal((await f.sync.view(row.id))!.crystal.name, 'Changed elsewhere'); assert.equal(await f.sync.isDeleted(row.id), false);
  await f.sync.remove([row.id]); f.remote.set(row.id, { ...changed, updatedAt: new Date(Date.now() + 20_000).toISOString() }); await f.sync.sync(f.transport);
  review = await f.sync.inspectConflict(f.transport, row.id);
  await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'local', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport); assert.equal(f.remote.has(row.id), false); assert.equal(await f.sync.view(row.id), null);
  assert.equal(f.calls.at(-1).body.expectedUpdatedAt, review.remote.updatedAt);
 } finally { await f.db.close(); }
});
test('delete batches roll back on missing content and stale editor deletion is refused', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.sync(f.transport);
  await assert.rejects(f.sync.remove([row.id, 'missing']), /Open this Thing/); assert.ok(await f.sync.view(row.id));
  await f.sync.things.update({ id: row.id, crystal: { name: 'Newer' } });
  await assert.rejects(f.sync.remove([row.id], row.updatedAt), /changed/); assert.ok(await f.sync.view(row.id));
 } finally { await f.db.close(); }
});
test('delete claims serialize across tabs and permission refusals never become successful readback', async () => {
 const f = fixture(), secondDb = new WorkspaceDatabase(f.factory), second = new AccountThingSync(secondDb, f.scope, f.lease);
 try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]); f.calls.length = 0;
  let reads = 0;
  await f.sync.sync({ ...f.transport, remove: async () => { throw { status: 403 }; }, get: async () => { reads++; throw { status: 404 }; } });
  assert.equal(reads, 0); assert.equal((await f.sync.status())[0].state, 'error'); assert.equal(f.remote.has(row.id), true);
  await f.sync.retry(row.id); await Promise.all([f.sync.sync(f.transport), second.sync(f.transport)]);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'delete');
 } finally { await f.db.close(); await secondDb.close(); }
});
test('a deletion conflict can safely check again after another device already deleted it', async () => {
 const f = fixture(); try {
  const row = await f.create(); await f.sync.sync(f.transport); await f.sync.remove([row.id]);
  f.remote.set(row.id, { ...f.remote.get(row.id)!, updatedAt: new Date(Date.now() + 50_000).toISOString() });
  await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'conflict');
  f.remote.delete(row.id); await f.sync.retry(row.id); await f.sync.sync(f.transport);
  assert.equal((await f.sync.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});
test('large cached deletion keeps one bounded recovery copy and releases it after acknowledgement', async () => {
 const f = fixture(); try {
  const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Large', parts: Array.from({ length: 120 }, () => 'x'.repeat(5000)) } }); await f.sync.sync(f.transport);
  await f.sync.remove([row.id]); assert.equal(await f.sync.view(row.id), null);
  await f.sync.sync(f.transport);
  const retained = await f.db.transaction(f.scope, 'readonly', f.lease, tx => tx.get('thing-deletions', row.id));
  assert.equal(retained, undefined); assert.equal(await f.sync.isDeleted(row.id), true);
 } finally { await f.db.close(); }
});


async function recover(f:ReturnType<typeof fixture>, id:string, sync=f.sync, db=f.db) {
 const history=new AccountTimeline(db,f.scope,f.lease),backend=new IndexedDbTimelineBackend(f.factory);
 try {
  const store=new AccountTimelineStore(accountTimelineScope(f.scope),backend,history);
  const versions=new AccountTimelineVersions(db,f.scope,f.lease,sync.things,store);
  const deletion=(await history.rows({thingId:id})).find(row=>row.event.operation==='delete')!;
  const request:VersionRequest={command:'preview-version',eventId:deletion.event.id,mode:'restore',componentMode:'recorded',recover:true,choices:{},componentChoices:{}};
  const result=await versions.request(request);assert.ok('preview' in result);
  const applied=await versions.request({...request,command:'apply-version',operationId:randomUUID(),expectedHeadId:result.preview.expectedHeadId,expectedComponents:result.preview.components!.fingerprint,expectedRecovery:result.preview.recoveryFingerprint});
  assert.ok('entry' in applied);assert.equal(applied.entry.receipt,null);return applied;
 } finally { await backend.close(); }
}

for(const completed of [false,true]) test(`offline recovery of a ${completed?'completed':'not-yet-sent'} deletion syncs privately`,async()=>{
 const f=fixture();try{
  const row=await f.create('Recover private');await f.sync.sync(f.transport);
  const stale=structuredClone(f.remote.get(row.id)!);
  await f.sync.remove([row.id]);if(completed)await f.sync.sync(f.transport);
  const oldRevision=stale.revision;await recover(f,row.id);
  const restored=await f.sync.things.get(row.id);assert.ok(restored.revision>oldRevision);
  await f.sync.things.update({id:row.id,crystal:{name:'Recovered local edit'}});
  await f.sync.remember(stale);assert.equal((await f.sync.view(row.id))!.crystal.name,'Recovered local edit');
  f.calls.length=0;await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.map(call=>call.method),[completed?'create':'update']);
  assert.equal(f.remote.get(row.id)!.crystal.name,'Recovered local edit');
  assert.deepEqual(f.remote.get(row.id)!.acl,['tt:user']);
  assert.equal((await f.sync.status())[0].state,'synced');
 }finally{await f.db.close();}
});

for(const method of ['create','update','delete'] as const) test(`recovery survives a delayed ${method} acknowledgment without overwriting content or losing sync`,async()=>{
 const f=fixture();let finish!:()=>void;
 try{
  const row=await f.create('Original');
  if(method!=='create')await f.sync.sync(f.transport);
  if(method==='update')await f.sync.things.update({id:row.id,crystal:{name:'Earlier in-flight edit'}});
  if(method==='delete')await f.sync.remove([row.id]);
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{finish=resolve;});
  const transport:AccountSyncTransport={...f.transport,
   write:async(operation,signal)=>{const result=await f.transport.write(operation,signal);started();await held;return result;},
   remove:async(operation,signal)=>{await f.transport.remove!(operation,signal);started();await held;}
  };
  const run=f.sync.sync(transport,undefined,1);await ready;
  if(method!=='delete')await f.sync.remove([row.id]);
  await recover(f,row.id);
  const restored=await f.sync.things.get(row.id);assert.ok(restored.revision>f.calls.at(-1).version);
  await f.sync.things.update({id:row.id,crystal:{name:'Latest recovered edit'}});
  finish();await run;
  assert.equal((await f.sync.things.get(row.id)).crystal.name,'Latest recovered edit');
  assert.equal((await f.sync.status())[0].state,'pending');
  await f.sync.sync(f.transport);
  assert.equal(f.remote.get(row.id)!.crystal.name,'Latest recovered edit');
  assert.equal(f.calls.at(-1).method,method==='delete'?'create':'update');
  assert.equal((await f.sync.status())[0].state,'synced');
 }finally{finish?.();await f.db.close();}
});

test('recovery after a lost deletion response survives reopening and replays the exact frozen DELETE',async()=>{
 const f=fixture();let reopened:WorkspaceDatabase|undefined;
 try{
  const row=await f.create('Lost response');await f.sync.sync(f.transport);await f.sync.remove([row.id]);
  await f.sync.sync({...f.transport,get:async()=>{throw new Error('offline');},remove:async(op,signal)=>{await f.transport.remove!(op,signal);throw new Error('lost');}});
  const frozen=structuredClone(f.calls.at(-1));await recover(f,row.id);f.tick();await f.db.close();reopened=new WorkspaceDatabase(f.factory);
  const resumed=new AccountThingSync(reopened,f.scope,f.lease,f.now);await resumed.sync(f.transport);
  assert.deepEqual(f.calls.at(-2),frozen);assert.equal(f.calls.at(-1).method,'create');
  assert.equal((await resumed.view(row.id))!.crystal.name,'Lost response');assert.equal(f.remote.get(row.id)!.crystal.name,'Lost response');
  assert.equal((await resumed.status())[0].state,'synced');
 }finally{await(reopened||f.db).close();}
});


test('recovered content cannot overwrite a colliding account identity or bypass conditional deletion conflicts',async()=>{
 const f=fixture();try{
  const row=await f.create('Private recovery');await f.sync.sync(f.transport);await f.sync.remove([row.id]);await f.sync.sync(f.transport);
  await recover(f,row.id);
  const occupied={...row,crystal:{name:'Another owner'},author:{id:'different-owner'},acl:['tt:user'],visibility:'private'};
  f.remote.set(row.id,occupied);await f.sync.sync(f.transport);
  assert.equal((await f.sync.status())[0].state,'conflict');assert.equal(f.remote.get(row.id)!.crystal.name,'Another owner');
  assert.equal((await f.sync.things.get(row.id)).crystal.name,'Private recovery');
  await assert.rejects(f.sync.inspectConflict(f.transport,row.id),/does not belong/);
  const second=await f.create('Concurrent account edit');await f.sync.sync(f.transport);await f.sync.remove([second.id]);
  const remote=f.remote.get(second.id)!;f.remote.set(second.id,{...remote,crystal:{name:'Newer remote edit'},updatedAt:new Date(Date.parse(remote.updatedAt)+1).toISOString()});
  await f.sync.sync(f.transport);await recover(f,second.id);assert.equal((await f.sync.status()).find(item=>item.id===second.id)!.state,'conflict');
  await f.sync.sync(f.transport);assert.equal(f.remote.get(second.id)!.crystal.name,'Newer remote edit');
  const review=await f.sync.inspectConflict(f.transport,second.id);await f.sync.resolveConflict(f.transport,{id:second.id,keep:'local',localRevision:review.localRevision,remoteUpdatedAt:review.remote.updatedAt});
  await f.sync.sync(f.transport);assert.equal(f.remote.get(second.id)!.crystal.name,'Concurrent account edit');assert.equal(f.calls.at(-1).method,'update');
 }finally{await f.db.close();}
});

test('new linked content waits for the recovered parent frozen DELETE before syncing',async()=>{
 const f=fixture();let finish!:()=>void,run:ReturnType<AccountThingSync['sync']>|undefined;
 try{
  const parent=await f.create('Recovered parent');await f.sync.sync(f.transport);await f.sync.remove([parent.id]);
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{finish=resolve;});
  run=f.sync.sync({...f.transport,remove:async(operation,signal)=>{started();await held;await f.transport.remove!(operation,signal);}},undefined,1);await ready;
  await recover(f,parent.id);const child=await f.create('New linked child','data',{targetId:parent.id});
  const count=f.calls.length;assert.equal((await f.sync.sync(f.transport)).completed,0,'a new child cannot race the outstanding parent cascade');assert.equal(f.calls.length,count);
  finish();await run;await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.slice(count).map(call=>[call.method,call.id]),[['delete',parent.id],['create',parent.id],['create',child.id]]);
  assert.ok(f.remote.has(parent.id));assert.ok(f.remote.has(child.id));
 }finally{finish?.();await run?.catch(()=>{});await f.db.close();}
});
