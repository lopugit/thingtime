import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import { useApi } from '../../hooks/useApi';
import { rootIdentity } from '../../utils/rootIdentity';
import { LOCAL_WORKSPACE_CHANGED, workspaceIdentityKey, subscribeWorkspaceIdentity } from '../../local-workspace/runtime.client';
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
	const api = useApi(), apiRef = React.useRef(api); apiRef.current = api;
 const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, () => '');

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

 // Use retained device content first. A failed remote refresh must not erase
 // local customizations or make offline boot depend on the public theme route.
 const pristine = preset === 'Thingtime' && !hasOverrides && !appliedThemeShareId;
 const attempted = React.useRef<string | null>(null);
 React.useEffect(() => {
  if (loading || !identity || attempted.current === identity) return;
  if (!pristine) { attempted.current = identity; return; }
  let cancelled = false, request = 0;
  const generation = rootIdentity.read().generation;
  const pickUp = async () => {
   const turn = ++request;
   try {
    const result = await apiRef.current.v1.themes.list();
    if (cancelled || turn !== request || generation !== rootIdentity.read().generation) return;
    const saved = result?.themes?.find((entry: any) => entry.id === result.activeThemeId);
    if (saved?.theme) { attempted.current = identity; applyThemeDoc(saved.theme, {shareId: saved.id}); }
   } catch { /* Keep the existing look; a later workspace refresh can retry. */ }
  };
  void pickUp(); window.addEventListener(LOCAL_WORKSPACE_CHANGED, pickUp);
  return () => { cancelled = true; request++; window.removeEventListener(LOCAL_WORKSPACE_CHANGED, pickUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [loading, identity, pristine]);

	const vars = React.useMemo(() => themeToCssVars(theme), [theme]);
	const snapshotTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
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
	}, [vars]);

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
