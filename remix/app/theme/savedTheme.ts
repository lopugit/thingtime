import { resolveTheme, THINGTIME_THEME } from './tokens';

export const MAX_SAVED_THEMES = 100;

/** Shared saved-theme content boundary; authority and publication live in the adapters. */
export function normalizeSavedTheme(input: { name?: unknown; theme?: unknown }) {
	const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
	if (!name) return { ok: false as const, status: 400, error: 'Theme name is required' };
	if (!input.theme || typeof input.theme !== 'object') return { ok: false as const, status: 400, error: 'Theme tokens are required' };
	return { ok: true as const, name, theme: resolveTheme(THINGTIME_THEME, { ...(input.theme as object), name }) };
}
