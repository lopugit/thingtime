import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { apiErrorMessage } from '~/hooks/apiFailure';
import {
	getElectronBridge,
	type ThingtimeNodePairingChallenge,
	type ThingtimeNodePermission,
	type ThingtimeNodeStatus
} from '~/utils/electronBridge';

import type { DeviceActionControl, DeviceActionHandler, DeviceActionIntent, DeviceControlResolver } from './DeviceStateGrid';
import type { DeviceActionKind, DeviceActionPolicy } from './deviceTypes';

const LOCAL_ACTIONS = new Set<DeviceActionKind>([
	'register-service',
	'unregister-service',
	'begin-pairing',
	'complete-pairing',
	'unpair',
	'request-permission',
	'open-permission-settings',
	'register-project'
]);

const inputString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const allowedPolicy = (): DeviceActionPolicy => ({
	allowed: true,
	delivery: 'local',
	reason: 'ready',
	message: null,
	capabilityId: null,
	requiredPermissions: [],
	approvalRequired: false
});

const blockedPolicy = (message: string): DeviceActionPolicy => ({
	allowed: false,
	delivery: 'blocked',
	reason: 'local-only',
	message,
	capabilityId: null,
	requiredPermissions: [],
	approvalRequired: false
});

const methodForAction = (bridge: ReturnType<typeof getElectronBridge>, action: DeviceActionKind): boolean => {
	if (action === 'register-service') return Boolean(bridge?.nodeRegisterService);
	if (action === 'unregister-service') return Boolean(bridge?.nodeUnregisterService);
	if (action === 'begin-pairing') return Boolean(bridge?.nodeCompletePairing || bridge?.nodeResumePairing);
	if (action === 'complete-pairing') return Boolean(bridge?.nodeCompletePairing);
	if (action === 'unpair') return Boolean(bridge?.nodeUnpair);
	if (action === 'open-permission-settings') return Boolean(bridge?.nodeOpenPermissionSettings);
	if (action === 'register-project') return Boolean(bridge?.nodeAddProject);
	// Permission prompts remain preflight-only. The settings deep link above is
	// a deliberate renderer gesture, validated and confirmed by Electron.
	return false;
};

export type LocalThingtimeNodeState = {
	available: boolean;
	loading: boolean;
	status: ThingtimeNodeStatus | null;
	permissions: ThingtimeNodePermission[];
	pairingChallenge: ThingtimeNodePairingChallenge | null;
};

