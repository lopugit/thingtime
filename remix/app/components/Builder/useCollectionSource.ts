import React from 'react';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCharacterScope } from '../Characters/CharacterScope';
import { useApi } from '~/hooks/useApi';
import { NativeControlsEnabled } from './NativeComponentControls';
import { appendCollectionPage, collectionOffsetPage, collectionSource, type CollectionPage } from './collectionSource';
import { sourceFailure } from './sourceFailure';
import { clearSourceCache, readSourceCache, useWebpageRuntime, writeSourceCache } from './webpageRuntime';

/** Same viewer/shared read boundary and cache as ordinary Component sources. */
export function useCollectionSource(raw: unknown) {
	const runtime = useWebpageRuntime();
	const enabled = React.useContext(NativeControlsEnabled);
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const dataPlane = useDataPlane();
	const character = useCharacterScope();
	const key = JSON.stringify([raw ?? null, dataPlane, character?.id ?? null]);
	const config = React.useMemo(() => {
		try { return { source: collectionSource(raw), error: '' }; }
		catch (error) { return { source: null, error: (error as Error).message }; }
		// eslint-disable-next-line react-hooks/exhaustive-deps -- serialized authored config
	}, [key]);
	const source = config.source;
	const active = !!source && enabled && (runtime.canRunSources || !!runtime.sharedRun);
	const cacheId = `collection:${source?.action || ''}`;
	// eslint-disable-next-line react-hooks/exhaustive-deps -- opaque access/config boundary
	const identity = React.useMemo(() => ({}), [runtime.identity, key, active]);
	const identitySerial = React.useRef({ identity, revision: 0 });
	if (identitySerial.current.identity !== identity) identitySerial.current = { identity, revision: identitySerial.current.revision + 1 };
	const [retry, setRetry] = React.useState(0);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate late completions on refresh
	const token = React.useMemo(() => ({}), [identity, runtime.version, retry]);
	const current = React.useRef(token);
	current.current = token;
	const initial = React.useMemo(() => {
		if (!source || !active || runtime.sharedRun) return undefined;
		try {
			const cached = readSourceCache(runtime.cacheScope, runtime.pageId, cacheId, key);
			return cached === undefined ? undefined : appendCollectionPage(source, cached);
		} catch { return undefined; }
		// eslint-disable-next-line react-hooks/exhaustive-deps -- identity includes config and runtime access
	}, [identity]);
	type State = { identity: object; token: object | null; page?: CollectionPage; loading: boolean; error: string; terminal?: boolean; firstFailed?: boolean };
	const [stored, setStored] = React.useState<State>({ identity, token: null, page: initial, loading: false, error: '' });
	const state: State = stored.identity === identity ? stored : { identity, token: null, page: initial, loading: false, error: '' };
	const inFlight = React.useRef<object | null>(null);
	const refusedToken = React.useRef<object | null>(null);
	const [offsetStored, setOffsetStored] = React.useState<{ token: object; pages: Record<string, Record<string, any>[]>; loading: boolean; error: string }>({ token, pages: {}, loading: false, error: '' });
	const offsetState = offsetStored.token === token ? offsetStored : { token, pages: {}, loading: false, error: '' };
	const offsetFlight = React.useRef<object | null>(null);
	const offsetAttempts = React.useRef(0);
	const failedPrefetch = React.useRef<{ token: object; keys: Set<string> }>({ token, keys: new Set() });
	if (failedPrefetch.current.token !== token) failedPrefetch.current = { token, keys: new Set() };
	const attempts = React.useRef(0);
	const run = React.useCallback(async (previous?: CollectionPage) => {
		if (!source || !active || inFlight.current === token || refusedToken.current === token) return;
		inFlight.current = token;
		setStored((old) => ({ identity, token, page: old.identity === identity ? old.page : initial, loading: true, error: '' }));
		const stale = () => current.current !== token || refusedToken.current === token;
		const fail = (error: unknown, terminal = false) => {
			const failure = sourceFailure(error, !!runtime.sharedRun);
			if (failure.clear) {
				refusedToken.current = token;
				clearSourceCache(runtime.cacheScope, runtime.pageId, cacheId);
				setOffsetStored({ token, pages: {}, loading: false, error: '' });
			}
			setStored((old) => ({ identity, page: old.identity === identity ? old.page : initial, token, loading: false, terminal, firstFailed: !previous || failure.clear, error: failure.error || 'Install this app to load its records.', ...(failure.clear ? { page: undefined } : {}) }));
		};
		try {
			const inputs = { ...source.inputs, ...(previous ? { [source.cursorInput]: previous.cursor } : {}) };
			const loadKey = JSON.stringify({ a: source.action, i: inputs, t: 0, l: 0, ...((retry || attempts.current) ? { retry, attempt: attempts.current } : {}) });
			const response: any = await runtime.load(loadKey, () => runtime.sharedRun
				? runtime.sharedRun(source.action, inputs)
				: apiRef.current.v1.actions.run({ action: source.action, inputs, source: 'component' }));
			if (stale()) return;
			if (response?.status !== 'ok') { attempts.current += 1; fail(response); return; }
			let page: CollectionPage;
			try { page = appendCollectionPage(source, response.result, previous); }
			catch (error) { fail(error, true); return; }
			if (!runtime.sharedRun) {
				if (response.cache === 'no-store') clearSourceCache(runtime.cacheScope, runtime.pageId, cacheId);
				else if (!previous) writeSourceCache(runtime.cacheScope, runtime.pageId, cacheId, response.result, key);
			}
			setStored({ identity, token, page, loading: false, error: '' });
		} catch (error) {
			if (!stale()) { attempts.current += 1; fail(error); }
		} finally {
			if (inFlight.current === token) inFlight.current = null;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the used runtime fields, not unrelated last/query changes
	}, [source, active, token, identity, initial, runtime.load, runtime.sharedRun, runtime.cacheScope, runtime.pageId, cacheId, key, retry]);
	React.useEffect(() => {
		current.current = token;
		void run();
		return () => { if (current.current === token) current.current = {}; };
	}, [run, token]);
	const refreshing = state.token !== token;
	const loadMore = React.useCallback(async () => {
		if (state.loading || refreshing || state.terminal) return;
		// A failed first page must be retried as a first page, even if cached rows exist.
		if (state.error && state.firstFailed) { setRetry((value) => value + 1); return; }
		if (state.page?.cursor) await run(state.page);
	}, [state.loading, state.error, state.firstFailed, state.page, state.terminal, refreshing, run]);
	const loadPage = React.useCallback(async (offset: number, limit: number, prefetch = false) => {
		if (!source?.offsetInput || !source.limitInput || !active || offsetFlight.current === token || refusedToken.current === token) return;
		const pageKey = `${offset}:${limit}`;
		if (offsetState.pages[pageKey] || (prefetch && failedPrefetch.current.keys.has(pageKey))) return;
		if (!prefetch) failedPrefetch.current.keys.delete(pageKey);
		offsetFlight.current = token;
		if (!prefetch) setOffsetStored(old => ({ token, pages: old.token === token ? old.pages : {}, loading: true, error: '' }));
		const fail = (error: unknown) => {
			const failure = sourceFailure(error, !!runtime.sharedRun);
			offsetAttempts.current += 1;
			if (prefetch) failedPrefetch.current.keys.add(pageKey);
			if (failure.clear) {
				refusedToken.current = token;
				clearSourceCache(runtime.cacheScope, runtime.pageId, cacheId);
				setStored({ identity, token, loading: false, error: failure.error || 'Access to these records was denied.', terminal: false, firstFailed: true });
			}
			setOffsetStored(old => ({ token, pages: !failure.clear && old.token === token ? old.pages : {}, loading: false, error: prefetch && !failure.clear ? '' : failure.error || 'Could not load this page.' }));
		};
		try {
			const inputs = { ...source.inputs, [source.offsetInput]: offset, [source.limitInput]: limit };
			delete inputs[source.cursorInput];
			const loadKey = JSON.stringify({ a: source.action, i: inputs, t: 0, l: 0, ...(offsetAttempts.current ? { attempt: offsetAttempts.current } : {}) });
			const response: any = await runtime.load(loadKey, () => runtime.sharedRun ? runtime.sharedRun(source.action, inputs) : apiRef.current.v1.actions.run({ action: source.action, inputs, source: 'component' }));
			if (current.current !== token || refusedToken.current === token) return;
			if (response?.status !== 'ok') { fail(response); return; }
			const page = collectionOffsetPage(source, response.result, offset, limit);
			setOffsetStored(old => ({ token, pages: { ...(old.token === token ? old.pages : {}), [pageKey]: page.items }, loading: false, error: '' }));
		} catch (error) {
			if (current.current === token && refusedToken.current !== token) fail(error);
		} finally { if (offsetFlight.current === token) offsetFlight.current = null; }
		// eslint-disable-next-line react-hooks/exhaustive-deps -- track the used runtime fields, not unrelated page state
	}, [source, active, token, offsetState.pages, runtime.load, runtime.sharedRun, runtime.cacheScope, runtime.pageId, cacheId, identity]);
	return {
		bound: raw !== undefined && raw !== null,
		items: active ? state.page?.items || [] : [],
		total: active ? state.page?.total : undefined,
		loading: active && (refreshing || state.loading),
		error: config.error || (!enabled ? '' : !active && source ? 'Open a workspace to load these records.' : refreshing ? '' : state.error),
		hasMore: active && !state.terminal && (!!state.page?.cursor || !!state.error),
		loadMore,
		loadPage: source?.offsetInput && source.limitInput && active && !state.firstFailed ? loadPage : undefined,
		pageData: offsetState.pages,
		pageLoading: offsetState.loading,
		pageError: offsetState.error,
		resetKey: JSON.stringify([key, identitySerial.current.revision, !state.page && state.firstFailed ? 'cleared' : 'available'])
	};
}
