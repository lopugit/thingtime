import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountThingSync, type AccountThing } from './accountSync';
import { exportAccountThings } from './accountExport';
import { AccountDiscussionCache } from './accountDiscussions';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { WorkspaceDatabase } from './storage';
import { serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';

const setup = () => {
 const db = new WorkspaceDatabase(new IDBFactory(),undefined,undefined,IDBKeyRange), scope = { kind: 'account', ownerId: 'owner', origin: 'https://thingtime.example', dataPlane: 'home' } as const;
 let live = true, online = false;
 const lease = { assertCurrent() { if (!live) throw new Error('Workspace changed'); }, onInvalidate: () => () => {} };
 const sync = new AccountThingSync(db, scope, lease);
 const calls: any[] = [];
 const deps = { sync, db, lease, canRefresh: () => online, remote: (async (args: any) => { calls.push(args); throw new Error('Unexpected remote export'); }) as any };
 return { ...deps, deps, calls, enable: () => { online = true; }, retire: () => { live = false; } };
};
const row = (id: string, kind: string, crystal: any, folderId?: string): AccountThing => ({ id, thingtime: [kind], crystal, ...(folderId ? { folderId } : {}), createdAt: '2026-10-16T01:00:00.000Z', updatedAt: '2026-10-16T01:00:00.000Z', revision: 1, author: { id: 'owner' }, acl: ['tt:user'], visibility: 'private' });
const portable = (thing: AccountThing) => ({ id: thing.id, thingtime: thing.thingtime, crystal: thing.crystal, ...(thing.folderId ? { folderId: thing.folderId } : {}) });
const manifest = (plan: any) => validateTransfer({ format: 'thingtime.transfer', version: 1, roots:plan.roots,things:plan.things,files:plan.files });

test('new account content exports canonical offline dependencies without sync or account authority', async () => {
 const f = setup(); try {
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Offline bundle' } });
  const component = await f.sync.things.create({ thingtime: ['component'], crystal: { name: 'Card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Original' } } });
  const page = await f.sync.things.create({ thingtime: ['webpage'], folderId: folder.id, crystal: { name: 'Page', blocks: [{ id: 'card', type: 'component', component: 'card' }] } });
  const result = await exportAccountThings({ ids: [folder.id] }, f.deps);
  assert.equal(result.localWorkspace, true); assert.equal(result.retainedOnDevice, true); assert.equal(f.calls.length, 0);
  const first = manifest(result.plan); assert.equal(first.things.length, 3); assert.equal((first.things.find(t => t.id === page.id)!.crystal.blocks as any[])[0].component, component.id);
  assert.doesNotMatch(serializeTransfer(first), /"author"|"acl"|"revision"|"updatedAt"/);
  // The successful device closure still exports after ordinary sync acknowledges it.
  await f.sync.sync({ get: async () => { throw { status: 404 }; }, write: async op => row(op.id, (op.body.thingtime as string[])[0], op.body.crystal, op.body.folderId as string) });
  await f.sync.things.update({ id: component.id, crystal: { render: { tag: 'p', children: 'Edited offline' } } });
  const after = await exportAccountThings({ ids: [folder.id] }, f.deps);
  assert.equal(after.plan.things.find((t: any) => t.id === component.id).crystal.render.children, 'Edited offline'); assert.equal(f.calls.length, 0);
 } finally { await f.db.close(); }
});

