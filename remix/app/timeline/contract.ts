import { copyBoundedJson, type JsonValue } from '../utils/boundedJson.ts';

/** Bounded sync/view aggregates. records.ts normalizes these into identical
 * event and link records on BOTH sides of sync. No Mongo or queue fields here. */
export const TIMELINE_FORMAT_VERSION = 1;
export const TIMELINE_EVENT_KIND = 'timeline-event';
export const TIMELINE_LINK_KIND = 'timeline-link';
export const TIMELINE_RESERVED_PREFIX = 'timeline-';
export const TIMELINE_EVENT_MAX_BYTES = 4 * 1024 * 1024;
export const TIMELINE_PAGE_SIZE = 40;
export const TIMELINE_SOURCES = ['client', 'api', 'action', 'ai', 'system'] as const;
export const TIMELINE_OPERATIONS = ['create', 'update', 'delete', 'restore', 'merge', 'effect'] as const;
export type TimelineSnapshot = { adapter: string; version: number; value: JsonValue };
export type TimelineDependency = { thingId: string; eventId: string };
export type TimelineEvent = {
	formatVersion: 1;
	id: string;
	ownerId: string;
	thingId: string;
	branchId: string;
	parentIds: string[];
	operationId: string;
	actorId: string;
	source: typeof TIMELINE_SOURCES[number];
	clientId: string | null;
	occurredAt: string;
	mode: 'draft' | 'revision' | 'effect';
	operation: typeof TIMELINE_OPERATIONS[number];
	label: string;
	before: TimelineSnapshot | null;
	after: TimelineSnapshot | null;
	dependencies: TimelineDependency[];
};

/** Server-issued order; client timestamps are descriptive, never conflict rules.
 * The server serializes acceptance per account/data-plane, so a pull cursor
 * cannot skip an earlier transaction which happened to commit late. */
export type TimelineReceipt = { formatVersion: 1; eventId: string; ownerId: string; position: number; acceptedAt: string };
export type TimelineEntry = { event: TimelineEvent; receipt: TimelineReceipt };
export type TimelineScope = { ownerId: string; apiOrigin: string; dataPlane: string };

