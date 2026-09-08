import { getSettingsCollection } from '../mongodb/collections';
import {
  DEFAULT_LOPU_CHAT_DEFAULTS,
  LOPU_CHAT_DEFAULTS_KEY,
  normalizeLopuChatDefaults,
  validateLopuChatDefaults,
  type StoredLopuChatDefaults
} from '../ai/modelsCore';

export { LOPU_CHAT_DEFAULTS_KEY } from '../ai/modelsCore';
export type { LopuChatDefaults, StoredLopuChatDefaults } from '../ai/modelsCore';

// The `Thingtime.LopuChatDefaults` settings singleton — the model / effort /
// speed a fresh Lopu conversation starts from. Same store pattern as the AI
// workflow waterfall (prConflictResolverModelWaterfall.ts): every read hits the
// home-DB singleton so an admin save is visible immediately on every warm
// instance; only an actual Mongo outage serves the last-known-good value, and
// a cold instance in an outage serves the hard default. Availability is NOT
// applied here — `api/utils/ai/models.ts` resolves the stored preference
// against the live catalog (`pickLopuChatDefaults`).

type StoreDependencies = {
  readStoredDefaults: () => Promise<unknown>;
  writeStoredDefaults: (defaults: StoredLopuChatDefaults, updatedBy: string) => Promise<void>;
};

export const createLopuChatDefaultsStore = (dependencies: StoreDependencies) => {
  let lastKnownGood: StoredLopuChatDefaults | null = null;

  const getDefaults = async (): Promise<StoredLopuChatDefaults> => {
    try {
      const defaults = normalizeLopuChatDefaults(await dependencies.readStoredDefaults());
      lastKnownGood = defaults;
      return { ...defaults };
    } catch {
      // Availability over freshness, but only when the durable read itself
      // fails — never a positive TTL that could hide an admin's save.
      return { ...(lastKnownGood || DEFAULT_LOPU_CHAT_DEFAULTS) };
    }
  };

  const setDefaults = async (value: unknown, updatedBy: string): Promise<StoredLopuChatDefaults> => {
    const validated = validateLopuChatDefaults(value);
    if (validated.ok === false) throw new TypeError(validated.error);

    const defaults = { ...validated.defaults };
    await dependencies.writeStoredDefaults(defaults, updatedBy);
    lastKnownGood = defaults;
    return { ...defaults };
  };

  return { getDefaults, setDefaults };
};

const store = createLopuChatDefaultsStore({
  readStoredDefaults: async () => {
    const doc = await (await getSettingsCollection()).findOne(
      { key: LOPU_CHAT_DEFAULTS_KEY },
      { projection: { _id: 0, model: 1, effort: 1, speed: 1 } }
    );
    return doc ?? undefined;
  },
  writeStoredDefaults: async (defaults, updatedBy) => {
    await (await getSettingsCollection()).updateOne(
      { key: LOPU_CHAT_DEFAULTS_KEY },
      {
        $set: {
          key: LOPU_CHAT_DEFAULTS_KEY,
          model: defaults.model,
          effort: defaults.effort,
          speed: defaults.speed,
          updatedAt: new Date(),
          updatedBy
        }
      },
      { upsert: true }
    );
  }
});

export const getStoredLopuChatDefaults = store.getDefaults;
export const setStoredLopuChatDefaults = store.setDefaults;
