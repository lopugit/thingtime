import React from 'react';
import { readStampedCache, writeStampedCache, pruneCacheNamespace } from '../../hooks/localCache';
import { useApi } from '../../hooks/useApi';
import { useTimelineBranchDraft } from '../../timeline/useTimelineBranchDraft';
import type { useTimelineSession } from '../../timeline/TimelineProvider';
import type { TimelineBranchEntry } from '../../timeline/branches';
import { buildComponentsByRef, type ComponentsByRef } from './WebpageBlocksRenderer';
import { branchComponentRefs, branchWebpageCrystal, updateBranchWebpage } from './branchWebpageCore';
import type { UseWebpageDraft } from './useWebpage';

/** Adapts the shared branch working copy to the ordinary Builder contract.
 * There is deliberately no published Thing writer or Lopu save registration. */
export function useBranchWebpageDraft(
	target: TimelineBranchEntry,
	connection: NonNullable<ReturnType<typeof useTimelineSession>['connection']>
): UseWebpageDraft {
	const branch = useTimelineBranchDraft(target, connection);
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const cachePrefix = 'tt-branch-components-v1-';
	const cacheKey =
		cachePrefix +
		JSON.stringify([connection.scope.ownerId, connection.scope.apiOrigin, connection.scope.dataPlane, target.branch.id, target.head.thingId]);
	const [components, setComponents] = React.useState<ComponentsByRef>(() => {
		try {
			const cached = readStampedCache<any>(cacheKey);
			return cached && new TextEncoder().encode(JSON.stringify(cached)).byteLength <= 256 * 1024 ? buildComponentsByRef(cached) : {};
		} catch {
			return {};
		}
	});
	const [componentError, setComponentError] = React.useState('');
	const [revision, refreshComponents] = React.useReducer((value) => value + 1, 0);
	const alive = React.useRef(true);
	React.useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	let crystal: ReturnType<typeof branchWebpageCrystal> | null = null;
	let invalid = '';
	try {
		if (branch.snapshot) crystal = branchWebpageCrystal(branch.snapshot);
	} catch (error: any) {
		invalid = error.message;
	}
	const refsKey = JSON.stringify(branchComponentRefs(crystal?.blocks || []));
	React.useEffect(() => {
		const refs: string[] = JSON.parse(refsKey);
		if (!refs.length) return;
		const controller = new AbortController();
		const blocks = refs.map((component, index) => ({ id: `preview-${index}`, type: 'component', component }));
		void apiRef.current.v1.webpages
			.resolveComponents(connection.scope, blocks, { signal: controller.signal })
			.then((result) => {
				if (controller.signal.aborted || !alive.current) return;
				if (!result?.ok) throw new Error(result?.error || 'Could not load components.');
				setComponents(buildComponentsByRef(result));
				setComponentError('');
				// An optional bounded rendering cache, never a second history format. Store
				// the same public response and retain at most four 256-KiB entries.
				if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= 256 * 1024) {
					pruneCacheNamespace(cachePrefix, cacheKey, 4);
					writeStampedCache(cacheKey, result);
				}
			})
			.catch((error) => {
				if (!controller.signal.aborted && alive.current) setComponentError(error?.error || error?.message || 'Could not refresh components.');
			});
		return () => controller.abort();
	}, [refsKey, revision, connection, cacheKey]);
	const update = (patch: Parameters<typeof updateBranchWebpage>[1]) => {
		const current = branch.getSnapshot();
		if (!current || branch.locked) return;
		try {
			branch.change(updateBranchWebpage(current, patch));
		} catch (error: any) {
			setComponentError(error.message);
		}
	};
	const content = branch.snapshot?.value as any;
	return {
		branch: {
			id: target.branch.id,
			name: target.branch.name,
			locked: branch.locked,
			notice: branch.notice,
			canRefresh: branch.canRefresh,
			updateMetadata: update
		},
		history: {
			error: invalid || branch.error || componentError,
			saving: branch.writing,
			recoverable: branch.locked ? [] : branch.recoverable,
			recover: branch.recover,
			dismiss: branch.dismiss
		},
		loading: branch.loading,
		error: !!(invalid || branch.error),
		resolved: crystal
			? {
					page: {
						id: target.head.thingId,
						crystal,
						author: { id: connection.scope.ownerId },
						acl: content.acl ?? ['tt:user'],
						timelineHeadId: branch.target.head.eventId
					},
					source: 'user',
					componentsByRef: components
			  }
			: null,
		blocks: crystal?.blocks || [],
		dirty: branch.edited,
		componentsByRef: components,
		setBlocks: (blocks) => update({ blocks }),
		addComponent: (ref, component) => {
			if (alive.current) setComponents((current) => ({ ...current, [ref]: component }));
		},
		ensureComponent: async () => {
			if (alive.current) refreshComponents();
		},
		markSaved: () => {
			/* A published save cannot acknowledge this branch. */
		},
		save: async (options) => {
			if (!alive.current) return { ok: false, error: 'Branch editor closed.' };
			// Read the working copy now: inline edits may have been flushed in this same
			// click, before React renders their new block tree.
			const current = branch.getSnapshot();
			if (!current) return { ok: false, error: 'Load the branch before saving.' };
			try {
				if (options && !branch.locked) branch.change(updateBranchWebpage(current, options));
				const result = await branch.save();
				return { ...result, id: target.head.thingId };
			} catch (error: any) {
				return { ok: false, error: error.message };
			}
		},
		resetToDefault: async () => ({ ok: false, error: 'A branch cannot delete the published page.' }),
		discardDraft: () => {
			void branch.discard();
		},
		refresh: () => {
			void branch.load();
			refreshComponents();
		}
	};
}