test('partial folder caches require a complete server plan and preserve local changes on subsequent offline downloads', async () => {
 const f = setup(); try {
  const folder = row('folder', 'folder', { name: 'Server folder' }), first = row('first', 'data', { name: 'Cached first page' }, folder.id), last = row('last', 'data', { name: 'Unseen second page' }, folder.id);
  await f.sync.remember(folder); await f.sync.remember(first);
  await assert.rejects(exportAccountThings({ ids: [folder.id] }, f.deps), /Complete export content/);
  await f.sync.things.update({ id: first.id, crystal: { name: 'Device edit' } });
  f.enable(); f.deps.remote = async (args: any) => { f.calls.push(args); return { ok: true, plan: { roots: args.ids, things: [folder, first, last].map(portable), files: [] } }; };
  const result = await exportAccountThings({ ids: [folder.id] }, f.deps);
  assert.equal(result.plan.things.length, 3); assert.equal(result.plan.things.find((t: any) => t.id === first.id).crystal.name, 'Device edit'); assert.equal(f.calls.length, 1);
  f.deps.canRefresh = () => false;
  await f.sync.remove([first.id]);
  const added = await f.sync.things.create({ thingtime: ['data'], folderId: folder.id, crystal: { name: 'New local child' } });
  const result2 = await exportAccountThings({ ids: [folder.id] }, f.deps);
  assert.deepEqual(new Set(result2.plan.things.map((t: any) => t.id)), new Set([folder.id, last.id, added.id])); assert.equal(f.calls.length, 1);
  // The server-only dependency is retained only as export content, not forged
  // into an owned editable Thing or a queued mutation.
  assert.equal(await f.sync.view(last.id), null);
  await assert.rejects(exportAccountThings({ ids: [folder.id], includeChildren: false }, f.deps), /Complete export content/);
 } finally { await f.db.close(); }
});

test('fresh server export content outranks unchanged stale cache and option scopes never widen', async () => {
 const f = setup(); try {
  const old = row('note', 'data', { name: 'Old' }); await f.sync.remember(old); f.enable();
  f.deps.remote = async (args: any) => ({ ok: true, plan: { roots: args.ids, things: [portable({ ...old, crystal: { name: 'New on server' } })], files: [] } });
  assert.equal((await exportAccountThings({ ids: [old.id] }, f.deps)).plan.things[0].crystal.name, 'New on server');
  f.deps.canRefresh = () => false;
  assert.equal((await exportAccountThings({ ids: [old.id] }, f.deps)).plan.things[0].crystal.name, 'New on server');
  await f.sync.things.update({ id: old.id, crystal: { name: 'Latest device edit' } });
  assert.equal((await exportAccountThings({ ids: [old.id] }, f.deps)).plan.things[0].crystal.name, 'Latest device edit');
 } finally { await f.db.close(); }
});

