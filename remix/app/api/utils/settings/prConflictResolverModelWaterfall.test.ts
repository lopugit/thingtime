import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createPrConflictResolverModelWaterfallStore } from './prConflictResolverModelWaterfall.ts';

test('every GET reads the durable singleton so an external Admin save is visible immediately', async () => {
  let stored: unknown = ['default'];
  let reads = 0;
  const store = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      reads += 1;
      return stored;
    },
    writeStoredWaterfall: async () => undefined
  });

  assert.deepEqual(await store.getWaterfall(), ['default']);
  stored = ['claude-opus-5', 'claude-fable-5', 'default'];
  assert.deepEqual(await store.getWaterfall(), ['claude-opus-5', 'claude-fable-5', 'default']);
  assert.equal(reads, 2);
});

test('a failed durable read uses last-known-good, or the hard default on a cold instance', async () => {
  let shouldFail = false;
  const warmStore = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      if (shouldFail) throw new Error('Mongo unavailable');
      return ['claude-opus-5', 'default'];
    },
    writeStoredWaterfall: async () => undefined
  });

  assert.deepEqual(await warmStore.getWaterfall(), ['claude-opus-5', 'default']);
  shouldFail = true;
  assert.deepEqual(await warmStore.getWaterfall(), ['claude-opus-5', 'default']);

  const coldStore = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      throw new Error('Mongo unavailable');
    },
    writeStoredWaterfall: async () => undefined
  });
  assert.deepEqual(await coldStore.getWaterfall(), ['default']);
});

test('an Admin save persists the validated order and becomes the outage fallback', async () => {
  let persisted: { waterfall: unknown; updatedBy: string } | null = null;
  const store = createPrConflictResolverModelWaterfallStore({
    readStoredWaterfall: async () => {
      throw new Error('Mongo unavailable');
    },
    writeStoredWaterfall: async (waterfall, updatedBy) => {
      persisted = { waterfall, updatedBy };
    }
  });

  const waterfall = ['claude-opus-5', 'claude-fable-5', 'default'] as const;
  assert.deepEqual(await store.setWaterfall(waterfall, 'admin-123'), waterfall);
  assert.deepEqual(persisted, { waterfall: [...waterfall], updatedBy: 'admin-123' });
  assert.deepEqual(await store.getWaterfall(), waterfall);
});
