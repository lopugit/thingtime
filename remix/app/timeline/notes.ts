import { copyBoundedJson } from '../utils/boundedJson.ts';

/** Contextual messages attached to one immutable Timeline event.
 *
 * A note is its own relational record (one protected Thing per note on the
 * server, one IndexedDB row locally), linked to its event by `eventId`. Events
 * stay immutable and exact-keyed; notes never extend the event record, never
 * accumulate as an array on the event or the Thing, and never appear in the
 * event list as separate moments. The same record travels through page reads,
 * the local cache and the offline command queue. */
export const TIMELINE_NOTE_KIND = 'timeline-note';
export const TIMELINE_NOTE_MAX_CHARS = 2000;
export const TIMELINE_NOTES_PER_EVENT = 8;
export const TIMELINE_NOTE_MAX_BYTES = 8192;
export const TIMELINE_NOTE_AUTHORS = ['owner', 'lopu'] as const;
export type TimelineNoteAuthor = (typeof TIMELINE_NOTE_AUTHORS)[number];
export type TimelineNote = {
	formatVersion: 1; id: string; ownerId: string; eventId: string; thingId: string;
	author: TimelineNoteAuthor; text: string; createdAt: string;
};
/** `operationId` is the retry identity: add/explain mint `note-<operationId>`,
 * so a lost reply retried with the same request can never create a second note. */
export type TimelineNoteCommand =
	| { command: 'add-note'; operationId: string; eventId: string; thingId: string; text: string }
	| { command: 'explain-change'; operationId: string; eventId: string; thingId: string }
	| { command: 'remove-note'; operationId: string; noteId: string };
export type TimelineNoteResult = { ok: true; note: TimelineNote } | { ok: true; removed: true; noteId: string };
/** Presentation state for one note in the browser: accepted by the account,
 * authored on this device and waiting, or queued for removal. A definitive
 * server refusal is kept with the queued command until it is dismissed. */
export type HistoryNoteView = { note: TimelineNote; status: 'accepted' | 'pending' | 'removing'; failure: { status: number; message: string } | null };

const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const noteId = (value: unknown): value is string => typeof value === 'string' && value.startsWith('note-') && uuid(value.slice(5));
export const isTimelineNoteId = noteId;
export const timelineNoteId = (operationId: string) => `note-${operationId}`;
const date = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Plain text only: trimmed, bounded, line breaks allowed, no other control characters. */
/* eslint-disable no-control-regex -- the stripped control range is the point of these checks */
export const isTimelineNoteText = (value: unknown): value is string =>
	typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= TIMELINE_NOTE_MAX_CHARS && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
export const normalizeTimelineNoteText = (value: string) => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
/* eslint-enable no-control-regex */
function record(input: unknown, keys: string[], label: string): Record<string, any> {
	const value = copyBoundedJson(input, { maxBytes: TIMELINE_NOTE_MAX_BYTES, maxDepth: 2, maxNodes: 16, sortKeys: true }, label) as Record<string, any>;
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) throw new Error(`Invalid ${label} fields`);
	return value;
}
export function parseTimelineNote(input: unknown): TimelineNote {
	const value = record(input, ['formatVersion', 'id', 'ownerId', 'eventId', 'thingId', 'author', 'text', 'createdAt'], 'Timeline note');
	if (value.formatVersion !== 1 || !noteId(value.id) || !identifier(value.ownerId) || !identifier(value.eventId) || !identifier(value.thingId) ||
		!TIMELINE_NOTE_AUTHORS.includes(value.author) || !isTimelineNoteText(value.text) || !date(value.createdAt)) throw new Error('Invalid Timeline note');
	return value as TimelineNote;
}
export function parseTimelineNoteCommand(input: unknown): TimelineNoteCommand {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Timeline note command');
	const command = (input as any).command;
	if (command === 'add-note') {
		const value = record(input, ['command', 'operationId', 'eventId', 'thingId', 'text'], 'Timeline note command');
		if (!uuid(value.operationId) || !identifier(value.eventId) || !identifier(value.thingId) || !isTimelineNoteText(value.text)) throw new Error('Invalid Timeline note command fields');
		return value as TimelineNoteCommand;
	}
	if (command === 'explain-change') {
		const value = record(input, ['command', 'operationId', 'eventId', 'thingId'], 'Timeline note command');
		if (!uuid(value.operationId) || !identifier(value.eventId) || !identifier(value.thingId)) throw new Error('Invalid Timeline note command fields');
		return value as TimelineNoteCommand;
	}
	if (command === 'remove-note') {
		const value = record(input, ['command', 'operationId', 'noteId'], 'Timeline note command');
		if (!uuid(value.operationId) || !noteId(value.noteId)) throw new Error('Invalid Timeline note command fields');
		return value as TimelineNoteCommand;
	}
	throw new Error('Invalid Timeline note command');
}
export function parseTimelineNoteResult(input: unknown, ownerId: string, command: TimelineNoteCommand): TimelineNoteResult {
	if (!input || typeof input !== 'object' || (input as any).ok !== true) throw new Error('Invalid Timeline note result');
	if (command.command === 'remove-note') {
		const value = input as any;
		if (value.removed !== true || value.noteId !== command.noteId || Object.keys(value).length !== 3) throw new Error('Server acknowledged another note');
		return { ok: true, removed: true, noteId: command.noteId };
	}
	const note = parseTimelineNote((input as any).note);
	if (note.ownerId !== ownerId || note.id !== timelineNoteId(command.operationId) || note.eventId !== command.eventId || note.thingId !== command.thingId ||
		note.author !== (command.command === 'add-note' ? 'owner' : 'lopu') || (command.command === 'add-note' && note.text !== command.text)) throw new Error('Server acknowledged another note');
	return { ok: true, note };
}
export const sortTimelineNotes = (notes: TimelineNote[]) => [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
