import { createVersionGraphTools, type TimelineGraphNode } from './versionGraph.ts';
import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from './snapshotParts.ts';
import { copyBoundedJson } from '../utils/boundedJson.ts';
import { PUBLISHED_PREVIEW_MAX_BYTES, type VersionRequest } from './publishedVersion.ts';
import type { TimelineEntry, TimelineSnapshot, TimelineEvent } from './contract.ts';
import { mergeVersionValues, versionContentEquals } from './versions.ts';
import { isProtectedThingtime } from '../schemas/registry';
import { webpageComponentRefs } from './componentBindings.ts';
import { thingContentSnapshot } from './thingContent.ts';
import type { ComponentDefinitionVersion } from './componentDefinitions.ts';
import type { createPublishedComponentTools } from './publishedComponentTools.ts';

export type VersionSource = Pick<TimelineEntry, 'event'>;
type Dependencies<Entry extends VersionSource> = {
	reject(status: number, message: string): never;
	canUndoDraft?: (event: TimelineEvent) => boolean;
	find(id: string, owner: string): Promise<any>;
	entries(owner: string, ids: string[]): Promise<Entry[]>;
	nodes(owner: string, ids: string[]): Promise<TimelineGraphNode[]>;
	snapshot(owner: string, entry: Entry, side: 'before' | 'after'): Promise<TimelineSnapshot | null>;
	deleted(owner: string, id: string): Promise<{ entry: Entry; thingtime: string[] } | null>;
	folderExists(owner: string, id: string): Promise<boolean>;
	recorded(owner: string, sources: { event: TimelineEvent; content: any }[]): Promise<ComponentDefinitionVersion[]>;
	live(
		doc: any,
		current: any,
		result: any
	): Promise<{ current: ComponentDefinitionVersion; result: ComponentDefinitionVersion; fingerprint: string }>;
	compare: ReturnType<typeof createPublishedComponentTools>['comparePublishedComponents'];
	hash(value: unknown): string | Promise<string>;
};
/** Canonical read-only restore/undo/current-content merge planning. Adapters
 * retain authority, transactional mutation, replay and storage-specific readers. */
