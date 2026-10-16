import { TIMELINE_SNAPSHOT_PARTS_ADAPTER, parseTimelineSnapshotReference } from './snapshotParts.ts';
import { TIMELINE_EVENT_MAX_BYTES, type TimelineEntry, type TimelineEvent, type TimelineReceipt, type TimelineSnapshot } from './contract.ts';
import type { TimelineNote } from './notes.ts';
import type { TimelineVersionName } from './versionNames.ts';
import { createVersionGraphTools, type TimelineGraphNode } from './versionGraph.ts';

/** The existing History archive contract, shared by account and local authority.
 * This is a version archive, not a thingtime.transfer bundle. It never borrows
 * current Thing content or resolves dependency references against live Things. */
export type TimelineVersionExport = {
	formatVersion: 1;
	exportedAt: string;
	event: TimelineEvent;
	receipt: TimelineReceipt;
	content: TimelineSnapshot;
	notes: TimelineNote[];
	name: TimelineVersionName | null;
};
type Dependencies = {
	entries: (ids: string[]) => Promise<TimelineEntry[]>;
	nodes: (ids: string[]) => Promise<TimelineGraphNode[]>;
	snapshot: (entry: TimelineEntry, side: 'before' | 'after') => Promise<TimelineSnapshot | null>;
	notes: (entry: TimelineEntry) => Promise<TimelineNote[]>;
	names: (entry: TimelineEntry) => Promise<TimelineVersionName[]>;
	now: () => Date;
	refuse: (status: number, message: string) => never;
	retainedLocation: 'your account' | 'this device';
};
export function createVersionExportReader(deps: Dependencies) {
	const { refuse } = deps;
	const { restorableContent, loadVersionGraph, versionContentSources, createVersionContentReader } = createVersionGraphTools(refuse);
	const tooLarge = `This version is too large to export in one file. It remains retained in ${deps.retainedLocation}.`;
	return async (ownerId: string, eventId: string): Promise<TimelineVersionExport | null> => {
		if (typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(eventId)) refuse(400, 'Invalid Timeline export request');
		const read = deps.entries;
		const source = (await read([eventId]))[0];
		if (!source || source.event.ownerId !== ownerId || source.event.id !== eventId) return null;
		if (source.event.mode !== 'revision') refuse(422, 'Only saved versions can be exported.');
		const side = source.event.after ? 'after' : 'before';
		const retained = source.event[side];
		// A parts snapshot may hold up to 128 MiB; refuse from its reference before any part document is read.
		if (retained?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER && parseTimelineSnapshotReference(retained.value).bytes > TIMELINE_EVENT_MAX_BYTES)
			refuse(413, tooLarge);
		let value: ReturnType<typeof restorableContent>;
		if (source.event.after) {
			const compact = !['thing-content', TIMELINE_SNAPSHOT_PARTS_ADAPTER].includes(source.event.after.adapter);
			const graph = compact
				? await loadVersionGraph([eventId], source.event.thingId, (ids) => deps.nodes(ids))
				: new Map<string, TimelineGraphNode>();
			if (compact) {
				// A compact version resolves through its saved ancestor; that ancestor's parts reference is checked before any part is read.
				const ancestors = versionContentSources(graph, source).selected.filter((id) => id !== eventId);
				for (const ancestor of ancestors.length ? await read(ancestors) : []) {
					const after = ancestor.event.after;
					if (after?.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER && parseTimelineSnapshotReference(after.value).bytes > TIMELINE_EVENT_MAX_BYTES)
						refuse(413, tooLarge);
				}
			}
			value = await createVersionContentReader(graph, read, (entry) => deps.snapshot(entry, 'after'))(source);
		} else value = restorableContent(await deps.snapshot(source, 'before'));
		const [notes, names] = await Promise.all([deps.notes(source), deps.names(source)]);
		const result: TimelineVersionExport = {
			formatVersion: 1,
			exportedAt: deps.now().toISOString(),
			event: source.event,
			receipt: source.receipt,
			content: { adapter: 'thing-content', version: 1, value },
			notes,
			name: names[0] ?? null
		};
		if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TIMELINE_EVENT_MAX_BYTES) refuse(413, tooLarge);
		return result;
	};
}
