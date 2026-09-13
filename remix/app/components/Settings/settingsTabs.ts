export const SETTINGS_TABS = [
	{ id: 'account', label: 'Account' },
	{ id: 'profile', label: 'Profile' },
	{ id: 'things', label: 'Things' },
	{ id: 'appearance', label: 'Appearance' },
	{ id: 'notifications', label: 'Notifications' },
	{ id: 'security', label: 'Security' },
	{ id: 'connections', label: 'Connections' },
	{ id: 'lopu', label: 'Lopu' },
	{ id: 'ai-waterfalls', label: 'AI waterfalls' },
	{ id: 'admin', label: 'Admin' }
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];
export function resolveSettingsTab(value?: string | null, hash = ''): SettingsTab {
	const knownTab = SETTINGS_TABS.some((tab) => tab.id === value);
	// Credits and invitations moved from Lopu to Account. Preserve both older
	// /settings#... bookmarks and /settings/lopu#... links.
	if ((hash === '#lopu-credits' || hash === '#gift-invites') && (!knownTab || value === 'lopu' || value === 'account')) return 'account';
	if (knownTab) return value as SettingsTab;
	// Keep existing section bookmarks and links working after introducing tabs.
	if (hash === '#ai-waterfalls') return 'ai-waterfalls';
	if (hash === '#secure-vault') return 'security';
	if (hash === '#lopu') return 'lopu';
	return 'profile';
}
export const settingsTabHref = (tab: SettingsTab) => `/settings/${tab}`;
