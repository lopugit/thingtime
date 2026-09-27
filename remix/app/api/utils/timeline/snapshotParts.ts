import { createHash } from 'node:crypto';
import { copyBoundedJson } from '../../../utils/boundedJson.ts';
import { TIMELINE_EVENT_MAX_BYTES, type TimelineSnapshot } from '../../../timeline/contract.ts';
import { TIMELINE_SNAPSHOT_PART_KIND, TIMELINE_SNAPSHOT_PARTS_ADAPTER, TIMELINE_SNAPSHOT_PART_CHARS, TIMELINE_SNAPSHOT_MAX_BYTES, parseTimelineSnapshotPart, parseTimelineSnapshotReference, timelineSnapshotPartId, type TimelineSnapshotPart, type TimelineSnapshotSide } from '../../../timeline/snapshotParts.ts';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { binaryBytes, fromBin, toBin } from '../auth/binary.ts';
import { timelineEventThingId, timelineFolderId } from './repository.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const timelineSnapshotPartThingId = (ownerId: string, id: string) => `timeline-snapshot-part-${digest(JSON.stringify([ownerId, id]))}`;

/** Mongo accepts Things larger than the bounded history transport. Retain their
 * exact content in separate parts instead of making those Things uneditable. */
export function splitLargeThingSnapshot(snapshot: TimelineSnapshot | null, ownerId: string, eventId: string, side: TimelineSnapshotSide) {
 if (!snapshot) return { snapshot, parts: [] as TimelineSnapshotPart[] };
 const text = JSON.stringify(snapshot); const bytes = Buffer.byteLength(text);
 if (bytes <= TIMELINE_EVENT_MAX_BYTES / 2 - 4096) return { snapshot, parts: [] as TimelineSnapshotPart[] };
 if (snapshot.adapter !== 'thing-content' || snapshot.version !== 1 || bytes > TIMELINE_SNAPSHOT_MAX_BYTES) throw new Error('Unsupported large Timeline snapshot');
 const value = snapshot.value as any;
 const retainedBytes = Buffer.byteLength(JSON.stringify({ crystal: value.crystal ?? null, extended: value.extended ?? null, tags: value.tags ?? [] }));
 const reference = parseTimelineSnapshotReference({ eventId, side, partCount: Math.ceil(text.length / TIMELINE_SNAPSHOT_PART_CHARS), characters: text.length, bytes, retainedBytes, sha256: digest(text) });
 const parts = Array.from({ length: reference.partCount }, (_, ordinal) => parseTimelineSnapshotPart({ formatVersion: 1, id: timelineSnapshotPartId(eventId, side, ordinal), ownerId, eventId, side, ordinal, data: text.slice(ordinal * TIMELINE_SNAPSHOT_PART_CHARS, (ordinal + 1) * TIMELINE_SNAPSHOT_PART_CHARS) }));
 return { snapshot: { adapter: TIMELINE_SNAPSHOT_PARTS_ADAPTER, version: 1, value: reference } as TimelineSnapshot, parts };
}

function unpackPart(doc: any): TimelineSnapshotPart {
 const bytes = binaryBytes(doc?.secure);
 if (!doc?.thingtime?.includes(TIMELINE_SNAPSHOT_PART_KIND) || doc.timelineSnapshotPartVersion !== 1 || !bytes || bytes > 512 * 1024) throw new Error('Invalid Timeline snapshot part envelope');
 const part = parseTimelineSnapshotPart(JSON.parse(fromBin(doc.secure)));
 if (doc.ownerId !== part.ownerId || doc.shareId !== timelineSnapshotPartThingId(part.ownerId, part.id) || doc.parentId !== timelineEventThingId(part.ownerId, part.eventId) || doc.targetId !== doc.parentId) throw new Error('Timeline snapshot part envelope does not match its record');
 return part;
}