test('export refuses missing dependencies, invalid options, cancellation and identity changes without retaining partial snapshots', async () => {
 const f = setup(); try {
  const page = await f.sync.things.create({ thingtime: ['webpage'], crystal: { name: 'Missing', blocks: [{ id: 'card', type: 'component', component: 'not-saved' }] } });
  await assert.rejects(exportAccountThings({ ids: [page.id] }, f.deps), /Missing component/);
  await assert.rejects(exportAccountThings({ ids: [page.id], ownerId: 'other' } as any, f.deps), /valid Thing/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(exportAccountThings({ ids: [page.id] }, f.deps, controller.signal));
  const remoteRow = row('remote', 'data', { name: 'Remote' }); await f.sync.remember(remoteRow); f.enable();
  f.deps.remote = async () => { f.retire(); return { ok: true, plan: { roots: [remoteRow.id], things: [portable(remoteRow)], files: [] } }; };
  await assert.rejects(exportAccountThings({ ids: [remoteRow.id] }, f.deps), /Workspace changed/);
  assert.deepEqual(await f.db.transaction(f.sync.scope, 'readonly', { assertCurrent() {}, onInvalidate: () => () => {} }, tx => tx.list('thing-export-snapshots')), []);
 } finally { await f.db.close(); }
});

test('dedicated online exports remain available but cannot erase pending device edits', async () => {
 const f = setup(); try {
  const item = row('note', 'data', { name: 'Media owner' }); await f.sync.remember(item); f.enable();
  const remotePlan = { ok: true, plan: { roots: [item.id], things: [portable(item)], files: [{ id: 'file' }] } };
  f.deps.remote = async () => remotePlan;
  assert.equal(await exportAccountThings({ ids: [item.id] }, f.deps), remotePlan);
  await f.sync.things.update({ id: item.id, crystal: { name: 'Pending edit' } });
  await assert.rejects(exportAccountThings({ ids: [item.id] }, f.deps), /Sync your device edits/);
  assert.equal((await f.sync.view(item.id))!.crystal.name, 'Pending edit');
 } finally { await f.db.close(); }
});


test('export remains available when retaining its snapshot would exceed the record quota', async () => {
 const f = setup(); try {
  const roots = [];
  for (let i = 0; i < 220; i++) roots.push((await f.sync.things.create({ thingtime: ['data'], crystal: { name: `Large ${i}`, text: 'x'.repeat(4900) } })).id);
  const result = await exportAccountThings({ ids: roots }, f.deps);
  assert.equal(result.retainedOnDevice, false); assert.equal(result.plan.things.length, 220);
  assert.ok(serializeTransfer(manifest(result.plan)).length > 1024 * 1024);
 } finally { await f.db.close(); }
});

test('export-only dependencies cannot capture an owner-local component alias', async () => {
 const f = setup(); try {
  const page = row('page', 'webpage', { name: 'Page', blocks: [{ id: 'card', type: 'component', component: 'foreign-card' }] });
  const foreign = row('foreign-card', 'component', { name: 'Shared card', componentKey: 'card', version: 99, render: { tag: 'p', children: 'Foreign content' } });
  await f.sync.remember(page); f.enable();
  f.deps.remote = async (args: any) => ({ ok: true, plan: { roots: args.ids, things: [page, foreign].map(portable), files: [] } });
  await exportAccountThings({ ids: [page.id] }, f.deps);
  const own = await f.sync.things.create({ thingtime: ['component'], crystal: { name: 'My card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Owner content' } } });
  await f.sync.things.update({ id: page.id, crystal: { blocks: [{ id: 'card', type: 'component', component: 'card' }] } });
  f.deps.canRefresh = () => false;
  const result = await exportAccountThings({ ids: [page.id] }, f.deps);
  assert.equal(result.plan.things.find((row: any) => row.id === page.id).crystal.blocks[0].component, own.id);
  assert.equal(result.plan.things.some((row: any) => row.id === foreign.id), false);
 } finally { await f.db.close(); }
});


test('multi-root preparation refuses conflicting saved dependency contexts', async () => {
 const f = setup(); try {
  const first = row('first', 'webpage', { name: 'First', blocks: [{ id: 'card', type: 'component', component: 'shared' }] });
  const second = row('second', 'webpage', { name: 'Second', blocks: [{ id: 'card', type: 'component', component: 'shared' }] });
  await f.sync.remember(first); await f.sync.remember(second); f.enable();
  f.deps.remote = async (args: any) => ({ ok: true, plan: { roots: args.ids, files: [], things: [portable(args.ids[0] === first.id ? first : second),
   portable(row('shared', 'component', { name: 'Shared', componentKey: 'shared', version: 1, render: { tag: 'p', children: args.ids[0] } }))] } });
  await assert.rejects(exportAccountThings({ ids: [first.id, second.id] }, f.deps), /conflicting saved contexts/);
  assert.deepEqual(await f.db.transaction(f.sync.scope, 'readonly', f.lease, tx => tx.list('thing-export-snapshots')), []);
 } finally { await f.db.close(); }
});


test('known read refusals remove complete export snapshots and invalidate prepared JSON plans',async()=>{
 const f=setup();try{
  const post=row('post','post',{type:'text',text:'Private original'});await f.sync.remember(post);f.enable();
  f.deps.remote=async()=>({ok:true,plan:{roots:[post.id],things:[portable(post)],files:[]}});
  const prepared=await exportAccountThings({ids:[post.id]},f.deps);
  await new AccountDiscussionCache(f.db,f.sync.scope,f.lease).forget(post.id,Date.now());
  assert.equal(await f.sync.view(post.id),null);
  assert.deepEqual(await f.db.transaction(f.sync.scope,'readonly',f.lease,tx=>tx.list('thing-export-snapshots')),[]);
  f.deps.canRefresh=()=>false;
  await assert.rejects(exportAccountThings({ids:[post.id]},f.deps));
  await assert.rejects(bundleFromPlan(prepared.plan),/no longer available/);
 }finally{await f.db.close();}
});

