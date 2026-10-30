import { timelineScopeKey, TIMELINE_PAGE_SIZE, type TimelineScope } from './contract.ts';
import { parseTimelineNote, parseTimelineNoteCommand, sortTimelineNotes, timelineNoteId, TIMELINE_NOTES_PER_EVENT, type HistoryNoteView, type TimelineNote, type TimelineNoteCommand } from './notes.ts';

export const TIMELINE_NOTE_CACHE_LIMIT = 1280;
export const TIMELINE_NOTE_PENDING_LIMIT = 128;
export type QueuedNoteCommand = { command: TimelineNoteCommand; failure?: { status: number; message: string } | null };
export type NoteLocalState = {
	notes: { scope: string; note: TimelineNote; accessedAt: number }[];
	pending: (QueuedNoteCommand & { scope: string; queuedAt: number })[];
};
export interface TimelineNoteBackend {
	readNoteState(scope: string): Promise<NoteLocalState>;
	changeNoteState(scope: string, update: (state: NoteLocalState) => NoteLocalState): Promise<void>;
}
const DEFINITIVE = [400, 404, 409, 413, 422];
const noteCommand = (command: TimelineNoteCommand): command is Exclude<TimelineNoteCommand, { command: 'remove-note' }> => command.command !== 'remove-note';

/** These arrays are bounded in-memory transaction views. Each cached note and
 * queued command is its own IndexedDB record; the server stays authoritative
 * for accepted notes while queued commands keep their request identity. */