export async function storeTimelineSnapshotParts(things: any, parts: TimelineSnapshotPart[], session: any, now: Date) {
 if (!session) throw new Error('Timeline snapshot parts require the content transaction');
 if (parts.length > 4096 || parts.some(part => part.ownerId !== parts[0].ownerId || part.eventId !== parts[0].eventId)) throw new Error('Snapshot parts must belong to one bounded event');
 for (let offset = 0; offset < parts.length; offset += 64) {
  const batch = parts.slice(offset, offset + 64).map(parseTimelineSnapshotPart);
  const prior = await things.find({ ownerId: batch[0].ownerId, thingtime: TIMELINE_SNAPSHOT_PART_KIND, shareId: { $in: batch.map(part => timelineSnapshotPartThingId(part.ownerId, part.id)) } }, { session }).toArray();
  const existing = new Map(prior.map((doc: any) => { const part = unpackPart(doc); return [part.id, JSON.stringify(part)]; }));
  const insert = batch.filter(part => {
   if (!existing.has(part.id)) return true;
   if (existing.get(part.id) !== JSON.stringify(part)) throw new Error('Timeline snapshot part identity changed');
   return false;
  }).map(part => ({ schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, shareId: timelineSnapshotPartThingId(part.ownerId, part.id), ownerId: part.ownerId,
   thingtime: [TIMELINE_SNAPSHOT_PART_KIND], acl: ['tt:user'], folderId: timelineFolderId(part.ownerId), parentId: timelineEventThingId(part.ownerId, part.eventId), targetId: timelineEventThingId(part.ownerId, part.eventId), crystal: {}, extended: null, tags: [],
   // The parent event meters these retained bytes exactly once.
   storageClass: 'control', timelineSnapshotPartVersion: 1, secure: toBin(JSON.stringify(part)), createdAt: now, updatedAt: now }));
  if (insert.length) await things.insertMany(insert, { session });
 }
}

export async function readTimelineSnapshot(things: any, ownerId: string, eventId: string, side: TimelineSnapshotSide, snapshot: TimelineSnapshot | null): Promise<TimelineSnapshot | null> {
 if (snapshot?.adapter !== TIMELINE_SNAPSHOT_PARTS_ADAPTER) return snapshot;
 const reference = parseTimelineSnapshotReference(snapshot.value);
 if (snapshot.version !== 1 || reference.eventId !== eventId || reference.side !== side) throw new Error('Timeline snapshot reference does not match its event');
 const pieces: string[] = [];
 for (let offset = 0; offset < reference.partCount; offset += 64) {
  const ids = Array.from({ length: Math.min(64, reference.partCount - offset) }, (_, index) => timelineSnapshotPartId(eventId, side, offset + index));
  const docs = await things.find({ ownerId, thingtime: TIMELINE_SNAPSHOT_PART_KIND, shareId: { $in: ids.map(id => timelineSnapshotPartThingId(ownerId, id)) } }).toArray();
  if (docs.length !== ids.length) throw new Error('Timeline snapshot parts are unavailable');
  const parts = new Map(docs.map((doc: any) => { const part = unpackPart(doc); return [part.id, part]; }));
  for (const id of ids) {
   const part = parts.get(id) as TimelineSnapshotPart | undefined;
   if (!part || part.ownerId !== ownerId || part.eventId !== eventId || part.side !== side || (part.ordinal < reference.partCount - 1 && part.data.length !== TIMELINE_SNAPSHOT_PART_CHARS)) throw new Error('Timeline snapshot parts are incomplete');
   pieces.push(part.data);
  }
 }
 const text = pieces.join('');
 if (text.length !== reference.characters || Buffer.byteLength(text) !== reference.bytes || digest(text) !== reference.sha256) throw new Error('Timeline snapshot content does not match its receipt');
 const value = copyBoundedJson(JSON.parse(text), { maxBytes: TIMELINE_SNAPSHOT_MAX_BYTES, maxDepth: 94, maxNodes: 100_000, sortKeys: true }, 'Timeline snapshot') as any;
 if (value?.adapter !== 'thing-content' || value.version !== 1 || Object.keys(value).length !== 3) throw new Error('Invalid retained Thing snapshot');
 return value;
}
