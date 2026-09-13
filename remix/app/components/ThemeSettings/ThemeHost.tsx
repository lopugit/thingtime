import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useTtTheme } from '../../hooks/useTtTheme';
import { buildCustomCss } from '../../theme/customise';
import {
	CURATED_FONTS,
	themeToCssVars,
	TT_THEME_SNAPSHOT_KEY,
} from '../../theme/tokens';

const FONT_LINK_ID = 'tt-theme-fonts';
const CUSTOM_CSS_ID = 'tt-custom-css';

/** Families already loaded statically from index.html. */
const STATIC_FONTS = new Set(['Space Grotesk', 'Hanken Grotesk', 'JetBrains Mono']);

const curatedFontNames = new Set(CURATED_FONTS.map((f) => f.css).filter(Boolean));

const googleFontsHref = (families: string[]) =>
	`https://fonts.googleapis.com/css2?${families
		.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700;800`)
		.join('&')}&display=swap`;

/**
 * Renderless runtime theming host — the sibling of VisualSettingsHost.
 * Resolves thingtime.settings.theme into --tt-* CSS custom properties on
 * <html>, mirrors the computed vars to localStorage so the index.html
 * pre-paint script can apply them before React loads (no flash), loads any
 * extra Google fonts the theme asks for, and broadcasts a change event.
 */
export const ThemeHost = () => {
	const { theme, preset, hasOverrides, appliedThemeShareId, applyThemeDoc, custom } = useTtTheme();
	const { loading } = useThingtime();
	const user = useCurrentUser();

	// Per-option custom CSS (the customise popovers) — scoped to each option's
	// registered selector and injected as one stylesheet. Personal only; never
	// part of saved/shared theme documents.
	const customCss = React.useMemo(() => buildCustomCss(custom), [custom]);

	React.useEffect(() => {
		let styleEl = document.getElementById(CUSTOM_CSS_ID) as HTMLStyleElement | null;
		if (!customCss) {
			if (styleEl) styleEl.remove();
			return;
		}
		if (!styleEl) {
			styleEl = document.createElement('style');
			styleEl.id = CUSTOM_CSS_ID;
			document.head.appendChild(styleEl);
		}
		if (styleEl.textContent !== customCss) styleEl.textContent = customCss;
	}, [customCss]);

	// Cross-device pickup: when the user has an active saved theme and this
	// device's theme settings are still pristine defaults, apply it once.
	// One attempt per app load per user — otherwise a stale user.activeThemeId
	// (before root-data revalidation) would fight a just-picked preset.
	const syncAttemptedForRef = React.useRef<string | null>(null);
	const pristine = preset === 'Thingtime' && !hasOverrides && !appliedThemeShareId;
	const activeThemeId = user?.activeThemeId;
	const userId = user?.id;
	React.useEffect(() => {
		if (loading || !userId || syncAttemptedForRef.current === userId) return;
		syncAttemptedForRef.current = userId;
		if (!activeThemeId || !pristine) return;
		let cancelled = false;
		(async () => {
			try {
				const response = await fetch(
					`/api/v1/themes/shared?id=${encodeURIComponent(activeThemeId)}`,
					{ credentials: 'include' },
				);
				if (!response.ok) return;
				const data = await response.json();
				if (!cancelled && data?.theme?.theme) {
					applyThemeDoc(data.theme.theme, { shareId: data.theme.id });
				}
			} catch (error) {
				// best-effort — defaults stay
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, userId, activeThemeId, pristine]);

	const vars = React.useMemo(() => themeToCssVars(theme), [theme]);
	const snapshotTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
		// Nothing may be written until the localforage blob resolves. Until then
		// `theme` is still the built-in default, and writing it here would
		// overwrite — inline, so at the highest priority — the pre-paint snapshot
		// tt-boot.js just applied, undoing the whole no-flash path: a custom
		// theme (or a switched-off pet) paints correctly, flips to the defaults
		// for as long as hydration takes, then flips back. The snapshot write
		// below is debounced 200ms, so a slow hydration would also persist those
		// defaults over the good snapshot and carry the flash into the next load.
		// Nothing is missing meanwhile: GlobalStyles declares this same default
		// --tt-* set on :root, so a first-ever visit still resolves every token,
		// and so do the getComputedStyle readers (eggs.ts, ConfettiCanvas).
		if (loading) return;

		const root = document.documentElement;
		for (const [key, value] of Object.entries(vars)) {
			root.style.setProperty(key, value);
		}
		window.dispatchEvent(
			new CustomEvent('thingtime:theme-change', { detail: { vars } }),
		);
		// Debounce the pre-paint snapshot — colour-picker drags fire per
		// pointer-move and the synchronous localStorage write is the expensive
		// part; the CSS-var application above stays immediate.
		if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
		snapshotTimerRef.current = setTimeout(() => {
			try {
				window.localStorage.setItem(TT_THEME_SNAPSHOT_KEY, JSON.stringify(vars));
			} catch (error) {
				// localStorage unavailable (private mode) — pre-paint just skips
			}
		}, 200);
		return () => {
			if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
		};
	}, [vars, loading]);

	// Load non-default Google fonts the active theme references.
	const wantedFamilies = React.useMemo(() => {
		const families = [
			theme.fonts.heading,
			theme.fonts.body,
			theme.fonts.mono,
			theme.fonts.display,
		]
			.filter((f) => f && curatedFontNames.has(f) && !STATIC_FONTS.has(f))
			.filter((f, i, arr) => arr.indexOf(f) === i);
		return families;
	}, [theme.fonts.heading, theme.fonts.body, theme.fonts.mono, theme.fonts.display]);

	React.useEffect(() => {
		const existing = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
		if (!wantedFamilies.length) {
			if (existing) existing.remove();
			return;
		}
		const href = googleFontsHref(wantedFamilies);
		if (existing) {
			if (existing.href !== href) existing.href = href;
			return;
		}
		const link = document.createElement('link');
		link.id = FONT_LINK_ID;
		link.rel = 'stylesheet';
		link.href = href;
		document.head.appendChild(link);
	}, [wantedFamilies]);

	return null;
};
