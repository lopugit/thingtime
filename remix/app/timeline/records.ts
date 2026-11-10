import { copyBoundedJson } from '../utils/boundedJson.ts';
import { TIMELINE_EVENT_MAX_BYTES, parseTimelineEvent, validateTimelineEventFields, type TimelineEvent } from './contract.ts';

/** Durable schemas, shared verbatim by IndexedDB and Mongo's private envelope.
 * Collections contain ONE event/link per record. Lists returned by split/join
 * are bounded transport batches, never stored on an event, Thing or branch. */
export type TimelineEventRecord = Omit<TimelineEvent, 'parentIds' | 'dependencies'> & { parentCount: number; dependencyCount: number };
export type TimelineLink = {
	formatVersion: 1; id: string; ownerId: string; eventId: string;
	relation: 'parent' | 'dependency' | 'thing' | 'branch' | 'operation';
	targetId: string; targetThingId: string | null; ordinal: number;
};
export const TIMELINE_MAX_LINKS = 2053;
const relations = ['parent', 'dependency', 'thing', 'branch', 'operation'] as const;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
export const timelineLinkId = (eventId: string, relation: TimelineLink['relation'], ordinal: number) => `${eventId}/links/${relation}/${ordinal}`;
const exactKeys = (value: Record<string, unknown>, expected: string[]) => {
	if (Object.keys(value).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('Invalid Timeline record fields');
};

export function parseTimelineEventRecord(input: unknown): TimelineEventRecord {
	const value = copyBoundedJson(input, { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 96, maxNodes: 200_000, sortKeys: true }, 'Timeline event record') as Record<string, any>;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Timeline event record');
	exactKeys(value, ['formatVersion', 'id', 'ownerId', 'thingId', 'branchId', 'parentCount', 'dependencyCount', 'operationId', 'actorId', 'source', 'clientId', 'occurredAt', 'mode', 'operation', 'label', 'before', 'after']);
	validateTimelineEventFields(value);
	if (!Number.isInteger(value.parentCount) || value.parentCount < 0 || value.parentCount > 2 || !Number.isInteger(value.dependencyCount) || value.dependencyCount < 0 || value.dependencyCount > 2048 || (value.operation === 'merge' && value.parentCount !== 2)) throw new Error('Invalid Timeline link counts');
	return value as TimelineEventRecord;
}

export function parseTimelineLink(input: unknown): TimelineLink {
	const value = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 12, sortKeys: true }, 'Timeline link') as Record<string, any>;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Timeline link');
	exactKeys(value, ['formatVersion', 'id', 'ownerId', 'eventId', 'relation', 'targetId', 'targetThingId', 'ordinal']);
	if (value.formatVersion !== 1 || !identifier(value.ownerId) || !identifier(value.eventId) || !identifier(value.targetId) || !relations.includes(value.relation) || !Number.isInteger(value.ordinal) || value.ordinal < 0 || value.ordinal >= 2048 || value.id !== timelineLinkId(value.eventId, value.relation, value.ordinal)) throw new Error('Invalid Timeline link');
	if (['parent', 'dependency'].includes(value.relation) ? !identifier(value.targetThingId) || value.eventId === value.targetId : value.targetThingId !== null || value.ordinal !== 0) throw new Error('Invalid Timeline link target');
	if (value.relation === 'parent' && value.ordinal > 1) throw new Error('Invalid Timeline parent link');
	return value as TimelineLink;
}

export function splitTimelineEvent(input: TimelineEvent): { event: TimelineEventRecord; links: TimelineLink[] } {
	const { parentIds, dependencies, ...content } = parseTimelineEvent(input);
	const links: TimelineLink[] = [];
	const add = (relation: TimelineLink['relation'], targetId: string, ordinal = 0, targetThingId: string | null = null) => links.push(parseTimelineLink({ formatVersion: 1, id: timelineLinkId(content.id, relation, ordinal), ownerId: content.ownerId, eventId: content.id, relation, targetId, targetThingId, ordinal }));
	add('thing', content.thingId); add('branch', content.branchId); add('operation', content.operationId);
	parentIds.forEach((targetId, ordinal) => add('parent', targetId, ordinal, content.thingId));
	dependencies.forEach((dependency, ordinal) => add('dependency', dependency.eventId, ordinal, dependency.thingId));
	return { event: parseTimelineEventRecord({ ...content, parentCount: parentIds.length, dependencyCount: dependencies.length }), links };
}

/** Completeness and identity are checked before exposing a joined view. A
 * missing link is corruption, never an empty ancestry or guessed dependency. */
export function joinTimelineEvent(input: TimelineEventRecord, inputs: TimelineLink[]): TimelineEvent {
	const { parentCount, dependencyCount, ...content } = parseTimelineEventRecord(input);
	if (inputs.length !== 3 + parentCount + dependencyCount) throw new Error('Timeline links are incomplete');
	const links = inputs.map(parseTimelineLink);
	const select = (relation: TimelineLink['relation']) => links.filter(link => link.relation === relation).sort((a, b) => a.ordinal - b.ordinal);
	const event = parseTimelineEvent({ ...content, parentIds: select('parent').map(link => link.targetId), dependencies: select('dependency').map(link => ({ thingId: link.targetThingId, eventId: link.targetId })) });
	const expected = new Map(splitTimelineEvent(event).links.map(link => [link.id, JSON.stringify(link)]));
	for (const link of links) {
		if (expected.get(link.id) !== JSON.stringify(link)) throw new Error('Timeline link identity does not match its event');
		expected.delete(link.id);
	}
	if (expected.size) throw new Error('Timeline links are incomplete');
	return event;
}
