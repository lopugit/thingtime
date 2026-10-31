import { clearLocalCache, pruneCacheNamespace, readStampedCache, writeStampedCache } from '../hooks/localCache';
import { timelineScopeKey, type TimelineScope } from './contract';
import { parseRelatedTimelineScope, type RelatedTimelineScope } from './relatedHistory';

const prefix = 'tt-timeline-related:';
const key = (scope: TimelineScope, rootId: string) => prefix + JSON.stringify([timelineScopeKey(scope), rootId]);
/** Disposable membership hints only. All snapshots remain canonical IndexedDB
 * records; this bounded cache cannot acknowledge a save or create a relation. */
export function readRelatedHistoryCache(scope: TimelineScope, rootId: string): RelatedTimelineScope | null {
	try {
		return parseRelatedTimelineScope(readStampedCache(key(scope, rootId)), rootId);
	} catch {
		return null;
	}
}
export function writeRelatedHistoryCache(scope: TimelineScope, related: RelatedTimelineScope) {
	const target = key(scope, related.rootId);
	writeStampedCache(target, parseRelatedTimelineScope(related, related.rootId));
	pruneCacheNamespace(prefix, target, 8);
}
export const clearRelatedHistoryCache = (scope: TimelineScope, rootId: string) => clearLocalCache(key(scope, rootId));
