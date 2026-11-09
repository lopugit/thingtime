import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeviceFolders, deviceFolderIdentity, type DeviceFolderTransport } from './deviceFolders';
import { cloudFolderPaths } from './folderPaths';
const scope = { origin: 'https://thingtime.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'phone' };
const request = { deviceId: scope.deviceId, connectionId: 'connection-1', name: 'Photo Library' };
function fixture() {
 const rows = new Map<string, any>(), writes: any[] = [];
 let cancelled = false, lostReply = false;
 const api: DeviceFolderTransport = {
  assertCurrent() { if (cancelled) throw Error('Identity changed'); },
  async get(id) { const row = rows.get(id); if (!row) throw Object.assign(Error('Missing'), { status: 404 }); return structuredClone(row); },
  async create(input) {
   if (rows.has(input.shareId)) throw Object.assign(Error('Conflict'), { status: 409 });
   rows.set(input.shareId, { ...structuredClone(input), id: input.shareId, author: { id: scope.ownerId } }); writes.push(input);
   if (lostReply) throw Error('Lost reply');
  }
 };
 return { api, rows, writes, cancel() { cancelled = true; }, lose() { lostReply = true; } };
}
test('device root / Files / source label are normal folders with identity-based concurrent creation', async () => {
 const f = fixture(); f.lose();
 const [one, two] = await Promise.all([resolveDeviceFolders(scope, 'Test phone', request, f.api), resolveDeviceFolders(scope, 'Test phone', request, f.api)]);
 assert.deepEqual(one, two); assert.equal(f.writes.length, 3);
 assert.deepEqual(f.writes.map(row => row.crystal.name), ['Test phone', 'Files', 'Photo Library']);
 assert.deepEqual(f.writes.map(row => row.folderId), [null, f.writes[0].shareId, f.writes[1].shareId]);
 assert(f.writes.every(row => row.thingtime.length === 1 && row.thingtime[0] === 'folder' && JSON.stringify(row.acl) === '["tt:user"]'));
 assert.equal(one.folder.path, 'Test phone / Files / Photo Library');
 assert.deepEqual(await resolveDeviceFolders(scope, 'Test phone', request, f.api), one);
 assert.equal(f.writes.length, 3);
});
test('same names never merge different devices, origins, owners, planes or connections', async () => {
 const root = await deviceFolderIdentity(scope, 'root');
 for (const patch of [{ deviceId: 'other' }, { origin: 'https://other.test' }, { ownerId: 'other' }, { dataPlane: 'custom' }])
  assert.notEqual(await deviceFolderIdentity({ ...scope, ...patch }, 'root'), root);
 const f = fixture();
 const one = await resolveDeviceFolders(scope, 'Phone', request, f.api);
 const two = await resolveDeviceFolders(scope, 'Phone', { ...request, connectionId: 'another' }, f.api);
 assert.notEqual(one.folder.id, two.folder.id); assert.equal(one.rootFolderId, two.rootFolderId); assert.equal(f.writes.length, 4);
});
test('renaming never duplicates; moving child identities fails without moving or overwriting', async () => {
 const f = fixture(), first = await resolveDeviceFolders(scope, 'Phone', request, f.api);
 f.rows.get(first.rootFolderId).crystal.name = 'Renamed phone';
 f.rows.get(first.folder.id).crystal.name = 'Renamed library';
 assert.equal((await resolveDeviceFolders(scope, 'Another display name', request, f.api)).folder.path, 'Renamed phone / Files / Renamed library');
 f.rows.get(first.folder.id).folderId = 'moved';
 const before = structuredClone([...f.rows]);
 await assert.rejects(resolveDeviceFolders(scope, 'Phone', request, f.api), /moved or replaced/);
 assert.deepEqual([...f.rows], before); assert.equal(f.writes.length, 3);
});
test('deleted empty root is recovered at its original identity, never guessed by name', async () => {
 const f = fixture(), root = await resolveDeviceFolders(scope, 'Phone', { deviceId: scope.deviceId }, f.api);
 f.rows.delete(root.rootFolderId);
 const recovered = await resolveDeviceFolders(scope, 'New phone label', { deviceId: scope.deviceId }, f.api);
 assert.equal(recovered.rootFolderId, root.rootFolderId); assert.equal(f.rows.size, 1);
});
test('foreign/shared/replaced deterministic identities are refused', async () => {
 for (const patch of [{ author: { id: 'foreign' } }, { acl: ['tt:all'] }, { thingtime: ['folder', 'data'] }, { crystal: { name: 'Wrong identity' } }, { appId: 'app' }, { targetId: 'target' }]) {
  const f = fixture(), first = await resolveDeviceFolders(scope, 'Phone', request, f.api);
  Object.assign(f.rows.get(first.rootFolderId), patch);
  await assert.rejects(resolveDeviceFolders(scope, 'Phone', request, f.api)); assert.equal(f.writes.length, 3);
 }
});
test('existing display names retain ordinary folder semantics and cancellation stops writes', async () => {
 const f = fixture(); await resolveDeviceFolders(scope, 'Name / punctuation 🌈', request, f.api); assert.equal(f.writes[0].crystal.name, 'Name / punctuation 🌈');
 f.cancel(); await assert.rejects(resolveDeviceFolders(scope, 'Phone', request, f.api), /Identity/); assert.equal(f.writes.length, 3);
});
test('cloud picker reads real parent paths, excludes cycles/foreign ancestors and has no ID labels', async () => {
 const f = fixture(), destination = await resolveDeviceFolders(scope, 'Phone', request, f.api);
 const rows = [...f.rows.values()];
 const paths = await cloudFolderPaths([f.rows.get(destination.folder.id)], scope.ownerId, f.api.get);
 assert.equal(paths[0].path, 'Phone / Files / Photo Library');
 f.rows.get(destination.rootFolderId).folderId = destination.folder.id;
 assert.deepEqual(await cloudFolderPaths(rows, scope.ownerId, f.api.get), []);
});

test('path transport failures propagate and cancellation stops deeper reads', async () => {
 const f = fixture(), destination = await resolveDeviceFolders(scope, 'Phone', request, f.api), row = f.rows.get(destination.folder.id);
 await assert.rejects(cloudFolderPaths([row], scope.ownerId, async () => { throw Object.assign(Error('Offline'), { status: 503 }); }), /Offline/);
 let reads = 0, current = true;
 await assert.rejects(cloudFolderPaths([row], scope.ownerId, async id => { reads++; current = false; return f.api.get(id); }, () => { if (!current) throw Error('Cancelled'); }), /Cancelled/);
 assert.equal(reads, 1);
});
