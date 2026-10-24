import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { WorkspaceDatabase } from './storage';
import { validateTransfer, serializeTransfer } from '../utils/thingTransfer/format';

const bundle = () => ({ format: 'thingtime.transfer', version: 1, roots: ['folder'], files: [], things: [
 { id: 'data', thingtime: ['data'], folderId: 'folder', crystal: { name: 'Imported data', schemaId: 'schema', note: 'Original' } },
 { id: 'page', thingtime: ['webpage'], folderId: 'folder', crystal: { name: 'Imported page', pageKey: 'site-global', siteRoute: '/ode', blocks: [{ id: 'card', type: 'component', component: 'component' }] } },
 { id: 'component', thingtime: ['component'], folderId: 'folder', crystal: { name: 'Imported card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Native import' } } },
 { id: 'schema', thingtime: ['schema'], folderId: 'folder', crystal: { name: 'Import schema', fields: [{ name: 'note', type: 'string' }] } },
 { id: 'folder', thingtime: ['folder'], crystal: { name: 'Imported folder' } }
] });
const setup = () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory), scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
 let active = true, time = Date.now();
 const lease = { assertCurrent() { if (!active) throw new Error('Workspace changed'); }, onInvalidate: () => () => {} };
 const sync = new AccountThingSync(db, scope, lease, () => time), remote = new Map<string, AccountThing>(), calls: any[] = [];
 const transport: AccountSyncTransport = {
  get: async id => { const row = remote.get(id); if (!row) throw { status: 404 }; return structuredClone(row); },
  write: async operation => {
   calls.push(structuredClone(operation)); const old = remote.get(operation.id);
   if (operation.method === 'create' && old) throw { status: 409 };
   if (operation.method === 'update' && old?.updatedAt !== operation.body.expectedUpdatedAt) throw { status: 409 };
   const schema = (operation.body.crystal as any).schemaId;
   for (const id of [operation.body.folderId, operation.body.targetId, schema]) if (id && !remote.has(id as string)) throw { status: 422 };
   const row = { ...operation.body, id: operation.id, author: { id: scope.ownerId }, createdAt: old?.createdAt || new Date(time).toISOString(), updatedAt: new Date(++time).toISOString(), revision: 1 } as AccountThing;
   remote.set(row.id, row); return row;
  }
 };
 return { db, factory, scope, lease, sync, remote, calls, transport, invalidate: () => { active = false; }, tick: () => { time += 120_000; } };
};
test('account imports atomically queue private independent copies and remap every dependency', async () => {
 const f = setup(); try {
  const source = bundle(), original = JSON.stringify(source), imported = await f.sync.things.import(source);
  assert.equal(JSON.stringify(source), original); assert.equal(f.calls.length, 0); assert.equal((await f.sync.status()).length, 5);
  assert.equal(new Set(Object.values(imported.idMap)).size, 5);
  for (const id of Object.values(imported.idMap)) assert.match(id, /^[0-9a-f-]{36}$/);
  const page = await f.sync.view(imported.idMap.page), schema = await f.sync.view(imported.idMap.schema), data = await f.sync.view(imported.idMap.data);
  assert.equal(page!.crystal.siteRoute, undefined); assert.notEqual(page!.crystal.pageKey, 'site-global');
  assert.equal((page!.crystal.blocks as any[])[0].component, imported.idMap.component);
  assert.notEqual(schema!.crystal.name, 'Import schema'); assert.equal(data!.crystal.schema, schema!.crystal.name); assert.equal(data!.crystal.schemaId, schema!.id);
  await f.sync.things.update({ id: data!.id, crystal: { note: 'Edited before sync' } });
  await f.sync.sync(f.transport);
  assert.equal(f.remote.size, 5); assert.ok((await f.sync.status()).every(row => row.state === 'synced'));
  assert.equal(f.remote.get(data!.id)!.crystal.note, 'Edited before sync');
  for (const row of f.remote.values()) { assert.deepEqual(row.acl, ['tt:user']); assert.equal(row.author.id, 'owner'); }
  const exported = await f.sync.things.export(imported.roots); validateTransfer(exported.manifest);
  assert.equal(exported.manifest.things.length, 5); assert.doesNotMatch(serializeTransfer(exported.manifest), /"author"|"visibility"|"revision"|"updatedAt"/);
  const second = await f.sync.things.import(exported.manifest); assert.equal(new Set([...imported.things, ...second.things].map(row => row.id)).size, 10);
  assert.notEqual((await f.sync.view(second.idMap[schema!.id]))!.crystal.name, schema!.crystal.name);
 } finally { await f.db.close(); }
});
test('an imported ambiguous create survives reopen and replays its exact request', async () => {
 const f = setup(); let reopened: WorkspaceDatabase | undefined;
 try {
  const imported = await f.sync.things.import(bundle());
  await f.sync.sync({ ...f.transport, get: async () => { throw new Error('Offline'); }, write: async op => { await f.transport.write(op, new AbortController().signal); throw new Error('Lost response'); } });
  const frozen = structuredClone(f.calls[0]); f.tick(); await f.db.close(); reopened = new WorkspaceDatabase(f.factory);
  const resumed = new AccountThingSync(reopened, f.scope, f.lease); await resumed.retry(frozen.id); await resumed.sync(f.transport);
  assert.deepEqual(f.calls[1], frozen); assert.equal(f.remote.size, imported.things.length); assert.ok((await resumed.status()).every(row => row.state === 'synced'));
 } finally { await (reopened || f.db).close(); }
});
test('account import places unparented dependencies in the selected destination like the normal importer', async () => {
 const f = setup(); try {
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Destination' } });
  const source = bundle(); source.things = source.things.filter(row => row.id !== 'folder'); source.roots = ['page', 'data'];
  for (const row of source.things) delete row.folderId;
  const imported = await f.sync.things.import(source, folder.id);
  for (const row of imported.things) assert.equal(row.folderId, folder.id);
 } finally { await f.db.close(); }
});
test('invalid and cancelled account imports leave neither content nor queue entries', async () => {
 const f = setup(); try {
  await assert.rejects(f.sync.things.import(bundle(), 'unknown-folder'), /not in this workspace/);
  const cyclic = bundle(); (cyclic.things[0] as any).targetId = 'data';
  await assert.rejects(f.sync.things.import(cyclic), /Circular/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.sync.things.import(bundle(), null, undefined, controller.signal));
  assert.deepEqual(await f.sync.things.snapshot(), []); assert.deepEqual(await f.sync.status(), []);
  f.invalidate(); await assert.rejects(f.sync.things.import(bundle()), /Workspace changed/);
 } finally { await f.db.close(); }
});
test('imports freeze caller content before async work and preserve executable Action cycles', async () => {
 const f = setup(); try {
  const source = bundle(), importing = f.sync.things.import(source); source.things[0].crystal.name = 'Changed after dispatch';
  const result = await importing; assert.equal((await f.sync.view(result.idMap.data))!.crystal.name, 'Imported data');
  const actions = ['a','b'].map((id, n) => ({ id, thingtime: ['action'], crystal: { name: id, actionKey: id, version: 1, capabilities: [{ capability: 'actions.invoke', actions: [n ? 'a' : 'b'] }], steps: [{ op: 'actions.invoke', action: n ? 'a' : 'b', inputs: {} }] } }));
  const copied = await f.sync.things.import({ format: 'thingtime.transfer', version: 1, roots: ['a'], files: [], things: actions });
  for (const [id, other] of [['a','b'],['b','a']]) {
   const row = (await f.sync.view(copied.idMap[id]))!; assert.equal((row.crystal.steps as any[])[0].action, copied.idMap[other]);
  }
  assert.equal(f.calls.length, 0, 'Importing Action definitions never executes them');
 } finally { await f.db.close(); }
});
