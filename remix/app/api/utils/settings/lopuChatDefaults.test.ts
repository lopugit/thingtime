import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createLopuChatDefaultsStore } from './lopuChatDefaults.ts';

const HARD_DEFAULT = { model: 'claude-opus-5', effort: 'high', speed: 'normal' };

test('every read hits the durable singleton so an external Admin save is visible immediately', async () => {
  let stored: unknown = undefined;
  let reads = 0;
  const store = createLopuChatDefaultsStore({
    readStoredDefaults: async () => {
      reads += 1;
      return stored;
    },
    writeStoredDefaults: async () => undefined
  });

  assert.deepEqual(await store.getDefaults(), HARD_DEFAULT);
  stored = { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast', updatedBy: 'admin-1' };
  assert.deepEqual(await store.getDefaults(), { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' });
  assert.equal(reads, 2);
});

test('reads are forgiving: unknown models, unoffered efforts, and unsold fast lanes normalize instead of failing', async () => {
  let stored: unknown = { model: 'claude-opus-99', effort: 'ultra', speed: 'fast' };
  const store = createLopuChatDefaultsStore({
    readStoredDefaults: async () => stored,
    writeStoredDefaults: async () => undefined
  });
  assert.deepEqual(await store.getDefaults(), { model: 'claude-opus-5', effort: 'high', speed: 'fast' });

  stored = { model: 'claude-fable-5', effort: 'ultra', speed: 'fast' };
  assert.deepEqual(await store.getDefaults(), { model: 'claude-fable-5', effort: 'high', speed: 'normal' });

  stored = { model: 'claude-haiku-4-5', effort: null };
  assert.deepEqual(await store.getDefaults(), { model: 'claude-haiku-4-5', effort: null, speed: 'normal' });
});

test('a failed durable read uses last-known-good, or the hard default on a cold instance', async () => {
  let shouldFail = false;
  const warmStore = createLopuChatDefaultsStore({
    readStoredDefaults: async () => {
      if (shouldFail) throw new Error('Mongo unavailable');
      return { model: 'claude-fable-5', effort: 'max', speed: 'normal' };
    },
    writeStoredDefaults: async () => undefined
  });

  assert.deepEqual(await warmStore.getDefaults(), { model: 'claude-fable-5', effort: 'max', speed: 'normal' });
  shouldFail = true;
  assert.deepEqual(await warmStore.getDefaults(), { model: 'claude-fable-5', effort: 'max', speed: 'normal' });

  const coldStore = createLopuChatDefaultsStore({
    readStoredDefaults: async () => {
      throw new Error('Mongo unavailable');
    },
    writeStoredDefaults: async () => undefined
  });
  assert.deepEqual(await coldStore.getDefaults(), HARD_DEFAULT);
});

test('an Admin save validates strictly, persists with the actor, and becomes the outage fallback', async () => {
  let persisted: { defaults: unknown; updatedBy: string } | null = null;
  const store = createLopuChatDefaultsStore({
    readStoredDefaults: async () => {
      throw new Error('Mongo unavailable');
    },
    writeStoredDefaults: async (defaults, updatedBy) => {
      persisted = { defaults, updatedBy };
    }
  });

  await assert.rejects(() => store.setDefaults({ model: 'default' }, 'admin-1'), TypeError);
  await assert.rejects(() => store.setDefaults({ model: 'claude-opus-5', effort: 'ultra' }, 'admin-1'), TypeError);
  await assert.rejects(() => store.setDefaults({ model: 'claude-fable-5', speed: 'fast' }, 'admin-1'), TypeError);
  assert.equal(persisted, null);

  const saved = await store.setDefaults({ model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' }, 'admin-1');
  assert.deepEqual(saved, { model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' });
  assert.deepEqual(persisted, { defaults: { model: 'claude-opus-5', effort: 'xhigh', speed: 'fast' }, updatedBy: 'admin-1' });
  assert.deepEqual(await store.getDefaults(), saved);

  // the returned copy is detached from the fallback
  saved.model = 'mutated';
  assert.equal((await store.getDefaults()).model, 'claude-opus-5');
});
