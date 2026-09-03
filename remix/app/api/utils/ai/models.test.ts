import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createAiModelsService, type AiModelThingsCollection } from './models.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { AI_MODEL_CATALOG, DEFAULT_LOPU_CHAT_DEFAULTS, aiModelShareId } from './modelsCore.ts';

// An in-memory stand-in for the `things` collection covering exactly the
// driver surface the service uses: uniqueKeys lookups ($in and equality on
// BinData), shareId/ownerId equality, thingtime array membership, upserts with
// $setOnInsert, and dotted-path $set.
const binaryKey = (value: any): string => Buffer.from(value?.buffer ?? value ?? '').toString('utf8');

const matches = (doc: any, filter: Record<string, any>): boolean =>
  Object.entries(filter).every(([field, expected]) => {
    const actual = doc[field];
    if (field === 'uniqueKeys') {
      const keys = Array.isArray(actual) ? actual.map(binaryKey) : [];
      if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
        return expected.$in.some((bin: any) => keys.includes(binaryKey(bin)));
      }
      return keys.includes(binaryKey(expected));
    }
    if (Array.isArray(actual)) return actual.includes(expected);
    return actual === expected;
  });

const applySet = (doc: any, $set: Record<string, unknown>) => {
  for (const [path, value] of Object.entries($set)) {
    const parts = path.split('.');
    let target = doc;
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== 'object') target[part] = {};
      target = target[part];
    }
    target[parts[parts.length - 1]] = value;
  }
};

const createFakeThings = () => {
  const docs: any[] = [];
  const calls = { find: 0, updateOne: 0, upserts: 0, sets: 0 };
  const collection: AiModelThingsCollection = {
    find: (filter) => {
      calls.find += 1;
      return { toArray: async () => docs.filter((doc) => matches(doc, filter)) };
    },
    updateOne: async (filter, update, options) => {
      calls.updateOne += 1;
      const doc = docs.find((candidate) => matches(candidate, filter));
      if (!doc) {
        if (options?.upsert && update.$setOnInsert) {
          docs.push({ ...(update.$setOnInsert as Record<string, unknown>) });
          calls.upserts += 1;
          return { upsertedCount: 1, matchedCount: 0, modifiedCount: 0 };
        }
        return { upsertedCount: 0, matchedCount: 0, modifiedCount: 0 };
      }
      if (update.$set) {
        applySet(doc, update.$set as Record<string, unknown>);
        calls.sets += 1;
      }
      return { upsertedCount: 0, matchedCount: 1, modifiedCount: 1 };
    }
  };
  return { docs, calls, collection };
};

const NOW = new Date('2026-09-03T00:00:00.000Z');

const createService = (overrides: Record<string, unknown> = {}) => {
  const fake = createFakeThings();
  const logs: string[] = [];
  const service = createAiModelsService({
    getThingsCollection: async () => fake.collection,
    getStoredDefaults: async () => ({ ...DEFAULT_LOPU_CHAT_DEFAULTS }),
    env: () => ({ ANTHROPIC_API_KEY: 'sk-test', OPENAI_API_KEY: 'sk-test' }),
    now: () => NOW,
    log: (message: string) => logs.push(message),
    ...overrides
  } as any);
  return { fake, logs, service };
};

test('ensureAiModelCatalog seeds one protected system-owned control-plane Thing per catalog model, idempotently', async () => {
  const { fake, service } = createService();

  const first = await service.ensureAiModelCatalog();
  assert.deepEqual(first, { ok: true, total: AI_MODEL_CATALOG.length, created: AI_MODEL_CATALOG.length, refreshed: 0, unchanged: 0, skipped: 0, notes: [] });
  assert.equal(fake.docs.length, AI_MODEL_CATALOG.length);

  const opus = fake.docs.find((doc) => doc.shareId === aiModelShareId('claude-opus-5'));
  assert.ok(opus);
  assert.equal(opus.ownerId, 'system');
  assert.equal(opus.storageClass, 'control');
  assert.deepEqual(opus.acl, ['tt:all']);
  assert.deepEqual(opus.thingtime, ['ai-model']);
  assert.equal(opus.targetId, null);
  assert.equal(typeof opus.schemaVersion, 'number');
  assert.deepEqual(opus.uniqueKeys.map(binaryKey), ['aiModel:claude-opus-5']);
  assert.deepEqual(opus.crystal, {
    modelId: 'claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'anthropic',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    speeds: ['normal', 'fast'],
    family: 'claude',
    sortOrder: AI_MODEL_CATALOG.find((entry) => entry.modelId === 'claude-opus-5')!.sortOrder,
    contextWindow: 1_000_000,
    enabled: true
  });
  assert.equal(opus.createdAt, NOW);
  // no contextWindow key at all when the catalog does not know it
  const gpt = fake.docs.find((doc) => doc.shareId === aiModelShareId('gpt-5.5'));
  assert.equal('contextWindow' in gpt.crystal, false);
  assert.equal(gpt.crystal.family, 'gpt');

  // a second forced run touches nothing
  const writesBefore = fake.calls.updateOne;
  const second = await service.ensureAiModelCatalog({ force: true });
  assert.deepEqual(second, { ok: true, total: AI_MODEL_CATALOG.length, created: 0, refreshed: 0, unchanged: AI_MODEL_CATALOG.length, skipped: 0, notes: [] });
  assert.equal(fake.calls.updateOne, writesBefore);
});