export async function prepareVersionChange<Entry extends VersionSource = TimelineEntry>(ownerId: string, request: VersionRequest, deps: Dependencies<Entry>) {
	const { reject } = deps;
	const { restorableContent, loadVersionGraph, versionMergeBase, versionContentSources, createVersionContentReader } =
		createVersionGraphTools(reject);
	const read = (ids: string[]) => deps.entries(ownerId, ids);
	const source = (await read([request.eventId]))[0];
	if (!source) reject(404, 'Version not found.');
	const liveDoc = await deps.find(source.event.thingId, ownerId);
	const recovery = !liveDoc && request.recover ? await deps.deleted(ownerId, source.event.thingId) : null;
	const doc =
		liveDoc ??
		(recovery
			? ({
					ownerId,
					shareId: source.event.thingId,
					thingtime: recovery.thingtime,
					crystal: {},
					acl: ['tt:user'],
					extended: null,
					tags: [],
					folderId: null,
					targetId: null,
					geo: null
			  } as any)
			: null);
	if (!doc || doc.ownerId !== ownerId || isProtectedThingtime(doc.thingtime ?? [])) reject(404, 'This Thing is not available for version changes.');
	// Undo reverts exactly one saved edit: base is that edit's after-state and
	// incoming its before-state, merged against the live current content.
	const undo = request.mode === 'undo';
	if (undo && (source.event.operation !== 'update' || (source.event.mode !== 'revision' && !deps.canUndoDraft?.(source.event)) || !source.event.before || !source.event.after))
		reject(422, 'Only a saved edit can be undone on its own.');
	if (!source.event.after && (source.event.operation !== 'delete' || request.mode !== 'restore' || !request.recover))
		reject(422, 'Choose Restore to recover the content before this deletion.');
	const headId = recovery?.entry.event.id ?? ((doc as any).timelineHeadId as string);
	if (!headId) reject(409, 'Save this Thing once before applying an earlier version.');
	if (request.command === 'apply-version' && headId !== request.expectedHeadId)
		reject(409, 'Thing changed after the version preview. Refresh and compare again.');
	const graph =
		request.mode === 'merge' ||
		!['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes((source.event.after ?? source.event.before)?.adapter ?? '')
			? await loadVersionGraph(request.mode === 'merge' ? [source.event.id, headId] : [source.event.id], source.event.thingId, (ids) =>
					deps.nodes(ownerId, ids)
			  )
			: new Map<string, TimelineGraphNode>();
	const baseNode = request.mode === 'merge' ? versionMergeBase(graph, headId, source.event.id) : null;
	const base = baseNode ? (await read([baseNode.id]))[0] : null;
	const resolved = (entry: Entry) => deps.snapshot(ownerId, entry, 'after');
	const contentFor = createVersionContentReader(graph, read, resolved);
	const currentSnapshot = thingContentSnapshot(doc)!;
	const current = restorableContent(currentSnapshot);
	const beforeContent = async (basis?: TimelineSnapshot['value']) =>
		['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(source.event.before?.adapter ?? '')
			? restorableContent(await deps.snapshot(ownerId, source, 'before'))
			: // A compact before (folder-placement) overlays its field on the exact after-state; no parent walk.
			  restorableContent(source.event.before, basis);
	// Undo never loads the head into the graph: every ancestor would be walked
	// and long-lived Things would refuse as too far back where restore succeeds.
	const baseContent = undo ? await contentFor(source) : base ? await contentFor(base) : null;
	const incoming = undo ? await beforeContent(baseContent!) : source.event.after ? await contentFor(source) : await beforeContent();
	let merged: ReturnType<typeof mergeVersionValues>;
	try {
		merged = baseContent ? mergeVersionValues(baseContent, current, incoming, request.choices) : { value: incoming, conflicts: [] };
	} catch {
		return reject(422, 'This comparison or its conflict choices are no longer valid. Refresh the comparison before applying it.');
	}
	if (undo && !merged.conflicts.length && versionContentEquals(merged.value, current))
		reject(409, 'Nothing to undo: this change is already reverted.');
	if (request.mode === 'restore' && Object.keys(request.choices ?? {}).length) reject(400, 'Restores do not accept merge choices.');
	if (recovery) {
		const folderId = typeof incoming.folderId === 'string' && (await deps.folderExists(ownerId, incoming.folderId)) ? incoming.folderId : null;
		// Recovery never silently republishes deleted content or recreates old
		// grants. The preview shows the surviving folder (or Things root).
		merged = { value: { ...incoming, acl: ['tt:user'], folderId }, conflicts: [] };
	}
	const snapshot = (value: any): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value });
	const isPage = doc.thingtime?.includes('webpage');
	// Undo compares the edit's own two sides: its parent's crystal source
	// supplies the recorded definitions before the edit, the edit its own.
	const undoSources = async () => {
		if (!isPage || !(webpageComponentRefs((incoming.crystal as any)?.blocks).length || source.event.dependencies.length))
			return [source.event.id, source.event.id];
		if (source.event.parentIds.length !== 1) reject(422, 'Undo is not available for this page version yet. Use Restore or Review and combine.');
		const parent = (await read([source.event.parentIds[0]]))[0];
		if (!parent || parent.event.thingId !== source.event.thingId || !parent.event.after) reject(409, 'The earlier version is unavailable.');
		const ancestors = ['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(parent!.event.after!.adapter)
			? graph
			: await loadVersionGraph([parent!.event.id], source.event.thingId, (ids) => deps.nodes(ownerId, ids));
		return [versionContentSources(ancestors, parent!).crystalId, versionContentSources(graph, source).crystalId];
	};
	const componentSources = undo
		? await undoSources()
		: await Promise.all(
				[source, ...(base ? [base] : [])].map(async (entry) => {
					if (entry.event.after) return versionContentSources(graph, entry).crystalId;
					if (
						!isPage ||
						!webpageComponentRefs((incoming.crystal as any)?.blocks).length ||
						entry.event.dependencies.length ||
						!entry.event.parentIds.length
					)
						return entry.event.id;
					const parent = (await read([entry.event.parentIds[0]]))[0];
					if (!parent || parent.event.thingId !== entry.event.thingId) reject(409, 'The deleted version has incomplete ancestry.');
					const ancestors = await loadVersionGraph([parent.event.id], entry.event.thingId, (ids) => deps.nodes(ownerId, ids));
					return versionContentSources(ancestors, parent).crystalId;
				})
		  );
	const providerEntries = await read([...new Set(componentSources)]);
	if (
		providerEntries.length !== new Set(componentSources).size ||
		providerEntries.some((entry) => entry.event.ownerId !== ownerId || entry.event.thingId !== source.event.thingId)
	)
		reject(409, 'A component source version is unavailable.');
	const providers = new Map(providerEntries.map((entry) => [entry.event.id, entry.event]));
	const refs = isPage ? webpageComponentRefs((merged.value as any).crystal?.blocks) : [];
	if (!request.componentMode && (refs.length || providerEntries.some((entry) => entry.event.dependencies.length)))
		reject(409, 'Update this client to review components before applying this version.');
	if (request.mode === 'restore' && Object.keys(request.componentChoices ?? {}).length)
		reject(400, 'Restores do not accept component merge choices.');
	let components: ReturnType<Dependencies<Entry>['compare']> | undefined;
	if (request.componentMode) {
		const recorded = isPage
			? await deps.recorded(
					ownerId,
					componentSources.map((id, index) => ({ event: providers.get(id)!, content: index === 0 ? incoming : baseContent }))
			  )
			: [{}, {}];
		const live = await deps.live(doc, current, merged.value);
		try {
			// Resolve the page's block tree before aligning definitions by block
			// identity. Its provisional tree may intentionally share a reference
			// that the incoming choice separates again.
			components = deps.compare(
				request,
				recorded[1] ?? {},
				recorded[0],
				live,
				refs,
				merged.conflicts.length ? undefined : { base: baseContent, current, incoming, result: merged.value }
			);
		} catch {
			return reject(
				422,
				'These components or choices cannot be combined. Refresh the comparison; separate shared block references with different definitions before merging.'
			);
		}
	}
	const recoveryFingerprint = recovery ? await deps.hash({ headId, folderId: (merged.value as any).folderId }) : undefined;
	if (request.command === 'apply-version' && recovery && request.expectedRecovery !== recoveryFingerprint)
		reject(409, 'The recovery placement changed. Refresh and review the recovery again.');
	const preview = {
		eventId: source.event.id,
		thingId: source.event.thingId,
		mode: request.mode,
		expectedHeadId: headId,
		current: recovery ? null : snapshot(current),
		...(recovery ? { recovery: true as const, recoveryFingerprint } : {}),
		incoming: snapshot(incoming),
		result: snapshot(merged.value),
		baseEventId: undo ? source.event.id : base?.event.id ?? null,
		conflicts: merged.conflicts,
		...(components ? { thingtime: doc.thingtime ?? ['data'], components } : {})
	};
	try {
		if (request.command === 'preview-version')
			copyBoundedJson(preview, { maxBytes: PUBLISHED_PREVIEW_MAX_BYTES, maxDepth: 100, maxNodes: 800_000 }, 'Version comparison');
	} catch {
		return reject(413, 'This comparison is too large to preview. Its recorded versions are still retained.');
	}
	if (request.command === 'preview-version') return { preview, source, doc, recovery, headId, current, merged, refs, components };
	if (components && components.fingerprint !== request.expectedComponents)
		reject(409, 'A component changed after the preview. Refresh and compare again.');
	if (components?.conflicts.length) reject(409, 'Choose which component definitions to keep before merging.');
	if (request.componentMode === 'recorded' && components!.missing.length)
		reject(422, 'Some component definitions were not recorded. Choose current components or another version before restoring.');
	if (merged.conflicts.length) reject(409, 'Choose which overlapping changes to keep before merging.');
	if (request.mode === 'merge' && headId === source.event.id) reject(409, 'This version is already current.');

	return { preview, source, doc, recovery, headId, current, merged, refs, components };
}
