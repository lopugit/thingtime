import { readRecordedComponents } from '../../../timeline/recordedComponentReader.ts';
import { StorageMutationError } from '../storage/storageCore';
import { COMPONENT_BINDING_PREFIX, MAX_COMPONENT_BINDINGS } from '../../../timeline/componentBindings.ts';
import {
	TIMELINE_EVENT_KIND,
	TIMELINE_EVENT_MAX_BYTES,
	parseTimelineEvent,
	type TimelineEvent,
	type TimelineDependency
} from '../../../timeline/contract.ts';
import type { TimelinePageRequest } from '../../../timeline/sync.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { appendTimelineEvent, readTimelinePage, readTimelineEntries, timelineEventThingId, timelineFolderId } from './repository.ts';

export { getTimelineNotes } from './notes.ts';
export { getTimelineVersionNames, handleVersionNameCommand } from './versionNames.ts';
export { exportTimelineVersion } from './exportVersion.ts';

export const timelineDataPlane = mongoDataPlane;

export const timelineDiscovery = (ownerId: string) => ({ ownerId, dataPlane: timelineDataPlane(), folderId: timelineFolderId(ownerId) });

export function validateClientTimelineEvent(ownerId: string, input: unknown): TimelineEvent {
	const event = parseTimelineEvent(input);
	if (event.ownerId !== ownerId || event.actorId !== ownerId || event.source !== 'client' || event.mode !== 'draft' || event.clientId === null)
		throw new Error('Only this account’s authored drafts can be uploaded');
	// Draft uploads store supplied private data, not evidence that a mutation ran.
	// They never write the target Thing, claim API/AI provenance, or execute code.
	return event;
}

export async function pushClientTimelineEvent(ownerId: string, event: TimelineEvent) {
	const validated = validateClientTimelineEvent(ownerId, event);
	const things = await getThingsCollection();
	return withMongoTransaction((session) => appendTimelineEvent(things, validated, session));
}

export async function getTimelinePage(ownerId: string, request: TimelinePageRequest) {
	return readTimelinePage(await getThingsCollection(), ownerId, request);
}

export async function getTimelineEntry(ownerId: string, eventId: string) {
	return (await readTimelineEntries(await getThingsCollection(), ownerId, [eventId]))[0] ?? null;
}

/** Read at most three versions' captures. Preflight the combined byte budget
 * before decoding any payload, then use the repository's bounded batch reads. */
export async function readRecordedComponentEntries(
	things: any,
	ownerId: string,
	wanted: TimelineDependency[],
	entries = readTimelineEntries,
	maxBytes = TIMELINE_EVENT_MAX_BYTES - 4096
) {
	return readRecordedComponents({ ownerId, wanted, maxBytes,
		readSizes: ids => things.find({ ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: ids.map(id => timelineEventThingId(ownerId, id)) } }, { projection: { timelineEntryBytes: 1 } }).toArray(),
		readEntries: ids => entries(things, ownerId, ids),
		error: (status, message) => new StorageMutationError(status, 'storage_invariant', message)
	});
}

/** One bounded batch: referenced immutable records in this owner's Timeline.
 * Never follows component ids into another user's history or live document. */
const componentReaderDependencies = { collection: getThingsCollection, entries: readTimelineEntries };
export function createTimelineComponentReader(overrides: Partial<typeof componentReaderDependencies> = {}) {
	const deps = { ...componentReaderDependencies, ...overrides };
	return async (ownerId: string, eventId: string) => {
		const things = await deps.collection();
		const source = (await deps.entries(things, ownerId, [eventId]))[0];
		if (!source || source.event.ownerId !== ownerId || source.event.id !== eventId) return null;
		const wanted = source.event.dependencies.filter((item) => item.thingId.startsWith(COMPONENT_BINDING_PREFIX));
		if (wanted.length > MAX_COMPONENT_BINDINGS)
			throw new StorageMutationError(413, 'storage_invariant', 'Too many recorded components to preview together.');
		return { eventId, entries: await readRecordedComponentEntries(things, ownerId, wanted, deps.entries) };
	};
}
export const getTimelineComponentBindings = createTimelineComponentReader();