const budget = { maxBytes: TIMELINE_EVENT_MAX_BYTES, maxDepth: 96, maxNodes: 200_000, sortKeys: true };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => {
	if (Object.keys(value).length !== expected.length || expected.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error('Invalid Timeline fields');
};
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const snapshot = (value: unknown) => {
	if (value === null) return;
	if (!object(value)) throw new Error('Invalid Timeline snapshot');
	keys(value, ['adapter', 'version', 'value']);
	if (!id(value.adapter) || !Number.isSafeInteger(value.version) || value.version < 1) throw new Error('Invalid Timeline snapshot adapter');
};

/** A strict detached canonical copy; unknown fields and lossy JSON are refused. */
export function parseTimelineEvent(input: unknown): TimelineEvent {
	const value: unknown = copyBoundedJson(input, budget, 'Timeline event');
	if (!object(value)) throw new Error('Invalid Timeline event');
	keys(value, ['formatVersion', 'id', 'ownerId', 'thingId', 'branchId', 'parentIds', 'operationId', 'actorId', 'source', 'clientId', 'occurredAt', 'mode', 'operation', 'label', 'before', 'after', 'dependencies']);
	validateTimelineEventFields(value);
	if (!Array.isArray(value.parentIds) || value.parentIds.length > 2 || value.parentIds.some(parent => !id(parent) || parent === value.id) || new Set(value.parentIds).size !== value.parentIds.length) throw new Error('Invalid Timeline parents');
	if (value.operation === 'merge' && value.parentIds.length !== 2) throw new Error('A Timeline merge needs two parents');
	if (!Array.isArray(value.dependencies) || value.dependencies.length > 2048) throw new Error('Invalid Timeline dependencies');
	const dependencies = new Set<string>();
	for (const dependency of value.dependencies) {
		if (!object(dependency)) throw new Error('Invalid Timeline dependency');
		keys(dependency, ['thingId', 'eventId']);
		if (!id(dependency.thingId) || !id(dependency.eventId) || dependencies.has(dependency.thingId)) throw new Error('Invalid Timeline dependency');
		dependencies.add(dependency.thingId);
	}
	return value as TimelineEvent;
}

/** Shared scalar/snapshot validation for the normalized record and aggregate.
 * Callers must first make a bounded inert copy and validate their exact keys. */
export function validateTimelineEventFields(value: Record<string, any>): void {
	if (value.formatVersion !== TIMELINE_FORMAT_VERSION) throw new Error('Unsupported Timeline format');
	for (const key of ['id', 'ownerId', 'thingId', 'branchId', 'operationId', 'actorId']) if (!id(value[key])) throw new Error(`Invalid Timeline ${key}`);
	if (value.clientId !== null && !id(value.clientId)) throw new Error('Invalid Timeline clientId');
	if (!TIMELINE_SOURCES.includes(value.source) || !TIMELINE_OPERATIONS.includes(value.operation) || !['draft', 'revision', 'effect'].includes(value.mode)) throw new Error('Invalid Timeline operation');
	if (!timestamp(value.occurredAt)) throw new Error('Invalid Timeline timestamp');
	if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 240) throw new Error('Invalid Timeline label');
	snapshot(value.before);
	snapshot(value.after);
	if (value.mode === 'effect' ? value.operation !== 'effect' : value.operation === 'effect') throw new Error('Invalid Timeline effect mode');
	if (value.operation === 'create' && (value.before !== null || value.after === null)) throw new Error('Invalid Timeline creation');
	if (value.operation === 'delete' && (value.before === null || value.after !== null)) throw new Error('Invalid Timeline deletion');
	if (['update', 'restore', 'merge'].includes(value.operation) && (value.before === null || value.after === null)) throw new Error('Invalid Timeline change');
}

export function parseTimelineReceipt(input: unknown): TimelineReceipt {
	const value: unknown = copyBoundedJson(input, { maxBytes: 2048, maxDepth: 2, maxNodes: 10, sortKeys: true }, 'Timeline receipt');
	if (!object(value)) throw new Error('Invalid Timeline receipt');
	keys(value, ['formatVersion', 'eventId', 'ownerId', 'position', 'acceptedAt']);
	if (value.formatVersion !== 1 || !id(value.eventId) || !id(value.ownerId) || !Number.isSafeInteger(value.position) || value.position < 1 || !timestamp(value.acceptedAt)) throw new Error('Invalid Timeline receipt');
	return value as TimelineReceipt;
}

export function parseTimelineEntry(input: unknown): TimelineEntry {
	const value: unknown = copyBoundedJson(input, { ...budget, maxBytes: TIMELINE_EVENT_MAX_BYTES + 2048 }, 'Timeline entry');
	if (!object(value)) throw new Error('Invalid Timeline entry');
	keys(value, ['event', 'receipt']);
	const event = parseTimelineEvent(value.event);
	const receipt = parseTimelineReceipt(value.receipt);
	if (receipt.eventId !== event.id || receipt.ownerId !== event.ownerId) throw new Error('Timeline receipt does not match its event');
	return { event, receipt };
}

export const timelineEventText = (event: TimelineEvent): string => JSON.stringify(parseTimelineEvent(event));

export function timelineScopeKey(scope: TimelineScope): string {
	if (!id(scope.ownerId) || !id(scope.dataPlane)) throw new Error('Invalid Timeline scope');
	const url = new URL(scope.apiOrigin);
	if (!['https:', 'http:'].includes(url.protocol) || url.origin !== scope.apiOrigin) throw new Error('Invalid Timeline origin');
	return JSON.stringify([scope.apiOrigin, scope.dataPlane, scope.ownerId]);
}
