import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { ACL_OWNER, MAX_WEBPAGE_ROUTE_CHARS, WEBPAGE_ROUTE_PATTERN } from '~/schemas/registry';
import {
	focusWebpageDraft,
	notifyWebpageDraftChange,
	registerWebpageDraft,
	type LopuDraftHandle,
	type LopuSavedThingLike
} from '../Lopu/lopuBuildBridge';
import { buildComponentsByRef, type ComponentsByRef, type ComponentThingLike } from './WebpageBlocksRenderer';
import type { WebpageBlock, WebpageCrystal } from './webpageBlocks';

// Data layer for webpage surfaces: resolve a page (+ its referenced
// components) through GET /api/v1/webpages/resolve, hold an editable block
// draft, and save through the ordinary things write path — a viewer-owned
// page updates in place, a system/site doc forks into the viewer's own twin
// (same pageKey/siteRoute, forkOf provenance) so shared defaults are never
// mutated. Optimistic-render house rule: resolves never gate a first paint —
// callers render last-known state and reconcile when data lands.

export type WebpageTarget =
	| { kind: 'id'; id: string; key?: string }
	| { kind: 'path'; path: string }
	| { kind: 'global' };

export type ResolvedWebpage = {
	page: { id: string; crystal: WebpageCrystal; author?: { id?: string } | null; updatedAt?: string; acl?: string[]; linkKey?: string } | null;
	source: 'user' | 'system' | null;
	componentsByRef: ComponentsByRef;
};

const targetQuery = (target: WebpageTarget): string => {
	if (target.kind === 'id') {
		const id = `id=${encodeURIComponent(target.id)}`;
		return target.key ? `${id}&key=${encodeURIComponent(target.key)}` : id;
	}
	if (target.kind === 'path') return `path=${encodeURIComponent(target.path)}`;
	return 'global=1';
};

export type WebpageLoadResult =
	| { status: 'ready'; data: ResolvedWebpage }
	| { status: 'missing' }
	| { status: 'error' };

export const loadWebpageClient = async (target: WebpageTarget): Promise<WebpageLoadResult> => {
	// SiteBlocksHost resolves EVERY route a signed-in viewer lands on, and many
	// of them can never be a siteRoute: /post/<id>, /docs/api/<group>/<docId>
	// and the `*` thing-tree catch-all routinely carry characters the server
	// gate refuses. Screening with the SAME bounds turns a guaranteed 400 round
	// trip into the null a refused resolve already returns — identical
	// behaviour, one less request per navigation.
	if (target.kind === 'path' && (target.path.length > MAX_WEBPAGE_ROUTE_CHARS || !WEBPAGE_ROUTE_PATTERN.test(target.path))) return { status: 'missing' };
	try {
		await requireThingtimeCapability('api.webpages-resolve', '1.2.0');
		const response = await fetch(`/api/v1/webpages/resolve?${targetQuery(target)}`, { credentials: 'include' });
		if ([400, 401, 403, 404].includes(response.status)) return { status: 'missing' };
		if (!response.ok) return { status: 'error' };
		const data = await response.json();
		if (data?.ok !== true || !Object.prototype.hasOwnProperty.call(data, 'page')) return { status: 'error' };
		return {
			status: 'ready',
			data: {
				page: data.page || null,
				source: data.source || null,
				componentsByRef: buildComponentsByRef(data)
			}
		};
	} catch {
		return { status: 'error' };
	}
};

// Optional site decorations retain their nullable fallback contract. The page
// viewer/draft uses the discriminated result so outages never mean "not found".
export const resolveWebpageClient = async (target: WebpageTarget): Promise<ResolvedWebpage | null> => {
	const result = await loadWebpageClient(target);
	return result.status === 'ready' ? result.data : null;
};

// The /p/ viewer only DISPLAYS its draft (p.tsx renders the resolved page
// blocks, never the editable tree). Drafts mounted there register with the
// Lopu bridge as read-only so a streamed builder patch can never target them;
// everything else (BuilderCanvas, SiteBlocksEditor — which the host never
// mounts under /p/) is editable. Callers can always say so explicitly.
export const isReadOnlyWebpageViewerRoute = (pathname: string): boolean => /^\/p\//.test(pathname);

export type UseWebpageDraftOptions = {
	// whether Lopu may paint live builder patches into this draft
	// (default: true everywhere except the /p/ viewer route)
	editable?: boolean;
};

