import React from 'react';

import { useApi } from '~/hooks/useApi';
import { ACL_OWNER, MAX_WEBPAGE_ROUTE_CHARS, WEBPAGE_ROUTE_PATTERN } from '~/schemas/registry';
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
	| { kind: 'id'; id: string }
	| { kind: 'path'; path: string }
	| { kind: 'global' };

export type ResolvedWebpage = {
	page: { id: string; crystal: WebpageCrystal; author?: { id?: string } | null; updatedAt?: string; acl?: string[] } | null;
	source: 'user' | 'system' | null;
	componentsByRef: ComponentsByRef;
};

// The public toggle must never bulldoze the rest of the acl — hidden links
// (tt:hidden + link keys), custom audiences (tt:user/…, tt:group/…), and app
// grants (tt:app/…) all live in the same list. Only the tt:all entry is the
// toggle's to add or remove.
export const webpageAclForToggle = (current: unknown, isPublic: boolean): string[] => {
	const list = Array.isArray(current) ? current.filter((entry): entry is string => typeof entry === 'string') : [];
	const others = list.filter((entry) => entry !== 'tt:all' && entry !== ACL_OWNER);
	return isPublic ? [ACL_OWNER, ...others, 'tt:all'] : [ACL_OWNER, ...others];
};

const targetQuery = (target: WebpageTarget): string => {
	if (target.kind === 'id') return `id=${encodeURIComponent(target.id)}`;
	if (target.kind === 'path') return `path=${encodeURIComponent(target.path)}`;
	return 'global=1';
};

export const resolveWebpageClient = async (target: WebpageTarget): Promise<ResolvedWebpage | null> => {
	// SiteBlocksHost resolves EVERY route a signed-in viewer lands on, and many
	// of them can never be a siteRoute: /post/<id>, /docs/api/<group>/<docId>
	// and the `*` thing-tree catch-all routinely carry characters the server
	// gate refuses. Screening with the SAME bounds turns a guaranteed 400 round
	// trip into the null a refused resolve already returns — identical
	// behaviour, one less request per navigation.
	if (target.kind === 'path' && (target.path.length > MAX_WEBPAGE_ROUTE_CHARS || !WEBPAGE_ROUTE_PATTERN.test(target.path))) return null;
	try {
		const response = await fetch(`/api/v1/webpages/resolve?${targetQuery(target)}`, { credentials: 'include' });
		if (!response.ok) return null;
		const data = await response.json();
		if (!data?.ok) return null;
		return {
			page: data.page || null,
			source: data.source || null,
			componentsByRef: buildComponentsByRef(data)
		};
	} catch {
		return null;
	}
};

export type UseWebpageDraft = {
	loading: boolean;
	resolved: ResolvedWebpage | null;
	blocks: WebpageBlock[];
	setBlocks: (next: WebpageBlock[]) => void;
	dirty: boolean;
	componentsByRef: ComponentsByRef;
	// make a just-inserted component renderable without a refetch
	addComponent: (ref: string, component: ComponentThingLike | null) => void;
	ensureComponent: (ref: string) => Promise<void>;
	save: (options?: { name?: string; isPublic?: boolean }) => Promise<{ ok: boolean; id?: string; error?: string }>;
	// discard the viewer's personalised site doc (site targets only)
	resetToDefault: () => Promise<{ ok: boolean; error?: string }>;
	discardDraft: () => void;
	refresh: () => void;
};

