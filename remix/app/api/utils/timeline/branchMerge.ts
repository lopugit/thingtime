import type { TimelineEntry, TimelineSnapshot } from '../../../timeline/contract.ts';
import { parseBranchMergeRequest, type BranchMergeRequest, type BranchMergePreview } from '../../../timeline/branchMerge.ts';
import { mergeVersionValues } from '../../../timeline/versions.ts';
import { getThingsCollection } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore';
import { readTimelineBranchEntry } from './branches.ts';
import { readTimelineEntries, readTimelineNodes } from './repository.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { createVersionContentReader, loadVersionGraph, versionMergeBase } from './versions.ts';

const refuse = (status: number, message: string): never => { throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message); };
const defaults = { collection: getThingsCollection, branch: readTimelineBranchEntry, entries: readTimelineEntries, nodes: readTimelineNodes, snapshot: readTimelineSnapshot };

/** Read-only comparison against the exact named-branch head. Applying uses
 * the same authored-event upload and compare-and-swap branch queue as edits. */
export function createBranchMergeService(overrides: Partial<typeof defaults> = {}) {
	const deps = { ...defaults, ...overrides };
	return async (ownerId: string, input: BranchMergeRequest): Promise<{ ok: true; preview: BranchMergePreview }> => {
		const request = parseBranchMergeRequest(input); const things = await deps.collection();
		const target = await deps.branch(things, ownerId, request.branchId, request.thingId);
		if (!target || target.branch.ownerId !== ownerId || target.head.ownerId !== ownerId || target.branch.id !== request.branchId || target.head.branchId !== request.branchId || target.head.thingId !== request.thingId) refuse(404, 'Branch not found.');
		if (target.head.revision !== request.expectedRevision || target.head.eventId !== request.expectedHeadId) refuse(409, 'This branch changed. Pull its latest version and compare again.');
		if (target.head.eventId === request.eventId) refuse(409, 'This version is already the branch head.');
		const read = (ids: string[]) => deps.entries(things, ownerId, ids);
		const versions = await read([target.head.eventId, request.eventId]);
		const byId = new Map(versions.map(entry => [entry.event.id, entry]));
		const current = byId.get(target.head.eventId); const incoming = byId.get(request.eventId);
		const available = (entry: TimelineEntry | undefined) => entry && entry.event.ownerId === ownerId && entry.event.thingId === request.thingId && entry.event.mode !== 'effect' && entry.event.after;
		if (!available(current) || !available(incoming)) refuse(404, 'One of these branch versions is unavailable.');
		const graph = await loadVersionGraph([target.head.eventId, request.eventId], request.thingId, ids => deps.nodes(things, ownerId, ids));
		const baseId = versionMergeBase(graph, target.head.eventId, request.eventId).id;
		const base = byId.get(baseId) ?? (await read([baseId]))[0];
		if (!available(base) || base!.event.id !== baseId) refuse(409, 'The shared ancestor is unavailable.');
		const contentFor = createVersionContentReader(graph, read, entry => deps.snapshot(things, ownerId, entry.event.id, 'after', entry.event.after));
		const currentValue = await contentFor(current!); const incomingValue = await contentFor(incoming!); const baseValue = await contentFor(base!);
		let merged: ReturnType<typeof mergeVersionValues>;
		try { merged = mergeVersionValues(baseValue, currentValue, incomingValue, request.choices); }
		catch { return refuse(422, 'These conflict choices no longer match. Refresh the comparison.'); }
		const snapshot = (value: TimelineSnapshot['value']): TimelineSnapshot => ({ adapter: 'thing-content', version: 1, value });
		return { ok: true, preview: { ...target, incomingEventId: incoming!.event.id, baseEventId: baseId,
			current: snapshot(currentValue), incoming: snapshot(incomingValue), result: snapshot(merged.value), conflicts: merged.conflicts } };
	};
}
export const previewBranchMerge = createBranchMergeService();
