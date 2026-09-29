import React from 'react';
import { useApi } from '../hooks/useApi';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { localTimelineBackend } from './localBackend.client';
import { TimelineLocalStore } from './localStore';
import { TimelineBranchStore } from './branchStore';
import { TimelineSync, TimelineBranchCommandRefusal } from './sync';
import { timelineScopeKey, type TimelineScope } from './contract';
import { listenTimelineScopeChange, TIMELINE_CHANGED_EVENT } from './clientEvents';
import { TimelineConnectionPool, timelineConnectionForViewer, type TimelineConnection } from './connectionPool';
import type { TimelineStorage } from './storageScope';
import { useDataPlane } from '../hooks/useDataPlane';

type Connection = TimelineConnection & { verified: boolean };
type Session = { storage: TimelineStorage; identity: string; ownerId: string | null; connection: Connection | null; error: string; retry: () => Promise<void>; redact: (error: unknown) => Promise<void> };
const Context = React.createContext<Session>({ storage: 'selected', identity: '', ownerId: null, connection: null, error: '', retry: async () => {}, redact: async () => {} });
const SelectedContext = Context;
const ActiveContext = React.createContext<Session | null>(null);
const HomeContext = React.createContext<Session | null>(null);
const failureMessage = (error: unknown) => error instanceof Error ? error.message : 'Timeline could not connect. Your local changes are preserved.';
export const timelineAccessFailure = (error: unknown): boolean => [401, 403].includes((error as { status?: number })?.status ?? 0);

