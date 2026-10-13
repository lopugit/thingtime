import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const records = Array.from({ length: 605 }, (_, index) => ({
  shareId: `account-${index}`,
  ownerId: 'owner',
  crystal: {
    recordKind: 'provider',
    name: `Account ${index}`,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    createdAt: '2026-10-13',
    updatedAt: '2026-10-13'
  }
}));
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getThingsCollection: async () => ({
      find: (query: any) => {
        assert.equal(query.ownerId, 'owner');
        let limit = Infinity;
        const cursor = {
          sort: () => cursor,
          limit: (count: number) => {
            limit = count;
            return cursor;
          },
          toArray: async () => records.slice(0, limit)
        };
        return cursor;
      }
    })
  }
});
mock.module(new URL('../things/things.ts', import.meta.url).href, {
  namedExports: { createThing: () => {}, deletePost: () => {}, isFail: () => false, updateThing: () => {} }
});
const { listUserVault, listUserVaultProviders } = await import('../lopu/userVault.ts');
test('saved AI accounts are not silently hidden beyond the former 200/500 limits', async () => {
  assert.equal((await listUserVault('owner')).entries.length, 605);
  assert.equal((await listUserVaultProviders('owner')).length, 605);
});
