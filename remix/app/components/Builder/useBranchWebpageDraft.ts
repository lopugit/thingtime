import React from 'react';
import { useCapturedComponents } from '../../timeline/useCapturedComponents';
import { bindingsForBlocks } from '../../timeline/componentBindings';
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
	const [currentComponents, setCurrentComponents] = React.useState<ComponentsByRef>({});
	const [useCurrentComponents, setUseCurrentComponents] = React.useState(false);
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
	const historical = useCapturedComponents(branch.event, crystal?.blocks || [], branch.unwritten);
	const extras = React.useRef<ComponentsByRef>({});
	const retained = React.useRef<ComponentsByRef>({});
	const [, redraw] = React.useReducer((value) => value + 1, 0);
	// The exact immutable records are the durable cache. Keep the rendered map
	// mounted while a newer local event's links are being read asynchronously.
	retained.current = { ...retained.current, ...historical.components };
	const components = { ...retained.current, ...(useCurrentComponents ? currentComponents : {}), ...extras.current };
	const componentsRef = React.useRef(components);
	componentsRef.current = components;
	const refsKey = JSON.stringify(branchComponentRefs(crystal?.blocks || []));
	React.useEffect(() => {
		if (!useCurrentComponents) return;
		const refs: string[] = JSON.parse(refsKey);
		if (!refs.length) return;
		const controller = new AbortController();
		const blocks = refs.map((component, index) => ({ id: `preview-${index}`, type: 'component', component }));
		void apiRef.current.v1.webpages
			.resolveComponents(connection.scope, blocks, { signal: controller.signal })
			.then((result) => {
				if (controller.signal.aborted || !alive.current) return;
				if (!result?.ok) throw new Error(result?.error || 'Could not load components.');
				setCurrentComponents(buildComponentsByRef(result));
				setComponentError('');
			})
			.catch((error) => {
				if (!controller.signal.aborted && alive.current) setComponentError(error?.error || error?.message || 'Could not refresh components.');
			});
		return () => controller.abort();
	}, [useCurrentComponents, refsKey, revision, connection]);
	const captured = (snapshot: Parameters<typeof branch.change>[0]) => {
		const blocks = branchWebpageCrystal(snapshot).blocks;
		const bindings = bindingsForBlocks(blocks, componentsRef.current);
		return Object.keys(bindings).length === branchComponentRefs(blocks).length ? bindings : undefined;
	};

	const update = (patch: Parameters<typeof updateBranchWebpage>[1]) => {
		const current = branch.getSnapshot();
		if (!current || branch.locked) return;
		try {
			const next = updateBranchWebpage(current, patch);
			branch.change(next, captured(next));
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
			updateMetadata: update,
			componentNotice: useCurrentComponents
				? 'Previewing current components. Subsequent edits record these definitions.'
				: historical.loading
				? 'Loading recorded components…'
				: historical.missing.length
				? 'Some component definitions were not recorded for this version.'
				: 'Using recorded component definitions.',
			useCurrentComponents,
			setUseCurrentComponents: (value: boolean) => {
				setUseCurrentComponents(value);
			},
			retryComponents: historical.retry
		},
		history: {
			error: invalid || branch.error || componentError || historical.error,
			saving: branch.writing,
			recoverable: branch.locked ? [] : branch.recoverable,
			recover: async (event) => {
				extras.current = {};
				retained.current = {};
				setUseCurrentComponents(false);
				await branch.recover(event);
			},
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
			// A repeated reference shares this branch's recorded definition. Inserting
			// another instance must not silently upgrade existing instances.
			if (alive.current && !(Object.prototype.hasOwnProperty.call(componentsRef.current, ref) && componentsRef.current[ref])) {
				extras.current = { ...extras.current, [ref]: component };
				componentsRef.current = { ...componentsRef.current, [ref]: component };
				redraw();
			}
		},
		ensureComponent: async (ref) => {
			if (!alive.current || (Object.prototype.hasOwnProperty.call(componentsRef.current, ref) && componentsRef.current[ref])) return;
			// Only an explicit insertion requests a new current definition. Missing
			// historical bindings never enter this path as an automatic fallback.
			try {
				const result = await apiRef.current.v1.webpages.resolveComponents(connection.scope, [{ id: 'inserted', type: 'component', component: ref }]);
				if (!alive.current) return;
				if (!result?.ok) throw new Error(result?.error || 'Could not load the inserted component.');
				const added = buildComponentsByRef(result);
				extras.current = { ...extras.current, ...added };
				componentsRef.current = { ...componentsRef.current, ...added };
				redraw();
				const current = branch.getSnapshot();
				if (current) branch.change(current, captured(current));
			} catch (error: any) {
				if (alive.current) setComponentError(error?.error || error?.message || 'Could not load the inserted component.');
			}
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
				if (!branch.locked) {
					const next = options ? updateBranchWebpage(current, options) : current;
					branch.change(next, captured(next));
				}
				const result = await branch.save();
				return { ...result, id: target.head.thingId };
			} catch (error: any) {
				return { ok: false, error: error.message };
			}
		},
		resetToDefault: async () => ({ ok: false, error: 'A branch cannot delete the published page.' }),
		discardDraft: () => {
			extras.current = {};
			retained.current = {};
			setUseCurrentComponents(false);
			void branch.discard();
		},
		refresh: () => {
			void branch.load();
			refreshComponents();
		}
	};
}
