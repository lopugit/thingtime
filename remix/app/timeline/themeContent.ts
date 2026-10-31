import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';
import type { TimelineSnapshot } from './contract.ts';

export const THEME_CONTENT_ADAPTER = 'theme-content';
// Versioned allowlist, deliberately independent of future theme defaults.
const fieldsV1 = {
	colors: ['ink', 'text', 'muted', 'faint', 'border', 'borderLight', 'surface', 'surfaceAlt', 'surfaceHover', 'card', 'pageBg', 'accent', 'accentTint', 'accentContrast', 'link', 'positive', 'positiveSoft', 'danger', 'warning', 'rainbow', 'darkBg', 'darkChrome', 'darkBorder', 'darkText', 'darkMuted', 'darkAccent'],
	fonts: ['heading', 'body', 'mono', 'display'],
	general: ['radiusScale', 'borderWidth', 'shadow', 'motion', 'animSpeed', 'iconStyle', 'thingsBadgePadding', 'thingsBadgeCustomPadding'],
	windows: ['closeColor', 'minimiseColor', 'maximiseColor', 'closeRadius', 'minimiseRadius', 'maximiseRadius']
} as const;
// Keep the v1 projection frozen: old event bytes/digests must not be rewritten
// when a later codec adds tokens. v2 records focus tokens only when present.
const focusColors = ['focusBorder', 'focusGlowStart', 'focusGlowEnd'] as const;
const focusNumbers = ['focusGlowBlur', 'focusGlowOpacity'] as const;
const fieldsV2 = { ...fieldsV1, colors: [...fieldsV1.colors, ...focusColors], general: [...fieldsV1.general, ...focusNumbers] };
const numbers = new Set(['radiusScale', 'borderWidth', 'animSpeed', 'closeRadius', 'minimiseRadius', 'maximiseRadius', ...focusNumbers]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const budget = { maxBytes: 256 * 1024, maxDepth: 8, maxNodes: 4096, sortKeys: true };
function invalid(): never { throw new Error('Invalid theme content history'); }

export type ThemeContentValue = {
	crystal: { name: string; theme: Record<string, JsonValue>; title?: string | null };
	tags: string[];
	visibility: 'private' | 'public';
	folderId: string | null;
};

/** Explicit approved projection. Never spread a protected crystal or add
 * missing token defaults: historical partial themes retain their exact tokens. */
function projectThemeContent(input: unknown, version: 1 | 2): TimelineSnapshot {
	if (!object(input) || !object(input.crystal) || !text(input.crystal.name, 60) || !object(input.crystal.theme)) invalid();
	const source = input.crystal.theme;
	const theme: Record<string, JsonValue> = {};
	if (own(source, 'name')) { if (!text(source.name, 60)) invalid(); theme.name = source.name; }
	for (const [section, keys] of Object.entries(version === 1 ? fieldsV1 : fieldsV2)) {
		if (!own(source, section)) continue;
		if (!object(source[section])) invalid();
		const tokens: Record<string, JsonValue> = {};
		for (const key of keys) {
			if (!own(source[section] as object, key)) continue;
			const value = (source[section] as Record<string, JsonValue>)[key];
			if (key === 'rainbow') {
				if (!Array.isArray(value) || value.length !== 5 || value.some(item => !text(item, 4096))) invalid();
			} else if (numbers.has(key)) {
				if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
			} else if (key === 'motion') {
				if (typeof value !== 'boolean') invalid();
			} else if (!text(value, 4096)) invalid();
			tokens[key] = value;
		}
		theme[section] = tokens;
	}
	const crystal: ThemeContentValue['crystal'] = { name: input.crystal.name, theme };
	if (own(input.crystal, 'title')) {
		if (input.crystal.title !== null && !text(input.crystal.title, 120)) invalid();
		crystal.title = input.crystal.title;
	}
	if (!Array.isArray(input.tags) || input.tags.length > 512 || input.tags.some(tag => !text(tag, 200)) ||
		!['private', 'public'].includes(input.visibility) || (input.folderId !== null && !text(input.folderId, 200))) invalid();
	return { adapter: THEME_CONTENT_ADAPTER, version,
		value: copyBoundedJson({ crystal, tags: input.tags, visibility: input.visibility, folderId: input.folderId }, budget, 'Theme history') };
}

/** Absent focus tokens keep the historical v1 contract exactly, including
 * partial themes. Do not inject current defaults into either version. */
export function themeContentSnapshot(input: unknown): TimelineSnapshot {
	const theme = object(input) && object(input.crystal) ? input.crystal.theme : null;
	const focus = object(theme) && ((object(theme.colors) && focusColors.some(key => own(theme.colors, key))) ||
		(object(theme.general) && focusNumbers.some(key => own(theme.general, key))));
	return projectThemeContent(input, focus ? 2 : 1);
}

/** Storage exemption is available only to the exact approved versioned shape.
 * Client drafts are still fully metered by the enclosing Timeline policy. */
export function themeContentValue(snapshot: TimelineSnapshot): ThemeContentValue {
	if (snapshot.adapter !== THEME_CONTENT_ADAPTER || (snapshot.version !== 1 && snapshot.version !== 2)) invalid();
	const value = copyBoundedJson(snapshot.value, budget, 'Theme history');
	const projected = projectThemeContent(value as ThemeContentValue, snapshot.version);
	if (JSON.stringify(projected.value) !== JSON.stringify(value)) invalid();
	return value as ThemeContentValue;
}

export function themeContentStoragePayload(snapshot: TimelineSnapshot) {
	const value = themeContentValue(snapshot);
	return { crystal: value.crystal, extended: null, tags: value.tags };
}
