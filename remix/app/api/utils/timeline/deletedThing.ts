import type { TimelineEntry } from '../../../timeline/contract.ts';
import { isProtectedThingtime } from '../../../schemas/registry.ts';
import { readTimelineBranchHead } from './branchEnvelope.ts';
import { readTimelineEntries, readTimelinePage } from './repository.ts';
import { isPublishedTimelineEvent } from './publishedHead.ts';
import { readTimelineSnapshot } from './snapshotParts.ts';
import { StorageMutationError } from '../storage/storageCore.ts';

const refuse = (message: string): never => {
	throw new StorageMutationError(409, 'storage_conflict', message);
};
/** Older histories are read in bounded pages only when they predate Published
 * pointers. A client draft or a branch push is never evidence of deletion. */
export async function readPublishedTimelineEntry(things: any, ownerId: string, thingId: string, session?: any): Promise<TimelineEntry | null> {
	const head = await readTimelineBranchHead(things, ownerId, 'main', thingId, session);
	if (head) {
		const entry = (await readTimelineEntries(things, ownerId, [head.eventId], session))[0];
		if (!entry || entry.event.thingId !== thingId || !isPublishedTimelineEvent(entry)) return refuse('Published history is incomplete.');
		return entry;
	}
	let before: number | null = null,
		bytes = 0;
	for (let scanned = 0; scanned < 2048; ) {
		const page = await readTimelinePage(things, ownerId, { thingId, before, after: null, limit: Math.min(40, 2048 - scanned) }, undefined, session);
		bytes += Buffer.byteLength(JSON.stringify(page));
		if (bytes > 16 * 1024 * 1024) return refuse('This older history needs a deeper recovery check. Its versions remain retained.');
		const entry = page.entries.find(isPublishedTimelineEvent);
		if (entry) return entry;
		if (page.nextBefore === null) return null;
		scanned += page.entries.length;
		before = page.nextBefore;
	}
	return refuse('This older history needs a deeper recovery check. Its versions remain retained.');
}

export async function readDeletedThingState(things: any, ownerId: string, thingId: string, session?: any) {
	if (await things.findOne({ shareId: thingId }, { ...(session ? { session } : {}), projection: { shareId: 1 } }))
		return refuse('This Thing is already present. Refresh History before restoring it.');
	const entry = await readPublishedTimelineEntry(things, ownerId, thingId, session);
	if (!entry || entry.event.operation !== 'delete' || entry.event.after !== null || !entry.event.before)
		return refuse('A recorded deletion is required to recover this Thing.');
	const snapshot = await readTimelineSnapshot(things, ownerId, entry.event.id, 'before', entry.event.before, session);
	const value = snapshot?.value as any;
	if (
		snapshot?.adapter !== 'thing-content' ||
		snapshot.version !== 1 ||
		!Array.isArray(value?.thingtime) ||
		!value.thingtime.length ||
		value.thingtime.some((kind: unknown) => typeof kind !== 'string') ||
		isProtectedThingtime(value.thingtime)
	)
		return refuse('This item needs recovery through its own editor.');
	if (value.targetId !== null) return refuse('Attached interactions need recovery through their parent Thing.');
	return { entry, snapshot, thingtime: value.thingtime as string[] };
}
