import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSubspaceViewPrefs, readSubspaceViewPrefs, subspaceViewPrefsKey } from './subspaceViewPrefs';

test('view preferences isolate every viewer, data plane, origin and subspace', () => {
  const scope = { origin: 'https://thingtime.test', dataPlane: 'test', viewerId: 'viewer-a', subspaceId: 'space-a' };
  const keys = [scope, { ...scope, origin: 'https://other.test' }, { ...scope, dataPlane: 'other' }, { ...scope, viewerId: 'viewer-b' }, { ...scope, viewerId: null }, { ...scope, subspaceId: 'space-b' }].map(subspaceViewPrefsKey);
  assert.equal(new Set(keys).size, keys.length);
  const saved = new Map([[keys[0], JSON.stringify({ mode: 'messages', expandComments: true })]]);
  const storage = { getItem: (key: string) => saved.get(key) || null };
  assert.deepEqual(readSubspaceViewPrefs(storage, keys[0]), { mode: 'messages', expandComments: true });
  for (const key of keys.slice(1)) assert.deepEqual(readSubspaceViewPrefs(storage, key), { mode: 'posts', expandComments: false });
});
test('corrupt, blocked and legacy values keep the normal post view', () => {
  assert.deepEqual(normalizeSubspaceViewPrefs({ mode: 'messages', expandComments: 'true' }), { mode: 'messages', expandComments: false });
  assert.deepEqual(readSubspaceViewPrefs({ getItem: () => '{' }, 'test'), { mode: 'posts', expandComments: false });
  assert.deepEqual(readSubspaceViewPrefs({ getItem: () => { throw new Error('blocked'); } }, 'test'), { mode: 'posts', expandComments: false });
  assert.deepEqual(readSubspaceViewPrefs(undefined, 'test'), { mode: 'posts', expandComments: false });
});
