import React from 'react';
import { applyHistoryPrefsPatch, DEFAULT_HISTORY_PREFS, parseHistoryPrefs, type HistoryPrefs, type HistoryPrefsPatch } from './historyPrefs.ts';
import { readLocalCache, writeLocalCache } from '../hooks/localCache.ts';
import { useApi } from '../hooks/useApi';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useLopu } from '../components/Lopu/useLopu';

// The account history preferences on the client: ONE module-level store keyed
// by ownerId, read through useSyncExternalStore in useHistoryPrefs and
// consulted synchronously by the sync hold (TimelineSync.push) and the draft
// pause (useTimelineDraft). `PersistedThingMenu` renders once per feed card, so
// there is at most one in-flight GET per owner per page load, never one per
// card. Per-viewer conveniences (`showMessages`) live beside the last-fetched
// prefs in the `tt-history-prefs:<ownerId>` localCache record. That record is
// keyed by account, not origin: the preference is an account record and the
// same account sees the same settings on every Thingtime origin. It is
// bounded by the accounts used in this browser (no stamped-namespace pruning)
// and swept on sign-out because `pausedThingIds` names private Things.
//
// Fail-safe = keep syncing: an unknown, unavailable or failed read never
// holds the queue or pauses a Thing. A 401/403 here is never routed to the
// Timeline session's redact path; temporary and service accounts never reach
// the settings API at all.
export type HistoryPrefsStatus = 'loading' | 'ready' | 'unavailable' | 'error';
export type HistoryPrefsReason = 'account' | 'origin';
export type HistoryPrefsSnapshot = { ownerId: string | null; prefs: HistoryPrefs; showMessages: boolean; status: HistoryPrefsStatus; reason?: HistoryPrefsReason; error?: string };
/** `accountKind`/`temporary` from the current-user projection; `null` is signed out, `undefined` is "not known here, let the server answer". */
export type HistoryPrefsViewer = { temporary?: boolean; accountKind?: string } | null | undefined;
export type HistoryPrefsApi = { v1: { timeline: { settings: { get: (options?: { signal?: AbortSignal }) => Promise<unknown>; set: (patch: HistoryPrefsPatch, scope: { ownerId: string }, options?: { signal?: AbortSignal }) => Promise<unknown> } } } };
export const HISTORY_PREFS_CACHE_PREFIX = 'tt-history-prefs:';
export const HISTORY_PAUSED_DRAFT_ERROR = 'History is paused for this Thing. Resume history to recover or dismiss drafts.';
export const TIMELINE_STORAGE_FULL_HELD = 'Timeline local storage is full. Resume sync to upload pending changes.';
/** While the account hold is on, reconnecting is not the fix for a full pending queue; resuming is. */
export const timelineDraftFailureText = (error: unknown, held: boolean, fallback: string) => {
	const text = error instanceof Error ? error.message : fallback;
	return held && /local storage is full/i.test(text) ? TIMELINE_STORAGE_FULL_HELD : text;
};
export const historyPrefsFailureText = (error: unknown) => (error as { error?: unknown })?.error && typeof (error as { error?: unknown }).error === 'string' ? (error as { error: string }).error : error instanceof Error && error.message ? error.message : 'History settings could not be saved.';

