import React from 'react';

import { useThingtime } from '../components/Thingtime/useThingtime';
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
			setThingtime(
				'settings.theme',
				{ preset: name, overrides: {} },
				{ ignoreUndoRedo: true, namespace: 'theme' },
			);
		},
		[setThingtime],
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
				},
				{ ignoreUndoRedo: true, namespace: 'theme' },
			);
		},
		[setThingtime],
	);

	return {
		theme,
		preset,
		overrides,
		appliedThemeName: settings.appliedThemeName,
		appliedThemeShareId: settings.appliedThemeShareId,
		builtinThemes: BUILTIN_THEMES,
		hasOverrides: Object.keys(overrides || {}).length > 0,
		setPreset,
		setColor,
		setRainbowStop,
		setFont,
		setGeneral,
		resetOverrides,
		applyThemeDoc,
	};
};
