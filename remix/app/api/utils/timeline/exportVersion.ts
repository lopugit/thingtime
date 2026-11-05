import { TIMELINE_SNAPSHOT_PARTS_ADAPTER } from '../../../timeline/snapshotParts.ts';
import { type TimelineEvent, type TimelineReceipt, type TimelineSnapshot } from '../../../timeline/contract.ts';
import type { TimelineNote } from '../../../timeline/notes.ts';
import type { TimelineVersionName } from '../../../timeline/versionNames.ts';
import { getThingsCollection } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore.ts';
import { readTimelineEntries, readTimelineNodes, type TimelineGraphNode } from './repository.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { readTimelineNotes } from './notes.ts';
import { readTimelineVersionNames } from './versionNames.ts';
import { createVersionContentReader, loadVersionGraph, restorableContent } from './versions.ts';

/** One saved version as a self-describing private file: the immutable event and
 * receipt, its resolved restorable content, its notes and its name. Nothing is
 * written; materialized content is separate from bounded event controls. */
export type TimelineVersionExport = { formatVersion: 1; exportedAt: string; event: TimelineEvent; receipt: TimelineReceipt; content: TimelineSnapshot; notes: TimelineNote[]; name: TimelineVersionName | null };
const refuse = (status: number, message: string): never => { throw new StorageMutationError(status, 'storage_invariant', message); };
const dependencies = {
	collection: getThingsCollection, entries: readTimelineEntries, nodes: readTimelineNodes, snapshot: readTimelineSnapshot,
	notes: readTimelineNotes, names: readTimelineVersionNames, now: () => new Date()
};
export function createExportVersionService(overrides: Partial<typeof dependencies> = {}) {
	const deps = { ...dependencies, ...overrides };
	return async (ownerId: string, eventId: string): Promise<TimelineVersionExport | null> => {
		const things = await deps.collection();
		const read = (ids: string[]) => deps.entries(things, ownerId, ids);
		const source = (await read([eventId]))[0];
		if (!source || source.event.ownerId !== ownerId || source.event.id !== eventId) return null;
		if (source.event.mode !== 'revision') refuse(422, 'Only saved versions can be exported.');
		let value: ReturnType<typeof restorableContent>;
		if (source.event.after) {
			const compact = !['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(source.event.after.adapter);
			const graph = compact ? await loadVersionGraph([eventId], source.event.thingId, ids => deps.nodes(things, ownerId, ids)) : new Map<string, TimelineGraphNode>();
			value = await createVersionContentReader(graph, read, entry => deps.snapshot(things, ownerId, entry.event.id, 'after', entry.event.after))(source);
		} else value = restorableContent(await deps.snapshot(things, ownerId, eventId, 'before', source.event.before));
		const [notes, names] = await Promise.all([deps.notes(things, ownerId, [eventId]), deps.names(things, ownerId, [eventId])]);
		return { formatVersion: 1, exportedAt: deps.now().toISOString(), event: source.event, receipt: source.receipt, content: { adapter: 'thing-content', version: 1, value }, notes, name: names[0] ?? null };
	};
}
export const exportTimelineVersion = createExportVersionService();
