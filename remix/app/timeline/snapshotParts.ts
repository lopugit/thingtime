import { copyBoundedJson } from '../utils/boundedJson.ts';

export const TIMELINE_SNAPSHOT_PART_KIND = 'timeline-snapshot-part';
export const TIMELINE_SNAPSHOT_PARTS_ADAPTER = 'thing-content-parts';
export const TIMELINE_SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;
export const TIMELINE_SNAPSHOT_PART_CHARS = 64 * 1024;
export const TIMELINE_SNAPSHOT_MAX_PARTS = 2048;
export type TimelineSnapshotSide = 'before' | 'after';
/** One bounded payload fragment, never an array appended to its event. This
 * canonical record is independent of the remote Thing/local cache envelope. */
export type TimelineSnapshotPart = { formatVersion: 1; id: string; ownerId: string; eventId: string; side: TimelineSnapshotSide; ordinal: number; data: string };
export type TimelineSnapshotReference = { eventId: string; side: TimelineSnapshotSide; partCount: number; characters: number; bytes: number; retainedBytes: number; sha256: string };
export const timelineSnapshotPartId = (eventId: string, side: TimelineSnapshotSide, ordinal: number) => `${eventId}/snapshots/${side}/${ordinal}`;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const exact = (value: any, keys: string[]) => {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('Invalid Timeline snapshot fields');
};
export function parseTimelineSnapshotReference(input: unknown): TimelineSnapshotReference {
 const value = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 10, sortKeys: true }, 'Timeline snapshot reference') as any;
 exact(value, ['eventId', 'side', 'partCount', 'characters', 'bytes', 'retainedBytes', 'sha256']);
 if (!identifier(value.eventId) || !['before', 'after'].includes(value.side) || !Number.isSafeInteger(value.characters) || value.characters < 1 || value.characters > TIMELINE_SNAPSHOT_MAX_BYTES || !Number.isSafeInteger(value.partCount) || value.partCount !== Math.ceil(value.characters / TIMELINE_SNAPSHOT_PART_CHARS) || value.partCount > TIMELINE_SNAPSHOT_MAX_PARTS || !Number.isSafeInteger(value.bytes) || value.bytes < value.characters || value.bytes > TIMELINE_SNAPSHOT_MAX_BYTES || !Number.isSafeInteger(value.retainedBytes) || value.retainedBytes < 0 || value.retainedBytes > value.bytes || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid Timeline snapshot reference');
 return value;
}
export function parseTimelineSnapshotPart(input: unknown): TimelineSnapshotPart {
 const value = copyBoundedJson(input, { maxBytes: 512 * 1024, maxDepth: 2, maxNodes: 10, sortKeys: true }, 'Timeline snapshot part') as any;
 exact(value, ['formatVersion', 'id', 'ownerId', 'eventId', 'side', 'ordinal', 'data']);
 if (value.formatVersion !== 1 || !identifier(value.ownerId) || !identifier(value.eventId) || !['before', 'after'].includes(value.side) || !Number.isSafeInteger(value.ordinal) || value.ordinal < 0 || value.ordinal >= TIMELINE_SNAPSHOT_MAX_PARTS || value.id !== timelineSnapshotPartId(value.eventId, value.side, value.ordinal) || typeof value.data !== 'string' || !value.data.length || value.data.length > TIMELINE_SNAPSHOT_PART_CHARS) throw new Error('Invalid Timeline snapshot part');
 return value;
}
