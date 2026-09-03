import { getHomeThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter, thingUniqueKeysFilter } from '../mongodb/uniqueKeys';
import { getStoredLopuChatDefaults } from '../settings/lopuChatDefaults';
import { ACL_ALL, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import {
  AI_MODEL_CATALOG,
  AI_MODEL_THINGTIME,
  AI_MODEL_UNIQUE_KEY_FIELD,
  aiModelShareId,
  aiProviderStatusFromEnv,
  pickLopuChatDefaults,
  publicAiModel,
  type AiModelCatalogEntry,
  type AiModelPublic,
  type AiProviderStatus,
  type LopuChatDefaults,
  type StoredLopuChatDefaults
} from './modelsCore';

// The MongoDB-backed half of the Lopu model catalog (design note §1.1).
//
// One protected, system-owned `ai-model` Thing per base model in the Admin
// catalog (`AI_WORKFLOW_BASE_MODELS`, minus the `default` sentinel): ownerId
// 'system', storageClass 'control', acl ['tt:all'], deterministic shareId
// `ai-model-<modelId>`, root uniqueKeys `aiModel:<modelId>`. Catalog fields
// (label, provider, efforts, speeds, family, sortOrder, contextWindow) are
// CODE and get re-stamped by every ensure; `crystal.enabled` is the single
// admin-owned toggle and is never touched by the seed. The kind rides
// PROTECTED_THINGTIME (no generic CRUD, excluded from generic reads) and
// CONTROL_PLANE_STORAGE_THINGTIMES (never billable), so the only way a model
// appears, disappears, or flips availability is this module. Everything else
// about the catalog — the public projection, provider availability, the
// defaults grammar, the per-turn choice resolver — is pure and lives in
// ./modelsCore.ts so the client can import it without Mongo.

export {
  AI_MODEL_CATALOG,
  AI_MODEL_THINGTIME,
  AI_MODEL_UNIQUE_KEY_FIELD,
  aiModelShareId,
  clampLopuEffort,
  clampLopuSpeed,
  composeAiWorkflowModelChoice,
  DEFAULT_LOPU_CHAT_DEFAULTS,
  getAiModelCatalogEntry,
  isAiModelCatalogId,
  LOPU_CHAT_DEFAULTS_KEY,
  pickLopuChatDefaults,
  resolveLopuModelChoice
} from './modelsCore';
export type {
  AiModelCatalogEntry,
  AiModelFamily,
  AiModelProviderId,
  AiModelPublic,
  AiProviderStatus,
  LopuChatDefaults,
  LopuModelRequest,
  ResolveLopuModelChoiceOptions,
  ResolveLopuModelChoiceResult,
  StoredLopuChatDefaults
} from './modelsCore';

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type EnsureAiModelCatalogResult = {
  ok: true;
  total: number; // catalog rows present after the run
  created: number;
  refreshed: number;
  unchanged: number;
  skipped: number;
  notes: string[];
};

export type ListAiModelsResult = {
  ok: true;
  models: AiModelPublic[];
  defaults: LopuChatDefaults;
  providers: AiProviderStatus;
};

export type SetAiModelEnabledResult = { ok: true; model: AiModelPublic; defaults: LopuChatDefaults };

// The viewer is accepted for the listAiModels contract (per-viewer catalog
// rules may land later); today the catalog is the same public list for every
// caller, anonymous included.
export type AiModelsViewer = { id?: string | null; isAdmin?: boolean } | null | undefined;

// The subset of the Mongo Collection API this module touches — a seam so the
// service is unit-testable with an in-memory collection and never a mock of
// the driver.
export type AiModelThingsCollection = {
  find: (
    filter: Record<string, unknown>,
    options?: { projection?: Record<string, unknown> }
  ) => { toArray: () => Promise<any[]> };
  updateOne: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ) => Promise<{ upsertedCount?: number; matchedCount?: number; modifiedCount?: number }>;
};

export type AiModelsServiceDependencies = {
  getThingsCollection: () => Promise<AiModelThingsCollection>;
  getStoredDefaults: () => Promise<StoredLopuChatDefaults>;
  env: () => Readonly<Record<string, string | undefined>>;
  now?: () => Date;
  catalog?: readonly AiModelCatalogEntry[];
  log?: (message: string, error?: unknown) => void;
};

const MAX_ENSURE_NOTES = 40;

// The catalog fields the seed owns. Stored as a whole on insert and re-stamped
// field by field on drift; `enabled` is deliberately absent.
const catalogCrystalFields = (entry: AiModelCatalogEntry): Record<string, unknown> => ({
  modelId: entry.modelId,
  label: entry.label,
  provider: entry.provider,
  efforts: [...entry.efforts],
  speeds: [...entry.speeds],
  family: entry.family,
  sortOrder: entry.sortOrder,
  ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {})
});

