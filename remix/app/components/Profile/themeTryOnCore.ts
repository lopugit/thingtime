// The "wear my theme" try-on state machine (claude-todo/10 ✨) as pure
// decisions, so the ProfilePage chip's three claims — "try it on", "take it
// off", and "back to your own look" — are testable without a DOM.
//
// Both halves of a try-on live in persisted `thingtime.settings.*`:
//   settings.theme            — the live look (written by applyThemeDoc)
//   settings.themeBeforeTryOn — the look to return to, captured on the FIRST
//                               try-on of a run and cleared on take-off
// so a run survives navigating away and reloading, which a React ref could not.

export type WornTheme = { id: string; name: string };

/** The subset of thingtime.settings.theme this state machine reasons about. */
export type TryOnThemeSettings = {
	preset?: string;
	overrides?: unknown;
	appliedThemeName?: string;
	appliedThemeShareId?: string;
	custom?: unknown;
};

/** Stock defaults — the only honest destination when no snapshot survives. */
export const DEFAULT_THEME_SETTINGS: TryOnThemeSettings = { preset: 'Thingtime', overrides: {} };

const asSettings = (value: unknown): TryOnThemeSettings | null =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as TryOnThemeSettings) : null;

/**
 * A run is in progress iff a snapshot is held. The snapshot — not the applied
 * share id — is what makes "take it off" meaningful: with no snapshot there is
 * nothing to return to, and the visitor is simply WEARING that theme because
 * they applied it themselves (share link, gallery, or cross-device pickup).
 */
export const hasTryOnSnapshot = (snapshot: unknown): boolean => asSettings(snapshot) !== null;

/**
 * Capture the visitor's own look only at the START of a run. Hopping from one
 * profile to the next must not overwrite the original snapshot with the theme
 * borrowed from the previous profile.
 */
export const shouldCaptureTryOnSnapshot = (snapshot: unknown): boolean => !hasTryOnSnapshot(snapshot);

/**
 * The chip reads "take it off" iff this profile's theme is the applied one AND
 * a snapshot is held. Matching on the share id alone would claim a try-on the
 * visitor never started — whenever they already wear the same theme as the
 * owner — and "taking it off" would then drop them to stock defaults.
 */
export const isWearingTryOn = (input: { wornTheme: WornTheme | null; currentTheme: unknown; snapshot: unknown }): boolean => {
	const { wornTheme, currentTheme, snapshot } = input;
	if (!wornTheme || !hasTryOnSnapshot(snapshot)) return false;
	return asSettings(currentTheme)?.appliedThemeShareId === wornTheme.id;
};

/**
 * The snapshot to store for the visitor's current look. Always a real object,
 * so a run stays closable even for a visitor with no theme settings yet:
 * storing a nullish snapshot would read back as "no run open" and strand them
 * in the borrowed theme with no take-off.
 */
export const tryOnSnapshotFor = (currentTheme: unknown): TryOnThemeSettings => ({ ...(asSettings(currentTheme) ?? DEFAULT_THEME_SETTINGS) });

/**
 * The settings to write on take-off: the held snapshot, else stock defaults.
 * `custom` (personal classes/CSS) is orthogonal to themes — applyThemeDoc and
 * setPreset both carry it across a switch, so a take-off carries it too, and
 * the defaults fallback never silently drops it.
 */
export const restoredThemeSettings = (snapshot: unknown, currentTheme: unknown): TryOnThemeSettings => {
	const restored = asSettings(snapshot) ?? DEFAULT_THEME_SETTINGS;
	const liveCustom = asSettings(currentTheme)?.custom;
	return liveCustom === undefined ? { ...restored } : { ...restored, custom: liveCustom };
};