// A save adopted through markSaved (Lopu persisted a patch) can outrun a
// resolve that was already in flight for the SAME page. Applying that older
// answer would rewind updatedAt (so the next save's expectedUpdatedAt 409s)
// and the blocks, so such a landing is skipped.
export const isStaleWebpageLanding = (
	saved: { id: string; updatedAt: string } | null,
	landing: { id?: string; updatedAt?: string } | null | undefined
): boolean =>
	!!saved && !!landing && landing.id === saved.id && typeof landing.updatedAt === 'string' && landing.updatedAt < saved.updatedAt;

// Fold a saved webpage thing into the resolved page: the save is the viewer's
// own row (source 'user'), fields the save does not carry are kept.
export const mergeSavedWebpage = (prev: ResolvedWebpage | null, thing: LopuSavedThingLike): ResolvedWebpage | null => {
	const id = typeof thing?.id === 'string' && thing.id ? thing.id : prev?.page?.id || null;
	if (!id) return prev;
	const crystal =
		thing?.crystal && typeof thing.crystal === 'object' && !Array.isArray(thing.crystal)
			? (thing.crystal as unknown as WebpageCrystal)
			: prev?.page?.crystal || null;
	if (!crystal) return prev;
	const updatedAt = typeof thing?.updatedAt === 'string' ? thing.updatedAt : prev?.page?.updatedAt;
	const acl = Array.isArray(thing?.acl) ? thing.acl.filter((entry): entry is string => typeof entry === 'string') : prev?.page?.acl;
	const savedAclPresent = Array.isArray(thing?.acl);
	const linkKey =
		typeof (thing as { linkKey?: unknown })?.linkKey === 'string'
			? (thing as { linkKey: string }).linkKey
			: savedAclPresent
				? undefined
				: prev?.page?.linkKey;
	const author = thing?.author && typeof thing.author === 'object' ? thing.author : prev?.page?.author;
	// Drop the previous linkKey from the carried-over base: `linkKey` above has
	// already decided whether it survives (a save that carries an acl is the
	// authoritative sharing state, so a key it omits was revoked). Spreading
	// `{ linkKey: undefined }` over the base would clear it too, but it also
	// materialises an own `linkKey` key, which deepStrictEqual reports as a
	// difference from an unshared page that never had one.
	const { linkKey: _supersededLinkKey, ...carried } = prev?.page || {};
	return {
		page: {
			...carried,
			id,
			crystal,
			...(author !== undefined ? { author } : {}),
			...(updatedAt ? { updatedAt } : {}),
			...(acl ? { acl } : {}),
			...(linkKey ? { linkKey } : {})
		},
		source: 'user',
		componentsByRef: prev?.componentsByRef || {}
	};
};

export type UseWebpageDraft = {
	loading: boolean;
	error: boolean;
	resolved: ResolvedWebpage | null;
	blocks: WebpageBlock[];
	setBlocks: (next: WebpageBlock[]) => void;
	dirty: boolean;
	componentsByRef: ComponentsByRef;
	// make a just-inserted component renderable without a refetch
	addComponent: (ref: string, component: ComponentThingLike | null) => void;
	ensureComponent: (ref: string) => Promise<void>;
	// adopt a save made elsewhere (Lopu's persisted patch/create): clears
	// dirty, updates the resolved page (updatedAt/crystal/acl) and, when the
	// saved thing carries blocks, converges the draft on them
	markSaved: (thing: LopuSavedThingLike) => void;
	save: (options?: { name?: string; acl?: string[] }) => Promise<{ ok: boolean; id?: string; thing?: Record<string, any>; error?: string }>;
	// discard the viewer's personalised site doc (site targets only)
	resetToDefault: () => Promise<{ ok: boolean; error?: string }>;
	discardDraft: () => void;
	refresh: () => void;
};