const genuineAiModelDoc = (doc: any): boolean =>
  !!doc &&
  doc.ownerId === 'system' &&
  Array.isArray(doc.thingtime) &&
  doc.thingtime.includes(AI_MODEL_THINGTIME) &&
  !!doc.crystal &&
  typeof doc.crystal === 'object';

const stableJson = (value: unknown): string => JSON.stringify(value);

export const createAiModelsService = (dependencies: AiModelsServiceDependencies) => {
  const catalog = dependencies.catalog ?? AI_MODEL_CATALOG;
  const catalogIds = catalog.map((entry) => entry.modelId);
  const catalogById = new Map(catalog.map((entry) => [entry.modelId, entry]));
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? ((message: string, error?: unknown) => console.error(message, error));

  // Every write after the insert names the row by its server-only unique key
  // AND its genuineness, so a foreign doc can never be edited into a model.
  const genuineFilter = (modelId: string): Record<string, unknown> => ({
    ...thingUniqueKeyFilter(AI_MODEL_UNIQUE_KEY_FIELD, modelId),
    thingtime: AI_MODEL_THINGTIME,
    ownerId: 'system'
  });

  const readCatalogDocs = async (things: AiModelThingsCollection, projection: Record<string, unknown>): Promise<Map<string, any>> => {
    const docs = await things.find(thingUniqueKeysFilter(AI_MODEL_UNIQUE_KEY_FIELD, catalogIds), { projection }).toArray();
    const byModelId = new Map<string, any>();
    for (const doc of docs) {
      if (!genuineAiModelDoc(doc)) continue;
      const modelId = typeof doc.crystal.modelId === 'string' ? doc.crystal.modelId : '';
      if (modelId && catalogById.has(modelId)) byModelId.set(modelId, doc);
    }
    return byModelId;
  };

  const newAiModelThing = (entry: AiModelCatalogEntry, at: Date) => ({
    shareId: aiModelShareId(entry.modelId),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: [AI_MODEL_THINGTIME],
    crystal: { ...catalogCrystalFields(entry), enabled: true },
    extended: null,
    ownerId: 'system',
    storageClass: 'control',
    acl: [ACL_ALL],
    targetId: null,
    tags: [],
    uniqueKeys: [thingUniqueKey(AI_MODEL_UNIQUE_KEY_FIELD, entry.modelId)],
    createdAt: at,
    updatedAt: at
  });

  const runEnsure = async (): Promise<EnsureAiModelCatalogResult> => {
    const things = await dependencies.getThingsCollection();
    const at = now();
    const existing = await readCatalogDocs(things, {
      shareId: 1,
      thingtime: 1,
      ownerId: 1,
      storageClass: 1,
      acl: 1,
      crystal: 1
    });
    const notes: string[] = [];
    let created = 0;
    let refreshed = 0;
    let unchanged = 0;
    let skipped = 0;

    for (const entry of catalog) {
      const shareId = aiModelShareId(entry.modelId);
      const twin = existing.get(entry.modelId);
      try {
        if (!twin) {
          // Insert keyed by the deterministic shareId (unique index) so two
          // instances booting together race safely: exactly one inserts, the
          // other matches the fresh row and falls through as unchanged.
          const res = await things.updateOne({ shareId }, { $setOnInsert: newAiModelThing(entry, at) }, { upsert: true });
          if (res.upsertedCount) {
            created += 1;
            continue;
          }
          const [holder] = await things.find({ shareId }, { projection: { thingtime: 1, ownerId: 1, crystal: 1 } }).toArray();
          if (genuineAiModelDoc(holder) && holder.crystal.modelId === entry.modelId) {
            unchanged += 1;
          } else {
            notes.push(`skipped ${entry.modelId}: shareId ${shareId} is held by a foreign doc — left unseeded`);
            skipped += 1;
          }
          continue;
        }

        const stored = twin.crystal ?? {};
        const wanted = catalogCrystalFields(entry);
        const crystalDrifted = Object.keys(wanted).some((field) => stableJson(stored[field]) !== stableJson(wanted[field]));
        const envelopeDrifted = twin.storageClass !== 'control' || stableJson(twin.acl) !== stableJson([ACL_ALL]);
        if (!crystalDrifted && !envelopeDrifted) {
          unchanged += 1;
          continue;
        }
        const $set: Record<string, unknown> = { storageClass: 'control', acl: [ACL_ALL], updatedAt: at };
        for (const [field, value] of Object.entries(wanted)) $set[`crystal.${field}`] = value;
        // `crystal.enabled` is never in $set — the admin toggle survives every
        // catalog refresh (a model dropped from the catalog keeps its doc too;
        // it just stops being listed).
        await things.updateOne(genuineFilter(entry.modelId), { $set });
        refreshed += 1;
      } catch (error: any) {
        notes.push(`skipped ${entry.modelId}: write failed (${error?.codeName || error?.message || 'unknown error'})`);
        skipped += 1;
      }
    }

    const total = (await readCatalogDocs(things, { crystal: 1, thingtime: 1, ownerId: 1 })).size;
    return { ok: true, total, created, refreshed, unchanged, skipped, notes: notes.slice(0, MAX_ENSURE_NOTES) };
  };

  // Memoised per process: the first catalog read after boot seeds/heals the
  // rows once; later reads share that promise. A failed run clears the memo
  // so the next read retries instead of pinning a boot-time outage. The admin
  // seed route passes { force: true } to re-run on demand.
  let ensureMemo: Promise<EnsureAiModelCatalogResult> | null = null;
  const ensureAiModelCatalog = (options: { force?: boolean } = {}): Promise<EnsureAiModelCatalogResult> => {
    if (!options.force && ensureMemo) return ensureMemo;
    const run: Promise<EnsureAiModelCatalogResult> = runEnsure().catch((error) => {
      if (ensureMemo === run) ensureMemo = null;
      throw error;
    });
    ensureMemo = run;
    return run;
  };

  const readStoredDefaults = async (): Promise<StoredLopuChatDefaults> => {
    try {
      return await dependencies.getStoredDefaults();
    } catch (error) {
      log('[ai-models] Lopu chat defaults unavailable — using the hard default', error);
      return { model: 'claude-opus-5', effort: 'high', speed: 'normal' };
    }
  };

  // The public list. The catalog itself is code, so a Mongo outage degrades
  // to "every model enabled" (availability still gated by provider keys)
  // instead of an empty picker — and is logged, never silent.
  const listAiModels = async (_viewer?: AiModelsViewer): Promise<ListAiModelsResult> => {
    const providers = aiProviderStatusFromEnv(dependencies.env());
    const enabledById = new Map<string, boolean>();
    try {
      await ensureAiModelCatalog();
      const docs = await readCatalogDocs(await dependencies.getThingsCollection(), {
        thingtime: 1,
        ownerId: 1,
        'crystal.modelId': 1,
        'crystal.enabled': 1
      });
      for (const [modelId, doc] of docs) enabledById.set(modelId, doc.crystal.enabled !== false);
    } catch (error) {
      log('[ai-models] catalog read unavailable — serving the code catalog with every model enabled', error);
    }
    const stored = await readStoredDefaults();
    const models = catalog.map((entry) => publicAiModel(entry, enabledById.get(entry.modelId) ?? true, providers));
    const defaults = pickLopuChatDefaults(models, stored);
    for (const model of models) model.isDefault = model.id === defaults.model;
    return { ok: true, models, defaults, providers };
  };

  // Availability-applied defaults for a list a caller already holds.
  const resolveLopuChatDefaults = async (models: readonly AiModelPublic[]): Promise<LopuChatDefaults> =>
    pickLopuChatDefaults(models, await readStoredDefaults());

  const setAiModelEnabled = async (modelId: unknown, enabled: unknown): Promise<SetAiModelEnabledResult | Fail> => {
    const entry = typeof modelId === 'string' ? catalogById.get(modelId.trim()) : undefined;
    if (!entry) return fail(404, 'Unknown model — id must be a catalog model id');
    if (typeof enabled !== 'boolean') return fail(400, 'enabled must be true or false');

    await ensureAiModelCatalog();
    const things = await dependencies.getThingsCollection();
    const res = await things.updateOne(genuineFilter(entry.modelId), { $set: { 'crystal.enabled': enabled, updatedAt: now() } });
    if (!res.matchedCount) {
      return fail(409, `The catalog row for ${entry.label} is missing — re-seed the catalog and try again`);
    }

    const list = await listAiModels();
    const model = list.models.find((candidate) => candidate.id === entry.modelId);
    if (!model) return fail(500, 'The model vanished from the catalog after the update');
    return { ok: true, model, defaults: list.defaults };
  };

  return { ensureAiModelCatalog, listAiModels, resolveLopuChatDefaults, setAiModelEnabled };
};

const service = createAiModelsService({
  // Home plane explicitly: the catalog is control-plane state and must never
  // land on a request's endpoint-override DB.
  getThingsCollection: async () => (await getHomeThingsCollection()) as unknown as AiModelThingsCollection,
  getStoredDefaults: getStoredLopuChatDefaults,
  env: () => process.env
});

export const ensureAiModelCatalog = service.ensureAiModelCatalog;
export const listAiModels = service.listAiModels;
export const resolveLopuChatDefaults = service.resolveLopuChatDefaults;
export const setAiModelEnabled = service.setAiModelEnabled;
