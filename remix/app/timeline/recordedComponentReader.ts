import { COMPONENT_BINDING_PREFIX, MAX_COMPONENT_BINDINGS, readComponentBinding } from './componentBindings.ts';
import { TIMELINE_EVENT_MAX_BYTES, type TimelineDependency, type TimelineEntry } from './contract.ts';
/** Preflight all payload sizes before reading immutable component captures. */
export async function readRecordedComponents<Entry extends Pick<TimelineEntry, 'event'> = TimelineEntry>({
	ownerId,
	wanted,
	readSizes,
	readEntries,
	error,
	maxBytes = TIMELINE_EVENT_MAX_BYTES - 4096
}: {
	ownerId: string;
	wanted: TimelineDependency[];
	readSizes: (ids: string[]) => Promise<{ timelineEntryBytes: number }[]>;
	readEntries: (ids: string[]) => Promise<Entry[]>;
	error: (status: number, message: string) => Error;
	maxBytes?: number;
}) {
	const expected = new Map<string, string>();
	for (const link of wanted) {
		if (!link.thingId.startsWith(COMPONENT_BINDING_PREFIX) || (expected.has(link.eventId) && expected.get(link.eventId) !== link.thingId))
			throw new Error('Invalid recorded component links');
		expected.set(link.eventId, link.thingId);
	}
	if (expected.size > MAX_COMPONENT_BINDINGS * 3) throw error(413, 'Too many recorded components to compare together.');
	const ids = [...expected.keys()];
	if (!ids.length) return [];
	const sizes = await readSizes(ids);
	if (sizes.length !== ids.length || sizes.some((item: any) => !Number.isSafeInteger(item.timelineEntryBytes) || item.timelineEntryBytes < 1))
		throw error(409, 'Recorded component metadata is incomplete.');
	if (sizes.reduce((bytes: number, item: any) => bytes + item.timelineEntryBytes, 0) > maxBytes)
		throw error(413, 'These recorded components are too large to preview together.');
	const found = [];
	for (let offset = 0; offset < ids.length; offset += 128) found.push(...(await readEntries(ids.slice(offset, offset + 128))));
	if (
		found.length !== ids.length ||
		new Set(found.map((item) => item.event.id)).size !== ids.length ||
		found.some((item) => item.event.ownerId !== ownerId || expected.get(item.event.id) !== item.event.thingId || !readComponentBinding(item.event))
	)
		throw new Error('Retained component dependencies are incomplete');
	return found;
}
