import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Pure revision decoding must not connect to or mutate a live database.
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: { ensureIndexes: async () => {}, getSettingsCollection: async () => { throw new Error('unexpected database access'); }, getHomeThingsCollection: async () => { throw new Error('unexpected database access'); } }
});
const { sanitizeTierContent } = await import('./tierCatalogStore.ts');
const { SUBSCRIPTION_TIER_CATALOG } = await import('./tierCatalog.ts');

test('historical PAYG revisions without a speed allowance remain readable and unchanged', () => {
  const historical = structuredClone(SUBSCRIPTION_TIER_CATALOG.find((tier) => tier.id === 'payg')!);
  delete historical.quotas.speedTestsPerHour;
  const result = sanitizeTierContent(historical);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.content.quotas.speedTestsPerHour, null);
  assert.equal(Object.hasOwn(historical.quotas, 'speedTestsPerHour'), false);
});

test('metered revisions still reject an explicitly finite speed allowance', () => {
  const metered = structuredClone(SUBSCRIPTION_TIER_CATALOG.find((tier) => tier.id === 'payg')!);
  metered.quotas.speedTestsPerHour = 4;
  assert.equal(sanitizeTierContent(metered).ok, false);
});
