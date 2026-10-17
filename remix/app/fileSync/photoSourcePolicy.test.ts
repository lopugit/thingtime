import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';
import { newFileSyncConfiguration, parseFileSyncConfiguration } from './configuration';
import { parseMobileFolderResult, type MobileFolder } from './mobileFolders.client';
const root: MobileFolder = { id: '00000000-0000-4000-8000-000000000001', name: 'Photo library', sourceKind: 'photos', photoAccess: 'full' };
const config = () => newFileSyncConfiguration({ name: 'Photos', deviceId: 'device', localRootId: root.id, remoteFolderId: 'cloud', sourceKind: 'photos' });
const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://native.test' };
const parse = (r: object) => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...expected, roots: [r] } }, expected, { action: 'list' })!.roots;
test('photo intent remains ordinary editable configuration with paused backup defaults and retained cloud copies', () => {
 const c = config(); assert.equal(c.mode, 'backup'); assert.equal(c.paused, true); assert.equal(c.propagateDeletes, false);
 assert.deepEqual(parseFileSyncConfiguration(c), c);
 for (const patch of [{ mode: 'two-way' }, { mode: 'upload' }, { mode: 'download' }, { propagateDeletes: true }, { sourceKind: 'other' }]) assert.throws(() => parseFileSyncConfiguration({ ...c, ...patch }));
 const { sourceKind, ...legacy } = c; assert.equal(Object.prototype.hasOwnProperty.call(parseFileSyncConfiguration(legacy), 'sourceKind'), false);
});
test('native photo source metadata is closed and cannot also advertise publication', () => {
 for (const photoAccess of ['full', 'limited', 'unavailable'] as const) assert.deepEqual(parse({ ...root, photoAccess }), [{ ...root, photoAccess }]);
 for (const patch of [{ sourceKind: 'other' }, { photoAccess: undefined }, { photoAccess: 'all' }, { publicationVersion: '1.0.0' }, { sourceKind: undefined }]) assert.throws(() => parse({ ...root, ...patch }));
});
test('fresh native authority prevents forged intent, deletion policy, missing grants and permission loss', () => {
 const c = config(); assert.doesNotThrow(() => assertPhotoSourcePolicy(c, [root]));
 assert.doesNotThrow(() => assertPhotoSourcePolicy(c, [{ ...root, photoAccess: 'limited' }]));
 assert.throws(() => assertPhotoSourcePolicy(c, [{ ...root, photoAccess: 'unavailable' }]));
 assert.throws(() => assertPhotoSourcePolicy(c, []));
 assert.throws(() => assertPhotoSourcePolicy(c, [{ id: root.id, name: 'Folder' }]));
 // A manually edited Thing cannot relabel an actual photo library to allow destructive sync.
 for (const mode of ['upload', 'download', 'two-way'] as const) assert.throws(() => assertPhotoSourcePolicy({ ...c, sourceKind: 'folder', mode }, [root]));
 assert.throws(() => assertPhotoSourcePolicy({ ...c, sourceKind: undefined, propagateDeletes: true }, [root]));
});
