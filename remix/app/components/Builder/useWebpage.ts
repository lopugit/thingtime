import React from 'react';

import { useApi } from '~/hooks/useApi';
import { ACL_OWNER } from '~/schemas/registry';
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
	page: { id: string; crystal: WebpageCrystal; author?: { id?: string } | null } | null;
	source: 'user' | 'system' | null;
	componentsByRef: ComponentsByRef;
};

const targetQuery = (target: WebpageTarget): string => {
	if (target.kind === 'id') return `id=${encodeURIComponent(target.id)}`;
	if (target.kind === 'path') return `path=${encodeURIComponent(target.path)}`;
	return 'global=1';
};

export const resolveWebpageClient = async (target: WebpageTarget): Promise<ResolvedWebpage | null> => {
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

	React.useEffect(() => {
		if (!targetKey) return;
		let cancelled = false;
		setLoading(true);
		(async () => {
			const data = await resolveWebpageClient(JSON.parse(targetKey) as WebpageTarget);
			if (cancelled) return;
			setResolved(data);
			setBlocksState((data?.page?.crystal?.blocks as WebpageBlock[]) || []);
			setDirty(false);
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

	const save = React.useCallback(
		async (options?: { name?: string; isPublic?: boolean }) => {
			if (!targetKey) return { ok: false, error: 'Nothing to save' };
			const page = resolved?.page || null;
			const crystalBase: Partial<WebpageCrystal> = page?.crystal || {};
			const crystal: WebpageCrystal = {
				name: options?.name || crystalBase.name || 'Untitled page',
				...(crystalBase.description ? { description: crystalBase.description } : {}),
				...(crystalBase.pageKey ? { pageKey: crystalBase.pageKey } : {}),
				...(crystalBase.siteRoute ? { siteRoute: crystalBase.siteRoute } : {}),
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
						// standalone pages honour the public toggle on every save; site
						// personalisations never send acl (they stay private)
						...(options?.isPublic === undefined ? {} : { acl: [options.isPublic ? 'tt:all' : ACL_OWNER] })
					});
					if (!resp?.ok) return { ok: false, error: resp?.error || 'Save failed' };
					setDirty(false);
					setResolved((prev) => (prev ? { ...prev, page: { ...prev.page!, crystal } } : prev));
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
				// re-resolve so source flips to 'user' and future saves update in place
				setRefreshTick((tick) => tick + 1);
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
			setRefreshTick((tick) => tick + 1);
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err?.error || err?.message || 'Reset failed' };
		}
	}, [resolved]);

	const discardDraft = React.useCallback(() => {
		setBlocksState((resolved?.page?.crystal?.blocks as WebpageBlock[]) || []);
		setDirty(false);
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
