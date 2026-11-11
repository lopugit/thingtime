import { readStampedCache } from '../hooks/localCache';
import { parseBackupCoverageDescriptor, readBackupCoveragePage } from './backupCoverage.client';
import { readOwnedFileSyncConfiguration } from './configuredPlan';
import type { FolderHost } from './desktopFolders.client';
import { openSyncJournal } from './journal.client';
import { nativeSyncTasks } from './nativeSyncTasks.client';
import { parseSyncProgressDescriptor, projectSyncProgress } from './progressProjection';
import { createJournalSyncProgressSource } from './progressProjection.client';
import { sameSyncScope, syncScopeKey, type SyncScope } from './reconcile';
import { validateRemoteSyncDetailsCommand, type RemoteSyncDetails, type RemoteSyncDetailsCommand } from './remoteSyncDetails';
import { parseUploadPriorityDraft } from './uploadPriorityEditor';

export type RemoteSyncDetailsContext = {
	ownerId: string; deviceId: string; host: FolderHost; signal: AbortSignal;
	check(): void; scope(connectionId: string): SyncScope;
};
export function currentRemoteSyncDetails(scope: SyncScope): RemoteSyncDetails {
	const task = nativeSyncTasks.read();
	const selected = task && sameSyncScope(task.scope, scope) ? task : null;
	// An active new run must never fall back to the previous run's successful tree.
	const progress = selected ? selected.progressDescriptor : readStampedCache('tt:sync-progress-tree:' + syncScopeKey(scope));
	const inventory = selected ? selected.inventoryDescriptor : readStampedCache('tt:sync-inventory:' + syncScopeKey(scope));
	const progressDescriptor = progress ? parseSyncProgressDescriptor(progress) : undefined;
	const inventoryDescriptor = inventory ? parseBackupCoverageDescriptor(inventory) : undefined;
	if ((progressDescriptor && !sameSyncScope(progressDescriptor.scope, scope)) || (inventoryDescriptor && !sameSyncScope(inventoryDescriptor.scope, scope)))
		throw Error('The saved sync detail scope changed.');
	return { ...(progressDescriptor ? { progressDescriptor } : {}), ...(inventoryDescriptor ? { inventoryDescriptor } : {}) };
}

/** Reuse native journal readers on the device; only the requested metadata page
 * crosses the control channel. No browser journal or second transfer is made. */
export async function executeRemoteSyncDetails(value: RemoteSyncDetailsCommand, context: RemoteSyncDetailsContext,
	dependencies: { details?: typeof currentRemoteSyncDetails; open?: typeof openSyncJournal } = {}) {
	const command = validateRemoteSyncDetailsCommand(value), scope = context.scope(command.connectionId);
	const check = () => {
		context.signal.throwIfAborted(); context.check();
		if (scope.ownerId !== context.ownerId || scope.deviceId !== context.deviceId || scope.dataPlane !== 'home' ||
			scope.rootId !== command.connectionId || scope.origin !== context.host.origin()) throw Error('The remote sync scope changed.');
		return scope;
	};
	check();
	const url = new URL('/api/v1/things', scope.origin); url.searchParams.set('id', command.connectionId);
	const response = await context.host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: context.signal,
		headers: { 'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
	check();
	if (!response.ok) throw Error('The saved sync connection could not be verified.');
	const payload = await response.json(); check();
	const saved = readOwnedFileSyncConfiguration(payload.thing, context.ownerId);
	if (saved.id !== command.connectionId || saved.configuration.deviceId !== context.deviceId) throw Error('The saved connection belongs to another device.');
	const open = dependencies.open ?? openSyncJournal;
	if (command.action === 'priorities') {
		const journal = await open();
		try {
			check();
			const priorities = journal.priorities({ scope, currentScope: check, signal: context.signal });
			const result = command.operation === 'read' ? await priorities.read() : await priorities.save(
				parseUploadPriorityDraft(command.paths.join('\n'), saved.configuration), command.expectedRevision);
			check(); return result;
		} finally { journal.close(); }
	}
	const details = (dependencies.details ?? currentRemoteSyncDetails)(scope); check();
	if (command.action === 'details') return details;
	if (command.action === 'progress') {
		const descriptor = details.progressDescriptor;
		if (!descriptor || descriptor.run.id !== command.runId || !sameSyncScope(descriptor.scope, scope)) throw Error('The sync run changed. Refresh its progress.');
		const task = nativeSyncTasks.read();
		const page = await projectSyncProgress(createJournalSyncProgressSource(descriptor, check, open), {
			parent: command.parent, after: command.after, signal: context.signal,
			activePath: task && sameSyncScope(task.scope, scope) ? task.progress.path : undefined
		});
		check(); return page;
	}
	const descriptor = details.inventoryDescriptor;
	if (!descriptor || descriptor.inventory.id !== command.inventoryId || descriptor.inventory.generation !== command.generation || !sameSyncScope(descriptor.scope, scope))
		throw Error('The backup inventory changed. Refresh its coverage.');
	const page = await readBackupCoveragePage(descriptor, check, command.offset, context.signal, open);
	check(); return page;
}
