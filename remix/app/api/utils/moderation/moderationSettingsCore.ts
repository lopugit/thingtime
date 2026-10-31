// Admin AI-moderation settings — pure core (validation, options, defaults).
// The Admin dashboard's Moderation tab edits ONE settings doc that picks the
// provider per moderation surface: media uploads (images) and post/comment
// text. An admin choice overrides the THINGTIME_MODERATION_PROVIDER env
// default; 'default' delegates back to the env/key-based resolution so
// clearing a choice never strands an environment. Reads are forgiving
// (malformed storage collapses to defaults), writes are strict (admins see
// validation errors, never a silently rewritten preference).

export const MODERATION_SETTINGS_KEY = 'Thingtime.ModerationSettings' as const;

export type ModerationMediaProviderId = 'default' | 'openai+claude' | 'openai' | 'claude' | 'off';
export type ModerationTextProviderId = 'default' | 'openai' | 'off';

export type ModerationSettings = {
	mediaProvider: ModerationMediaProviderId;
	textProvider: ModerationTextProviderId;
};

export const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
	mediaProvider: 'default',
	textProvider: 'default'
};

export type ModerationProviderOption<Id extends string> = {
	id: Id;
	label: string;
	// one-line admin-facing consequence note rendered under the picker
	note: string;
};

export const MODERATION_MEDIA_PROVIDER_OPTIONS = [
	{ id: 'default', label: 'Default (env / API keys)', note: 'Follows THINGTIME_MODERATION_PROVIDER; with both API keys present this is the tiered pipeline.' },
	{ id: 'openai+claude', label: 'OpenAI omni → Claude (tiered, recommended)', note: 'Free omni screen on every image; only flagged/borderline images pay for a Claude call.' },
	{ id: 'openai', label: 'OpenAI omni only (free)', note: 'Zero cost, but image CSAM detection is unavailable (sexual/minors is text-only) and flagged images can only be blurred (nsfw), never auto-blocked.' },
	{ id: 'claude', label: 'Claude on every image', note: 'Most thorough and most expensive; every image is a paid vision call.' },
	{ id: 'off', label: 'Off', note: 'Images stamp skipped and always serve unmoderated.' }
] as const satisfies readonly ModerationProviderOption<ModerationMediaProviderId>[];

export const MODERATION_TEXT_PROVIDER_OPTIONS = [
	{ id: 'default', label: 'Default (on when an OpenAI key exists)', note: 'Text moderation is free, so it runs whenever OPENAI_API_KEY is configured.' },
	{ id: 'openai', label: 'OpenAI omni (free)', note: 'All 13 omni categories apply to text, including sexual/minors, threats, and hate.' },
	{ id: 'off', label: 'Off', note: 'Post and comment text is never analyzed.' }
] as const satisfies readonly ModerationProviderOption<ModerationTextProviderId>[];

const mediaIds = new Set<ModerationMediaProviderId>(MODERATION_MEDIA_PROVIDER_OPTIONS.map((option) => option.id));
const textIds = new Set<ModerationTextProviderId>(MODERATION_TEXT_PROVIDER_OPTIONS.map((option) => option.id));

export const isModerationMediaProviderId = (value: unknown): value is ModerationMediaProviderId =>
	typeof value === 'string' && mediaIds.has(value as ModerationMediaProviderId);

export const isModerationTextProviderId = (value: unknown): value is ModerationTextProviderId =>
	typeof value === 'string' && textIds.has(value as ModerationTextProviderId);

export const normalizeModerationSettings = (value: unknown): ModerationSettings => {
	const raw = (value ?? {}) as { mediaProvider?: unknown; textProvider?: unknown };
	return {
		mediaProvider: isModerationMediaProviderId(raw.mediaProvider) ? raw.mediaProvider : DEFAULT_MODERATION_SETTINGS.mediaProvider,
		textProvider: isModerationTextProviderId(raw.textProvider) ? raw.textProvider : DEFAULT_MODERATION_SETTINGS.textProvider
	};
};

export type ValidateModerationSettingsResult = { ok: true; settings: ModerationSettings } | { ok: false; error: string };

export const validateModerationSettings = (value: unknown): ValidateModerationSettingsResult => {
	if (!value || typeof value !== 'object') return { ok: false, error: 'settings must be an object' };
	const raw = value as { mediaProvider?: unknown; textProvider?: unknown };
	if (!isModerationMediaProviderId(raw.mediaProvider)) {
		return { ok: false, error: `mediaProvider must be one of: ${MODERATION_MEDIA_PROVIDER_OPTIONS.map((option) => option.id).join(', ')}` };
	}
	if (!isModerationTextProviderId(raw.textProvider)) {
		return { ok: false, error: `textProvider must be one of: ${MODERATION_TEXT_PROVIDER_OPTIONS.map((option) => option.id).join(', ')}` };
	}
	return { ok: true, settings: { mediaProvider: raw.mediaProvider, textProvider: raw.textProvider } };
};