test('the ensure is memoised per process and only a forced run repeats it', async () => {
  const { fake, service } = createService();

  await service.listAiModels();
  await service.listAiModels();
  await service.ensureAiModelCatalog();
  assert.equal(fake.calls.upserts, AI_MODEL_CATALOG.length);
  // one seeding pass: the two list reads plus the ensure's own reads, never a second insert sweep
  const upsertsAfterMemo = fake.calls.upserts;
  await service.ensureAiModelCatalog({ force: true });
  assert.equal(fake.calls.upserts, upsertsAfterMemo);
});

test('a forced ensure heals drifted catalog fields and envelope but never touches enabled', async () => {
  const { fake, service } = createService();
  await service.ensureAiModelCatalog();

  const fable = fake.docs.find((doc) => doc.shareId === aiModelShareId('claude-fable-5'));
  fable.crystal.label = 'Renamed by hand';
  fable.crystal.efforts = ['low'];
  fable.crystal.enabled = false;
  fable.acl = ['tt:user'];
  fable.storageClass = 'content';

  const report = await service.ensureAiModelCatalog({ force: true });
  assert.equal(report.refreshed, 1);
  assert.equal(report.unchanged, AI_MODEL_CATALOG.length - 1);
  assert.equal(fable.crystal.label, 'Claude Fable 5');
  assert.deepEqual(fable.crystal.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(fable.crystal.enabled, false, 'the admin toggle survives a catalog refresh');
  assert.deepEqual(fable.acl, ['tt:all']);
  assert.equal(fable.storageClass, 'control');
  assert.equal(fable.updatedAt, NOW);
});

test('a foreign doc squatting a catalog shareId is skipped, never edited into a model', async () => {
  const { fake, service } = createService();
  const squatter = {
    shareId: aiModelShareId('claude-opus-5'),
    thingtime: ['data'],
    ownerId: 'user-1',
    acl: ['tt:user'],
    crystal: { modelId: 'claude-opus-5', enabled: false, label: 'fake' }
  };
  fake.docs.push(squatter);

  const report = await service.ensureAiModelCatalog();
  assert.equal(report.skipped, 1);
  assert.equal(report.created, AI_MODEL_CATALOG.length - 1);
  assert.equal(report.total, AI_MODEL_CATALOG.length - 1);
  assert.match(report.notes[0], /claude-opus-5: shareId ai-model-claude-opus-5 is held by a foreign doc/);
  assert.equal(squatter.ownerId, 'user-1');
  assert.equal(squatter.crystal.label, 'fake');

  // the catalog is code: the model is still listed (enabled by default) and the squatter's toggle is ignored
  const list = await service.listAiModels();
  const opus = list.models.find((model) => model.id === 'claude-opus-5')!;
  assert.equal(opus.enabled, true);
  assert.equal(opus.available, true);
});

test('listAiModels projects enabled/available/isDefault from the rows, the env, and the stored defaults', async () => {
  let stored: { model: string; effort: 'ultra' | 'max'; speed: 'fast' | 'normal' } = { model: 'gpt-5.6-sol', effort: 'ultra', speed: 'fast' };
  const { fake, service } = createService({
    env: () => ({ ANTHROPIC_AUTH_TOKEN: 'tok' }),
    getStoredDefaults: async () => ({ ...stored })
  });

  const list = await service.listAiModels({ id: 'viewer-1' });
  assert.equal(list.ok, true);
  assert.equal(list.models.length, AI_MODEL_CATALOG.length);
  assert.deepEqual(list.models.map((model) => model.id), AI_MODEL_CATALOG.map((entry) => entry.modelId));
  assert.deepEqual(list.providers, { anthropic: { configured: true }, openai: { configured: false } });
  // stored model needs OpenAI → first available Anthropic model becomes the default, effort re-clamped
  assert.deepEqual(list.defaults, { model: 'claude-fable-5', effort: 'high', speed: 'normal' });
  assert.deepEqual(list.models.filter((model) => model.isDefault).map((model) => model.id), ['claude-fable-5']);
  const sol = list.models.find((model) => model.id === 'gpt-5.6-sol')!;
  assert.equal(sol.enabled, true);
  assert.equal(sol.available, false);
  assert.equal(JSON.stringify(list).includes('sk-'), false);

  // flip a row's toggle straight in the store: the next read reflects it, nothing is cached
  fake.docs.find((doc) => doc.shareId === aiModelShareId('claude-fable-5')).crystal.enabled = false;
  stored = { model: 'claude-opus-5', effort: 'max', speed: 'fast' };
  const next = await service.listAiModels();
  assert.equal(next.models.find((model) => model.id === 'claude-fable-5')!.enabled, false);
  assert.equal(next.models.find((model) => model.id === 'claude-fable-5')!.available, false);
  assert.deepEqual(next.defaults, { model: 'claude-opus-5', effort: 'max', speed: 'fast' });

  assert.deepEqual(await service.resolveLopuChatDefaults(next.models), next.defaults);
});

test('a catalog outage degrades to the code catalog (everything enabled), logs, and retries on the next read', async () => {
  const fake = createFakeThings();
  const logs: string[] = [];
  let outage = true;
  const service = createAiModelsService({
    getThingsCollection: async () => {
      if (outage) throw new Error('Mongo unavailable');
      return fake.collection;
    },
    getStoredDefaults: async () => {
      throw new Error('settings unavailable');
    },
    env: () => ({ OPENAI_API_KEY: 'sk-test' }),
    log: (message: string) => logs.push(message)
  });

  const degraded = await service.listAiModels();
  assert.equal(degraded.models.length, AI_MODEL_CATALOG.length);
  assert.ok(degraded.models.every((model) => model.enabled));
  assert.equal(degraded.defaults.model, 'gpt-5.6-sol', 'hard default needs Anthropic, so the first OpenAI model stands in');
  assert.ok(logs.some((line) => line.includes('catalog read unavailable')));
  assert.ok(logs.some((line) => line.includes('chat defaults unavailable')));
  assert.equal(fake.docs.length, 0);

  outage = false;
  await service.listAiModels();
  assert.equal(fake.docs.length, AI_MODEL_CATALOG.length, 'the failed memo is cleared so the next read seeds');
});

test('setAiModelEnabled flips only crystal.enabled on the genuine row and reports the recomputed defaults', async () => {
  const { fake, service } = createService();

  assert.deepEqual(await service.setAiModelEnabled('nope', true), { ok: false, status: 404, error: 'Unknown model — id must be a catalog model id' });
  assert.deepEqual(await service.setAiModelEnabled('claude-opus-5', 'yes'), { ok: false, status: 400, error: 'enabled must be true or false' });

  const disabled = await service.setAiModelEnabled(' claude-opus-5 ', false);
  assert.equal(disabled.ok, true);
  if (disabled.ok !== true) return;
  assert.equal(disabled.model.id, 'claude-opus-5');
  assert.equal(disabled.model.enabled, false);
  assert.equal(disabled.model.available, false);
  assert.equal(disabled.model.isDefault, false);
  assert.equal(disabled.defaults.model, 'claude-fable-5', 'the disabled hard default yields to the next available model');

  const row = fake.docs.find((doc) => doc.shareId === aiModelShareId('claude-opus-5'));
  assert.equal(row.crystal.enabled, false);
  assert.equal(row.crystal.label, 'Claude Opus 5');
  assert.equal(row.updatedAt, NOW);

  const enabled = await service.setAiModelEnabled('claude-opus-5', true);
  assert.equal(enabled.ok && enabled.model.available, true);
  assert.equal(enabled.ok && enabled.defaults.model, 'claude-opus-5');
});