test('refused export-only dependencies invalidate every affected closure but preserve pending authored work',async()=>{
 const f=setup();try{
  const page=row('page','webpage',{name:'Original page',blocks:[{id:'card',type:'component',component:'foreign'}]});
  const foreign=row('foreign','component',{name:'Foreign',componentKey:'foreign',version:1,render:{tag:'p',children:'Private source'}});
  await f.sync.remember(page);f.enable();f.deps.remote=async()=>({ok:true,plan:{roots:[page.id],things:[page,foreign].map(portable),files:[]}});
  const first=await exportAccountThings({ids:[page.id]},f.deps);
  await f.sync.things.update({id:page.id,crystal:{name:'My pending edit'}});
  const second=await exportAccountThings({ids:[page.id],includeChildren:false},f.deps);
  await new AccountDiscussionCache(f.db,f.sync.scope,f.lease).forget(foreign.id);
  assert.equal((await f.sync.view(page.id))!.crystal.name,'My pending edit');
  assert.deepEqual(await f.db.transaction(f.sync.scope,'readonly',f.lease,tx=>tx.list('thing-export-snapshots')),[]);
  for(const result of [first,second])await assert.rejects(bundleFromPlan(result.plan),/no longer available/);
 }finally{await f.db.close();}
});

test('a refusal during an authorized export read cannot resurrect the snapshot; fresh reauthorization can export again',async()=>{
 const f=setup();try{
  const post=row('post','post',{type:'text',text:'Private original'});await f.sync.remember(post);f.enable();
  const cache=new AccountDiscussionCache(f.db,f.sync.scope,f.lease),stamp=Date.now()+10;
  const response={ok:true,plan:{roots:[post.id],things:[portable(post)],files:[]}};
  f.deps.remote=async()=>{await cache.forget(post.id,stamp);return response;};
  await assert.rejects(exportAccountThings({ids:[post.id]},f.deps),/no longer available/);
  assert.deepEqual(await f.db.transaction(f.sync.scope,'readonly',f.lease,tx=>tx.list('thing-export-snapshots')),[]);
  await f.sync.remember(post,stamp+1);f.deps.remote=async()=>response;
  const fresh=await exportAccountThings({ids:[post.id]},f.deps);assert.equal(fresh.plan.things[0].id,post.id);
  f.deps.canRefresh=()=>false;assert.equal((await exportAccountThings({ids:[post.id]},f.deps)).plan.things[0].id,post.id);
  await cache.forget(post.id,stamp+2);await assert.rejects(bundleFromPlan(fresh.plan),/no longer available/);
 }finally{await f.db.close();}
});

test('legacy export snapshots cannot bypass a refusal retained before this client version',async()=>{
 const f=setup();try{
  const post=row('post','post',{type:'text',text:'Private original'});await f.sync.remember(post);f.enable();
  f.deps.remote=async()=>({ok:true,plan:{roots:[post.id],things:[portable(post)],files:[]}});
  await exportAccountThings({ids:[post.id]},f.deps);
  const saved=await f.db.transaction(f.sync.scope,'readonly',f.lease,tx=>tx.list<any>('thing-export-snapshots'));
  await new AccountDiscussionCache(f.db,f.sync.scope,f.lease).forget(post.id);
  await f.db.transaction(f.sync.scope,'readwrite',f.lease,async tx=>{const {refusals,...legacy}=saved[0].value;await tx.put('thing-export-snapshots',saved[0].id,legacy);});
  f.deps.canRefresh=()=>false;await assert.rejects(exportAccountThings({ids:[post.id]},f.deps),/no longer available/);
 }finally{await f.db.close();}
});
