import { TIMELINE_SNAPSHOT_PARTS_ADAPTER, parseTimelineSnapshotReference } from '../../../timeline/snapshotParts.ts';
import { TIMELINE_EVENT_KIND, TIMELINE_LINK_KIND, TIMELINE_EVENT_MAX_BYTES, parseTimelineEntry, parseTimelineReceipt, type TimelineEntry } from '../../../timeline/contract.ts';
import { joinTimelineEvent, parseTimelineEventRecord, parseTimelineLink, splitTimelineEvent, type TimelineLink } from '../../../timeline/records.ts';
import { binaryBytes, fromBin, toBin } from '../auth/binary.ts';

export const TIMELINE_ENVELOPE_VERSION = 3;
export const packTimelineEntry = (input: TimelineEntry) => {
	const entry = parseTimelineEntry(input);
	return { timelineEnvelopeVersion: TIMELINE_ENVELOPE_VERSION, secure: toBin(JSON.stringify({ event: splitTimelineEvent(entry.event).event, receipt: entry.receipt })) };
};

export const packTimelineLink = (input: TimelineLink) => ({ timelineLinkVersion: 1, secure: toBin(JSON.stringify(parseTimelineLink(input))) });
export function unpackTimelineLink(doc: { thingtime?: unknown; timelineLinkVersion?: unknown; secure?: unknown }): TimelineLink {
	if (!Array.isArray(doc.thingtime) || !doc.thingtime.includes(TIMELINE_LINK_KIND) || doc.timelineLinkVersion !== 1 || !binaryBytes(doc.secure) || binaryBytes(doc.secure)! > 2048) throw new Error('Invalid Timeline link envelope');
	return parseTimelineLink(JSON.parse(fromBin(doc.secure)));
}

type Envelope = { thingtime?: unknown; timelineEnvelopeVersion?: unknown; secure?: unknown };
const validEnvelope = (doc: Envelope): boolean => {
	const bytes = binaryBytes(doc.secure);
	return [1, 2, TIMELINE_ENVELOPE_VERSION].includes(doc.timelineEnvelopeVersion as number) && bytes !== null && bytes > 0 && bytes <= TIMELINE_EVENT_MAX_BYTES + 2048;
};

function readEnvelope(doc: Envelope) {
	if (!Array.isArray(doc.thingtime) || !doc.thingtime.includes(TIMELINE_EVENT_KIND) || !validEnvelope(doc)) throw new Error('Invalid Timeline storage envelope');
	const value = JSON.parse(fromBin(doc.secure));
	if (doc.timelineEnvelopeVersion !== 3) return parseTimelineEntry(value);
	if (!value || typeof value !== 'object' || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, 'event') || !Object.prototype.hasOwnProperty.call(value, 'receipt')) throw new Error('Invalid Timeline storage entry');
	const event = parseTimelineEventRecord(value.event); const receipt = parseTimelineReceipt(value.receipt);
	if (receipt.eventId !== event.id || receipt.ownerId !== event.ownerId) throw new Error('Timeline receipt does not match its event');
	return { event, receipt };
}

/** Ordinary Things add zero; a malformed history envelope fails closed.
 * V2 meters retained customer content, using the same crystal/extended/tags
 * projection as a live Thing. Event ids, receipts and managed labels are
 * platform overhead. A deletion moves those logical bytes into history, so
 * retaining its before-image cannot prevent deletion at a full quota.
 * V1's existing byte definition remains unchanged for old stamped records. */
export function timelinePayloadBytes(doc: Envelope): number | null {
	if (!Array.isArray(doc.thingtime) || !doc.thingtime.includes(TIMELINE_EVENT_KIND)) return 0;
	if (!validEnvelope(doc)) return null;
	if (doc.timelineEnvelopeVersion === 1) return binaryBytes(doc.secure);
	try {
		const { event } = readEnvelope(doc);
		if (event.mode !== 'revision' || event.source === 'client') return Buffer.byteLength(JSON.stringify({ before: event.before, after: event.after }));
		let total = 0;
		for (const snapshot of [event.before, event.after]) {
			if (!snapshot) continue;
			if (snapshot.adapter === TIMELINE_SNAPSHOT_PARTS_ADAPTER && snapshot.version === 1) { total += parseTimelineSnapshotReference(snapshot.value).retainedBytes; continue; }
			const value = snapshot.value as any;
			const keys = ['thingtime', 'crystal', 'extended', 'tags', 'acl', 'folderId', 'targetId', 'geo'];
			if (snapshot.adapter !== 'thing-content' || snapshot.version !== 1 || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
				// Other adapters pay for their entire payload. Arbitrary keys can
				// never hide unmetered data behind the ordinary-content projection.
				total += Buffer.byteLength(JSON.stringify(snapshot)); continue;
			}
			total += Buffer.byteLength(JSON.stringify({ crystal: value.crystal ?? null, extended: value.extended ?? null, tags: value.tags ?? [] }));
		}
		return total;
	} catch { return null; }
}

export function unpackTimelineEntry(doc: Envelope, links: TimelineLink[] = []): TimelineEntry {
	const entry = readEnvelope(doc);
	return doc.timelineEnvelopeVersion === 3 ? { event: joinTimelineEvent(entry.event as ReturnType<typeof parseTimelineEventRecord>, links), receipt: entry.receipt } : entry as TimelineEntry;
}