export const useLocalThingtimeNode = (selectedDeviceId?: string | null, onPaired?: () => void | Promise<void>) => {
	const lopu = useLopu();
	const lopuRef = useRef(lopu);
	lopuRef.current = lopu;
	const bridge = typeof window === 'undefined' ? undefined : getElectronBridge();
	const [state, setState] = useState<LocalThingtimeNodeState>({
		available: Boolean(bridge?.nodeGetStatus),
		loading: false,
		status: null,
		permissions: [],
		pairingChallenge: null
	});

	const refresh = useCallback(async () => {
		const currentBridge = getElectronBridge();
		if (!currentBridge?.nodeGetStatus) {
			setState((previous) => ({ ...previous, available: false, loading: false }));
			return;
		}
		setState((previous) => ({ ...previous, available: true, loading: true }));
		try {
			const [statusResult, permissionsResult] = await Promise.allSettled([currentBridge.nodeGetStatus(), currentBridge.nodeGetPermissions?.()]);
			if (statusResult.status === 'rejected') throw statusResult.reason;
			setState((previous) => ({
				...previous,
				available: true,
				loading: false,
				status: statusResult.value,
				permissions:
					permissionsResult.status === 'fulfilled' && permissionsResult.value?.permissions
						? permissionsResult.value.permissions
						: previous.permissions
			}));
		} catch (error) {
			setState((previous) => ({ ...previous, available: true, loading: false }));
			lopuRef.current({
				title: 'Couldn’t read the local Thingtime node 😔',
				description: apiErrorMessage(error, 'Open Thingtime Desktop and try again.'),
				status: 'error'
			});
		}
	}, []);

	useEffect(() => {
		if (!bridge?.nodeGetStatus) return;
		void refresh();
	}, [bridge?.nodeGetStatus, refresh, selectedDeviceId]);

	useEffect(() => {
		if (!bridge?.nodeGetStatus || typeof window === 'undefined') return;
		const refreshAfterSettings = () => void refresh();
		window.addEventListener('focus', refreshAfterSettings);
		return () => window.removeEventListener('focus', refreshAfterSettings);
	}, [bridge?.nodeGetStatus, refresh]);

	const isSelectedLocalNode = Boolean(selectedDeviceId) && Boolean(state.status?.deviceId) && selectedDeviceId === state.status?.deviceId;

	const controlFor = useCallback<DeviceControlResolver>(
		(action, targetKey) => {
			if (!LOCAL_ACTIONS.has(action)) return null;
			const currentBridge = getElectronBridge();
			const supported = methodForAction(currentBridge, action);
			let policy: DeviceActionPolicy;
			if (!supported) {
				policy = blockedPolicy(
					action === 'request-permission' || action === 'open-permission-settings'
						? 'Thingtime Desktop can preflight this permission, but does not prompt for it from the web UI.'
						: 'This setup control is only available in a compatible Thingtime Desktop build.'
				);
			} else if (action === 'begin-pairing' && state.status?.loginItem?.registered !== true) {
				policy = blockedPolicy('Start the Thingtime Node service before pairing this Mac.');
			} else if (action === 'register-project' && state.status?.loginItem?.registered !== true) {
				policy = blockedPolicy('Start the Thingtime Node service before adding a local Codex project.');
			} else if (selectedDeviceId && !isSelectedLocalNode) {
				policy = blockedPolicy('Open Thingtime on that computer to change its local node setup.');
			} else {
				policy = allowedPolicy();
			}
			const control: DeviceActionControl = {
				policy,
				idempotencyKey: `local-${action}-${targetKey || 'node'}`,
				busy: state.loading,
				pendingLabel: 'Working'
			};
			return control;
		},
		[isSelectedLocalNode, selectedDeviceId, state.loading, state.status?.loginItem?.registered]
	);

	const executeAction = useCallback<DeviceActionHandler>(
		(intent: DeviceActionIntent) => {
			const run = async () => {
				const currentBridge = getElectronBridge();
				if (!methodForAction(currentBridge, intent.action)) return;
				setState((previous) => ({ ...previous, loading: true }));
				try {
					if (intent.action === 'complete-pairing') {
						const pairingSecret = typeof intent.input?.pairingSecret === 'string' ? intent.input.pairingSecret.trim() : '';
						const commandId = intent.commandId || inputString(intent.input?.commandId);
						if (!pairingSecret || !commandId) throw new Error('Pairing requires the server challenge and command id.');
						const completed = await currentBridge?.nodeCompletePairing?.({ pairingSecret, commandId });
						if (completed?.pairingStatus !== 'paired') {
							setState((previous) => ({ ...previous, loading: false, status: completed ?? previous.status }));
							return;
						}
						await onPaired?.();
					} else if (intent.action === 'begin-pairing') {
						const latestStatus = await currentBridge?.nodeGetStatus?.();
						let completed: ThingtimeNodeStatus | undefined;
						if (latestStatus?.recoverablePairing === true) {
							if (!currentBridge?.nodeResumePairing) {
								throw new Error('This Thingtime Desktop build cannot resume the pending pairing safely.');
							}
							completed = await currentBridge.nodeResumePairing({ commandId: `pair-resume-${crypto.randomUUID()}` });
						} else {
							const response = await fetch('/api/v1/devices/pairing', {
								method: 'POST',
								credentials: 'include',
								headers: { Accept: 'application/json' }
							});
							const payload = (await response.json().catch(() => null)) as {
								ok?: boolean;
								error?: string;
								pairing?: { pairingSecret?: string; expiresAt?: string };
							} | null;
							const pairingSecret = payload?.pairing?.pairingSecret;
							if (!response.ok || payload?.ok !== true || !pairingSecret) {
								throw new Error(payload?.error || 'Thingtime could not create a device pairing.');
							}
							if (!currentBridge?.nodeCompletePairing) {
								throw new Error('This Thingtime Desktop build cannot complete pairing.');
							}
							completed = await currentBridge.nodeCompletePairing({
								pairingSecret,
								commandId: `pair-${crypto.randomUUID()}`
							});
						}
						if (completed?.pairingStatus !== 'paired') {
							setState((previous) => ({ ...previous, loading: false, status: completed ?? latestStatus ?? previous.status }));
							return;
						}
						setState((previous) => ({ ...previous, pairingChallenge: null }));
						await onPaired?.();
					} else if (intent.action === 'register-service') {
						await currentBridge?.nodeRegisterService?.();
					} else if (intent.action === 'unregister-service') {
						await currentBridge?.nodeUnregisterService?.();
					} else if (intent.action === 'unpair') {
						const commandId = intent.commandId || inputString(intent.input?.commandId);
						if (!commandId) throw new Error('Unpairing requires a server command id.');
						await currentBridge?.nodeUnpair?.({ commandId });
					} else if (intent.action === 'open-permission-settings') {
						const rawKind = inputString(intent.input?.permissionKind);
						const kind = rawKind === 'accessibility' || rawKind === 'screen-recording' ? rawKind : null;
						if (!kind) throw new Error('Choose Accessibility or Screen Recording.');
						await currentBridge?.nodeOpenPermissionSettings?.({ kind });
					} else if (intent.action === 'register-project') {
						const result = await currentBridge?.nodeAddProject?.();
						if (result?.cancelled === false) {
							lopuRef.current({
								title: `${result.project.projectLabel} is available to this Thingtime node ✨`,
								description: 'Only its opaque project id and folder name can sync to your account.',
								status: 'success'
							});
							await onPaired?.();
						}
					}
					await refresh();
				} catch (error) {
					setState((previous) => ({ ...previous, loading: false }));
					lopuRef.current({
						title: 'That local node action didn’t work 😔',
						description: apiErrorMessage(error, 'Try again from Thingtime Desktop.'),
						status: 'error'
					});
				}
			};
			void run();
		},
		[onPaired, refresh]
	);

	return useMemo(
		() => ({ ...state, isSelectedLocalNode, refresh, controlFor, executeAction }),
		[controlFor, executeAction, isSelectedLocalNode, refresh, state]
	);
};
