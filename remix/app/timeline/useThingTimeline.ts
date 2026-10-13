import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import type { LocalTimelineRow } from './localStore';
import { timelineScopeKey } from './contract';
import { useTimelineSession, timelineAccessFailure } from './TimelineProvider';
import { TIMELINE_CHANGED_EVENT } from './clientEvents';
import type { RelatedTimelineScope } from './relatedHistory';
import { readRelatedHistoryCache, writeRelatedHistoryCache, clearRelatedHistoryCache } from './relatedHistoryCache';
export { TIMELINE_CHANGED_EVENT } from './clientEvents';

type View = { identity: string; rows: LocalTimelineRow[]; error: string; ready: boolean; nextBefore: number | null; folderId: string | null; related?: RelatedTimelineScope | null };
const emptyView = (identity: string): View => ({ identity, rows: [], error: '', ready: false, nextBefore: null, folderId: null });

/** Only open history views pull pages. The account queue runs independently. */
export function useThingTimeline(thingId: string | null, enabled = true, related = false) {
	const user = useCurrentUser(); const session = useTimelineSession();
	const sessionRef = useRef(session); sessionRef.current = session;
	const connection = session.connection;
	const scope = connection ? timelineScopeKey(connection.scope) : 'unavailable';
	const identity = `${user?.id ?? 'guest'}:${scope}:${thingId ?? 'all'}${related ? ':related' : ''}`;
	const [view, setView] = useState<View>(() => emptyView(identity));
	const refreshRef = useRef<() => Promise<void>>(async () => {});
	const olderRef = useRef<() => Promise<void>>(async () => {});
	useEffect(() => {
		if (!enabled || !connection) { refreshRef.current = () => sessionRef.current.retry(); return; }
		let alive = true; let busy = false; let unavailable = false; let after: number | null = null; let before: number | null = null;
		const { store, sync, folderId } = connection;
		let membership = related && thingId ? readRelatedHistoryCache(connection.scope, thingId) : null;
		const fail = async (error: unknown) => {
			if (!alive) return;
			if (related && thingId && [401, 403, 404].includes((error as any)?.status)) { unavailable = true; after = null; before = null; membership = null; clearRelatedHistoryCache(connection.scope, thingId); setView(emptyView(identity)); }
			if (timelineAccessFailure(error)) { setView(emptyView(identity)); await sessionRef.current.redact(error); return; }
			setView(previous => ({ ...(previous.identity === identity ? previous : emptyView(identity)), ready: true, error: error instanceof Error ? error.message : 'History could not synchronize. Try again.' }));
		};
		const cached = async () => {
			if (unavailable) return;
			const rows = membership ? await store.forThings(membership.thingIds) : await store.forThing(thingId);
			if (alive) setView(previous => ({ ...(previous.identity === identity ? previous : emptyView(identity)), identity, rows, ready: true, folderId, nextBefore: before, related: membership }));
		};
		const refresh = async (force = false) => {
			if (!alive || busy || (!force && document.visibilityState === 'hidden')) return;
			busy = true;
			try {
				await cached();
				if (!connection.verified) { await sessionRef.current.retry(); return; }
				for (let pass = 0; pass < 10; pass++) {
					const page = await sync.page(thingId, { ...(after === null ? {} : { after }), ...(related ? { related: true, ...(membership ? { relatedRevision: membership.revision } : {}) } : {}) });
					if (!alive) return;
					unavailable = false;
					if (page.related) { membership = page.related; writeRelatedHistoryCache(connection.scope, membership); }
					if (page.reset) { after = null; before = null; }
					if (after === null) before = page.nextBefore;
					for (const entry of page.entries) after = Math.max(after ?? 0, entry.receipt.position);
					await cached();
					if (alive) setView(previous => ({ ...previous, error: '' }));
					if (page.nextAfter === null) break;
				}
			} catch (error) { await fail(error); } finally { busy = false; }
		};
		refreshRef.current = () => refresh(true);
		olderRef.current = async () => {
			if (!alive || busy || before === null || !connection.verified) return;
			busy = true;
			try {
				const page = await sync.page(thingId, { before, ...(related ? { related: true, ...(membership ? { relatedRevision: membership.revision } : {}) } : {}) });
				if (alive) {
					if (page.related) { membership = page.related; writeRelatedHistoryCache(connection.scope, membership); }
					if (page.reset) after = page.entries.reduce((position, entry) => Math.max(position, entry.receipt.position), 0) || null;
					before = page.nextBefore; await cached();
				}
			}
			catch (error) { await fail(error); } finally { busy = false; }
		};
		const changed = () => void refresh();
		window.addEventListener('focus', changed); window.addEventListener('online', changed); window.addEventListener(TIMELINE_CHANGED_EVENT, changed); document.addEventListener('visibilitychange', changed);
		const timer = setInterval(changed, 10_000); void refresh(true);
		return () => { alive = false; clearInterval(timer); refreshRef.current = async () => {}; olderRef.current = async () => {}; window.removeEventListener('focus', changed); window.removeEventListener('online', changed); window.removeEventListener(TIMELINE_CHANGED_EVENT, changed); document.removeEventListener('visibilitychange', changed); };
	}, [identity, enabled, thingId, connection, related]);
	const current = view.identity === identity ? view : emptyView(identity);
	return { ...current, identity: related ? `${identity}:${current.related?.revision ?? 'unknown'}` : identity, error: current.error || session.error, signedIn: !!user?.id, refresh: useCallback(() => refreshRef.current(), []), older: useCallback(() => olderRef.current(), []) };
}
