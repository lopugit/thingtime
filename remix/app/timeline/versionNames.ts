import { copyBoundedJson } from '../utils/boundedJson.ts';
import { parseTimelineEntry, type TimelineEntry } from './contract.ts';

/** A pinned display name for one saved version.
 *
 * A name is its own relational record (one protected Thing per named event on
 * the server, a per-connection cache locally), linked to its event by
 * `eventId`. Events stay immutable and exact-keyed; names never extend the
 * event record, never accumulate on the event, the Thing or the Timeline folder,
 * and never invent version numbers. Every name, rename and clear appends an
 * immutable `timeline-version-name` effect event beside the named version. */
export const TIMELINE_VERSION_NAME_KIND = 'timeline-version-name';
export const TIMELINE_VERSION_NAME_MAX_CHARS = 80;
export const TIMELINE_VERSION_NAME_LABELS = { named: 'Named version', renamed: 'Renamed version', cleared: 'Removed version name' } as const;
export type TimelineVersionName = {
	formatVersion: 1; id: string; ownerId: string; eventId: string; thingId: string;
	name: string; revision: number; createdAt: string; updatedAt: string;
};
/** `operationId` is the retry identity: the effect event is `version-name-<operationId>`,
 * so a lost reply retried with the same request returns the original receipt. `null` clears. */
export type TimelineVersionNameCommand = { command: 'name-version'; operationId: string; eventId: string; thingId: string; name: string | null; expectedRevision: number };
/** `entry` is null only when nothing was written (a no-op name or clear). */
export type TimelineVersionNameResult = { ok: true; name: TimelineVersionName | null; entry: TimelineEntry | null };
export const timelineVersionNameEventId = (operationId: string) => `version-name-${operationId}`;
export const timelineVersionNameId = (eventId: string) => `${eventId}/name`;

const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const date = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Same rule as branch names: trimmed, 1..80 characters, no control characters. */
/* eslint-disable no-control-regex -- the stripped control range is the point of this check */
export const isTimelineVersionNameText = (value: unknown): value is string =>
	typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= TIMELINE_VERSION_NAME_MAX_CHARS && !/[\u0000-\u001f\u007f]/.test(value);
/* eslint-enable no-control-regex */
function record(input: unknown, keys: string[], label: string): Record<string, any> {
	const value = copyBoundedJson(input, { maxBytes: 4096, maxDepth: 2, maxNodes: 16, sortKeys: true }, label) as Record<string, any>;
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`Invalid ${label} fields`);
	return value;
}
export function parseTimelineVersionName(input: unknown): TimelineVersionName {
	const value = record(input, ['formatVersion', 'id', 'ownerId', 'eventId', 'thingId', 'name', 'revision', 'createdAt', 'updatedAt'], 'Timeline version name');
	// Event ids may use all 200 characters, so the id is compared directly, never through the identifier regex.
	if (value.formatVersion !== 1 || !identifier(value.ownerId) || !identifier(value.eventId) || !identifier(value.thingId) || value.id !== timelineVersionNameId(value.eventId) ||
		!isTimelineVersionNameText(value.name) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt) throw new Error('Invalid Timeline version name');
	return value as TimelineVersionName;
}
export function parseTimelineVersionNameCommand(input: unknown): TimelineVersionNameCommand {
	const value = record(input, ['command', 'operationId', 'eventId', 'thingId', 'name', 'expectedRevision'], 'Timeline version name command');
	if (value.command !== 'name-version' || !uuid(value.operationId) || !identifier(value.eventId) || !identifier(value.thingId) || (value.name !== null && !isTimelineVersionNameText(value.name)) ||
		!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw new Error('Invalid Timeline version name command fields');
	return value as TimelineVersionNameCommand;
}
/** The server answered this exact command for this account: a stored name
 * (new, no-op or replayed), or null after a clear / no-op clear. */
export function parseTimelineVersionNameResult(input: unknown, ownerId: string, command: TimelineVersionNameCommand): TimelineVersionNameResult {
	if (!input || typeof input !== 'object' || Array.isArray(input) || (input as any).ok !== true) throw new Error('Invalid Timeline version name result');
	const value = input as any;
	if (Object.keys(value).length !== 3 || !Object.prototype.hasOwnProperty.call(value, 'name') || !Object.prototype.hasOwnProperty.call(value, 'entry')) throw new Error('Invalid Timeline version name result fields');
	const name = value.name === null ? null : parseTimelineVersionName(value.name);
	if (command.name === null ? name !== null : !name || name.name !== command.name) throw new Error('Server acknowledged another version name');
	if (name && (name.ownerId !== ownerId || name.eventId !== command.eventId || name.thingId !== command.thingId || (name.revision !== command.expectedRevision && name.revision < command.expectedRevision + 1))) throw new Error('Server acknowledged another version name');
	const entry = value.entry === null ? null : parseTimelineEntry(value.entry);
	if (entry && (entry.event.ownerId !== ownerId || entry.event.id !== timelineVersionNameEventId(command.operationId) || entry.event.thingId !== command.thingId || entry.event.mode !== 'effect' ||
		(entry.event.after ?? entry.event.before)?.adapter !== TIMELINE_VERSION_NAME_KIND || entry.event.dependencies.length !== 1 || entry.event.dependencies[0].eventId !== command.eventId ||
		(entry.event.after ? JSON.stringify(parseTimelineVersionName(entry.event.after.value)) !== JSON.stringify(name) : name !== null))) throw new Error('Server acknowledged another version name');
	return { ok: true, name, entry };
}
