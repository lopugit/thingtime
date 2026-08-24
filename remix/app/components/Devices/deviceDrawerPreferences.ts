import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

export const DEVICE_DRAWER_SECTION_IDS = [
	'node',
	'permissions',
	'observed-state',
	'audio',
	'network',
	'system-controls',
	'power',
	'applications',
	'connectors',
	'screen',
	'approvals',
	'command-activity'
] as const;

export type DeviceDrawerSectionId = (typeof DEVICE_DRAWER_SECTION_IDS)[number];

export type DeviceDrawerPreferences = {
	version: 1;
	sections: Record<DeviceDrawerSectionId, boolean>;
	drawerWidth: number | null;
};

const preferenceKeyFor = (deviceId: string): string | null => {
	const normalized = deviceId.trim().slice(0, 160);
	return normalized ? `tt-device-drawer-layout:v1:${encodeURIComponent(normalized)}` : null;
};

export const defaultDeviceDrawerPreferences = (): DeviceDrawerPreferences => ({
	version: 1,
	// Keep the device's everyday controls immediately useful, while detail-heavy
	// and disruptive controls stay tucked away until someone asks for them.
	sections: Object.fromEntries(
		DEVICE_DRAWER_SECTION_IDS.map((section) => [section, section === 'observed-state' || section === 'applications'])
	) as Record<DeviceDrawerSectionId, boolean>,
	drawerWidth: null
});

export const normalizeDeviceDrawerPreferences = (value: unknown): DeviceDrawerPreferences => {
	const defaults = defaultDeviceDrawerPreferences();
	if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;

	const candidate = value as { sections?: unknown; drawerWidth?: unknown };
	const sections = candidate.sections && typeof candidate.sections === 'object' && !Array.isArray(candidate.sections) ? candidate.sections : null;
	for (const section of DEVICE_DRAWER_SECTION_IDS) {
		const expanded = sections ? (sections as Record<string, unknown>)[section] : undefined;
		if (typeof expanded === 'boolean') defaults.sections[section] = expanded;
	}

	if (typeof candidate.drawerWidth === 'number' && Number.isFinite(candidate.drawerWidth) && candidate.drawerWidth > 0) {
		defaults.drawerWidth = Math.round(candidate.drawerWidth);
	}

	return defaults;
};

export const readDeviceDrawerPreferences = (deviceId: string | null | undefined): DeviceDrawerPreferences => {
	const key = deviceId ? preferenceKeyFor(deviceId) : null;
	return normalizeDeviceDrawerPreferences(key ? readLocalCache<unknown>(key) : null);
};

const writeDeviceDrawerPreferences = (deviceId: string, preferences: DeviceDrawerPreferences): void => {
	const key = preferenceKeyFor(deviceId);
	if (!key) return;
	writeLocalCache(key, preferences);
};

export const setDeviceDrawerSectionExpanded = (deviceId: string, section: DeviceDrawerSectionId, expanded: boolean): DeviceDrawerPreferences => {
	const current = readDeviceDrawerPreferences(deviceId);
	const next: DeviceDrawerPreferences = {
		...current,
		sections: { ...current.sections, [section]: expanded }
	};
	writeDeviceDrawerPreferences(deviceId, next);
	return next;
};

export const setDeviceDrawerWidthPreference = (deviceId: string, drawerWidth: number): DeviceDrawerPreferences => {
	const current = readDeviceDrawerPreferences(deviceId);
	const next: DeviceDrawerPreferences = {
		...current,
		drawerWidth: Number.isFinite(drawerWidth) && drawerWidth > 0 ? Math.round(drawerWidth) : null
	};
	writeDeviceDrawerPreferences(deviceId, next);
	return next;
};
