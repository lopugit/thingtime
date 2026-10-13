export type TimelineStorage = 'selected' | 'home';

/** Transport routing only. Canonical local/remote records and cache keys stay
 * unchanged; a home request still has to pass its expected dataPlane fence. */
export function timelineRequestScope(scope: { ownerId: string; dataPlane: string }) {
	return { ownerId: scope.ownerId, dataPlane: scope.dataPlane, ...(scope.dataPlane === 'home' ? { storage: 'home' as const } : {}) };
}

/** These personal-library kinds use dedicated home writers. Timeline's own
 * records can live in either plane and must not be inferred from protection. */
export function historyStorageForThing(thingtime?: readonly string[]): TimelineStorage {
	return thingtime?.length === 1 && ['theme', 'feed-algorithm', 'custom-emoji', 'chat-archive', 'attachment'].includes(thingtime[0]) ? 'home' : 'selected';
}

export const timelineFolderHref = (folderId: string, storage: TimelineStorage) =>
	`/things?folder=${encodeURIComponent(folderId)}${storage === 'home' ? '&historyStorage=home' : ''}`;