export const useWebpageDraft = (target: WebpageTarget | null, options?: UseWebpageDraftOptions): UseWebpageDraft => {
	const api = useApi();
	const user = useCurrentUser();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const editableOption = options?.editable;

	const [resolved, setResolved] = React.useState<ResolvedWebpage | null>(null);
	const [loading, setLoading] = React.useState(!!target);
	const [error, setError] = React.useState(false);
	const [blocks, setBlocksState] = React.useState<WebpageBlock[]>([]);
	const [dirty, setDirty] = React.useState(false);
	const [extraComponents, setExtraComponents] = React.useState<ComponentsByRef>({});
	const [refreshTick, setRefreshTick] = React.useState(0);

	const targetKey = target ? JSON.stringify(target) : null;
	const scopeKey = JSON.stringify([targetKey, user?.id || null]);
	const scopeRef = React.useRef(scopeKey);
	scopeRef.current = scopeKey;
	const [stateScope, setStateScope] = React.useState(scopeKey);

	// dirtyRef mirrors dirty for async landings: a background re-resolve (the
	// post-save refresh) must never clobber keystrokes typed while it was in
	// flight — only a target change or an explicitly-clean draft applies
	// server blocks wholesale.
	const dirtyRef = React.useRef(false);
	const appliedTargetRef = React.useRef<string | null>(null);
	// the newest save adopted through markSaved for the current target — a
	// resolve that was in flight when it landed must not rewind it
	const savedRef = React.useRef<{ id: string; updatedAt: string } | null>(null);
	const savedTargetRef = React.useRef<string | null>(null);
	// the live handle registered with the Lopu build bridge (created once)
	const handleRef = React.useRef<LopuDraftHandle | null>(null);
	const generationRef = React.useRef(0);

	// Reset before children commit, not in an effect after a stale private page
	// has already painted under another user, target or hidden-link key.
	if (stateScope !== scopeKey) {
		generationRef.current++;
		setStateScope(scopeKey);
		setResolved(null);
		setBlocksState([]);
		setExtraComponents({});
		setDirty(false);
		setError(false);
		setLoading(!!target);
		dirtyRef.current = false;
		appliedTargetRef.current = null;
		savedRef.current = null;
		savedTargetRef.current = null;
	}

	React.useEffect(() => {
		if (!targetKey) return;
		if (savedTargetRef.current !== targetKey) {
			savedTargetRef.current = targetKey;
			savedRef.current = null;
		}
		let cancelled = false;
		const generation = generationRef.current;
		setLoading(true);
		(async () => {
			const result = await loadWebpageClient(JSON.parse(targetKey) as WebpageTarget);
			if (cancelled || generation !== generationRef.current) return;
			if (result.status === 'error') {
				setError(true);
				setLoading(false);
				return;
			}
			setError(false);
			const data = result.status === 'ready' ? result.data : null;
			if (isStaleWebpageLanding(savedRef.current, data?.page)) {
				setLoading(false);
				return;
			}
			setResolved(data);
			const targetChanged = appliedTargetRef.current !== targetKey;
			appliedTargetRef.current = targetKey;
			if (!data?.page || targetChanged || !dirtyRef.current) {
				setBlocksState((data?.page?.crystal?.blocks as WebpageBlock[]) || []);
				setDirty(false);
				dirtyRef.current = false;
			}
			setExtraComponents({});
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [targetKey, scopeKey, refreshTick]);

	const setBlocks = React.useCallback((next: WebpageBlock[]) => {
		if (scopeRef.current !== scopeKey) return;
		setBlocksState(next);
		setDirty(true);
		dirtyRef.current = true;
		// an edit makes this the draft Lopu's 'active' patches go to
		if (handleRef.current) focusWebpageDraft(handleRef.current);
	}, [scopeKey]);

	const componentsByRef = React.useMemo(
		() => ({ ...(resolved?.componentsByRef || {}), ...extraComponents }),
		[resolved?.componentsByRef, extraComponents]
	);

	const addComponent = React.useCallback((ref: string, component: ComponentThingLike | null) => {
		if (scopeRef.current !== scopeKey) return;
		setExtraComponents((prev) => ({ ...prev, [ref]: component }));
	}, [scopeKey]);

	const ensureComponent = React.useCallback(
		async (ref: string) => {
			if (scopeRef.current !== scopeKey) return;
			const generation = generationRef.current;
			if (componentsByRef[ref]) return;
			// exact shareId first, then the seeded platform doc
			for (const id of [ref, `component-${ref}`]) {
				try {
					const resp: any = await apiRef.current.v1.things.get({ id });
					if (generation !== generationRef.current) return;
					const thing = resp?.thing || resp?.things?.[0];
					if (thing?.crystal?.render) {
						setExtraComponents((prev) => ({ ...prev, [ref]: thing }));
						return;
					}
				} catch {
					// fall through to the next candidate
				}
				if (generation !== generationRef.current) return;
			}
			setExtraComponents((prev) => ({ ...prev, [ref]: prev[ref] ?? null }));
		},
		[componentsByRef, scopeKey]
	);

	// Saves announce themselves so caches elsewhere (SiteBlocksHost's per-path
	// and global-blocks caches) can invalidate without coupling to this hook.
	const announceSave = (crystal: WebpageCrystal) => {
		try {
			window.dispatchEvent(
				new CustomEvent('thingtime:webpage-saved', {
					detail: { pageKey: crystal.pageKey || null, siteRoute: crystal.siteRoute || null }
				})
			);
		} catch {
			// non-browser runtimes
		}
	};

	const save = React.useCallback(
		async (options?: { name?: string; acl?: string[] }) => {
			if (scopeRef.current !== scopeKey) return { ok: false, error: 'Page or account changed' };
			const generation = generationRef.current;
			if (!targetKey) return { ok: false, error: 'Nothing to save' };
			const target = JSON.parse(targetKey) as WebpageTarget;
			const page = resolved?.page || null;
			const crystalBase: Partial<WebpageCrystal> = page?.crystal || {};
			// site/global targets must stamp their binding even when no seed doc
			// existed to inherit it from (fresh deployments before the admin seed)
			const siteRoute = crystalBase.siteRoute || (target.kind === 'path' ? target.path : undefined);
			const pageKey = crystalBase.pageKey || (target.kind === 'global' ? 'site-global' : undefined);
			const crystal: WebpageCrystal = {
				name: options?.name || crystalBase.name || 'Untitled page',
				...(crystalBase.description ? { description: crystalBase.description } : {}),
				...(pageKey ? { pageKey } : {}),
				...(siteRoute ? { siteRoute } : {}),
				...(crystalBase.previewBg ? { previewBg: crystalBase.previewBg } : {}),
				version: (Number(crystalBase.version) || 0) + 1,
				...(resolved?.source === 'user'
					? crystalBase.forkOf
						? { forkOf: crystalBase.forkOf }
						: {}
					: page
						? { forkOf: page.id }
						: {}),
				blocks
			};
			try {
				if (resolved?.source === 'user' && page) {
					const resp: any = await apiRef.current.v1.things.update({
						id: page.id,
						crystal,
						// refuse to silently overwrite a save made from another tab or
						// device since this draft loaded (server answers 409)
						...(page.updatedAt ? { expectedUpdatedAt: page.updatedAt } : {}),
						...(options?.acl ? { acl: options.acl } : {})
					});
					if (!resp?.ok) return { ok: false, error: resp?.error || 'Save failed' };
					if (generation !== generationRef.current) return { ok: false, error: 'Page or account changed while saving. Reopen the saved page to continue.' };
					setDirty(false);
					dirtyRef.current = false;
					const nextUpdatedAt = typeof resp?.thing?.updatedAt === 'string' ? resp.thing.updatedAt : page.updatedAt;
					const nextAcl = Array.isArray(resp?.thing?.acl) ? (resp.thing.acl as string[]) : page.acl;
					const nextLinkKey = typeof resp?.thing?.linkKey === 'string' ? resp.thing.linkKey : undefined;
					setResolved((prev) =>
						prev
							? {
								...prev,
								page: {
									...prev.page!,
									crystal,
									updatedAt: nextUpdatedAt,
									acl: nextAcl,
									...(nextLinkKey ? { linkKey: nextLinkKey } : { linkKey: undefined })
								}
							}
							: prev
					);
					announceSave(crystal);
					return { ok: true, id: page.id, thing: resp?.thing };
				}
				// forking a system/site default or creating a brand-new page —
				// personal site docs stay private, standalone pages honour the toggle
				const resp: any = await apiRef.current.v1.things.create({
					thingtime: ['webpage'],
					crystal,
					acl: options?.acl || [ACL_OWNER]
				});
				if (!resp?.ok) return { ok: false, error: resp?.error || 'Save failed' };
				if (generation !== generationRef.current) return { ok: false, error: 'Page or account changed while saving. Find the saved page in your Things.' };
				const id = resp?.thing?.id || resp?.id;
				setDirty(false);
				dirtyRef.current = false;
				// re-resolve so source flips to 'user' and future saves update in place
				setRefreshTick((tick) => tick + 1);
				announceSave(crystal);
				return { ok: true, id, thing: resp?.thing };
			} catch (err: any) {
				return { ok: false, error: err?.error || err?.message || 'Save failed' };
			}
		},
		[targetKey, resolved, blocks, scopeKey]
	);

	const resetToDefault = React.useCallback(async () => {
		if (scopeRef.current !== scopeKey) return { ok: false, error: 'Page or account changed' };
		const generation = generationRef.current;
		const page = resolved?.page;
		if (!page || resolved?.source !== 'user') return { ok: false, error: 'Nothing to reset' };
		try {
			const resp: any = await apiRef.current.v1.things.remove({ id: page.id });
			if (!resp?.ok) return { ok: false, error: resp?.error || 'Reset failed' };
			if (generation !== generationRef.current) return { ok: false, error: 'Page or account changed while resetting.' };
			// an explicit reset means the refresh SHOULD replace any local edits
			setDirty(false);
			dirtyRef.current = false;
			setRefreshTick((tick) => tick + 1);
			announceSave((page.crystal || {}) as WebpageCrystal);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.error || err?.message || 'Reset failed' };
		}
	}, [resolved, scopeKey]);

	const discardDraft = React.useCallback(() => {
		if (scopeRef.current !== scopeKey) return;
		setBlocksState((resolved?.page?.crystal?.blocks as WebpageBlock[]) || []);
		setDirty(false);
		dirtyRef.current = false;
	}, [resolved, scopeKey]);

	const refresh = React.useCallback(() => setRefreshTick((tick) => tick + 1), []);

	// A save that happened elsewhere (Lopu persisted a patch or created this
	// page): the saved thing is the truth — adopt its blocks (ids the server
	// rewrote included), its updatedAt (so the next manual save's
	// expectedUpdatedAt matches) and clear dirty. The bridge announces the
	// thingtime:webpage-saved event itself.
	const markSaved = React.useCallback((thing: LopuSavedThingLike) => {
		if (scopeRef.current !== scopeKey) return;
		const id = typeof thing?.id === 'string' && thing.id ? thing.id : null;
		const updatedAt = typeof thing?.updatedAt === 'string' ? thing.updatedAt : null;
		if (id && updatedAt) savedRef.current = { id, updatedAt };
		const savedBlocks =
			thing?.crystal && Array.isArray((thing.crystal as { blocks?: unknown }).blocks)
				? ((thing.crystal as unknown as WebpageCrystal).blocks as WebpageBlock[])
				: null;
		if (savedBlocks) setBlocksState(savedBlocks);
		setDirty(false);
		dirtyRef.current = false;
		setResolved((prev) => mergeSavedWebpage(prev, thing));
	}, [scopeKey]);

	// ——— Lopu build bridge registration ————————————————————————————————
	// One LIVE handle per mount: getters read the latest state through refs,
	// so the registry never sees a stale tree; the methods are the stable
	// callbacks above. Editability and the target are fixed per registration.
	const stateRef = React.useRef({ resolved, blocks, dirty, componentsByRef });
	stateRef.current = { resolved, blocks, dirty, componentsByRef };
	const metaRef = React.useRef<{ editable: boolean; target: WebpageTarget | null }>({ editable: true, target: null });
	const handle = React.useMemo<LopuDraftHandle>(
		() => ({
			get id() {
				return stateRef.current.resolved?.page?.id ?? null;
			},
			get source() {
				return stateRef.current.resolved?.source ?? null;
			},
			get pageKey() {
				const value = stateRef.current.resolved?.page?.crystal?.pageKey;
				// mirror save(): an unseeded global doc still binds to site-global
				return typeof value === 'string' && value ? value : metaRef.current.target?.kind === 'global' ? 'site-global' : null;
			},
			get siteRoute() {
				const value = stateRef.current.resolved?.page?.crystal?.siteRoute;
				return typeof value === 'string' && value ? value : metaRef.current.target?.kind === 'path' ? metaRef.current.target.path : null;
			},
			get updatedAt() {
				return stateRef.current.resolved?.page?.updatedAt ?? null;
			},
			get name() {
				const value = stateRef.current.resolved?.page?.crystal?.name;
				return typeof value === 'string' && value ? value : null;
			},
			get blocks() {
				return stateRef.current.blocks;
			},
			get dirty() {
				return stateRef.current.dirty;
			},
			get editable() {
				return metaRef.current.editable;
			},
			get target() {
				return metaRef.current.target;
			},
			get componentsByRef() {
				return stateRef.current.componentsByRef;
			},
			setBlocks,
			addComponent,
			markSaved
		}),
		[setBlocks, addComponent, markSaved]
	);
	handleRef.current = handle;

	React.useEffect(() => {
		if (!targetKey) return;
		metaRef.current = {
			target: JSON.parse(targetKey) as WebpageTarget,
			editable: editableOption ?? !(typeof window !== 'undefined' && isReadOnlyWebpageViewerRoute(window.location.pathname))
		};
		return registerWebpageDraft(handle);
	}, [handle, targetKey, editableOption]);

	// the context chip (page name, dirty) follows the resolved page
	React.useEffect(() => {
		notifyWebpageDraftChange();
	}, [resolved, dirty]);

	return {
		loading,
		error,
		resolved,
		blocks,
		setBlocks,
		dirty,
		componentsByRef,
		addComponent,
		ensureComponent,
		markSaved,
		save,
		resetToDefault,
		discardDraft,
		refresh
	};
};
