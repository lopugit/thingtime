import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineLocalStore } from './localStore';
import { TIMELINE_CHANGED_EVENT } from './clientEvents';
import type { ActionOutcomeRecovery } from './actionRecovery';
import type { TimelineScope } from './contract';
import { AccountTimeline, AccountTimelineStore } from '../local-workspace/accountTimeline';
import { currentAccountWorkspace, accountWorkspaceLease, workspaceDatabase } from '../local-workspace/runtime.client';

let backend: IndexedDbTimelineBackend | null = null;
export const localTimelineBackend = () => backend ??= new IndexedDbTimelineBackend(window.indexedDB);

/** Only the currently bound account/plane can add its authoritative workspace
 * versions. Home History on a different selected plane keeps its existing cache. */
export function scopedTimelineStore(scope: TimelineScope): TimelineLocalStore {
	const account = currentAccountWorkspace();
	if (account && account.origin === scope.apiOrigin && account.ownerId === scope.ownerId && account.dataPlane === scope.dataPlane) {
		const authored = new AccountTimeline(workspaceDatabase(), account, accountWorkspaceLease(account));
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
