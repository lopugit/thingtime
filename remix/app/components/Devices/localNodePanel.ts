import type { LocalThingtimeNodeState } from './useLocalThingtimeNode';
export const nodePanelPreferenceKey = (userId?: string | null) => `tt-local-node-panel:${userId || 'signed-out'}`;
export function localNodeIsHealthy(state: LocalThingtimeNodeState): boolean {
	return Boolean(
		state.available &&
			state.status?.loginItem?.registered &&
			state.status.serviceStatus === 'running' &&
			state.status.pairingStatus === 'paired' &&
			state.pairedToCurrentAccount === true &&
			// The native bridge reports unknown when cloud transport is not exposed.
			// Explicit transport failures still reveal the panel.
			(state.status.transportStatus === 'online' || state.status.transportStatus === 'unknown') &&
			!state.status.lastError &&
			!state.permissionCheckError &&
			state.permissionsCheckedAt &&
			['accessibility', 'screenRecording'].every((kind) =>
				state.permissions.some(
					(permission) =>
						(permission.kind === kind || (kind === 'screenRecording' && permission.kind === 'screen-recording')) && permission.status === 'authorized'
				)
			)
	);
}
export function shouldHideLocalNodePanel(state: LocalThingtimeNodeState, dismissed: boolean): boolean {
	if (!dismissed) return false;
	// Preserve the dismissed first paint while the first live check runs. A failed
	// check always reveals recovery, including when no status could be fetched.
	if (!state.status && !state.permissionCheckError) return true;
	return localNodeIsHealthy(state.pairedToCurrentAccount === null ? { ...state, pairedToCurrentAccount: true } : state);
}
