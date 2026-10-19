import type { LocalTrashContext } from './localTrash';
import { getNativeBridge } from '../utils/nativeBridge';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { parseFileSyncConfiguration } from './configuration';
import type { LocalSyncTarget } from './localSyncTarget';
import { sameSyncScope, validateSyncScope, type SyncScope } from './reconcile';
import {
	requestMobileFolders,
	supportsMobileFolderPublication,
	supportsMobileTrash,
	supportsMobileTrashTransitions,
	supportsNativeWriteApprovalCheck,
	supportsNativeIgnoreRules,
	type FolderCapabilities,
	type MobileWriteApproval
} from './mobileFolders.client';
import { stageMobileCopy } from './mobileStaging.client';

/** Native consent is separate from the editable configuration. Its binding is
 * invalidated by a settings change or a newly selected native folder grant. */
export async function approveMobileSyncTarget(
	saved: SavedFileSyncConfiguration,
	scope: SyncScope,
	signal: AbortSignal,
	request = requestMobileFolders,
	bridge: FolderCapabilities | undefined = getNativeBridge(),
	consent: 'request' | 'existing' = 'request'
): Promise<LocalSyncTarget> {
	validateSyncScope(scope);
	if (consent === 'existing' && !supportsNativeWriteApprovalCheck(bridge))
		throw Error('Update the app to resume with saved folder approval without a dialog.');
	const configuration = parseFileSyncConfiguration(saved.configuration),
		rootId = configuration.localRootId;
	if (configuration.ignoreRules && !supportsNativeIgnoreRules(bridge)) throw Error('Update Thingtime Mac to apply Gitignore rules before syncing.');
	if (saved.id !== scope.rootId || configuration.deviceId !== scope.deviceId) throw Error('Sync approval scope changed.');
	const roots = (await request(scope.ownerId, { action: 'list' }, signal)).roots;
	if (
		!supportsMobileFolderPublication(
			roots.find((root) => root.id === rootId),
			bridge
		)
	)
		throw Error('Downloads are unavailable for this device folder. On Android, choose a Thingtime offline folder.');
	if (configuration.propagateDeletes && !supportsMobileTrash(bridge)) throw Error('Recoverable native trash is unavailable on this device.');
	const bytes = new TextEncoder().encode(JSON.stringify(configuration));
	const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
	const approval: MobileWriteApproval = {
		scope: { ...scope },
		configurationRevision: saved.updatedAt,
		configurationHash: hash,
		...(configuration.propagateDeletes ? { allowTrash: true } : {})
	};
	signal.throwIfAborted();
	const checkApproval = async (action: 'write-approve' | 'write-check') => {
		signal.throwIfAborted();
		const approved = await request(scope.ownerId, { action, rootId, approval }, signal);
		signal.throwIfAborted();
		if (!approved.writeApproval || JSON.stringify(approved.writeApproval) !== JSON.stringify(approval))
			throw Error('Native folder write approval is unavailable.');
	};
	await checkApproval(consent === 'existing' ? 'write-check' : 'write-approve');
	const recheckApproval = async () => {
		if (supportsNativeWriteApprovalCheck(bridge)) await checkApproval('write-check');
	};
	const transfer = (operation: Parameters<LocalSyncTarget['lookup']>[0], current: SyncScope, context?: LocalTrashContext) => {
		signal.throwIfAborted();
		if (!sameSyncScope(scope, current)) throw Error('Native download scope changed.');
		if (context && (context.parent || context.childrenOperationId) && !supportsMobileTrashTransitions(bridge))
			throw Error('Update the app to safely remove folders after their children.');
		return { ...structuredClone(context ?? {}), scope: { ...scope }, rootId, operation: { ...structuredClone(operation), confirmed: false } };
	};
	return {
		...(configuration.propagateDeletes
			? {
					trash: async (operation: Parameters<LocalSyncTarget['lookup']>[0], current: SyncScope, context?: LocalTrashContext) => {
						const input = transfer(operation, current, context);
						await recheckApproval();
						const result = await request(scope.ownerId, { action: 'trash', rootId, trash: input, approval }, signal);
						if (result.trash?.status !== 'complete') throw Error('Native trash is not confirmed.');
						return result.trash.receipt;
					}
			  }
			: {}),
		...(configuration.propagateDeletes && supportsMobileTrashTransitions(bridge)
			? {
					trashExpected: async (operation: Parameters<LocalSyncTarget['lookup']>[0], current: SyncScope, context?: LocalTrashContext) => {
						const result = await request(scope.ownerId, { action: 'trash-expected', rootId, trash: transfer(operation, current, context) }, signal);
						if (!result.expectedEntry) throw Error('Native folder precondition is unavailable.');
						return result.expectedEntry;
					}
			  }
			: {}),
		lookup: async (operation, current, context) => {
			if (operation.mutation.kind === 'trash' && operation.mutation.side === 'local') {
				if (!supportsMobileTrash(bridge)) throw Error('Recoverable native trash is unavailable on this device.');
				const result = await request(scope.ownerId, { action: 'trash-lookup', rootId, trash: transfer(operation, current, context) }, signal);
				if (!result.trash) throw Error('Native trash lookup is unavailable.');
				return result.trash;
			}
			const result = await request(scope.ownerId, { action: 'publication-lookup', rootId, transfer: transfer(operation, current) }, signal);
			if (!result.publication) throw Error('Native publication lookup is unavailable.');
			return result.publication;
		},
		reportsTransferBytes: true,
		stage: async (operation, current, source, transferred) => {
			const input = transfer(operation, current);
			await recheckApproval();
			return stageMobileCopy(input.scope, rootId, input.operation, source, signal, request, bridge, transferred);
		},
		publish: async (operation, current, stage) => {
			const input = transfer(operation, current);
			await recheckApproval();
			const result = await request(scope.ownerId, { action: 'publish', rootId, transfer: input, stage, approval }, signal);
			if (result.publication?.status !== 'complete') throw Error('Native download is not confirmed.');
			return result.publication.receipt;
		}
	};
}
