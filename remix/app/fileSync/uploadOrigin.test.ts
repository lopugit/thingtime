import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileSyncUploadOrigin, sameFileSyncUploadOrigin, ownerFileSyncUploadOrigin } from './uploadOrigin';
const origin = { version: 1 as const, deviceId: 'device', localRootId: 'local-root', cloudRootId: 'cloud-root', fileId: 'file', folderId: 'folder', path: 'Icons/search.svg' };
test('closed provenance rejects absolute/traversal paths and invalid scope identifiers', () => {
  assert.deepEqual(parseFileSyncUploadOrigin(origin), origin);
  for (const change of [{ path: '/Users/private/search.svg' }, { path: '../search.svg' }, { path: 'C:/private/search.svg' }, { path: 'x\\search.svg' }, { localRootId: '/Users/private' }, { folderId: undefined }, { version: 2 }, { ownerId: 'spoof' }]) assert.throws(() => parseFileSyncUploadOrigin({ ...origin, ...change }));
  for (const change of [{ deviceId: 'other' }, { localRootId: 'other' }, { cloudRootId: 'other' }, { folderId: 'other' }, { path: 'Other/search.svg' }]) assert.equal(sameFileSyncUploadOrigin(origin, { ...origin, ...change }), false);
});
test('source provenance is an exact-owner projection, never public account data', () => {
  const doc = { ownerId: 'owner', attachmentFileSyncOrigin: origin };
  assert.deepEqual(ownerFileSyncUploadOrigin(doc, 'owner'), origin);
  assert.equal(ownerFileSyncUploadOrigin(doc, 'other'), undefined);
  assert.equal(ownerFileSyncUploadOrigin(doc, undefined), undefined);
  assert.equal(ownerFileSyncUploadOrigin({ ...doc, attachmentFileSyncOrigin: { path: '/private' } }, 'owner'), undefined);
});
