import { getSettingsCollection } from '../mongodb/collections';
import {
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  normalizePrConflictResolverModelWaterfall,
  PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  type PRConflictResolverModelId,
  validatePrConflictResolverModelWaterfall
} from './prConflictResolverModelWaterfallCore';

const CACHE_TTL_MS = 15_000;

let cache: { at: number; waterfall: PRConflictResolverModelId[] } | null = null;

export const getPrConflictResolverModelWaterfall = async (): Promise<PRConflictResolverModelId[]> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return [...cache.waterfall];

  try {
    const doc = await (await getSettingsCollection()).findOne(
      { key: PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY },
      { projection: { _id: 0, waterfall: 1 } }
    );
    const waterfall = normalizePrConflictResolverModelWaterfall(doc?.waterfall);
    cache = { at: Date.now(), waterfall };
    return [...waterfall];
  } catch {
    // The conflict resolver must retain a safe hard fallback when settings
    // storage is temporarily unavailable as well as when the singleton is
    // absent. A recent known-good value is preferable during a brief outage.
    return [...(cache?.waterfall || DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL)];
  }
};

export const setPrConflictResolverModelWaterfall = async (
  value: unknown,
  updatedBy: string
): Promise<PRConflictResolverModelId[]> => {
  const validated = validatePrConflictResolverModelWaterfall(value);
  if (validated.ok === false) throw new TypeError(validated.error);

  const waterfall = [...validated.waterfall];
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
  cache = { at: Date.now(), waterfall };
  return [...waterfall];
};