export const useWebpageDraft = (target: WebpageTarget | null): UseWebpageDraft => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;

	const [resolved, setResolved] = React.useState<ResolvedWebpage | null>(null);
	const [loading, setLoading] = React.useState(!!target);
	const [blocks, setBlocksState] = React.useState<WebpageBlock[]>([]);
	const [dirty, setDirty] = React.useState(false);
	const [extraComponents, setExtraComponents] = React.useState<ComponentsByRef>({});
	const [refreshTick, setRefreshTick] = React.useState(0);

	const targetKey = target ? JSON.stringify(target) : null;

	// dirtyRef mirrors dirty for async landings: a background re-resolve (the
	// post-save refresh) must never clobber keystrokes typed while it was in
	// flight — only a target change or an explicitly-clean draft applies
	// server blocks wholesale.
	const dirtyRef = React.useRef(false);
	const appliedTargetRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		if (!targetKey) return;
		let cancelled = false;
		setLoading(true);
		(async () => {
			const data = await resolveWebpageClient(JSON.parse(targetKey) as WebpageTarget);
			if (cancelled) return;
			setResolved(data);
			const targetChanged = appliedTargetRef.current !== targetKey;
			appliedTargetRef.current = targetKey;
			if (targetChanged || !dirtyRef.current) {
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
	}, [targetKey, refreshTick]);

	const setBlocks = React.useCallback((next: WebpageBlock[]) => {
		setBlocksState(next);
		setDirty(true);
		dirtyRef.current = true;
	}, []);

	const componentsByRef = React.useMemo(
		() => ({ ...(resolved?.componentsByRef || {}), ...extraComponents }),
		[resolved?.componentsByRef, extraComponents]
	);

	const addComponent = React.useCallback((ref: string, component: ComponentThingLike | null) => {
		setExtraComponents((prev) => ({ ...prev, [ref]: component }));
	}, []);

	const ensureComponent = React.useCallback(
		async (ref: string) => {
			if (componentsByRef[ref]) return;
			// exact shareId first, then the seeded platform doc
			for (const id of [ref, `component-${ref}`]) {
				try {
					const resp: any = await apiRef.current.v1.things.get({ id });
					const thing = resp?.thing || resp?.things?.[0];
					if (thing?.crystal?.render) {
						setExtraComponents((prev) => ({ ...prev, [ref]: thing }));
						return;
					}
				} catch {
					// fall through to the next candidate
				}
			}
			setExtraComponents((prev) => ({ ...prev, [ref]: prev[ref] ?? null }));
		},
		[componentsByRef]
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
		async (options?: { name?: string; isPublic?: boolean }) => {
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
					// the public toggle merges with the page's existing acl (hidden
					// links, custom audiences, app grants survive the toggle)
					let aclPatch: { acl: string[] } | Record<string, never> = {};
					if (options?.isPublic !== undefined) {
						let currentAcl: unknown = page.acl;
						if (!Array.isArray(currentAcl)) {
							try {
								const current: any = await apiRef.current.v1.things.get({ id: page.id });
								currentAcl = current?.thing?.acl ?? current?.things?.[0]?.acl;
							} catch {
								// fall through — the merge treats unknown as owner-only base
							}
						}
						aclPatch = { acl: webpageAclForToggle(currentAcl, options.isPublic) };
					}
					const resp: any = await apiRef.current.v1.things.update({
						id: page.id,
						crystal,
						// refuse to silently overwrite a save made from another tab or
						// device since this draft loaded (server answers 409)
						...(page.updatedAt ? { expectedUpdatedAt: page.updatedAt } : {}),
						...aclPatch
					});
					if (!resp?.ok) return { ok: false, error: resp?.error || 'Save failed' };
					setDirty(false);
					dirtyRef.current = false;
					const nextUpdatedAt = typeof resp?.thing?.updatedAt === 'string' ? resp.thing.updatedAt : page.updatedAt;
					const nextAcl = Array.isArray(resp?.thing?.acl) ? (resp.thing.acl as string[]) : page.acl;
					setResolved((prev) =>
						prev ? { ...prev, page: { ...prev.page!, crystal, updatedAt: nextUpdatedAt, acl: nextAcl } } : prev
					);
					announceSave(crystal);
					return { ok: true, id: page.id };
				}
				// forking a system/site default or creating a brand-new page —
				// personal site docs stay private, standalone pages honour the toggle
				const resp: any = await apiRef.current.v1.things.create({
					thingtime: ['webpage'],
					crystal,
					...(options?.isPublic ? {} : { acl: [ACL_OWNER] })
				});
				if (!resp?.ok) return { ok: false, error: resp?.error || 'Save failed' };
				const id = resp?.thing?.id || resp?.id;
				setDirty(false);
				dirtyRef.current = false;
				// re-resolve so source flips to 'user' and future saves update in place
				setRefreshTick((tick) => tick + 1);
				announceSave(crystal);
				return { ok: true, id };
			} catch (err: any) {
				return { ok: false, error: err?.error || err?.message || 'Save failed' };
			}
		},
		[targetKey, resolved, blocks]
	);

	const resetToDefault = React.useCallback(async () => {
		const page = resolved?.page;
		if (!page || resolved?.source !== 'user') return { ok: false, error: 'Nothing to reset' };
		try {
			const resp: any = await apiRef.current.v1.things.remove({ id: page.id });
			if (!resp?.ok) return { ok: false, error: resp?.error || 'Reset failed' };
			// an explicit reset means the refresh SHOULD replace any local edits
			setDirty(false);
			dirtyRef.current = false;
			setRefreshTick((tick) => tick + 1);
			announceSave((page.crystal || {}) as WebpageCrystal);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.error || err?.message || 'Reset failed' };
		}
	}, [resolved]);

	const discardDraft = React.useCallback(() => {
		setBlocksState((resolved?.page?.crystal?.blocks as WebpageBlock[]) || []);
		setDirty(false);
		dirtyRef.current = false;
	}, [resolved]);

	const refresh = React.useCallback(() => setRefreshTick((tick) => tick + 1), []);

	return {
		loading,
		resolved,
		blocks,
		setBlocks,
		dirty,
		componentsByRef,
		addComponent,
		ensureComponent,
		save,
		resetToDefault,
		discardDraft,
		refresh
	};
};
