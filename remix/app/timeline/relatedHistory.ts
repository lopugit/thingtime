import { copyBoundedJson } from '../utils/boundedJson.ts';

export const TIMELINE_RELATED_MAX_THINGS = 128;
/** A bounded query projection, never an accumulating history document. */
export type RelatedTimelineScope = { rootId: string; thingIds: string[]; revision: string; sharedCount: number };
export const timelineRelatedId = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
export const timelineRelatedRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function parseRelatedTimelineScope(input: unknown, rootId: string): RelatedTimelineScope {
	const value = copyBoundedJson(input, { maxBytes: 32 * 1024, maxDepth: 3, maxNodes: 300 }, 'Related history scope') as any;
	if (
		!value ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(',') !== 'revision,rootId,sharedCount,thingIds' ||
		value.rootId !== rootId ||
		!timelineRelatedId(rootId) ||
		!timelineRelatedRevision(value.revision) ||
		!Array.isArray(value.thingIds) ||
		!value.thingIds.length ||
		value.thingIds.length > TIMELINE_RELATED_MAX_THINGS ||
		value.thingIds.some((id: unknown) => !timelineRelatedId(id)) ||
		!value.thingIds.includes(rootId) ||
		new Set(value.thingIds).size !== value.thingIds.length ||
		!Number.isSafeInteger(value.sharedCount) ||
		value.sharedCount < 0 ||
		value.sharedCount + value.thingIds.length > TIMELINE_RELATED_MAX_THINGS
	)
		throw new Error('Invalid related history scope');
	return value;
}