export class TimelineNoteStore {
	readonly key: string;
	constructor(readonly scope: TimelineScope, private backend: TimelineNoteBackend, private now = Date.now) { this.key = timelineScopeKey(scope); this.scope = Object.freeze({ ...scope }); }
	private validate(input: NoteLocalState): NoteLocalState {
		if (input.notes.length > TIMELINE_NOTE_CACHE_LIMIT || input.pending.length > TIMELINE_NOTE_PENDING_LIMIT) throw new Error('Timeline note cache is damaged. Pending commands are preserved.');
		const check = (scope: string, ownerId?: string, at?: number) => {
			if (scope !== this.key || (ownerId !== undefined && ownerId !== this.scope.ownerId) || !Number.isFinite(at)) throw new Error('Timeline note cache scope is damaged. Pending commands are preserved.');
		};
		return {
			notes: input.notes.map(row => { const note = parseTimelineNote(row.note); check(row.scope, note.ownerId, row.accessedAt); return { ...row, note }; }),
			pending: input.pending.map(row => { check(row.scope, undefined, row.queuedAt); if (row.failure && (!DEFINITIVE.includes(row.failure.status) || typeof row.failure.message !== 'string' || row.failure.message.length > 512)) throw new Error('Invalid note failure record'); return { ...row, command: parseTimelineNoteCommand(row.command) }; })
		};
	}
	private change(update: (state: NoteLocalState) => NoteLocalState) { return this.backend.changeNoteState(this.key, state => this.validate(update(this.validate(state)))); }
	async enqueue(input: TimelineNoteCommand): Promise<void> {
		const command = parseTimelineNoteCommand(input);
		await this.change(state => {
			const old = state.pending.find(row => row.command.operationId === command.operationId);
			if (old) { if (JSON.stringify(old.command) !== JSON.stringify(command)) throw new Error('Note operation identity was reused with different content'); return state; }
			if (state.pending.length >= TIMELINE_NOTE_PENDING_LIMIT) throw new Error('Too many note commands are waiting. Reconnect to push them first.');
			const queuedAt = Math.max(this.now(), ...state.pending.map(row => row.queuedAt + 1));
			return { ...state, pending: [...state.pending, { scope: this.key, command, queuedAt }] };
		});
	}
	async pending(): Promise<TimelineNoteCommand[]> {
		const state = this.validate(await this.backend.readNoteState(this.key));
		return state.pending.filter(row => !row.failure).sort((a, b) => a.queuedAt - b.queuedAt).map(row => row.command);
	}
	async queued(): Promise<(QueuedNoteCommand & { queuedAt: number })[]> { return this.validate(await this.backend.readNoteState(this.key)).pending.map(({ command, failure, queuedAt }) => ({ command, failure, queuedAt })); }
	async reject(operationId: string, status: number, message: string) {
		if (!DEFINITIVE.includes(status)) throw new Error('An uncertain note command must remain pending');
		await this.change(state => ({ ...state, pending: state.pending.map(row => row.command.operationId === operationId ? { ...row, failure: { status, message: message.slice(0, 512) } } : row) }));
	}
	async retryRejected(operationId: string) { await this.change(state => ({ ...state, pending: state.pending.map(row => row.command.operationId === operationId ? { ...row, failure: null } : row) })); }
	/** Only a definitive server refusal can be dismissed. An uncertain command
	 * keeps its original request identity until its result has been reconciled. */
	async dismissRejected(operationId: string) {
		await this.change(state => {
			if (state.pending.some(row => row.command.operationId === operationId && !row.failure)) throw new Error('Sync this command to check its result before dismissing it');
			return { ...state, pending: state.pending.filter(row => row.command.operationId !== operationId) };
		});
	}
	async forEvents(eventIds: string[]): Promise<Map<string, TimelineNote[]>> {
		const wanted = new Set(eventIds);
		const state = this.validate(await this.backend.readNoteState(this.key));
		const grouped = new Map<string, TimelineNote[]>();
		for (const row of state.notes) if (wanted.has(row.note.eventId)) grouped.set(row.note.eventId, [...grouped.get(row.note.eventId) ?? [], row.note]);
		return new Map([...grouped].map(([eventId, notes]) => [eventId, sortTimelineNotes(notes)]));
	}
	/** `operationId` acknowledges one queued add/explain command with its exact
	 * note. `events` makes the server authoritative for those events: cached
	 * notes they no longer carry are dropped. Reads never consume a queued push. */
	async accept(inputs: TimelineNote[], options: { operationId?: string; events?: string[] } = {}): Promise<void> {
		const notes = inputs.map(parseTimelineNote);
		if (notes.length > TIMELINE_PAGE_SIZE * TIMELINE_NOTES_PER_EVENT || notes.some(note => note.ownerId !== this.scope.ownerId)) throw new Error('Invalid note response scope');
		await this.change(state => {
			const command = options.operationId ? state.pending.find(row => row.command.operationId === options.operationId)?.command : null;
			if (command && (!noteCommand(command) || notes.length !== 1 || notes[0].id !== timelineNoteId(command.operationId) || notes[0].eventId !== command.eventId || notes[0].thingId !== command.thingId || notes[0].author !== (command.command === 'add-note' ? 'owner' : 'lopu') || (command.command === 'add-note' && notes[0].text !== command.text))) throw new Error('Server acknowledged a different note command');
			const cached = new Map(state.notes.map(row => [row.note.id, row]));
			const events = options.events ? new Set(options.events) : null; const ids = new Set(notes.map(note => note.id));
			if (events) for (const [id, row] of cached) if (events.has(row.note.eventId) && !ids.has(id)) cached.delete(id);
			for (const note of notes) {
				const old = cached.get(note.id);
				if (old && JSON.stringify(old.note) !== JSON.stringify(note)) throw new Error('Immutable note identity changed');
				cached.set(note.id, { scope: this.key, note, accessedAt: this.now() });
			}
			const kept = [...cached.values()].sort((a, b) => b.accessedAt - a.accessedAt || b.note.createdAt.localeCompare(a.note.createdAt)).slice(0, TIMELINE_NOTE_CACHE_LIMIT);
			return { notes: kept, pending: state.pending.filter(row => row.command.operationId !== options.operationId) };
		});
	}
	/** A removal acknowledgment (or an authoritative read without the note)
	 * drops cached copies and the queued remove command it answers. */
	async removed(noteIds: string[], operationId?: string): Promise<void> {
		if (noteIds.length > TIMELINE_PAGE_SIZE * TIMELINE_NOTES_PER_EVENT || noteIds.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid note removal');
		await this.change(state => {
			const command = operationId ? state.pending.find(row => row.command.operationId === operationId)?.command : null;
			if (command && (command.command !== 'remove-note' || noteIds.length !== 1 || noteIds[0] !== command.noteId)) throw new Error('Server acknowledged a different note command');
			const dropped = new Set(noteIds);
			return { notes: state.notes.filter(row => !dropped.has(row.note.id)), pending: state.pending.filter(row => row.command.operationId !== operationId) };
		});
	}
	/** Dropping downloaded notes never discards queued work. */
	async clearCache() { await this.change(state => ({ ...state, notes: [] })); }
}

/** Presentation rows for loaded events: accepted notes (struck through while a
 * removal is queued) plus notes authored on this device that are still waiting,
 * each carrying the definitive refusal of its own command when there is one. */
export function historyNoteViews(ownerId: string, rows: { event: { id: string } }[], stored: Map<string, TimelineNote[]>, queued: (QueuedNoteCommand & { queuedAt: number })[]): Map<string, HistoryNoteView[]> {
	const loaded = new Set(rows.map(row => row.event.id));
	const removing = new Map(queued.flatMap(row => row.command.command === 'remove-note' ? [[row.command.noteId, row.failure ?? null] as const] : []));
	const views = new Map<string, HistoryNoteView[]>();
	const add = (view: HistoryNoteView) => views.set(view.note.eventId, [...views.get(view.note.eventId) ?? [], view]);
	for (const [eventId, notes] of stored) if (loaded.has(eventId)) for (const note of notes) add({ note, status: removing.has(note.id) ? 'removing' : 'accepted', failure: removing.get(note.id) ?? null });
	const accepted = new Set([...stored.values()].flat().map(note => note.id));
	for (const row of queued) {
		const { command } = row;
		if (!noteCommand(command) || !loaded.has(command.eventId) || accepted.has(timelineNoteId(command.operationId))) continue;
		const note: TimelineNote = { formatVersion: 1, id: timelineNoteId(command.operationId), ownerId, eventId: command.eventId, thingId: command.thingId, author: command.command === 'add-note' ? 'owner' : 'lopu', text: command.command === 'add-note' ? command.text : 'Asking Lopu…', createdAt: new Date(row.queuedAt).toISOString() };
		add({ note, status: 'pending', failure: row.failure ?? null });
	}
	for (const [eventId, list] of views) views.set(eventId, list.sort((a, b) => a.note.createdAt.localeCompare(b.note.createdAt) || a.note.id.localeCompare(b.note.id)));
	return views;
}
