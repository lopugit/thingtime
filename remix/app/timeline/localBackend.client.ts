import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineLocalStore } from './localStore';
import { TIMELINE_CHANGED_EVENT } from './clientEvents';
import type { ActionOutcomeRecovery } from './actionRecovery';
import type { TimelineScope } from './contract';
import { AccountTimeline, AccountTimelineStore } from '../local-workspace/accountTimeline';
import { currentAccountWorkspace, accountWorkspaceLease, workspaceDatabase } from '../local-workspace/runtime.client';
import { WorkspaceError } from '../local-workspace/storage';

let backend: IndexedDbTimelineBackend | null = null;
export const localTimelineBackend = () => backend ??= new IndexedDbTimelineBackend(window.indexedDB);

/** The current account may read its selected partition or its home partition.
 * Both keep the selected-account lease, so changing identity or selection retires
 * an old reader. This local authority never confirms remote synchronization. */
export function scopedTimelineStore(scope: TimelineScope): TimelineLocalStore {
	const account = currentAccountWorkspace();
	if (scope.delegatedBy !== undefined) {
		if (!account || account.ownerId !== scope.delegatedBy || account.origin !== scope.apiOrigin || (account.dataPlane !== scope.dataPlane && scope.dataPlane !== 'home'))
			throw new WorkspaceError('WORKSPACE_CHANGED', 'Character History belongs to another account or database.', 409);
		const authored = new AccountTimeline(workspaceDatabase(), { ...account, ownerId: scope.ownerId, delegatedBy: scope.delegatedBy, dataPlane: scope.dataPlane }, accountWorkspaceLease(account));
		return new AccountTimelineStore(scope, localTimelineBackend(), authored);
	}
	if (account && account.origin === scope.apiOrigin && account.ownerId === scope.ownerId && (account.dataPlane === scope.dataPlane || scope.dataPlane === 'home')) {
		const authored = new AccountTimeline(workspaceDatabase(), { ...account, dataPlane: scope.dataPlane }, accountWorkspaceLease(account));
		return new AccountTimelineStore(scope, localTimelineBackend(), authored);
	}
	return new TimelineLocalStore(scope, localTimelineBackend());
}

/** Independent of React provider lifetime: a late Action result can retain its
 * original owner's outcome without exposing it to the currently signed-in UI. */
export async function enqueueActionOutcomeRecovery(apiOrigin: string, recovery: ActionOutcomeRecovery) {
	const store = new TimelineLocalStore({ apiOrigin, ownerId: recovery.event.ownerId, dataPlane: recovery.dataPlane }, localTimelineBackend());
	await store.enqueueRecovery(recovery);
	window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
}
