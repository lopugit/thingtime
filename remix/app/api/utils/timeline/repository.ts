import { createHash } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import {
	TIMELINE_EVENT_KIND, TIMELINE_LINK_KIND, TIMELINE_PAGE_SIZE, TIMELINE_EVENT_MAX_BYTES, parseTimelineEvent, timelineEventText,
	type TimelineEntry, type TimelineEvent
} from '../../../timeline/contract.ts';
import type { TimelinePage, TimelinePageRequest } from '../../../timeline/sync.ts';
import { packTimelineEntry, unpackTimelineEntry, packTimelineLink, unpackTimelineLink } from './envelope.ts';
import { splitTimelineEvent, timelineLinkId, TIMELINE_MAX_LINKS, type TimelineLink } from '../../../timeline/records.ts';
import { StorageMutationError, thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore.ts';
import { applyUserStorageDelta } from '../storage/userStorage';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { recordPublishedTimelineHead } from './publishedHead.ts';

const digest = (parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
// Leave room for the receipt/page wrapper while staying below the hosting
// response limit. Select tiny headers first: 40 large revisions must never be
// materialized just to discard 39 of them.
export const TIMELINE_PAGE_MAX_BYTES = TIMELINE_EVENT_MAX_BYTES + 4096;
export const timelineFolderId = (ownerId: string) => `timeline-folder-${digest([ownerId])}`;
export const timelineEventThingId = (ownerId: string, eventId: string) => `timeline-event-${digest([ownerId, eventId])}`;
export const timelineLinkThingId = (ownerId: string, linkId: string) => `timeline-link-${digest([ownerId, linkId])}`;
export const timelineLinkTargetKey = (link: TimelineLink) => `timeline-target-${digest([link.ownerId, link.relation, link.targetThingId ?? '', link.targetId])}`;

const entryFromDoc = (doc: any, links: TimelineLink[] = []): TimelineEntry => {
	const entry = unpackTimelineEntry(doc, links);
	if (doc.ownerId !== entry.event.ownerId || doc.targetId !== entry.event.thingId ||
		doc.shareId !== timelineEventThingId(entry.event.ownerId, entry.event.id) ||
		new Date(doc.createdAt).getTime() !== entry.receipt.position) throw new Error('Timeline record envelope does not match its payload');
	return entry;
};

/** One bounded, owner-scoped query per batch, using the shared targetId index.
 * Reverse relationships use crystal.targetId/linkKind's existing shared index.
 * No event, Thing, folder or branch accumulates an array of membership ids. */
export async function readTimelineLinks(things: any, ownerId: string, eventThingIds: string[], session?: any): Promise<Map<string, TimelineLink[]>> {
	if (eventThingIds.length > 128) throw new Error('Too many Timeline link sources requested.');
	const result = new Map<string, TimelineLink[]>();
	if (!eventThingIds.length) return result;
	const docs = await things.find({ ownerId, thingtime: TIMELINE_LINK_KIND, targetId: { $in: eventThingIds } }, { ...(session ? { session } : {}), projection: { shareId: 1, targetId: 1, thingtime: 1, timelineLinkVersion: 1, secure: 1, 'crystal.targetId': 1, 'crystal.linkKind': 1 } }).limit(eventThingIds.length * TIMELINE_MAX_LINKS + 1).toArray();
	if (docs.length > eventThingIds.length * TIMELINE_MAX_LINKS) throw new Error('Too many Timeline links.');
	for (const doc of docs) {
		const link = unpackTimelineLink(doc);
		if (link.ownerId !== ownerId || doc.shareId !== timelineLinkThingId(ownerId, link.id) || doc.targetId !== timelineEventThingId(ownerId, link.eventId) || doc.crystal?.targetId !== timelineLinkTargetKey(link) || doc.crystal?.linkKind !== link.relation) throw new Error('Timeline link envelope does not match its payload');
		const links = result.get(doc.targetId) ?? []; links.push(link); result.set(doc.targetId, links);
	}
	return result;
}

async function entriesFromDocs(things: any, ownerId: string, docs: any[], session?: any): Promise<TimelineEntry[]> {
	const links = await readTimelineLinks(things, ownerId, docs.filter(doc => doc.timelineEnvelopeVersion === 3).map(doc => doc.shareId), session);
	return docs.map(doc => entryFromDoc(doc, links.get(doc.shareId)));
}

export async function readTimelineEntries(things: any, ownerId: string, eventIds: string[], session?: any): Promise<TimelineEntry[]> {
	if (eventIds.length > 128) throw new Error('Too many Timeline versions requested.');
	if (!eventIds.length) return [];
	const docs = await things.find({ ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: [...new Set(eventIds)].map(id => timelineEventThingId(ownerId, id)) } }, session ? { session } : {}).toArray();
	return entriesFromDocs(things, ownerId, docs, session);
}

export type TimelineGraphNode = { id: string; thingId: string; parentIds: string[]; afterAdapter: string | null };
/** Traverse small graph headers, never thousands of full revision snapshots. */
export async function readTimelineNodes(things: any, ownerId: string, eventIds: string[]): Promise<TimelineGraphNode[]> {
	if (eventIds.length > 128) throw new Error('Too many Timeline versions requested.');
	if (!eventIds.length) return [];
	const docs = await things.find({ ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: [...new Set(eventIds)].map(id => timelineEventThingId(ownerId, id)) } }, { projection: { shareId: 1, targetId: 1, timelineNode: 1, timelineEnvelopeVersion: 1 } }).toArray();
	// Only parent links are needed for ancestry. Avoid loading all dependencies.
	const normalized = docs.filter((doc: any) => doc.timelineEnvelopeVersion === 3);
	const parentIds = normalized.flatMap((doc: any) => {
		if (!Number.isInteger(doc.timelineNode?.parentCount) || doc.timelineNode.parentCount < 0 || doc.timelineNode.parentCount > 2) throw new Error('Invalid Timeline parent count.');
		return Array.from({ length: doc.timelineNode.parentCount }, (_, ordinal) => timelineLinkThingId(ownerId, timelineLinkId(doc.timelineNode.id, 'parent', ordinal)));
	});
	const parentDocs = parentIds.length ? await things.find({ ownerId, thingtime: TIMELINE_LINK_KIND, shareId: { $in: parentIds } }).toArray() : [];
	if (parentDocs.length > normalized.length * 2) throw new Error('Invalid Timeline parent count.');
	const parents = new Map<string, TimelineLink[]>();
	for (const doc of parentDocs) {
		const link = unpackTimelineLink(doc);
		if (link.ownerId !== ownerId || link.relation !== 'parent' || doc.targetId !== timelineEventThingId(ownerId, link.eventId) || doc.shareId !== timelineLinkThingId(ownerId, link.id)) throw new Error('Invalid Timeline parent link.');
		const batch = parents.get(link.eventId) ?? []; batch.push(link); parents.set(link.eventId, batch);
	}
	const nodes: TimelineGraphNode[] = [];
	for (const doc of docs) {
		if (!doc.timelineNode) {
			// Upgrade compatibility: read one legacy payload at a time.
			const eventId = eventIds.find(id => timelineEventThingId(ownerId, id) === doc.shareId)!;
			const entry = (await readTimelineEntries(things, ownerId, [eventId]))[0];
			if (!entry) throw new Error('Timeline ancestor disappeared.');
			nodes.push({ id: entry.event.id, thingId: entry.event.thingId, parentIds: entry.event.parentIds, afterAdapter: entry.event.after?.adapter ?? null });
		} else {
			let node = doc.timelineNode;
			if (doc.timelineEnvelopeVersion === 3) {
				const links = (parents.get(node.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
				if (!Number.isInteger(node.parentCount) || links.length !== node.parentCount || links.some((link, ordinal) => link.ordinal !== ordinal || link.targetThingId !== node.thingId)) throw new Error('Timeline parent links are incomplete.');
				node = { id: node.id, thingId: node.thingId, afterAdapter: node.afterAdapter, parentIds: links.map(link => link.targetId) };
			}
			if (typeof node.id !== 'string' || !eventIds.includes(node.id) || doc.shareId !== timelineEventThingId(ownerId, node.id) || node.thingId !== doc.targetId || !Array.isArray(node.parentIds) || node.parentIds.length > 2 || node.parentIds.some((id: unknown) => typeof id !== 'string' || id.length > 200) || (node.afterAdapter !== null && typeof node.afterAdapter !== 'string')) throw new Error('Invalid Timeline graph header.');
			nodes.push(node);
		}
	}
	return nodes;
}

/** Collection and session MUST belong to the caller's chosen data plane.
 * This deliberately cannot start a separate transaction after a content write.
 * Event authorization/provenance is the caller's responsibility; shape checks
 * alone never turn uploaded client claims into server mutation evidence. */
export async function appendTimelineEvent(
	things: any,
	input: TimelineEvent,
	session: any,
	options: { plane?: 'active' | 'home'; debit?: typeof applyUserStorageDelta; now?: Date } = {}
): Promise<TimelineEntry> {
	if (!session) throw new Error('Timeline recording requires the content transaction');
	const event = parseTimelineEvent(input);
	const shareId = timelineEventThingId(event.ownerId, event.id);
	const existing = await things.findOne({ shareId }, { session });
	if (existing) {
		const entry = (await entriesFromDocs(things, event.ownerId, [existing], session))[0];
		if (timelineEventText(entry.event) !== timelineEventText(event)) throw new StorageMutationError(409, 'storage_conflict', 'Timeline event identity was reused with different content');
		return entry;
	}
	// Missing parents are not an empty history. Clients push ancestors first;
	// server operations retain a before snapshot for pre-Timeline Things.
	if (event.parentIds.length) {
		const parents = await things.find({ ownerId: event.ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: event.parentIds.map(id => timelineEventThingId(event.ownerId, id)) } }, { session, projection: { targetId: 1 } }).toArray();
		if (parents.length !== event.parentIds.length || parents.some((parent: any) => parent.targetId !== event.thingId))
			throw new StorageMutationError(409, 'storage_conflict', 'Load or upload the earlier changes before syncing this event');
	}
	for (let offset = 0; offset < event.dependencies.length; offset += 128) {
		const refs = event.dependencies.slice(offset, offset + 128);
		const targets = await things.find({ ownerId: event.ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: refs.map(ref => timelineEventThingId(event.ownerId, ref.eventId)) } }, { session, projection: { shareId: 1, targetId: 1 } }).toArray();
		if (refs.some(ref => !targets.some((target: any) => target.shareId === timelineEventThingId(event.ownerId, ref.eventId) && target.targetId === ref.thingId))) throw new StorageMutationError(409, 'storage_conflict', 'A referenced dependency version is unavailable');
	}
	const folderId = timelineFolderId(event.ownerId);
	const now = options.now ?? new Date();
	await things.updateOne({ shareId: folderId }, { $setOnInsert: {
		shareId: folderId, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['folder'], ownerId: event.ownerId,
		acl: ['tt:user'], targetId: null, folderId: null, crystal: { name: 'Timeline', icon: '🕰️' }, extended: null, tags: [],
		storageClass: 'control', timelinePosition: 0, createdAt: now, updatedAt: now
	} }, { session, upsert: true });
	const folder = await things.findOne({ shareId: folderId }, { session });
	if (!folder || folder.ownerId !== event.ownerId || folder.thingtime?.length !== 1 || folder.thingtime[0] !== 'folder' ||
		!Number.isSafeInteger(folder.timelinePosition) || folder.timelinePosition < 0) throw new Error('Invalid Timeline folder');
	// A monotonic logical millisecond supplies a range cursor using the EXISTING
	// targetId/thingtime/createdAt index. Writing this common folder serializes
	// account commits: a late transaction cannot land behind a published cursor.
	const position = Math.max(now.getTime(), folder.timelinePosition + 1);
	if (!Number.isSafeInteger(position) || position < 1 || !Number.isFinite(new Date(position).getTime())) throw new Error('Invalid Timeline position');
	const advanced = await things.updateOne({ _id: folder._id, timelinePosition: folder.timelinePosition }, { $set: { timelinePosition: position } }, { session });
	if (advanced.matchedCount !== 1) throw new StorageMutationError(409, 'storage_conflict', 'Timeline changed during this operation — retry with the same operation id');
	const entry: TimelineEntry = { event, receipt: { formatVersion: 1, eventId: event.id, ownerId: event.ownerId, position, acceptedAt: now.toISOString() } };
	const linkRecords = splitTimelineEvent(event).links;
	const doc: any = {
		shareId, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [TIMELINE_EVENT_KIND], ownerId: event.ownerId,
		acl: ['tt:user'], targetId: event.thingId, folderId, crystal: { name: 'Change' }, extended: null, tags: [],
		createdAt: new Date(position), updatedAt: new Date(position), ...packTimelineEntry(entry)
	};
	doc.timelineEntryBytes = Buffer.byteLength(JSON.stringify(entry));
	doc.timelineLinkBytes = linkRecords.reduce((bytes, link) => bytes + Buffer.byteLength(JSON.stringify(link)), 0);
	doc.timelineNode = { id: event.id, thingId: event.thingId, parentCount: event.parentIds.length, afterAdapter: event.after?.adapter ?? null };
	if (options.plane === 'home' || !isCustomMongoEndpointActive()) {
		doc.storageClass = 'content';
		doc.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION;
		doc.sizeBytes = thingStorageSizeBytes(doc);
		await (options.debit ?? applyUserStorageDelta)(event.ownerId, doc.sizeBytes, session);
	}
	await things.insertOne(doc, { session });
	const links = linkRecords.map(link => ({
		shareId: timelineLinkThingId(event.ownerId, link.id), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: [TIMELINE_LINK_KIND], ownerId: event.ownerId, acl: ['tt:user'], folderId,
		targetId: shareId, crystal: { name: 'History link', targetId: timelineLinkTargetKey(link), linkKind: link.relation },
		extended: null, tags: [], storageClass: 'control', createdAt: new Date(position), updatedAt: new Date(position), ...packTimelineLink(link)
	}));
	await things.insertMany(links, { session });
	await recordPublishedTimelineHead(things, entry, folderId, session);
	return entry;
}

