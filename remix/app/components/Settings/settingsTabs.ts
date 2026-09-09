export const SETTINGS_TABS = [
	{ id: 'profile', label: 'Profile' },
	{ id: 'things', label: 'Things' },
	{ id: 'appearance', label: 'Appearance' },
	{ id: 'notifications', label: 'Notifications' },
	{ id: 'security', label: 'Security' },
	{ id: 'connections', label: 'Connections' },
	{ id: 'lopu', label: 'Lopu' },
	{ id: 'admin', label: 'Admin' }
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
export function resolveSettingsTab(value?: string | null, hash = ''): SettingsTab {
	if (SETTINGS_TABS.some((tab) => tab.id === value)) return value as SettingsTab;
	// Keep existing section bookmarks and links working after introducing tabs.
	if (hash === '#secure-vault') return 'security';
	if (hash === '#lopu' || hash === '#lopu-credits') return 'lopu';
	return 'profile';
}
export const settingsTabHref = (tab: SettingsTab) => `/settings/${tab}`;
