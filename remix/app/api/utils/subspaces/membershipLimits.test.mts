import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const rows = Array.from({ length: 610 }, (_, i) => ({
  targetId: `subspace-${i}`, crystal: { role: 'member', banned: i === 609 }
}));
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: { getThingsCollection: async () => ({ find: () => {
    let limit = Infinity;
    const cursor = {
      project: () => cursor, batchSize: () => cursor,
      limit: (value: number) => { limit = value; return cursor; },
      toArray: async () => rows.slice(0, limit),
      async *[Symbol.asyncIterator]() { yield* rows.slice(0, limit); }
    };
    return cursor;
  } }) }
});
const { loadViewerSubspaceRoles, isActiveMember } = await import('./gate.ts');
test('subspace role reads preserve late memberships and bans past the former 500 boundary', async () => {
  const roles = await loadViewerSubspaceRoles('viewer');
  assert.equal(roles.size, 610);
  assert.equal(isActiveMember(roles.get('subspace-608')), true);
  assert.equal(roles.get('subspace-609')?.banned, true);
  assert.equal(isActiveMember(roles.get('subspace-609')), false);
  assert.equal((await loadViewerSubspaceRoles(null)).size, 0);
});
