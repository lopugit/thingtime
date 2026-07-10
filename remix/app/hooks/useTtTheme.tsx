import React from 'react';

import { useThingtime } from '../components/Thingtime/useThingtime';
import { sanitizeCustomClasses, TtCustomEntry, TtCustomMap } from '../theme/customise';
import {
	BUILTIN_THEMES,
	getBuiltinTheme,
	resolveTheme,
	TtTheme,
	TtThemePatch,
} from '../theme/tokens';

export interface TtThemeSettings {
	preset?: string;
	overrides?: TtThemePatch;
	appliedThemeName?: string;
	appliedThemeShareId?: string;
	/** Per-option custom classes/CSS — personal, never part of shared themes. */
	custom?: TtCustomMap;
}

/**
 * Theme settings state — mirrors the useDrawer pattern: persisted at
 * thingtime.settings.theme.* via setThingtime with ignoreUndoRedo so theme
 * tweaks stay out of the ctrl+z timeline (namespace 'theme').
 */
export const useTtTheme = () => {
	const { thingtime, setThingtime } = useThingtime();

	const settings: TtThemeSettings = thingtime?.settings?.theme || {};
	const preset = typeof settings.preset === 'string' ? settings.preset : 'Thingtime';
	const overrides = settings.overrides || {};
	const custom: TtCustomMap = settings.custom && typeof settings.custom === 'object' ? settings.custom : {};

	const theme: TtTheme = React.useMemo(
		() => resolveTheme(getBuiltinTheme(preset), overrides),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[preset, JSON.stringify(overrides)],
	);

	const setThemeSetting = React.useCallback(
		(path: string, value: unknown) => {
			setThingtime(`settings.theme.${path}`, value, {
				ignoreUndoRedo: true,
				namespace: 'theme',
			});
		},
		[setThingtime],
	);

	const setPreset = React.useCallback(
		(name: string) => {
			// switching preset resets token overrides but keeps personal
			// custom classes/CSS — they're orthogonal escape hatches
			setThingtime(
				'settings.theme',
				{ preset: name, overrides: {}, custom },
				{ ignoreUndoRedo: true, namespace: 'theme' },
			);
		},
		[setThingtime, custom],
	);

	const setColor = React.useCallback(
		(key: string, value: string) => setThemeSetting(`overrides.colors.${key}`, value),
		[setThemeSetting],
	);

	const setRainbowStop = React.useCallback(
		(index: number, value: string) => {
			const rainbow = [...theme.colors.rainbow];
			rainbow[index] = value;
			setThemeSetting('overrides.colors.rainbow', rainbow);
		},
		[setThemeSetting, theme.colors.rainbow],
	);

	const setFont = React.useCallback(
		(key: string, value: string) => setThemeSetting(`overrides.fonts.${key}`, value),
		[setThemeSetting],
	);

	const setGeneral = React.useCallback(
		(key: string, value: unknown) => setThemeSetting(`overrides.general.${key}`, value),
		[setThemeSetting],
	);

	const setWindows = React.useCallback(
		(key: string, value: unknown) => setThemeSetting(`overrides.windows.${key}`, value),
		[setThemeSetting],
	);

	/** Merge a patch into settings.theme.custom[key] (null clears the entry). */
	// writes in the same tick merge through pendingCustomRef so a second
	// setCustomEntry can't clobber the first before state catches up
	const pendingCustomRef = React.useRef<TtCustomMap | null>(null);

	React.useEffect(() => {
		pendingCustomRef.current = null;
	});

	const setCustomEntry = React.useCallback(
		(key: string, patch: Partial<TtCustomEntry> | null) => {
			// option keys contain dots ('windows.close'), so always write the
			// whole map — never a dot-path that setThingtime would split
			const base = pendingCustomRef.current || custom;
			const next = { ...base };
			if (patch === null) {
				delete next[key];
			} else {
				next[key] = { ...(base[key] || {}), ...patch };
			}
			pendingCustomRef.current = next;
			setThemeSetting('custom', next);
		},
		[setThemeSetting, custom],
	);

	// resetOverrides is the nuclear "back to defaults" — it clears custom too
	const resetOverrides = React.useCallback(() => {
		setThingtime(
			'settings.theme',
			{ preset, overrides: {} },
			{ ignoreUndoRedo: true, namespace: 'theme' },
		);
	}, [setThingtime, preset]);

	/** Apply a full theme document (saved/shared theme) on the default base. */
	const applyThemeDoc = React.useCallback(
		(doc: TtThemePatch & { name?: string }, meta?: { shareId?: string }) => {
			setThingtime(
				'settings.theme',
				{
					preset: 'Thingtime',
					overrides: doc,
					appliedThemeName: doc?.name,
					appliedThemeShareId: meta?.shareId,
					custom,
				},
				{ ignoreUndoRedo: true, namespace: 'theme' },
			);
		},
		[setThingtime, custom],
	);

	return {
		theme,
		preset,
		overrides,
		custom,
		appliedThemeName: settings.appliedThemeName,
		appliedThemeShareId: settings.appliedThemeShareId,
		builtinThemes: BUILTIN_THEMES,
		hasOverrides: Object.keys(overrides || {}).length > 0,
		setPreset,
		setColor,
		setRainbowStop,
		setFont,
		setGeneral,
		setWindows,
		setCustomEntry,
		resetOverrides,
		applyThemeDoc,
	};
};

/**
 * Custom classes for one element-backed theming option — components attach
 * these to the live element so user CSS (from the customise popover or
 * anywhere else) can hook it.
 */
export const useTtCustomClasses = (key: string): string => {
	const { thingtime } = useThingtime();
	const entry = thingtime?.settings?.theme?.custom?.[key];

	return React.useMemo(() => sanitizeCustomClasses(entry?.classes), [entry?.classes]);
};

/**
 * The active icon language without a full theme resolve — cheap enough for
 * the hundreds of Icon instances a tree can render. Reads the override
 * directly; every builtin preset defaults to 'emoji'.
 */
export const useTtIconStyle = (): 'emoji' | 'lucide' => {
	const { thingtime } = useThingtime();

	return thingtime?.settings?.theme?.overrides?.general?.iconStyle === 'lucide' ? 'lucide' : 'emoji';
};