function useTimelineConnection(pool: TimelineConnectionPool, storage: TimelineStorage, onDenied: (failure: unknown) => Promise<void>): Session {
	const user = useCurrentUser(); const api = useApi(); const apiRef = React.useRef(api); apiRef.current = api;
	const selectedPlane = useDataPlane();
	const expectedPlane = storage === 'home' ? 'home' : selectedPlane;
	const [connection, setConnection] = React.useState<Connection | null>(null);
	const [error, setError] = React.useState('');
	const [epoch, setEpoch] = React.useState(0);
	const active = React.useRef<Connection | null>(null);
	const retry = React.useRef<() => Promise<void>>(async () => {});
	const redact = React.useRef<(error: unknown) => Promise<void>>(async () => {});
	React.useEffect(() => {
		if (!user?.id) return;
		const ownerId = user.id; const origin = window.location.origin;
		const key = storage === 'home' ? `thingtime:timeline-scope:home:${ownerId}` : `thingtime:timeline-scope:${ownerId}`;
		let alive = true; let generation = 0; let busy = false;
		const forget = () => { try { sessionStorage.removeItem(key); } catch {} };
		let lease: ReturnType<TimelineConnectionPool['acquire']> | null = null;
		const stop = () => { lease?.release(); lease = null; active.current = null; setConnection(null); };
		const install = (scope: TimelineScope, folderId: string, verified: boolean) => {
			if (active.current && timelineScopeKey(active.current.scope) === timelineScopeKey(scope)) {
				if (active.current.folderId !== folderId) throw new Error('Timeline folder changed. Reconnect your history.');
				if (active.current.verified === verified) return active.current;
				active.current = { ...active.current, verified }; setConnection(active.current); return active.current;
			}
			if (active.current) setEpoch(value => value + 1);
			stop();
			lease = pool.acquire(scope, folderId);
			const next = { ...lease.connection, verified }; active.current = next; setConnection(next); return next;
		};
		// Offline reload may reopen a previously verified scope. It cannot push
		// until discovery confirms the current account and data source again.
		try {
			const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
			if (cached?.scope?.ownerId === ownerId && cached.scope.apiOrigin === origin && (!expectedPlane || cached.scope.dataPlane === expectedPlane) && typeof cached.folderId === 'string') {
				timelineScopeKey(cached.scope); install(cached.scope, cached.folderId, false);
			}
		} catch { forget(); }
		const deny = async (failure: unknown) => {
			if (!alive || !timelineAccessFailure(failure)) return;
			const old = active.current; generation++; setEpoch(value => value + 1); forget(); stop(); setError(failureMessage(failure));
			// Keep authored pending edits; retire downloaded private cache on an
			// explicit authorization refusal. Network failure is not revocation.
			await old?.store.prune(0, 0);
			await old?.branches.clearCache();
		};
		redact.current = deny;
		const syncFailure = async (failure: unknown) => {
			if (failure instanceof TimelineBranchCommandRefusal) { setError(''); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
			else if (timelineAccessFailure(failure)) await onDenied(failure);
			else setError(failureMessage(failure));
		};
		const connect = async (force = false) => {
			if (!alive || busy || (!force && document.visibilityState === 'hidden')) return;
			busy = true; const attempt = generation;
			try {
				const found = await apiRef.current.v1.timeline.discover(ownerId, { storage });
				if (!alive || attempt !== generation) return;
				if (found.ownerId !== ownerId || (storage === 'home' && found.dataPlane !== 'home') || typeof found.folderId !== 'string') throw new Error('Timeline account changed. Reopen your Things.');
				const scope = { ownerId, apiOrigin: origin, dataPlane: found.dataPlane }; timelineScopeKey(scope);
				const current = install(scope, found.folderId, true);
				try { sessionStorage.setItem(key, JSON.stringify({ scope, folderId: found.folderId })); } catch {}
				await current.sync.pushPending();
				if (alive && attempt === generation) { setError(''); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
			} catch (failure) {
				if (!alive || attempt !== generation) return;
				await syncFailure(failure);
			} finally { busy = false; }
		};
		retry.current = () => connect(true);
		const refresh = () => void connect();
		const edited = () => {
			const current = active.current;
			if (current?.verified) void current.sync.pushPending().then(count => { if (alive && active.current === current && count) window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }).catch(failure => { if (alive && active.current === current) void syncFailure(failure); });
		};
		const unlisten = storage === 'home' ? () => {} : listenTimelineScopeChange(() => { generation++; setEpoch(value => value + 1); forget(); stop(); setError(''); busy = false; void connect(true); });
		window.addEventListener('online', refresh); window.addEventListener('focus', refresh); window.addEventListener(TIMELINE_CHANGED_EVENT, edited);
		const timer = setInterval(refresh, 15_000); void connect(true);
		return () => { alive = false; generation++; lease?.release(); lease = null; active.current = null; clearInterval(timer); unlisten(); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); window.removeEventListener(TIMELINE_CHANGED_EVENT, edited); retry.current = async () => {}; redact.current = async () => {}; };
	}, [user?.id, pool, storage, onDenied, expectedPlane]);
	const scoped = timelineConnectionForViewer(connection, user?.id, expectedPlane);
	return { storage, identity: JSON.stringify([user?.id ?? null, storage, epoch]), ownerId: user?.id ?? null, connection: scoped, error, retry: () => retry.current(), redact: failure => redact.current(failure) };
}

/** Home and the selected database use identical records and separate scope
 * keys. Their shared pool keeps one sync queue when both resolve to home. */
export function TimelineProvider({ children }: { children: React.ReactNode }) {
	const api = useApi(); const apiRef = React.useRef(api); apiRef.current = api;
	const [pool] = React.useState(() => new TimelineConnectionPool((scope, folderId) => {
		const store = new TimelineLocalStore(scope, localTimelineBackend());
		const branches = new TimelineBranchStore(scope, localTimelineBackend());
		const sync = new TimelineSync(store, {
			push: async (event, signal) => (await apiRef.current.v1.timeline.push(scope, event, { signal })).entry,
			recoverOutcome: async (event, proof, signal) => (await apiRef.current.v1.timeline.recoverOutcome(scope, { formatVersion: 1, event, dataPlane: scope.dataPlane, proof }, { signal })).entry,
			page: (request, signal) => apiRef.current.v1.timeline.page(scope, request, { signal }),
			branch: (command, signal) => apiRef.current.v1.timeline.branch(scope, command, { signal }),
			branchHead: (branchId, thingId, signal) => apiRef.current.v1.timeline.branchHead(scope, branchId, thingId, { signal }),
			entry: async (eventId, signal) => (await apiRef.current.v1.timeline.entry(scope, eventId, { signal })).entry,
			branches: (thingId, before, signal) => apiRef.current.v1.timeline.branches(scope, thingId, before, { signal })
		}, branches);
		return { scope, folderId, store, branches, sync };
	}));
	const sessions = React.useRef<Session[]>([]);
	const redact = React.useCallback(async (failure: unknown) => { await Promise.all(sessions.current.map(session => session.redact(failure))); }, []);
	const selected = useTimelineConnection(pool, 'selected', redact);
	const home = useTimelineConnection(pool, 'home', redact);
	sessions.current = [selected, home];
	return <HomeContext.Provider value={{ ...home, redact }}><Context.Provider value={{ ...selected, redact }}>{children}</Context.Provider></HomeContext.Provider>;
}

/** The entire panel (including branches and restore) uses one chosen session. */
export function TimelineStorageProvider({ storage, children }: { storage: TimelineStorage; children: React.ReactNode }) {
	const selected = React.useContext(SelectedContext); const home = React.useContext(HomeContext);
	return <ActiveContext.Provider value={storage === 'home' && home ? home : selected}>{children}</ActiveContext.Provider>;
}
export const useTimelineSession = () => { const active = React.useContext(ActiveContext); const selected = React.useContext(Context); return active ?? selected; };
export const useSelectedTimelineSession = () => React.useContext(SelectedContext);
