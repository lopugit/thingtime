import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { StorageMutationError } from '../storage/storageCore';
let docs: any[] = [], history = 0, charged = 0, limit = Infinity;
const session = { fixture: 'isolated-unit-transaction' };
const col = {
  countDocuments() { throw new Error('Creation must not consult an arbitrary count gate'); },
  async insertOne(doc: any, options: any) { assert.equal(options.session, session); docs.push(doc); },
  find() { throw new Error('No profile author lookup is needed for empty fixture weights'); }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getHomeThingsCollection: async () => col,
  getThemesCollection: async () => col,
  getFeedAlgorithmsCollection: async () => col,
  getUsersCollection: async () => col,
  withHomeMongoTransaction: async (fn: any) => fn(session)
} });
mock.module(new URL('../storage/userStorage.ts', import.meta.url).href, { namedExports: {
  applyUserStorageDelta: async (ownerId: string, bytes: number, actualSession: any) => {
    assert.equal(actualSession, session); assert.equal(ownerId, 'owner'); assert.ok(bytes > 0);
    if (charged + bytes > limit) throw new StorageMutationError(413, 'quota_exceeded', 'Storage quota exceeded');
    charged += bytes;
  },
  markUserStorageNeedsReconcile: async () => {}, readyUserStorageMatch: () => ({})
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: {
  clearUserActiveTheme: async () => {}, clearUserActiveFeedAlgorithm: async () => {}, setUserActiveFeedAlgorithm: async () => {}
} });
mock.module(new URL('../things/things.ts', import.meta.url).href, { namedExports: { getPostFeatures: async () => [] } });
mock.module(new URL('../timeline/recordMutation.ts', import.meta.url).href, { namedExports: { newThingMutationCapture: () => ({ fixture: true }) } });
mock.module(new URL('../timeline/themeContent.ts', import.meta.url).href, { namedExports: {
  recordThemeMutation: async (_things: any, before: any, after: any, _capture: any, actualSession: any) => {
    assert.equal(before, null); assert.ok(after); assert.equal(actualSession, session); history++;
  }
} });
const { saveTheme } = await import('./themes');
const { createAlgorithm } = await import('../algorithms/algorithms');
(['themes', 'algorithms'] as const).forEach(family => test(`${family}: concurrent creation exceeds former count gate with canonical byte admission`, async () => {
  docs = []; history = 0; charged = 0; limit = Infinity;
  let boundaries = 0;
  const boundary = { beforeWrite: async (_before: any, _legacy: any, actualSession: any) => { assert.equal(actualSession, session); boundaries++; } };
  const count = family === 'themes' ? 105 : 55;
  const results = await Promise.all(Array.from({ length: count }, (_, index) => family === 'themes'
    ? saveTheme('owner', { name: 'Capacity fixture ' + index, theme: {}, visibility: 'private' }, boundary)
    : createAlgorithm('owner', { name: 'Capacity fixture ' + index }, undefined, boundary)));
  assert.ok(results.every(result => result.ok)); assert.equal(docs.length, count); assert.equal(boundaries, count);
  assert.equal(new Set(docs.map(doc => doc.shareId)).size, count);
  assert.equal(history, family === 'themes' ? count : 0);
  assert.ok(charged > 0); assert.ok(docs.every(doc => doc.ownerId === 'owner' && doc.storageClass === 'content' && doc.sizeBytes > 0));
  const before = { count: docs.length, history, charged };
  limit = charged;
  const denied = family === 'themes' ? await saveTheme('owner', { name: 'Denied', theme: {} }) : await createAlgorithm('owner', { name: 'Denied' });
  assert.deepEqual(denied, { ok: false, status: 413, error: 'Storage quota exceeded' });
  assert.deepEqual({ count: docs.length, history, charged }, before);
}));
