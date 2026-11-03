import { TIMELINE_EVENT_MAX_BYTES, type TimelineEntry, type TimelineSnapshot } from '../../../timeline/contract.ts';
import { parseBranchMergeRequest, type BranchMergeRequest, type BranchMergePreview } from '../../../timeline/branchMerge.ts';
import { componentBlocks, componentVersion, mergeComponentVersions, parseComponentMergeContext } from '../../../timeline/componentMerge.ts';
import { readRecordedComponentEntries } from './service.ts';
import { COMPONENT_BINDING_PREFIX } from '../../../timeline/componentBindings.ts';
import { copyBoundedJson } from '../../../utils/boundedJson.ts';
import { mergeVersionValues } from '../../../timeline/versions.ts';
import { getThingsCollection } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore';
import { readTimelineBranchEntry } from './branches.ts';
import { readTimelineEntries, readTimelineNodes } from './repository.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { createVersionContentReader, loadVersionGraph, versionMergeBase, versionContentSources } from './versions.ts';

const refuse = (status: number, message: string): never => {
	throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message);
};
const defaults = {
	collection: getThingsCollection,
	branch: readTimelineBranchEntry,
	entries: readTimelineEntries,
	nodes: readTimelineNodes,
	snapshot: readTimelineSnapshot
};
const checkedPreview = (preview: BranchMergePreview): { ok: true; preview: BranchMergePreview } => {
	try {
		copyBoundedJson(preview, { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 100, maxNodes: 200_000 }, 'Branch merge preview');
	} catch {
		return refuse(413, 'This comparison is too large to preview. Its recorded versions are still retained.');
	}
	return { ok: true, preview };
};

/** Read-only comparison against the exact named-branch head. Applying uses
 * the same authored-event upload and compare-and-swap branch queue as edits. */
export function createBranchMergeService(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async (ownerId: string, input: BranchMergeRequest): Promise<{ ok: true; preview: BranchMergePreview }> => {
		const request = parseBranchMergeRequest(input);
		const things = await deps.collection();
		const target = await deps.branch(things, ownerId, request.branchId, request.thingId);
		if (
			!target ||
			target.branch.ownerId !== ownerId ||
			target.head.ownerId !== ownerId ||
			target.branch.id !== request.branchId ||
			target.head.branchId !== request.branchId ||
			target.head.thingId !== request.thingId
		)
			refuse(404, 'Branch not found.');
		if (target.head.revision !== request.expectedRevision || target.head.eventId !== request.expectedHeadId)
			refuse(409, 'This branch changed. Pull its latest version and compare again.');
		if (target.head.eventId === request.eventId) refuse(409, 'This version is already the branch head.');
		const read = (ids: string[]) => deps.entries(things, ownerId, ids);
		const versions = await read([target.head.eventId, request.eventId]);
		const byId = new Map(versions.map((entry) => [entry.event.id, entry]));
		const current = byId.get(target.head.eventId);
		const incoming = byId.get(request.eventId);
		const available = (entry: TimelineEntry | undefined) =>
			entry && entry.event.ownerId === ownerId && entry.event.thingId === request.thingId && entry.event.mode !== 'effect' && entry.event.after;
		if (!available(current) || !available(incoming)) refuse(404, 'One of these branch versions is unavailable.');
		const graph = await loadVersionGraph([target.head.eventId, request.eventId], request.thingId, (ids) => deps.nodes(things, ownerId, ids));
		const baseId = versionMergeBase(graph, target.head.eventId, request.eventId).id;
		const base = byId.get(baseId) ?? (await read([baseId]))[0];
		if (!available(base) || base!.event.id !== baseId) refuse(409, 'The shared ancestor is unavailable.');
		const contentFor = createVersionContentReader(graph, read, (entry) => deps.snapshot(things, ownerId, entry.event.id, 'after', entry.event.after));
		const currentValue = await contentFor(current!);
		const incomingValue = await contentFor(incoming!);
		const baseValue = await contentFor(base!);
		let merged: ReturnType<typeof mergeVersionValues>;
		try {
			merged = mergeVersionValues(baseValue, currentValue, incomingValue, request.choices);
		} catch {
			return refuse(422, 'These conflict choices no longer match. Refresh the comparison.');
		}
		const snapshot = (value: TimelineSnapshot['value']): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value });
		const preview: BranchMergePreview = {
			...target,
			incomingEventId: incoming!.event.id,
			baseEventId: baseId,
			current: snapshot(currentValue),
			incoming: snapshot(incomingValue),
			result: snapshot(merged.value),
			conflicts: merged.conflicts
		};
		const sources = [base!, current!, incoming!].map((entry) => versionContentSources(graph, entry).crystalId);
		byId.set(baseId, base!);
		const missing = [...new Set(sources)].filter((id) => !byId.has(id));
		if (missing.length) {
			const found = await read(missing);
			if (
				found.length !== missing.length ||
				new Set(found.map((entry) => entry.event.id)).size !== missing.length ||
				found.some((entry) => !missing.includes(entry.event.id) || !available(entry))
			)
				refuse(409, 'A component source version is unavailable.');
			for (const entry of found) byId.set(entry.event.id, entry);
		}
		const sourceEvents = sources.map((id) => byId.get(id)!.event);
		if (request.componentChoices === undefined) {
			if (sourceEvents.some((event) => event.dependencies.length)) refuse(409, 'Update this client to review recorded components before merging.');
			return checkedPreview(preview);
		}
		if (sourceEvents.some((event) => event.dependencies.some((link) => !link.thingId.startsWith(COMPONENT_BINDING_PREFIX))))
			refuse(422, 'This version has dependencies this comparison cannot yet merge.');
		const bytes = new TextEncoder().encode(JSON.stringify(preview)).byteLength;
		const entries = await readRecordedComponentEntries(
			things,
			ownerId,
			sourceEvents.flatMap((event) => event.dependencies),
			deps.entries,
			TIMELINE_EVENT_MAX_BYTES - bytes - 256 * 1024
		);
		const componentVersions = [baseValue, currentValue, incomingValue].map((value, index) =>
			componentVersion(sourceEvents[index], componentBlocks(snapshot(value)), entries)
		);
		const used = new Set(componentVersions.flatMap((version) => Object.values(version).flatMap((link) => (link ? [link.eventId] : []))));
		preview.components = parseComponentMergeContext(
			{
				base: componentVersions[0],
				current: componentVersions[1],
				incoming: componentVersions[2],
				entries: entries.filter((entry) => used.has(entry.event.id)),
				choices: request.componentChoices
			},
			ownerId,
			preview.current,
			preview.incoming,
			request.componentChoices
		);
		try {
			mergeComponentVersions(preview.components, preview.result);
		} catch {
			return refuse(422, 'These component choices no longer match. Refresh the comparison.');
		}
		return checkedPreview(preview);
	};
}
export const previewBranchMerge = createBranchMergeService();