export async function readTimelinePage(things: any, ownerId: string, request: TimelinePageRequest, relatedIds?: string[], session?: any): Promise<TimelinePage> {
	if (relatedIds && (!request.thingId || !relatedIds.includes(request.thingId) || relatedIds.length > 128 || new Set(relatedIds).size !== relatedIds.length || relatedIds.some(id => !id || id.length > 200))) throw new Error('Invalid related Timeline targets');
	if (!ownerId || (request.thingId !== null && !request.thingId) || (request.before !== null && request.after !== null) || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > TIMELINE_PAGE_SIZE) throw new Error('Invalid Timeline page request');
	for (const cursor of [request.before, request.after]) if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1 || !Number.isFinite(new Date(cursor).getTime()))) throw new Error('Invalid Timeline cursor');
	const ascending = request.after !== null;
	const headers = await things.find({
		ownerId, ...(relatedIds ? { targetId: { $in: relatedIds } } : request.thingId === null ? {} : { targetId: request.thingId }), thingtime: TIMELINE_EVENT_KIND,
		...(request.before !== null ? { createdAt: { $lt: new Date(request.before) } } : {}),
		...(request.after !== null ? { createdAt: { $gt: new Date(request.after) } } : {})
	// Positions are unique within an account; no tie-break is needed. Sorting
	// only by createdAt fits both existing global and per-Thing index directions.
	}, { ...(session ? { session } : {}), projection: { _id: 0, shareId: 1, createdAt: 1, timelineEntryBytes: 1, timelineLinkBytes: 1 } }).sort({ createdAt: ascending ? 1 : -1 }).limit(request.limit + 1).toArray();
	const ids: string[] = [];
	let bytes = 128; let readBytes = 128;
	for (const header of headers.slice(0, request.limit)) {
		// Earlier records without a size header are conservatively fetched alone.
		const size = Number.isSafeInteger(header.timelineEntryBytes) && header.timelineEntryBytes > 0 ? header.timelineEntryBytes : TIMELINE_EVENT_MAX_BYTES + 1024;
		if (bytes + size + 1 > TIMELINE_PAGE_MAX_BYTES) break;
		const linkBytes = Number.isSafeInteger(header.timelineLinkBytes) && header.timelineLinkBytes >= 0 ? header.timelineLinkBytes : 0;
		// Link records are larger than the compact wire references. Bound the
		// relational join too; one individually valid event may be fetched alone.
		if (ids.length && readBytes + size + linkBytes > TIMELINE_PAGE_MAX_BYTES) break;
		ids.push(header.shareId); bytes += size + 1; readBytes += size + linkBytes;
	}
	if (headers.length && !ids.length) throw new Error('Invalid Timeline record size');
	const docs = ids.length ? await things.find({ ownerId, thingtime: TIMELINE_EVENT_KIND, shareId: { $in: ids } }, session ? { session } : {}).toArray() : [];
	const byId = new Map<string, any>(docs.map((doc: any) => [doc.shareId, doc]));
	const ordered = ids.map(id => {
		const doc = byId.get(id);
		if (!doc) throw new Error('Timeline changed while loading this page. Refresh and try again.');
		return doc;
	});
	const entries = await entriesFromDocs(things, ownerId, ordered, session);
	if (Buffer.byteLength(JSON.stringify(entries)) > TIMELINE_PAGE_MAX_BYTES - 128) throw new Error('Timeline page exceeds its recorded size');
	const next = headers.length > ids.length ? entries[entries.length - 1].receipt.position : null;
	return { entries, nextBefore: ascending ? null : next, nextAfter: ascending ? next : null };
}
