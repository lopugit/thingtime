import { IndexedDbTimelineBackend } from './indexedDb';
import { TimelineLocalStore } from './localStore';
import { TIMELINE_CHANGED_EVENT } from './clientEvents';
import type { ActionOutcomeRecovery } from './actionRecovery';

let backend: IndexedDbTimelineBackend | null = null;
export const localTimelineBackend = () => backend ??= new IndexedDbTimelineBackend(window.indexedDB);

/** Independent of React provider lifetime: a late Action result can retain its
 * original owner's outcome without exposing it to the currently signed-in UI. */
export async function enqueueActionOutcomeRecovery(apiOrigin: string, recovery: ActionOutcomeRecovery) {
	const store = new TimelineLocalStore({ apiOrigin, ownerId: recovery.event.ownerId, dataPlane: recovery.dataPlane }, localTimelineBackend());
	await store.enqueueRecovery(recovery);
	window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
}
