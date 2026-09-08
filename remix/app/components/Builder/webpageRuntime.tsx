import React from 'react';
import { useLocation } from 'react-router';

import { MAX_WEBPAGE_BLOCKS } from '~/schemas/registry';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// The PAGE RUNTIME — what turns a composed page of component things into a
// running app. It is deliberately tiny: a version counter every source-bound
// block subscribes to (any control run on the page bumps it, so every bound
// block refetches and the page reconciles without a reload — the "data
// written by a run appears in the same page" rule from
// claude-todo/21-app-composition-surface.md), the LAST run result (so a
// template can narrate it: "You caught Pikachu!"), the viewer, the URL query
// (deep links into an app page), and the install hook for a seeded app page
// the viewer has not installed yet.
//
// No block gets any authority from this: sources and controls both run
// through the ordinary delegated run path (owner-only resolution), and the
// runtime only remembers what came back.

export type WebpageRuntimeLastRun = {
	action: string;
	ok: boolean;
	result: unknown;
	error: string | null;
	at: number;
};

export type WebpageRuntimeViewer = {
	signedIn: boolean;
	id: string | null;
	username: string | null;
	displayName: string | null;
};

export type WebpageRuntime = {
	pageId: string | null;
	pageKey: string | null;
	suiteKey: string | null;
	// 'user' = the viewer owns this page (their installed twin); 'system' = the
	// seeded copy (an app the viewer can install); null = not a resolved page
	source: 'user' | 'system' | null;
	viewer: WebpageRuntimeViewer;
	query: Record<string, string>;
	version: number;
	last: WebpageRuntimeLastRun | null;
	installing: boolean;
	// bump the version — every source-bound block refetches
	refresh: () => void;
	// record a finished control run (bumps the version too)
	report: (run: Omit<WebpageRuntimeLastRun, 'at'>) => void;
	// install the page's suite for the viewer; resolves true when the page
	// should be re-resolved (the viewer now owns a twin)
	install: (() => Promise<boolean>) | null;
	// SHARED source loads: blocks bound to the same action + inputs at the
	// same version share one request (a page with three cards bound to
	// `today` runs the action once, not three times)
	load: (key: string, fetcher: () => Promise<unknown>) => Promise<unknown>;
};

const INERT_VIEWER: WebpageRuntimeViewer = { signedIn: false, id: null, username: null, displayName: null };

// Outside a provider (the builder canvas, gallery thumbnails, /components
// previews) the runtime is inert: nothing fetches, nothing installs.
const INERT_RUNTIME: WebpageRuntime = {
	pageId: null,
	pageKey: null,
	suiteKey: null,
	source: null,
	viewer: INERT_VIEWER,
	query: {},
	version: 0,
	last: null,
	installing: false,
	refresh: () => {},
	report: () => {},
	install: null,
	load: (_key, fetcher) => fetcher()
};

const WebpageRuntimeContext = React.createContext<WebpageRuntime>(INERT_RUNTIME);

export const useWebpageRuntime = (): WebpageRuntime => React.useContext(WebpageRuntimeContext);

const MAX_QUERY_KEYS = 32;
const MAX_QUERY_VALUE_CHARS = 200;
const QUERY_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;

// A shared-load entry only earns its keep for the SIBLING blocks that ask for
// the same key in the same beat, and one page draws at most
// MAX_WEBPAGE_BLOCKS of them. The version reset below is not on its own a
// bound: an `interval` source varies its key every tick (and a manual refetch
// on every press) WITHOUT moving the runtime version, so on a page that never
// runs a control — a clock, a live tally — the map would keep one entry, and
// the whole action result it retains, for every tick of the session. Evict
// oldest-first past a full page's worth of live blocks: the burst of loads for
// one version is a single render pass, so no sibling can lose an entry it is
// still waiting on, and the worst case past the cap is one duplicate request.
export const MAX_SHARED_SOURCE_LOADS = MAX_WEBPAGE_BLOCKS;

export const evictSharedLoads = <T,>(promises: Map<string, T>, max: number = MAX_SHARED_SOURCE_LOADS): void => {
	// Map iterates in insertion order, so the first key is always the oldest
	while (promises.size > max) {
		const oldest = promises.keys().next();
		if (oldest.done) return;
		promises.delete(oldest.value);
	}
};

// URL search params as a bounded string map: templates read `{query.id}`,
// source inputs interpolate `{query.<name>}`. Values are plain strings —
// they only ever become action INPUTS, which the executor validates.
export const queryScopeOf = (search: string): Record<string, string> => {
	const out: Record<string, string> = {};
	let params: URLSearchParams;
	try {
		params = new URLSearchParams(search);
	} catch {
		return out;
	}
	let count = 0;
	params.forEach((value, key) => {
		if (count >= MAX_QUERY_KEYS || !QUERY_KEY_PATTERN.test(key)) return;
		out[key] = value.slice(0, MAX_QUERY_VALUE_CHARS);
		count += 1;
	});
	return out;
};

