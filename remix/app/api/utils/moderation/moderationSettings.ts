// Durable storage for the Admin AI-moderation settings (see
// moderationSettingsCore.ts). Mirrors the AI model waterfall store: the
// settings collection holds one keyed singleton; reads reflect the current
// home-DB value on every request, keeping only a last-known-good copy for an
// actual Mongo outage.
import { getSettingsCollection } from '../mongodb/collections';
import {
	DEFAULT_MODERATION_SETTINGS,
	MODERATION_SETTINGS_KEY,
	normalizeModerationSettings,
	validateModerationSettings,
	type ModerationSettings
} from './moderationSettingsCore';

type StoreDependencies = {
	readStoredSettings: () => Promise<unknown>;
	writeStoredSettings: (settings: ModerationSettings, updatedBy: string) => Promise<void>;
};

export const createModerationSettingsStore = (dependencies: StoreDependencies) => {
	let lastKnownGood: ModerationSettings | null = null;

	const getSettings = async (): Promise<ModerationSettings> => {
		try {
			const settings = normalizeModerationSettings(await dependencies.readStoredSettings());
			lastKnownGood = settings;
			return { ...settings };
		} catch {
			// Availability without staleness-pretending: this path only runs when
			// the durable read itself fails.
			return { ...(lastKnownGood || DEFAULT_MODERATION_SETTINGS) };
		}
	};

	const setSettings = async (value: unknown, updatedBy: string): Promise<ModerationSettings> => {
		const validated = validateModerationSettings(value);
		if (validated.ok === false) throw new TypeError(validated.error);
		await dependencies.writeStoredSettings(validated.settings, updatedBy);
		lastKnownGood = validated.settings;
		return { ...validated.settings };
	};

	return { getSettings, setSettings };
};

const store = createModerationSettingsStore({
	readStoredSettings: async () => {
		const doc = await (await getSettingsCollection()).findOne(
			{ key: MODERATION_SETTINGS_KEY },
			{ projection: { _id: 0, settings: 1 } }
		);
		return doc?.settings;
	},
	writeStoredSettings: async (settings, updatedBy) => {
		await (await getSettingsCollection()).updateOne(
			{ key: MODERATION_SETTINGS_KEY },
			{ $set: { key: MODERATION_SETTINGS_KEY, settings, updatedAt: new Date(), updatedBy } },
			{ upsert: true }
		);
	}
});

export const getModerationSettings = store.getSettings;
export const setModerationSettings = store.setSettings;
