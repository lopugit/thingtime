// The "wear my theme" try-on state machine (claude-todo/10 ✨) as pure
// decisions, so the ProfilePage chip's three claims — "try it on", "take it
// off", and "back to your own look" — are testable without a DOM.
//
// A try-on RUN lives in persisted `thingtime.settings.*`:
//   settings.theme            — the live look (written by applyThemeDoc)
//   settings.themeBeforeTryOn — the open run: the look to return to, plus the
//                               share id the run most recently borrowed
// so a run survives navigating away and reloading, which a React ref could not.
//
// Recording the borrowed share id is what BOUNDS the run. A run holding only a
// look could never tell "still borrowing" from "the visitor has since chosen a
// theme of their own", so it stayed open forever: keep a tried-on theme (the
// toast invites exactly that), pick a preset or apply a saved theme, then try
// on a second profile months later, and take-off restored the pre-run look and
// silently discarded the theme they were actually wearing. A run is open only
// while the live look is still the one the run applied.

export type WornTheme = { id: string; name: string };

/** The subset of thingtime.settings.theme this state machine reasons about. */
export type TryOnThemeSettings = {
	preset?: string;
	overrides?: unknown;
	appliedThemeName?: string;
	appliedThemeShareId?: string;
	custom?: unknown;
};

/** An open try-on: the look to return to and the theme currently borrowed. */
export type TryOnRun = {
	settings: TryOnThemeSettings;
	borrowedShareId: string;
};

/** Stock defaults — the only honest destination when no run survives. */
export const DEFAULT_THEME_SETTINGS: TryOnThemeSettings = { preset: 'Thingtime', overrides: {} };

const asSettings = (value: unknown): TryOnThemeSettings | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as TryOnThemeSettings) : null;

/**
 * A stored run, or null. Anything that is not a well-formed run — junk, or the
 * bare settings object an earlier build of this feature persisted — reads as
 * "no run", so the next try-on captures the visitor's CURRENT look rather than
 * restoring them to something unrelated.
 */
const asRun = (value: unknown): TryOnRun | null => {
	const held = value as { settings?: unknown; borrowedShareId?: unknown } | null;
	const settings = asSettings(held?.settings);
	const borrowedShareId = typeof held?.borrowedShareId === 'string' ? held.borrowedShareId : '';
	return settings && borrowedShareId ? { settings, borrowedShareId } : null;
};

/**
 * The run in progress, iff the visitor is still wearing what it borrowed.
 * Once they move to any other look — a preset, their own saved theme, a
 * gallery theme — the run is over and its held look stops being "their own".
 */
export const openTryOnRun = (run: unknown, currentTheme: unknown): TryOnRun | null => {
	const held = asRun(run);
	if (!held) return null;
	return asSettings(currentTheme)?.appliedThemeShareId === held.borrowedShareId ? held : null;
};

/**
 * The chip reads "take it off" iff an open run borrowed exactly this profile's
 * theme. Matching on the applied share id alone would claim a try-on the
 * visitor never started — whenever they already wear the same theme as the
 * owner — and "taking it off" would then drop them to stock defaults.
 */
export const isWearingTryOn = (input: { wornTheme: WornTheme | null; currentTheme: unknown; run: unknown }): boolean => {
	const { wornTheme, currentTheme, run } = input;
	if (!wornTheme) return false;
	return openTryOnRun(run, currentTheme)?.borrowedShareId === wornTheme.id;
};

/**
 * The run to store when borrowing `borrowedShareId`.
 *
 * Hopping from one profile to the next continues the OPEN run — the look to
 * return to stays the visitor's own, never the theme borrowed from the
 * previous profile — while only the borrowed id advances. With no open run the
 * visitor's current look is captured fresh, including when they arrived
 * already wearing a shared theme (share link, gallery, cross-device pickup):
 * that look is theirs and take-off must return them to it.
 *
 * The held look is always a real object, so a run stays closable even for a
 * visitor with no theme settings yet: a nullish one would read back as "no run
 * open" and strand them in the borrowed theme with no take-off.
 */
export const nextTryOnRun = (run: unknown, currentTheme: unknown, borrowedShareId: string): TryOnRun => {
	const open = openTryOnRun(run, currentTheme);
	return {
		settings: { ...(open?.settings ?? asSettings(currentTheme) ?? DEFAULT_THEME_SETTINGS) },
		borrowedShareId
	};
};

/**
 * The settings to write on take-off: the run's held look, else stock defaults.
 * `custom` (personal classes/CSS) is orthogonal to themes — applyThemeDoc and
 * setPreset both carry it across a switch, so a take-off carries it too, and
 * the defaults fallback never silently drops it.
 */
export const restoredThemeSettings = (run: unknown, currentTheme: unknown): TryOnThemeSettings => {
	const restored = asRun(run)?.settings ?? DEFAULT_THEME_SETTINGS;
	const liveCustom = asSettings(currentTheme)?.custom;
	return liveCustom === undefined ? { ...restored } : { ...restored, custom: liveCustom };
};
