import { createHash } from 'node:crypto';
import { parseTimelineEvent, type TimelineEvent } from '../../../timeline/contract.ts';
import type { TimelinePageRequest } from '../../../timeline/sync.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { getActiveMongoEndpoint, dbNameFromMongoUrl } from '../mongodb/endpoint';
import { sanitiseMongoHost } from '../mongodb/config';
import { appendTimelineEvent, readTimelinePage, readTimelineEntries, timelineFolderId } from './repository.ts';

export function timelineDataPlane(): string {
	const selection = getActiveMongoEndpoint();
	if (!selection) return 'home';
	// Do not export a hash of credentials that could become a password oracle.
	const identity = [sanitiseMongoHost(selection.url), dbNameFromMongoUrl(selection.url)];
	return `custom-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

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
	return withMongoTransaction(session => appendTimelineEvent(things, validated, session));
}

export async function getTimelinePage(ownerId: string, request: TimelinePageRequest) {
	return readTimelinePage(await getThingsCollection(), ownerId, request);
}

export async function getTimelineEntry(ownerId: string, eventId: string) {
	return (await readTimelineEntries(await getThingsCollection(), ownerId, [eventId]))[0] ?? null;
}
