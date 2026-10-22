import { parseTimelineNote, parseTimelineNoteResult, sortTimelineNotes, timelineNoteId, TIMELINE_NOTES_PER_EVENT, type TimelineNote, type TimelineNoteCommand, type TimelineNoteResult } from '../timeline/notes';
import type { TimelineEntry } from '../timeline/contract';
import { WorkspaceError, type WorkspaceTransaction } from './storage';

const NOTES = 'timeline-notes';
const refuse = (status: number, message: string): never => { throw new WorkspaceError('LOCAL_TIMELINE_NOTE', message, status); };

/** One canonical record per note. Batch once per History page, never append
 * messages to an immutable event or issue one storage scan per event. */
export async function readLocalTimelineNotes(tx: WorkspaceTransaction, ownerId: string): Promise<TimelineNote[]> {
 const notes = (await tx.list<TimelineNote>(NOTES)).map(row => {
  const note = parseTimelineNote(row.value);
  if (row.id !== note.id || note.ownerId !== ownerId) refuse(409, 'Local History note identity is damaged.');
  return note;
 });
 const counts = new Map<string, number>();
 for (const note of notes) {
  const count = (counts.get(note.eventId) || 0) + 1;
  if (count > TIMELINE_NOTES_PER_EVENT) refuse(409, 'Local History note count is damaged.');
  counts.set(note.eventId, count);
 }
 return sortTimelineNotes(notes);
}

export function localNotesForEntry(notes: TimelineNote[], entry: TimelineEntry): TimelineNote[] {
 return notes.filter(note => {
  if (note.eventId !== entry.event.id) return false;
  if (note.thingId !== entry.event.thingId || note.ownerId !== entry.event.ownerId) refuse(409, 'Local History note target is damaged.');
  return true;
 });
}

export async function writeLocalTimelineNote(tx: WorkspaceTransaction, ownerId: string, command: TimelineNoteCommand,
 readEntry: (id: string) => Promise<TimelineEntry | null>, now: () => string): Promise<TimelineNoteResult> {
 if (command.command === 'explain-change') refuse(422, 'Lopu explanations require a configured inference service. Your local History has not been uploaded.');
 if (command.command === 'remove-note') {
  // A tiny internal deletion marker prevents another tab's delayed add retry
  // from resurrecting removed text. It contains no note content and counts
  // toward the ordinary workspace quota in this same transaction.
  await tx.delete(NOTES, command.noteId);
  await tx.put('timeline-meta', `removed-note:${command.noteId}`, true);
  return { ok: true, removed: true, noteId: command.noteId };
 }
 if (command.command !== 'add-note') return refuse(422, 'Unsupported local History note command.');
 const id = timelineNoteId(command.operationId);
 if (await tx.get('timeline-meta', `removed-note:${id}`)) refuse(409, 'This note was removed. Add a new note instead of retrying the old request.');
 const prior = await tx.get<TimelineNote>(NOTES, id);
 if (prior) {
  try { return parseTimelineNoteResult({ ok: true, note: prior }, ownerId, command); }
  catch { return refuse(409, 'This note request id was already used for another note.'); }
 }
 const entry = await readEntry(command.eventId);
 if (!entry || entry.event.ownerId !== ownerId || entry.event.thingId !== command.thingId) refuse(404, 'This change is not in your local History yet. Save it first.');
 const notes = localNotesForEntry(await readLocalTimelineNotes(tx, ownerId), entry!);
 if (notes.length >= TIMELINE_NOTES_PER_EVENT) refuse(413, `This change already has ${TIMELINE_NOTES_PER_EVENT} notes. Remove one to add another.`);
 const note = parseTimelineNote({ formatVersion: 1, id, ownerId, eventId: command.eventId, thingId: command.thingId, author: 'owner', text: command.text, createdAt: now() });
 await tx.put(NOTES, id, note);
 return { ok: true, note };
}
