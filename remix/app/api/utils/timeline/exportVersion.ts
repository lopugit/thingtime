import { createVersionExportReader, type TimelineVersionExport } from '../../../timeline/exportVersion.ts';
import { ALGORITHM_CONTENT_ADAPTER } from '../../../timeline/algorithmContent.ts';
import { getThingsCollection } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore.ts';
import { readTimelineEntries, readTimelineNodes } from './repository.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { readTimelineNotes } from './notes.ts';
import { readTimelineVersionNames } from './versionNames.ts';

export type { TimelineVersionExport } from '../../../timeline/exportVersion.ts';

const refuse = (status: number, message: string): never => {
	throw new StorageMutationError(status, 'storage_invariant', message);
};
const dependencies = {
	collection: getThingsCollection,
	entries: readTimelineEntries,
	nodes: readTimelineNodes,
	snapshot: readTimelineSnapshot,
	notes: readTimelineNotes,
	names: readTimelineVersionNames,
	now: () => new Date()
};
export function createExportVersionService(overrides: Partial<typeof dependencies> = {}) {
	const deps = { ...dependencies, ...overrides };
	return async (ownerId: string, eventId: string): Promise<TimelineVersionExport | null> => {
		const things = await deps.collection();
		return createVersionExportReader({
			entries: (ids) => deps.entries(things, ownerId, ids),
			nodes: (ids) => deps.nodes(things, ownerId, ids),
			snapshot: (entry, side) => deps.snapshot(things, ownerId, entry.event.id, side, entry.event[side]),
			notes: (entry) => deps.notes(things, ownerId, [entry.event.id]),
			names: (entry) => deps.names(things, ownerId, [entry.event.id]),
			now: deps.now,
			// Algorithm profiles are authored through their dedicated device queue. This
			// private archive preserves draft provenance and grants no write authority.
			allowClientDrafts: (event) => (event.after ?? event.before)?.adapter === ALGORITHM_CONTENT_ADAPTER,
			refuse,
			retainedLocation: 'your account'
		})(ownerId, eventId);
	};
}
export const exportTimelineVersion = createExportVersionService();
