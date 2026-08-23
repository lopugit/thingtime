import type { DeviceActionKind } from './deviceTypes';

export type LocalNodeBadgePresentation = {
	colorScheme: 'gray' | 'green';
	label: string;
	showChecking: boolean;
};

export const localNodeActionKey = (action: DeviceActionKind, targetKey?: string | null): string => `local-${action}-${targetKey || 'node'}`;

export const localNodeActionIsBusy = (pendingActionKeys: readonly string[], action: DeviceActionKind, targetKey?: string | null): boolean =>
	pendingActionKeys.includes(localNodeActionKey(action, targetKey));

export const localNodeBadgePresentation = ({
	checking,
	paired,
	pairedAccountCount,
	pairedToCurrentAccount,
	recoverablePairing,
	registered
}: {
	checking: boolean;
	paired: boolean;
	pairedAccountCount: number;
	pairedToCurrentAccount: boolean | null;
	recoverablePairing: boolean;
	registered: boolean;
}): LocalNodeBadgePresentation => {
	const pairedLabel = `${pairedAccountCount} ${pairedAccountCount === 1 ? 'account' : 'accounts'} paired`;
	const label = recoverablePairing
		? 'resume pairing'
		: pairedToCurrentAccount
		? pairedLabel
		: registered && paired
		? `${pairedLabel} elsewhere`
		: registered
		? 'ready to pair'
		: 'not running';

	return {
		colorScheme: registered ? 'green' : 'gray',
		label,
		showChecking: checking
	};
};
