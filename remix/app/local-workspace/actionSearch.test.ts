import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalActions } from './actions';
import { localActionRequests, localActionRequestSupported } from './actionRequests';
import { AccountThingSync } from './accountSync';
import { LocalThings } from './things';
import { installLocalSuite } from './suites';
import { WorkspaceDatabase } from './storage';
import { validateTransfer } from '../utils/thingTransfer/format';
import { searchOwnerScope } from '../api/utils/things/searchGrammar';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
const scope = { kind: 'anonymous' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const step = (body: Record<string, unknown>) => ({ path: '/api/v1/things/search', method: 'POST', feature: 'api.things-search', minimumVersion: '1.4.0', query: {}, body, maxResultBytes: 65536 });
test('mine scope binds to the authenticated actor and negotiates the additive contract', () => {
 assert.deepEqual(searchOwnerScope(undefined), {}); assert.deepEqual(searchOwnerScope('visible', 'owner'), {});
 assert.deepEqual(searchOwnerScope('mine', 'owner'), { ownerId: 'owner' });
 assert.equal((searchOwnerScope('mine') as any).status, 401);
 for (const invalid of [null, '', 'all', 'other-owner', { ownerId: 'forged' }]) assert.equal((searchOwnerScope(invalid, 'owner') as any).status, 400);
 for (const version of ['1.3.0', '2.0.0', 'invalid']) assert.equal(capabilitySatisfies(version, '1.4.0'), false);
 assert.equal(capabilitySatisfies('1.4.1', '1.4.0'), true);
});
test('bundled tasks, todos, progress and cursor reads run offline through canonical interpreters', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease), actions = new LocalActions(db, scope, lease);
 const originalFetch = globalThis.fetch; let requests = 0;
 globalThis.fetch = async () => { requests++; throw Error('No network'); };
 try {
  const suite = await installLocalSuite(things, 'agent-tasks');
  const run = async (key: string, inputs = {}) => {
   assert.equal(await actions.canRunLocally(suite.actionIds[key]), true, key);
   const result = await actions.run({ action: suite.actionIds[key], inputs });
   assert.equal(result.status, 'ok', result.error); return result.result as any;
  };
  const ids = [];
  for (let i = 0; i < 22; i++) ids.push((await run('create-task', { title: `Device task ${i}`, description: 'Independent local record' })).id);
  const todo = await run('add-todo', { taskId: ids[0], title: 'Check native rendering' });
  await run('add-todo', { taskId: ids[1], title: 'Other task todo' });
  await run('add-progress', { taskId: ids[0], body: 'Retained offline' });
  await run('complete-todo', { todoId: todo.id });
  const first = await run('recent-tasks'), next = await run('recent-tasks', { cursor: first.nextCursor });
  assert.equal(first.tasks.length, 20); assert.equal(next.tasks.length, 2); assert.equal(next.nextCursor, null);
  assert.deepEqual(new Set([...first.tasks, ...next.tasks].map(row => row.id)), new Set(ids)); assert.equal(first.incomplete, false);
  const todos = await run('read-todo', { taskId: ids[0] });
  assert.equal(todos.records.length, 1); assert.equal(todos.records[0].id, todo.id); assert.equal(todos.records[0].crystal.done, true);
  assert.equal((await run('read-progress', { taskId: ids[0] })).records[0].crystal.body, 'Retained offline');
  const bundle = await things.export((await things.snapshot()).filter(row => !row.thingtime.includes('action-run')).map(row => row.id));
  validateTransfer(bundle.manifest);
  const targetDb = new WorkspaceDatabase(new IDBFactory());
  try {
   const target = new LocalThings(targetDb, scope, lease), imported = await target.import(bundle.manifest);
   const reopened = await new LocalActions(targetDb, scope, lease).run({ action: imported.idMap[suite.actionIds['recent-tasks']] });
   assert.equal(reopened.status, 'ok', reopened.error); assert.equal((reopened.result as any).tasks.length, 20);
  } finally { await targetDb.close(); }
  assert.equal(requests, 0);
 } finally { globalThis.fetch = originalFetch; await db.close(); }
});
test('local search refuses unsupported meaning, cursors, cancellation, identity and oversized results', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease); let active = true;
 const fence = { ...lease, assertCurrent() { if (!active) throw Error('Workspace changed'); } };
 const request = localActionRequests(db, scope, fence, async () => { throw Error('Not used'); });
 const invoke = (value: any, signal = new AbortController().signal) => request(value, 'local-workspace', signal) as Promise<any>;
 try {
  for (const body of [{}, {scope:'visible'}, {scope:'$input.scope'}, {scope:'mine',author:'someone'}, {scope:'mine',q:'word'}, {scope:'mine',sort:'relevance'}]) {
   assert.equal(localActionRequestSupported(step(body)), false); await assert.rejects(invoke(step(body)), /without a local adapter/);
  }
  await things.create({thingtime:['data'],crystal:{title:'First'}}); await things.create({thingtime:['data'],crystal:{title:'Second'}});
  const search = step({scope:'mine',thingtime:'data',limit:1}), first = await invoke(search);
  assert.equal(first.total,2); assert.equal(first.source,'device');
  await assert.rejects(invoke(step({...search.body,cursor:first.nextCursor,conditions:[{field:'title',op:'eq',value:'First'}]})),/cursor|filters/i);
  await assert.rejects(invoke(step({scope:'mine',conditions:[{field:'$where',op:'eq',value:1}]})),/segments|field/i);
  await assert.rejects(invoke({...search,maxResultBytes:1}),/byte budget/);
  await assert.rejects(invoke(search,AbortSignal.abort()),/abort/i);
  await assert.rejects(request(search,'other-owner',new AbortController().signal),/Workspace changed/);
  active=false; await assert.rejects(invoke(search),/Workspace changed/);
 } finally { await db.close(); }
});
test('account mine-search is scoped, explicitly incomplete and creates no sync write', async () => {
 const db = new WorkspaceDatabase(new IDBFactory()), account = {kind:'account',origin:'https://example.test',ownerId:'owner',dataPlane:'home'} as const;
 try {
  const sync = new AccountThingSync(db,account,lease), actions = new LocalActions(db,account,lease,sync);
  await new LocalThings(db,scope,lease).create({thingtime:['data'],crystal:{title:'Anonymous'}});
  await new AccountThingSync(db,{...account,ownerId:'another'},lease).things.create({thingtime:['data'],crystal:{title:'Other account'}});
  const data = await sync.things.create({thingtime:['data'],crystal:{title:'Retained account'}});
  const program = await sync.things.create({thingtime:['action'],crystal:{name:'Read my retained records',runtime:'browser',version:1,
   capabilities:[{capability:'http.request',endpoints:['POST /api/v1/things/search']}],steps:[{op:'http.request',...step({scope:'mine',thingtime:'data'})},{op:'return',value:'$step.1'}]}});
  const before = await sync.status(); assert.equal(await actions.canRunLocally(program.id),true);
  const outcome = await actions.run({action:program.id}); assert.equal(outcome.status,'ok',outcome.error);
  const result = outcome.result as any; assert.equal(result.incomplete,true); assert.deepEqual(result.things.map(row=>row.id),[data.id]);
  assert.deepEqual(await sync.status(),before);
 } finally { await db.close(); }
});
