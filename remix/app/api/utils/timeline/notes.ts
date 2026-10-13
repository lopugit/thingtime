import { createHash } from 'node:crypto';
import {
	TIMELINE_NOTE_KIND, TIMELINE_NOTE_MAX_BYTES, TIMELINE_NOTES_PER_EVENT, parseTimelineNote, parseTimelineNoteCommand, sortTimelineNotes, timelineNoteId,
	type TimelineNote, type TimelineNoteAuthor, type TimelineNoteCommand, type TimelineNoteResult
} from '../../../timeline/notes.ts';
import { binaryBytes, fromBin, toBin } from '../auth/binary.ts';
import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry.ts';
import { applyUserStorageDelta } from '../storage/userStorage';
import { StorageMutationError, currentContentStorageSizeBytes, thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore.ts';
import { readTimelineEntries, timelineEventThingId, timelineFolderId } from './repository.ts';
import { explainTimelineEntry } from './explain.ts';

/** One protected relational Thing per note. The event stays immutable: a note
 * points at its event Thing through targetId (shared index) and never becomes
 * a field or array on the event, the Thing or the Timeline folder. */
const digest = (parts: unknown) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const refuse = (status: number, message: string): never => { throw new StorageMutationError(status, status === 409 ? 'storage_conflict' : 'storage_invariant', message); };
export const timelineNoteThingId = (ownerId: string, noteId: string) => `timeline-note-${digest([ownerId, noteId])}`;
export const packTimelineNote = (note: TimelineNote) => ({ timelineNoteVersion: 1, secure: toBin(JSON.stringify(note)) });
export const noteFromDoc = (doc: any): TimelineNote => {
	const bytes = binaryBytes(doc?.secure);
	if (!doc?.thingtime?.includes(TIMELINE_NOTE_KIND) || doc.timelineNoteVersion !== 1 || bytes === null || bytes < 1 || bytes > TIMELINE_NOTE_MAX_BYTES) throw new Error('Invalid Timeline note envelope');
	const note = parseTimelineNote(JSON.parse(fromBin(doc.secure)));
	const eventShareId = timelineEventThingId(note.ownerId, note.eventId);
	if (doc.ownerId !== note.ownerId || doc.shareId !== timelineNoteThingId(note.ownerId, note.id) || doc.targetId !== eventShareId || doc.crystal?.name !== 'Note' || doc.crystal?.targetId !== eventShareId || doc.crystal?.linkKind !== TIMELINE_NOTE_KIND)
		throw new Error('Timeline note envelope does not match its record');
	return note;
};

/** ONE bounded owner-scoped query per batch over the shared targetId index; at most 8 notes per event. */
export async function readTimelineNotes(things: any, ownerId: string, eventIds: string[], session?: any): Promise<TimelineNote[]> {
	if (eventIds.length > 128) throw new Error('Too many Timeline note sources requested.');
	const ids = [...new Set(eventIds)];
	if (!ownerId || !ids.length) return [];
	const docs = await things.find({ ownerId, thingtime: TIMELINE_NOTE_KIND, targetId: { $in: ids.map(id => timelineEventThingId(ownerId, id)) } },
		{ ...(session ? { session } : {}), projection: { _id: 0, shareId: 1, ownerId: 1, targetId: 1, thingtime: 1, timelineNoteVersion: 1, secure: 1, crystal: 1, createdAt: 1 } })
		.sort({ createdAt: 1 }).limit(ids.length * TIMELINE_NOTES_PER_EVENT).toArray();
	return sortTimelineNotes(docs.map(noteFromDoc));
}

const dependencies = {
	collection: getThingsCollection, transaction: withMongoTransaction, debit: applyUserStorageDelta, billable: () => !isCustomMongoEndpointActive(), now: () => new Date(),
	entries: readTimelineEntries, explain: explainTimelineEntry
};
export function createNoteService(overrides: Partial<typeof dependencies> = {}) {
	const deps = { ...dependencies, ...overrides };
	const existing = async (things: any, ownerId: string, noteId: string, session?: any) => {
		const doc = await things.findOne({ ownerId, thingtime: TIMELINE_NOTE_KIND, shareId: timelineNoteThingId(ownerId, noteId) }, session ? { session } : {});
		return doc ? noteFromDoc(doc) : null;
	};
	/** The operation id is the retry identity: an identical request returns the stored note; a different one is refused. */
	const replay = (prior: TimelineNote | null, command: Extract<TimelineNoteCommand, { eventId: string }>, author: TimelineNoteAuthor): TimelineNoteResult | null => {
		if (!prior) return null;
		if (prior.eventId !== command.eventId || prior.thingId !== command.thingId || prior.author !== author || (command.command === 'add-note' && prior.text !== command.text)) refuse(409, 'This note request id was already used for another note.');
		return { ok: true, note: prior };
	};
	/** The event must be this account's, for this Thing, and not already full; one bounded count on the shared targetId index. */
	const target = async (things: any, ownerId: string, command: Extract<TimelineNoteCommand, { eventId: string }>, session?: any) => {
		const entry = (await deps.entries(things, ownerId, [command.eventId], session))[0];
		if (!entry || entry.event.ownerId !== ownerId || entry.event.thingId !== command.thingId) refuse(404, 'This change is not in your history yet. Sync it first.');
		const count = await things.countDocuments({ ownerId, thingtime: TIMELINE_NOTE_KIND, targetId: timelineEventThingId(ownerId, command.eventId) }, { ...(session ? { session } : {}), limit: TIMELINE_NOTES_PER_EVENT });
		if (count >= TIMELINE_NOTES_PER_EVENT) refuse(413, `This change already has ${TIMELINE_NOTES_PER_EVENT} notes. Remove one to add another.`);
		return entry!;
	};
	const store = async (things: any, session: any, ownerId: string, command: Extract<TimelineNoteCommand, { eventId: string }>, author: TimelineNoteAuthor, text: string): Promise<TimelineNoteResult> => {
		const noteId = timelineNoteId(command.operationId);
		const prior = replay(await existing(things, ownerId, noteId, session), command, author);
		if (prior) return prior;
		await target(things, ownerId, command, session);
		const eventShareId = timelineEventThingId(ownerId, command.eventId);
		const now = deps.now();
		const note = parseTimelineNote({ formatVersion: 1, id: noteId, ownerId, eventId: command.eventId, thingId: command.thingId, author, text, createdAt: now.toISOString() });
		const doc: any = {
			shareId: timelineNoteThingId(ownerId, noteId), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [TIMELINE_NOTE_KIND], ownerId, acl: ['tt:user'],
			folderId: timelineFolderId(ownerId), parentId: null, targetId: eventShareId, crystal: { name: 'Note', targetId: eventShareId, linkKind: TIMELINE_NOTE_KIND },
			extended: null, tags: [], createdAt: now, updatedAt: now, ...packTimelineNote(note)
		};
		if (deps.billable()) { doc.storageClass = 'content'; doc.storageAccountingVersion = USER_STORAGE_ACCOUNTING_VERSION; doc.sizeBytes = thingStorageSizeBytes(doc); await deps.debit(ownerId, doc.sizeBytes, session); }
		await things.insertOne(doc, { session });
		return { ok: true, note };
	};
	return async (ownerId: string, input: TimelineNoteCommand, context: { signal?: AbortSignal } = {}): Promise<TimelineNoteResult> => {
		const command = parseTimelineNoteCommand(input); const things = await deps.collection();
		if (command.command === 'remove-note') return deps.transaction(async session => {
			const doc = await things.findOne({ ownerId, thingtime: TIMELINE_NOTE_KIND, shareId: timelineNoteThingId(ownerId, command.noteId) }, { session });
			if (!doc) return { ok: true, removed: true, noteId: command.noteId };
			await things.deleteOne({ shareId: doc.shareId, ownerId }, { session });
			// Refund only exact current-version accounting; a stale or malformed stamp leaves the ledger to reconciliation.
			const refund = doc.storageClass === 'content' ? currentContentStorageSizeBytes(doc) : null;
			if (refund !== null && refund > 0) await deps.debit(ownerId, -refund, session);
			return { ok: true, removed: true, noteId: command.noteId };
		});
		if (command.command === 'add-note') return deps.transaction(session => store(things, session, ownerId, command, 'owner', command.text));
		// Lopu runs OUTSIDE the transaction: a stored explanation is returned without asking again,
		// and a model call never holds a content transaction open.
		const prior = replay(await existing(things, ownerId, timelineNoteId(command.operationId)), command, 'lopu');
		if (prior) return prior;
		const text = await deps.explain(await target(things, ownerId, command), context.signal);
		return deps.transaction(session => store(things, session, ownerId, command, 'lopu', text));
	};
}
export const handleNoteRequest = createNoteService();
export const getTimelineNotes = async (ownerId: string, eventIds: string[]) => readTimelineNotes(await getThingsCollection(), ownerId, eventIds);
