import { configurationDraftKey, readConfigurationDrafts, type ConfigurationEditorScope } from '~/fileSync/configurationEditor';
import type { SavedFileSyncConfiguration } from '~/fileSync/configuredPlan';

type Listener = (saved: SavedFileSyncConfiguration) => void;
const listeners = new Map<string, Set<Listener>>();
const key = ({ origin, ownerId, dataPlane, deviceId }: ConfigurationEditorScope, generation: number) => JSON.stringify([origin, ownerId, dataPlane, deviceId, generation]);

export function hasSavedSyncDraft(scope: ConfigurationEditorScope, id: string) {
	const { origin, ownerId, dataPlane, deviceId } = scope;
	// Local and remote editors have existing journals in these two key orders.
	// Do not move or merge either one just to check the requested connection.
	return [{ origin, ownerId, dataPlane, deviceId }, { origin, ownerId, deviceId, dataPlane }].some(address =>
		readConfigurationDrafts(window.localStorage.getItem(configurationDraftKey(address)), deviceId).some(draft => draft.id === id));
}

// The local and account settings panels can coexist. Share only their verified
// save receipts, scoped to the mounted identity; the API remains authoritative.
export function observeSavedSyncConnections(scope: ConfigurationEditorScope, generation: number, listener: Listener) {
	const id = key(scope, generation), scoped = listeners.get(id) ?? new Set<Listener>();
	scoped.add(listener);
	listeners.set(id, scoped);
	return () => {
		scoped.delete(listener);
		if (!scoped.size) listeners.delete(id);
	};
}

export function publishSavedSyncConnection(scope: ConfigurationEditorScope, generation: number, saved: SavedFileSyncConfiguration) {
	if (saved.configuration.deviceId !== scope.deviceId) return;
	for (const receive of listeners.get(key(scope, generation)) ?? []) receive(saved);
}

export function reconcileSavedSyncList(before: SavedFileSyncConfiguration[], current: SavedFileSyncConfiguration[], listed: SavedFileSyncConfiguration[], append: boolean) {
	const rows = new Map((append ? current : []).map(row => [row.id, row]));
	const requested = new Map(before.map(row => [row.id, row]));
	for (const row of listed) rows.set(row.id, row);
	for (const row of current) {
		const listed = rows.get(row.id);
		// A save receipt can arrive while the list request is in flight.
		if (row !== requested.get(row.id) && (!listed || Date.parse(row.updatedAt) >= Date.parse(listed.updatedAt))) rows.set(row.id, row);
	}
	return [...rows.values()];
}
