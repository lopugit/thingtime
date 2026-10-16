import { getNativeBridge } from '../utils/nativeBridge';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { parseFileSyncConfiguration } from './configuration';
import type { LocalSyncTarget } from './localSyncTarget';
import { sameSyncScope, validateSyncScope, type SyncScope } from './reconcile';
import { requestMobileFolders, supportsMobileFolderPublication, type FolderCapabilities, type MobileWriteApproval } from './mobileFolders.client';
import { stageMobileCopy } from './mobileStaging.client';

/** Native consent is separate from the editable configuration. Its binding is
 * invalidated by a settings change or a newly selected native folder grant. */
export async function approveMobileSyncTarget(
	saved: SavedFileSyncConfiguration,
	scope: SyncScope,
	signal: AbortSignal,
	request = requestMobileFolders,
	bridge: FolderCapabilities | undefined = getNativeBridge()
): Promise<LocalSyncTarget> {
	validateSyncScope(scope);
	const configuration = parseFileSyncConfiguration(saved.configuration),
		rootId = configuration.localRootId;
	if (saved.id !== scope.rootId || configuration.deviceId !== scope.deviceId) throw Error('Sync approval scope changed.');
	const roots = (await request(scope.ownerId, { action: 'list' }, signal)).roots;
	if (
		!supportsMobileFolderPublication(
			roots.find((root) => root.id === rootId),
			bridge
		)
	)
		throw Error('Downloads are unavailable for this device folder. On Android, choose a Thingtime offline folder.');
	const bytes = new TextEncoder().encode(JSON.stringify(configuration));
	const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
	const approval: MobileWriteApproval = { scope: { ...scope }, configurationRevision: saved.updatedAt, configurationHash: hash };
	signal.throwIfAborted();
	const approved = await request(scope.ownerId, { action: 'write-approve', rootId, approval }, signal);
	if (!approved.writeApproval || JSON.stringify(approved.writeApproval) !== JSON.stringify(approval))
		throw Error('Native folder write approval is unavailable.');
	const transfer = (operation: Parameters<LocalSyncTarget['lookup']>[0], current: SyncScope) => {
		signal.throwIfAborted();
		if (!sameSyncScope(scope, current)) throw Error('Native download scope changed.');
		return { scope: { ...scope }, rootId, operation: { ...structuredClone(operation), confirmed: false } };
	};
	return {
		lookup: async (operation, current) => {
			const result = await request(scope.ownerId, { action: 'publication-lookup', rootId, transfer: transfer(operation, current) }, signal);
			if (!result.publication) throw Error('Native publication lookup is unavailable.');
			return result.publication;
		},
		stage: (operation, current, source) => {
			const input = transfer(operation, current);
			return stageMobileCopy(input.scope, rootId, input.operation, source, signal, request);
		},
		publish: async (operation, current, stage) => {
			const result = await request(scope.ownerId, { action: 'publish', rootId, transfer: transfer(operation, current), stage, approval }, signal);
			if (result.publication?.status !== 'complete') throw Error('Native download is not confirmed.');
			return result.publication.receipt;
		}
	};
}
