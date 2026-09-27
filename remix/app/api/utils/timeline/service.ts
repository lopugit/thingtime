import { StorageMutationError } from '../storage/storageCore';
import { COMPONENT_BINDING_PREFIX, MAX_COMPONENT_BINDINGS, readComponentBinding } from '../../../timeline/componentBindings.ts';
import { TIMELINE_EVENT_KIND, TIMELINE_EVENT_MAX_BYTES, parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract.ts';
import type { TimelinePageRequest } from '../../../timeline/sync.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { appendTimelineEvent, readTimelinePage, readTimelineEntries, timelineEventThingId, timelineFolderId } from './repository.ts';

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

/** One bounded batch: referenced immutable records in this owner's Timeline.
 * Never follows component ids into another user's history or live document. */
const componentReaderDependencies = { collection: getThingsCollection, entries: readTimelineEntries };
export function createTimelineComponentReader(overrides: Partial<typeof componentReaderDependencies> = {}) {
	const deps = { ...componentReaderDependencies, ...overrides };
	return async (ownerId: string, eventId: string) => {
		const things = await deps.collection();
		const source = (await deps.entries(things, ownerId, [eventId]))[0];
		if (!source) return null;
		const wanted = source.event.dependencies.filter((item) => item.thingId.startsWith(COMPONENT_BINDING_PREFIX));
		if (wanted.length > MAX_COMPONENT_BINDINGS)
			throw new StorageMutationError(413, 'storage_invariant', 'Too many recorded components to preview together.');
		if (wanted.length) {
			const sizes = await things
				.find(
					{ ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: wanted.map((item) => timelineEventThingId(ownerId, item.eventId)) } },
					{ projection: { timelineEntryBytes: 1 } }
				)
				.toArray();
			if (sizes.length !== wanted.length || sizes.some((item: any) => !Number.isSafeInteger(item.timelineEntryBytes) || item.timelineEntryBytes < 1))
				throw new StorageMutationError(409, 'storage_invariant', 'Recorded component metadata is incomplete.');
			if (sizes.reduce((bytes: number, item: any) => bytes + item.timelineEntryBytes, 0) > TIMELINE_EVENT_MAX_BYTES - 4096)
				throw new StorageMutationError(413, 'storage_invariant', 'These recorded components are too large to preview together.');
		}
		const entries = wanted.length
			? await deps.entries(
					things,
					ownerId,
					wanted.map((item) => item.eventId)
			  )
			: [];
		const expected = new Map(wanted.map((item) => [item.eventId, item.thingId]));
		if (
			entries.length !== wanted.length ||
			entries.some(
				(item) => item.event.ownerId !== ownerId || expected.get(item.event.id) !== item.event.thingId || !readComponentBinding(item.event)
			)
		)
			throw new Error('Retained component dependencies are incomplete');
		return { eventId, entries };
	};
}
export const getTimelineComponentBindings = createTimelineComponentReader();
