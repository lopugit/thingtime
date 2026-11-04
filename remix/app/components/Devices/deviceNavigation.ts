/** A device's full Things view. The id stays in the existing account-scoped device selector. */
export const deviceThingsPageHref = (deviceId: string): string =>
	`/things?${new URLSearchParams({ device: deviceId, deviceView: 'page' }).toString()}`;

/** Dedicated sync settings and activity for one account-scoped device. */
export const deviceSyncPageHref = (deviceId: string): string =>
	`/things?${new URLSearchParams({ device: deviceId, deviceView: 'sync' }).toString()}`;

export function deviceViewMode(search: URLSearchParams): 'page' | 'quick' | 'sync' | null {
	if (!search.get('device')) return null;
	const view = search.get('deviceView');
	return view === 'quick' || view === 'sync' ? view : 'page';
}
