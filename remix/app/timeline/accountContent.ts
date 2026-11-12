import { copyBoundedJson, type JsonValue } from '../utils/boundedJson';
import { MAX_BIO_CHARS, MAX_DISPLAY_NAME_CHARS, MAX_PROFILE_URL_CHARS, NOTIFICATION_TYPES, EMAIL_NOTIFICATION_TYPES } from '../schemas/registry';
import { validateLopuInstructions, validatePromptRevision } from '../api/utils/lopu/promptSettingsCore';
import type { TimelineSnapshot } from './contract';
import { parseInstructionRecord } from '../lopu/instructionTransfer';

export const ACCOUNT_CONTENT_ADAPTER = 'account-content';
export const ACCOUNT_CONTENT_BYTES = 1024 * 1024;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
function invalid(): never {
	throw Error('Invalid account content snapshot');
}
const budget = { maxBytes: ACCOUNT_CONTENT_BYTES, maxDepth: 10, maxNodes: 6000, sortKeys: true };

/** A shared, versioned content projection, never a login or permission record.
 * Preserve absent preferences rather than replacing them with today's defaults.
 * The input is already decoded by the owner-only server adapter; no credential
 * envelope is accepted by the portable/local Timeline contract. */
export function accountContentSnapshot(input: unknown): TimelineSnapshot {
	if (!object(input) || !id(input.ownerId) || !object(input.profile) || !object(input.preferences)) invalid();
	const profile: Record<string, JsonValue> = {};
	for (const [key, max] of Object.entries({
		username: 200,
		ttid: 200,
		displayName: MAX_DISPLAY_NAME_CHARS,
		bio: MAX_BIO_CHARS,
		avatarUrl: MAX_PROFILE_URL_CHARS,
		bannerUrl: MAX_PROFILE_URL_CHARS
	})) {
		if (!own(input.profile, key)) continue;
		const value = input.profile[key];
		if (value !== null && !text(value, max)) invalid();
		profile[key] = value;
	}
	for (const key of ['avatarAttachmentId', 'bannerAttachmentId']) {
		if (!own(input.profile, key)) continue;
		const value = input.profile[key];
		if (value !== null && !id(value)) invalid();
		profile[key] = value;
	}
	if (!text(profile.username, 200) || !profile.username || !text(profile.ttid, 200) || !profile.ttid) invalid();
	if (profile.avatarAttachmentId && profile.avatarAttachmentId === profile.bannerAttachmentId) invalid();
	const preferences: Record<string, JsonValue> = {},
		source = input.preferences;
	for (const key of ['hideEmailOnProfile', 'readReceiptsEnabled']) {
		if (!own(source, key)) continue;
		if (typeof source[key] !== 'boolean') invalid();
		preferences[key] = source[key];
	}
	for (const key of ['activeThemeId', 'activeFeedAlgorithmId']) {
		if (!own(source, key)) continue;
		if (source[key] !== null && !id(source[key])) invalid();
		preferences[key] = source[key];
	}
	if (own(source, 'birthday')) {
		const value = source.birthday;
		if (
			value !== null &&
			(typeof value !== 'string' ||
				!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
				!Number.isFinite(Date.parse(value)) ||
				new Date(value).toISOString().slice(0, 10) !== value)
		)
			invalid();
		preferences.birthday = value;
	}
	if (own(source, 'notificationPrefs')) {
		if (!object(source.notificationPrefs)) invalid();
		const prefs: Record<string, JsonValue> = {},
			raw = source.notificationPrefs;
		const booleans = (v: Record<string, any>, keys: readonly string[]) => {
			const out: Record<string, JsonValue> = {};
			for (const key of keys)
				if (own(v, key)) {
					if (typeof v[key] !== 'boolean') invalid();
					out[key] = v[key];
				}
			return out;
		};
		Object.assign(prefs, booleans(raw, NOTIFICATION_TYPES));
		for (const [key, keys] of [
			['push', NOTIFICATION_TYPES],
			['email', EMAIL_NOTIFICATION_TYPES],
			['masters', ['push', 'email']]
		] as const) {
			if (!own(raw, key)) continue;
			if (!object(raw[key])) invalid();
			prefs[key] = booleans(raw[key], keys);
		}
		preferences.notificationPrefs = prefs;
	}
	if (own(source, 'lopuInstructions')) {
		const stored = source.lopuInstructions;
		if (!object(stored)) invalid();
		if (own(stored, 'reference')) {
			// The immutable generation lives in separate owner-scoped records.
			// Never materialize it inside the bounded account snapshot.
			if (Object.keys(stored).length !== 2 || own(stored, 'instructions')) invalid();
			preferences.lopuInstructions = parseInstructionRecord(stored) as unknown as JsonValue;
		} else {
			const instructions = validateLopuInstructions(stored.instructions);
			// Legacy inline history remains readable without editing retained text.
			if (instructions.some((row, i) => row.text !== stored.instructions[i].text)) invalid();
			preferences.lopuInstructions = { revision: validatePromptRevision(stored.revision), instructions };
		}
	}
	if (!Array.isArray(input.recentReactions) || input.recentReactions.length > 500 || input.recentReactions.some((v) => !text(v, 4096))) invalid();
	return {
		adapter: ACCOUNT_CONTENT_ADAPTER,
		version: object(preferences.lopuInstructions) && own(preferences.lopuInstructions, 'reference') ? 2 : 1,
		value: copyBoundedJson({ ownerId: input.ownerId, profile, preferences, recentReactions: input.recentReactions }, budget, 'Account content')
	};
}

export function accountContentValue(snapshot: TimelineSnapshot): {
	ownerId: string;
	profile: Record<string, JsonValue>;
	preferences: Record<string, JsonValue>;
	recentReactions: string[];
} {
	if (snapshot.adapter !== ACCOUNT_CONTENT_ADAPTER || ![1, 2].includes(snapshot.version)) invalid();
	const value = copyBoundedJson(snapshot.value, budget, 'Account content');
	const canonical = accountContentSnapshot(value);
	if (canonical.version !== snapshot.version || JSON.stringify(canonical.value) !== JSON.stringify(value)) invalid();
	return value as ReturnType<typeof accountContentValue>;
}
