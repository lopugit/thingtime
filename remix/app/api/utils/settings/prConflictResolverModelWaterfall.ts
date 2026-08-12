import { getSettingsCollection } from '../mongodb/collections';
import {
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  normalizePrConflictResolverModelWaterfall,
  PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  type PRConflictResolverModelId,
  validatePrConflictResolverModelWaterfall
} from './prConflictResolverModelWaterfallCore';

type StoreDependencies = {
  readStoredWaterfall: () => Promise<unknown>;
  writeStoredWaterfall: (waterfall: PRConflictResolverModelId[], updatedBy: string) => Promise<void>;
};

// The public workflow endpoint must reflect the current home-DB singleton on
// every request. Keep only a last-known-good value for an actual Mongo outage;
// a positive TTL can otherwise let separate warm serverless instances return
// an administrator's previous model order after a successful save.
export const createPrConflictResolverModelWaterfallStore = (dependencies: StoreDependencies) => {
  let lastKnownGood: PRConflictResolverModelId[] | null = null;

  const getWaterfall = async (): Promise<PRConflictResolverModelId[]> => {
    try {
      const waterfall = normalizePrConflictResolverModelWaterfall(await dependencies.readStoredWaterfall());
      lastKnownGood = waterfall;
      return [...waterfall];
    } catch {
      // Preserve availability without pretending a stale cache is current:
      // this path is used only when the durable read itself fails.
      return [...(lastKnownGood || DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL)];
    }
  };

  const setWaterfall = async (value: unknown, updatedBy: string): Promise<PRConflictResolverModelId[]> => {
    const validated = validatePrConflictResolverModelWaterfall(value);
    if (validated.ok === false) throw new TypeError(validated.error);

    const waterfall = [...validated.waterfall];
    await dependencies.writeStoredWaterfall(waterfall, updatedBy);
    lastKnownGood = waterfall;
    return [...waterfall];
  };

  return { getWaterfall, setWaterfall };
};

const store = createPrConflictResolverModelWaterfallStore({
  readStoredWaterfall: async () => {
    const doc = await (await getSettingsCollection()).findOne(
      { key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY },
      { projection: { _id: 0, waterfall: 1 } }
    );
    return doc?.waterfall;
  },
  writeStoredWaterfall: async (waterfall, updatedBy) => {
    await (await getSettingsCollection()).updateOne(
      { key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY },
      {
        $set: {
          key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
          waterfall,
          updatedAt: new Date(),
          updatedBy
        }
      },
      { upsert: true }
    );
  }
});

export const getPrConflictResolverModelWaterfall = store.getWaterfall;
export const setPrConflictResolverModelWaterfall = store.setWaterfall;

// Canonical runtime alias. Keep the legacy exports above for the public API,
// Admin editor, and existing workflow consumers.
export const getAiPreferredModelWaterfall = store.getWaterfall;
