import React from 'react';
import { useApi } from '~/hooks/useApi';
import { NativeControlsEnabled } from './NativeComponentControls';
import { appendCollectionPage, collectionSource, type CollectionPage } from './collectionSource';
import { sourceFailure } from './sourceFailure';
import { clearSourceCache, readSourceCache, useWebpageRuntime, writeSourceCache } from './webpageRuntime';

/** Same viewer/shared read boundary and cache as ordinary Component sources. */
export function useCollectionSource(raw: unknown) {
	const runtime = useWebpageRuntime();
	const enabled = React.useContext(NativeControlsEnabled);
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const key = JSON.stringify(raw ?? null);
	const config = React.useMemo(() => {
		try { return { source: collectionSource(raw), error: '' }; }
		catch (error) { return { source: null, error: (error as Error).message }; }
		// eslint-disable-next-line react-hooks/exhaustive-deps -- serialized authored config
	}, [key]);
	const source = config.source;
	const active = !!source && enabled && (runtime.viewer.signedIn || !!runtime.sharedRun);
	const cacheId = `collection:${source?.action || ''}`;
	// eslint-disable-next-line react-hooks/exhaustive-deps -- opaque access/config boundary
	const identity = React.useMemo(() => ({}), [runtime.identity, key, active]);
	const [retry, setRetry] = React.useState(0);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate late completions on refresh
	const token = React.useMemo(() => ({}), [identity, runtime.version, retry]);
	const current = React.useRef(token);
	current.current = token;
	const initial = React.useMemo(() => {
		if (!source || !active || runtime.sharedRun) return undefined;
		try {
			const cached = readSourceCache(runtime.viewer.id, runtime.pageId, cacheId, key);
			return cached === undefined ? undefined : appendCollectionPage(source, cached);
		} catch { return undefined; }
		// eslint-disable-next-line react-hooks/exhaustive-deps -- identity includes config and runtime access
	}, [identity]);
	type State = { identity: object; token: object | null; page?: CollectionPage; loading: boolean; error: string; terminal?: boolean; firstFailed?: boolean };
	const [stored, setStored] = React.useState<State>({ identity, token: null, page: initial, loading: false, error: '' });
	const state: State = stored.identity === identity ? stored : { identity, token: null, page: initial, loading: false, error: '' };
	const inFlight = React.useRef<object | null>(null);
	const attempts = React.useRef(0);
	const run = React.useCallback(async (previous?: CollectionPage) => {
		if (!source || !active || inFlight.current === token) return;
		inFlight.current = token;
		setStored((old) => ({ identity, token, page: old.identity === identity ? old.page : initial, loading: true, error: '' }));
		const stale = () => current.current !== token;
		const fail = (error: unknown, terminal = false) => {
			const failure = sourceFailure(error, !!runtime.sharedRun);
			if (failure.clear) clearSourceCache(runtime.viewer.id, runtime.pageId, cacheId);
			setStored((old) => ({ ...old, token, loading: false, terminal, firstFailed: !previous || failure.clear, error: failure.error || 'Install this app to load its records.', ...(failure.clear ? { page: undefined } : {}) }));
		};
		try {
			const inputs = { ...source.inputs, ...(previous ? { [source.cursorInput]: previous.cursor } : {}) };
			const loadKey = JSON.stringify({ collection: source.action, inputs, retry, attempt: attempts.current });
			const response: any = await runtime.load(loadKey, () => runtime.sharedRun
				? runtime.sharedRun(source.action, inputs)
				: apiRef.current.v1.actions.run({ action: source.action, inputs, source: 'component' }));
			if (stale()) return;
			if (response?.status !== 'ok') { attempts.current += 1; fail(response); return; }
			let page: CollectionPage;
			try { page = appendCollectionPage(source, response.result, previous); }
			catch (error) { fail(error, true); return; }
			if (!runtime.sharedRun) {
				if (response.cache === 'no-store') clearSourceCache(runtime.viewer.id, runtime.pageId, cacheId);
				else if (!previous) writeSourceCache(runtime.viewer.id, runtime.pageId, cacheId, response.result, key);
			}
			setStored({ identity, token, page, loading: false, error: '' });
		} catch (error) {
			if (!stale()) { attempts.current += 1; fail(error); }
		} finally {
			if (inFlight.current === token) inFlight.current = null;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- depend on the used runtime fields, not unrelated last/query changes
	}, [source, active, token, identity, initial, runtime.load, runtime.sharedRun, runtime.viewer.id, runtime.pageId, cacheId, key, retry]);
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
	return {
		bound: raw !== undefined && raw !== null,
		items: active ? state.page?.items || [] : [],
		loading: active && (refreshing || state.loading),
		error: config.error || (!enabled ? '' : !active && source ? 'Sign in to load these records.' : refreshing ? '' : state.error),
		hasMore: active && !state.terminal && (!!state.page?.cursor || !!state.error),
		loadMore,
		resetKey: key
	};
}
