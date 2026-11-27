import test from 'node:test';
import assert from 'node:assert/strict';
import { newFileSyncConfiguration } from './configuration';
import { readOwnedFileSyncConfiguration } from './configuredPlan';
import { prepareExplicitSyncStart, type ExplicitSyncStartTransport } from './configurationStart';
const scope = { origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'phone' };
function fixture() {
 const make = (id: string) => ({ id, author: { id: scope.ownerId }, thingtime: ['file-sync'], acl: ['tt:user'], updatedAt: '2026-11-01T00:00:00Z', crystal: newFileSyncConfiguration({ name: id, deviceId: scope.deviceId, localRootId: 'photo-grant', remoteFolderId: 'cloud', sourceKind: 'photos' }) });
 const rows = new Map([['photos', make('photos')], ['Home', make('Home')]]), drafts = new Set<string>();
 let active = true, gets = 0; const updates: any[] = [];
 const api: ExplicitSyncStartTransport = {
  assertCurrent() { if (!active) throw Error('Account, origin or database changed'); }, hasDraft: id => drafts.has(id),
  async get(id) { gets++; return structuredClone(rows.get(id)); },
  async update(id, configuration, expectedUpdatedAt) {
   const row = rows.get(id)!; assert.equal(row.updatedAt, expectedUpdatedAt); updates.push({ id, configuration: structuredClone(configuration), expectedUpdatedAt });
   row.crystal = structuredClone(configuration); row.updatedAt = '2026-11-02T00:00:00Z'; return structuredClone(row);
  }
 };
 return { rows, drafts, api, updates, requested: readOwnedFileSyncConfiguration(rows.get('photos'), scope.ownerId), deactivate() { active = false; }, gets: () => gets };
}
test('explicit Start CAS-unpauses only its exact saved connection and preserves unrelated Home/draft bytes', async () => {
 const f = fixture(), before = structuredClone(f.rows.get('Home')); f.drafts.add('Home');
 const result = await prepareExplicitSyncStart(f.requested, scope, f.api);
 assert.equal(result.configuration.paused, false); assert.equal(f.updates.length, 1); assert.equal(f.updates[0].id, 'photos');
 assert.deepEqual(result.configuration, { ...f.requested.configuration, paused: false });
 assert.deepEqual(f.rows.get('Home'), before); assert.deepEqual([...f.drafts], ['Home']);
 assert.equal(result.updatedAt, '2026-11-02T00:00:00Z'); assert.equal(f.gets(), 2);
});
test('already runnable settings need a fresh read but no pause write', async () => {
 const f = fixture(); f.rows.get('photos')!.crystal.paused = false;
 const requested = readOwnedFileSyncConfiguration(f.rows.get('photos'), scope.ownerId);
 assert.equal((await prepareExplicitSyncStart(requested, scope, f.api)).configuration.paused, false); assert.equal(f.updates.length, 0);
});
test('CAS refusal and uncertain acknowledgement never produce an admitted start configuration or blind retry', async () => {
 for (const status of [409, 503]) {
  const f = fixture(); let writes = 0;
  f.api.update = async (id, configuration) => { writes++; if (status === 503) { f.rows.get(id)!.crystal = configuration; f.rows.get(id)!.updatedAt = '2026-11-03T00:00:00Z'; } throw Object.assign(Error('transport'), { status }); };
  await assert.rejects(prepareExplicitSyncStart(f.requested, scope, f.api), /No transfer was started/);
  assert.equal(writes, 1); assert.equal(f.rows.get('Home')!.crystal.paused, true);
  if (status === 503) { await assert.rejects(prepareExplicitSyncStart(f.requested, scope, f.api), /changed elsewhere/); assert.equal(writes, 1); }
 }
});
test('stale settings, retained selected draft and drafts arriving during a read refuse pause writes', async () => {
 const stale = fixture(); stale.rows.get('photos')!.updatedAt = '2026-11-03T00:00:00Z';
 await assert.rejects(prepareExplicitSyncStart(stale.requested, scope, stale.api), /changed elsewhere/); assert.equal(stale.updates.length, 0);
 const draft = fixture(); draft.drafts.add('photos');
 await assert.rejects(prepareExplicitSyncStart(draft.requested, scope, draft.api), /draft/); assert.equal(draft.gets(), 0);
 const arriving = fixture(), get = arriving.api.get;
 arriving.api.get = async id => { const row = await get(id); arriving.drafts.add(id); return row; };
 await assert.rejects(prepareExplicitSyncStart(arriving.requested, scope, arriving.api), /draft/); assert.equal(arriving.updates.length, 0);
});
test('identity changes before CAS and after successful save fence later admission', async () => {
 const before = fixture(), get = before.api.get;
 before.api.get = async id => { const row = await get(id); before.deactivate(); return row; };
 await assert.rejects(prepareExplicitSyncStart(before.requested, scope, before.api), /changed/); assert.equal(before.updates.length, 0);
 const after = fixture(), update = after.api.update;
 after.api.update = async (...args) => { const row = await update(...args); after.deactivate(); return row; };
 await assert.rejects(prepareExplicitSyncStart(after.requested, scope, after.api), /changed/);
 assert.equal(after.updates.length, 1); assert.equal(after.rows.get('Home')!.crystal.paused, true);
});
test('foreign responses or later concurrent settings cannot substitute a different resume result', async () => {
 const foreign = fixture(); foreign.rows.get('photos')!.author.id = 'foreign';
 await assert.rejects(prepareExplicitSyncStart(foreign.requested, scope, foreign.api)); assert.equal(foreign.updates.length, 0);
 const raced = fixture(), update = raced.api.update;
 raced.api.update = async (...args) => { const response = await update(...args); raced.rows.get('photos')!.updatedAt = '2026-11-04T00:00:00Z'; return response; };
 await assert.rejects(prepareExplicitSyncStart(raced.requested, scope, raced.api), /changed after resuming/);
});