export const WebpageRuntimeProvider = ({
	pageId,
	pageKey,
	suiteKey,
	source,
	onInstall,
	children
}: {
	pageId: string | null;
	pageKey: string | null;
	suiteKey: string | null;
	source: 'user' | 'system' | null;
	onInstall?: () => Promise<boolean>;
	children: React.ReactNode;
}) => {
	const user = useCurrentUser();
	const location = useLocation();
	const [version, setVersion] = React.useState(0);
	const [last, setLast] = React.useState<WebpageRuntimeLastRun | null>(null);
	const [installing, setInstalling] = React.useState(false);
	const onInstallRef = React.useRef(onInstall);
	onInstallRef.current = onInstall;

	const viewer = React.useMemo<WebpageRuntimeViewer>(
		() => ({
			signedIn: !!user?.id,
			id: user?.id || null,
			username: user?.username || null,
			displayName: (user as { displayName?: string | null } | null)?.displayName || user?.username || null
		}),
		[user]
	);
	const query = React.useMemo(() => queryScopeOf(location.search), [location.search]);

	const refresh = React.useCallback(() => setVersion((current) => current + 1), []);
	const report = React.useCallback((run: Omit<WebpageRuntimeLastRun, 'at'>) => {
		setLast({ ...run, at: Date.now() });
		setVersion((current) => current + 1);
	}, []);
	// in-flight + settled promises per (key) — reset whenever the version
	// moves so a refresh always refetches
	const loadsRef = React.useRef<{ version: number; promises: Map<string, Promise<unknown>> }>({ version: -1, promises: new Map() });
	const load = React.useCallback(
		(key: string, fetcher: () => Promise<unknown>): Promise<unknown> => {
			const store = loadsRef.current;
			if (store.version !== version) {
				store.version = version;
				store.promises = new Map();
			}
			const existing = store.promises.get(key);
			if (existing) return existing;
			const promise = fetcher();
			store.promises.set(key, promise);
			evictSharedLoads(store.promises);
			return promise;
		},
		[version]
	);
	const install = React.useCallback(async () => {
		if (!onInstallRef.current || installing) return false;
		setInstalling(true);
		try {
			return await onInstallRef.current();
		} finally {
			setInstalling(false);
		}
	}, [installing]);

	const value = React.useMemo<WebpageRuntime>(
		() => ({
			pageId,
			pageKey,
			suiteKey,
			source,
			viewer,
			query,
			version,
			last,
			installing,
			refresh,
			report,
			install: onInstall ? install : null,
			load
		}),
		[pageId, pageKey, suiteKey, source, viewer, query, version, last, installing, refresh, report, install, onInstall, load]
	);

	return <WebpageRuntimeContext.Provider value={value}>{children}</WebpageRuntimeContext.Provider>;
};

// The localStorage tier for source results — optimistic paint on the next
// visit (house rule: never flash a loading state when a last-known value
// exists). Keys are per VIEWER + page + block, so two apps never share a
// cache line AND two people never do.
//
// The viewer segment is the privacy bar, not a nicety. A source result is the
// signed-in viewer's OWN private data — their orders, their expense rows,
// their trainer, a natal chart derived from their birth details — and /p/ is
// a shared public URL. `useThingSource` seeds its state from this cache in a
// lazy initializer, BEFORE it knows whether the viewer is signed in and
// before any fetch can replace it, so a page-scoped key would paint the last
// signed-in viewer's data to whoever opens that page next on the same
// browser: the signed-out visitor, or the next account on a shared machine.
// Keyed by viewer, a cache line is only ever readable by the person who
// filled it; no viewer means no cache line at all (the builder canvas and
// gallery thumbnails render outside a provider and simply fetch).
// Sign-out additionally drops these keys (hooks/useApi logout), the same
// shared-browser rule the tt-activity-/tt-saved- caches follow.
export const SOURCE_CACHE_PREFIX = 'tt-page-source:';

export const sourceCacheKey = (viewerId: string | null, pageId: string | null, blockId: string): string | null =>
	viewerId && pageId && blockId ? `${SOURCE_CACHE_PREFIX}${viewerId}:${pageId}:${blockId}` : null;

export const readSourceCache = (viewerId: string | null, pageId: string | null, blockId: string): unknown => {
	const key = sourceCacheKey(viewerId, pageId, blockId);
	if (!key || typeof window === 'undefined') return undefined;
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? JSON.parse(raw) : undefined;
	} catch {
		return undefined;
	}
};

export const writeSourceCache = (viewerId: string | null, pageId: string | null, blockId: string, value: unknown): void => {
	const key = sourceCacheKey(viewerId, pageId, blockId);
	if (!key || typeof window === 'undefined') return;
	try {
		const encoded = JSON.stringify(value);
		if (encoded.length > 256 * 1024) return;
		window.localStorage.setItem(key, encoded);
	} catch {
		// storage full or unavailable — the live fetch still paints
	}
};

// Named form fields inside one component root, read the way the click
// wrapper reads them: input/select/textarea with a `name`, checkboxes as
// booleans, radios only when checked, everything else as its string value.
// Password inputs are never read (see below). Empty strings are dropped so a
// static ttActionInputs value survives an untouched field. Pure DOM, shared by
// the click hook and its tests.
export const gatherFormFields = (root: HTMLElement | null): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	if (!root) return out;
	const fields = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]');
	fields.forEach((field) => {
		const name = field.getAttribute('name') || '';
		if (!name || !QUERY_KEY_PATTERN.test(name)) return;
		if (field instanceof HTMLInputElement) {
			// A PASSWORD field is never an action input. ACTION_INPUT_TYPES is
			// string/text/number/boolean/enum — there is no credential type — and
			// no suite renders one. But component markup IS untrusted data, and
			// `autoComplete` now passes the HtmlThingRenderer allowlist, so a
			// crafted component can put `<input type="password"
			// autoComplete="current-password">` on this origin and let the
			// viewer's password manager fill it. Reading that value would carry
			// the viewer's own site password into a run's inputs — stored on
			// their data thing and echoed in their run record. Never gather one:
			// the field can still render and fill, the value just goes nowhere.
			if (field.type === 'password') return;
			if (field.type === 'checkbox') {
				out[name] = field.checked;
				return;
			}
			if (field.type === 'radio') {
				if (field.checked) out[name] = field.value;
				return;
			}
		}
		const value = field.value;
		if (typeof value === 'string' && value !== '') out[name] = value.slice(0, 4000);
	});
	return out;
};