type CachedRecord = { at: number; prefs: HistoryPrefs; showMessages: boolean };
type Write = { patch: HistoryPrefsPatch; previous: HistoryPrefs };
type Entry = { snapshot: HistoryPrefsSnapshot; stored: HistoryPrefs; version: number; attempted: boolean; inflight: Promise<void> | null; settled: Promise<void>; settle: () => void; queue: Promise<unknown>; writes: Write[] };
const SIGNED_OUT: HistoryPrefsSnapshot = Object.freeze({ ownerId: null, prefs: DEFAULT_HISTORY_PREFS, showMessages: true, status: 'unavailable' as const, reason: 'account' as const });
const cacheKey = (ownerId: string) => `${HISTORY_PREFS_CACHE_PREFIX}${ownerId}`;
const readCached = (ownerId: string): { prefs: HistoryPrefs; showMessages: boolean } | null => {
	const raw = readLocalCache<Partial<CachedRecord>>(cacheKey(ownerId));
	return raw && typeof raw === 'object' ? { prefs: parseHistoryPrefs(raw.prefs), showMessages: raw.showMessages !== false } : null;
};
const writeCached = (ownerId: string, prefs: HistoryPrefs, showMessages: boolean) => writeLocalCache(cacheKey(ownerId), { at: Date.now(), prefs, showMessages } satisfies CachedRecord);
const fullAccount = (viewer: HistoryPrefsViewer) => !!viewer && !viewer.temporary && viewer.accountKind === 'user';
const capabilityRefused = (error: unknown) => error instanceof Error && /Thingtime capability .* is incompatible/.test(error.message);
const accessRefused = (error: unknown) => [401, 403].includes((error as { status?: number })?.status ?? 0);
/** The server always answers with the full stored record; a lenient parse of anything else would invent settings. */
const serverPrefs = (result: unknown): HistoryPrefs => {
	const prefs = (result as { ok?: unknown; prefs?: unknown })?.prefs;
	if ((result as { ok?: unknown })?.ok !== true || !prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new Error('Invalid history settings response');
	return parseHistoryPrefs(prefs);
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach(listener => listener()); };
const ensure = (ownerId: string): Entry => {
	let entry = entries.get(ownerId);
	if (entry) return entry;
	const cached = readCached(ownerId);
	const prefs = cached?.prefs ?? parseHistoryPrefs(null);
	let settle = () => {};
	const settled = new Promise<void>(resolve => { settle = resolve; });
	entry = { snapshot: { ownerId, prefs, showMessages: cached?.showMessages ?? true, status: 'loading' }, stored: prefs, version: 0, attempted: false, inflight: null, settled, settle, queue: Promise.resolve(), writes: [] };
	entries.set(ownerId, entry);
	return entry;
};
const set = (entry: Entry, patch: Partial<HistoryPrefsSnapshot>) => { entry.snapshot = { ...entry.snapshot, ...patch }; emit(); };
/** One write settled: rebuild from its base (the server record, or the state it started from) plus the writes still queued behind it. */
const settle = (entry: Entry, write: Write, base: HistoryPrefs, confirmed: boolean) => {
	const index = entry.writes.indexOf(write); const later = index < 0 ? [] : entry.writes.splice(index + 1); if (index >= 0) entry.writes.splice(index, 1);
	let prefs = base;
	for (const pending of later) { pending.previous = prefs; try { prefs = applyHistoryPrefsPatch(prefs, pending.patch); } catch {} entry.writes.push(pending); }
	entry.version++;
	set(entry, confirmed ? { prefs, status: 'ready', reason: undefined, error: undefined } : { prefs });
};

export const historyPrefs = {
	/** Current snapshot for a viewer; signed out is a constant so a stale owner never paints for the next account. */
	snapshot(ownerId: string | null | undefined): HistoryPrefsSnapshot { return ownerId ? ensure(ownerId).snapshot : SIGNED_OUT; },
	subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
	/** Paints the cached record first, then at most one GET per owner per page load. A temporary, service or signed-out
	 * viewer never reaches the network (`unavailable`/`account`); an older origin is `unavailable`/`origin`, never a toast.
	 * A failed read is retried by the next call (the provider reconnects every 15 s) or at once with `force`. Never rejects. */
	load(ownerId: string, api: HistoryPrefsApi, viewer?: HistoryPrefsViewer, options: { force?: boolean } = {}): Promise<void> {
		const entry = ensure(ownerId);
		if (viewer !== undefined && !fullAccount(viewer)) {
			entry.attempted = true;
			if (entry.snapshot.status !== 'unavailable' || entry.snapshot.reason !== 'account') set(entry, { status: 'unavailable', reason: 'account', error: undefined });
			entry.settle(); return entry.settled;
		}
		if (entry.inflight) return entry.inflight;
		if (entry.attempted && !options.force && entry.snapshot.status !== 'error') return entry.settled;
		entry.attempted = true;
		if (options.force && entry.snapshot.status !== 'ready') set(entry, { status: 'loading', reason: undefined, error: undefined });
		const version = entry.version;
		entry.inflight = (async () => {
			try {
				const prefs = serverPrefs(await api.v1.timeline.settings.get());
				// An optimistic write that started after this read must not be undone by it.
				if (entry.version === version) { entry.stored = prefs; writeCached(ownerId, prefs, entry.snapshot.showMessages); set(entry, { prefs, status: 'ready', reason: undefined, error: undefined }); }
				else set(entry, { status: 'ready', reason: undefined, error: undefined });
			} catch (error) {
				if (capabilityRefused(error)) set(entry, { status: 'unavailable', reason: 'origin', error: undefined });
				else if (accessRefused(error)) set(entry, { status: 'unavailable', reason: 'account', error: undefined });
				else set(entry, { status: 'error', reason: undefined, error: historyPrefsFailureText(error) });
			} finally { entry.inflight = null; entry.settle(); }
		})();
		return entry.inflight;
	},
	/** Resolves once the first load for this owner settles (success, unavailable or error; the checker bounds the fetch at 20 s).
	 * Resolves at once when nothing was ever asked to load: an unknown record never holds the queue. */
	ready(ownerId: string): Promise<void> { const entry = entries.get(ownerId); return entry?.attempted ? entry.settled : Promise.resolve(); },
	isHeld(ownerId: string): boolean { return ensure(ownerId).snapshot.prefs.syncHold; },
	isPaused(ownerId: string, thingId: string): boolean { return ensure(ownerId).snapshot.prefs.pausedThingIds.includes(thingId); },
	/** Optimistic apply (synchronously, so a switch flips in the same tick), then the server's full record replaces
	 * it; a refusal reverts and rethrows (the hook toasts). Writes for one owner are sent in order, and every settle
	 * rebuilds the snapshot from its base plus the writes still in flight, so a revert restores the state the write
	 * actually started from and a success never erases a later toggle. */
	update(ownerId: string, patch: HistoryPrefsPatch, api: HistoryPrefsApi): Promise<HistoryPrefs> {
		const entry = ensure(ownerId);
		let optimistic: HistoryPrefs;
		try { optimistic = applyHistoryPrefsPatch(entry.snapshot.prefs, patch); } catch (error) { return Promise.reject(error); }
		const write: Write = { patch, previous: entry.snapshot.prefs };
		entry.writes.push(write); entry.version++; set(entry, { prefs: optimistic });
		const run = async () => {
			try {
				const prefs = serverPrefs(await api.v1.timeline.settings.set(patch, { ownerId }));
				entry.stored = prefs; writeCached(ownerId, prefs, entry.snapshot.showMessages);
				settle(entry, write, prefs, true);
				return prefs;
			} catch (error) { settle(entry, write, write.previous, false); throw error; }
		};
		const next = entry.queue.then(run, run);
		entry.queue = next.catch(() => {});
		return next;
	},
	setShowMessages(ownerId: string, value: boolean) {
		const entry = ensure(ownerId);
		if (entry.snapshot.showMessages === value) return;
		writeCached(ownerId, entry.stored, value); set(entry, { showMessages: value });
	},
	/** Tests only: forget every owner's in-memory state (localStorage is untouched). */
	reset() { entries.clear(); }
};

/** `update` resolves `null` after a Lopu error toast instead of rejecting, so menu and switch handlers can `void` it. */
export function useHistoryPrefs() {
	const user = useCurrentUser(); const api = useApi(); const lopu = useLopu();
	const ownerId = user?.id ?? null;
	const apiRef = React.useRef(api); apiRef.current = api;
	const viewer: HistoryPrefsViewer = user ? { temporary: user.temporary, accountKind: user.accountKind } : null;
	const viewerRef = React.useRef(viewer); viewerRef.current = viewer;
	const viewerKey = JSON.stringify([ownerId, !!user?.temporary, user?.accountKind ?? '']);
	const snapshot = React.useSyncExternalStore(historyPrefs.subscribe, () => historyPrefs.snapshot(ownerId), () => SIGNED_OUT);
	React.useEffect(() => { if (ownerId) void historyPrefs.load(ownerId, apiRef.current, viewerRef.current); }, [ownerId, viewerKey]);
	const update = React.useCallback(async (patch: HistoryPrefsPatch): Promise<HistoryPrefs | null> => {
		if (!ownerId) { lopu({ title: 'History settings', description: 'Sign in to change history settings.', status: 'error' }); return null; }
		try { return await historyPrefs.update(ownerId, patch, apiRef.current); }
		catch (error) { lopu({ title: 'History settings', description: historyPrefsFailureText(error), status: 'error' }); return null; }
	}, [ownerId, lopu]);
	const setShowMessages = React.useCallback((value: boolean) => { if (ownerId) historyPrefs.setShowMessages(ownerId, value); }, [ownerId]);
	const retry = React.useCallback(() => { if (ownerId) void historyPrefs.load(ownerId, apiRef.current, viewerRef.current, { force: true }); }, [ownerId]);
	return { ownerId, prefs: snapshot.prefs, showMessages: snapshot.showMessages, setShowMessages, update, status: snapshot.status, reason: snapshot.reason, error: snapshot.error, retry };
}
