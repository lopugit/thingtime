import { parseTimelineEntry, TIMELINE_PAGE_SIZE, type TimelineEntry, type TimelineEvent } from './contract.ts';
import type { TimelineLocalStore } from './localStore.ts';
import type { TimelineBranchStore } from './branchStore.ts';
import type { TimelineNoteStore } from './noteStore.ts';
import { parseTimelineNote, parseTimelineNoteResult, TIMELINE_NOTES_PER_EVENT, type TimelineNote, type TimelineNoteCommand, type TimelineNoteResult } from './notes.ts';
import { parseRelatedTimelineScope, timelineRelatedId, timelineRelatedRevision, type RelatedTimelineScope } from './relatedHistory.ts';
import { parseTimelineBranchEntry, parseTimelineBranchLookup, parseTimelineBranchLookupResult, type TimelineBranchEntry, type TimelineBranchCommand, type TimelineBranchResult, type TimelineBranchPage } from './branches.ts';

export type TimelineCursor = { before?: number; after?: number; related?: true; relatedRevision?: string };
export type TimelinePageRequest = { thingId: string | null; before: number | null; after: number | null; limit: number; related?: true; relatedRevision?: string };
/** `notes` are the contextual messages for the page's events (see notes.ts); older servers omit them. */
export type TimelinePage = { entries: TimelineEntry[]; nextBefore: number | null; nextAfter: number | null; related?: RelatedTimelineScope; reset?: true; notes?: TimelineNote[] };
/** The queue persisted a definitive command outcome. History reads remain
 * healthy; the owning branch control presents the actionable refusal. */
export class TimelineBranchCommandRefusal extends Error {}
/** The queue persisted a definitive note refusal; events and branches synced. */
export class TimelineNoteCommandRefusal extends Error {}
export interface TimelineTransport {
	push(event: TimelineEvent, signal: AbortSignal): Promise<TimelineEntry>;
	recoverOutcome?(event: TimelineEvent, proof: string, signal: AbortSignal): Promise<TimelineEntry>;
	page(request: TimelinePageRequest, signal: AbortSignal): Promise<TimelinePage>;
	branch?(command: TimelineBranchCommand, signal: AbortSignal): Promise<TimelineBranchResult>;
	branches?(thingId: string, before: number | undefined, signal: AbortSignal): Promise<TimelineBranchPage>;
	branchHead?(branchId: string, thingId: string, signal: AbortSignal): Promise<TimelineBranchEntry>;
	/** A bare entry remains accepted; servers with contextual notes wrap it. */
	entry?(eventId: string, signal: AbortSignal): Promise<TimelineEntry | { entry: TimelineEntry; notes?: TimelineNote[] }>;
	note?(command: TimelineNoteCommand, signal: AbortSignal): Promise<TimelineNoteResult>;
}

/** One instance per signed-in origin/data-plane scope. The UI owns the live
 * subscription lifetime; no account-wide history download or global cursor. */
export class TimelineSync {
	private controller = new AbortController();
	private pushing: Promise<number> | null = null;
	private pages = new Map<string, Promise<TimelinePage>>();
	private branchPages = new Map<string, Promise<TimelineBranchPage>>();
	constructor(readonly store: TimelineLocalStore, private transport: TimelineTransport, readonly branchStore?: TimelineBranchStore, readonly noteStore?: TimelineNoteStore) {}
	stop() { this.controller.abort(); }
	/** Fetch one pointer directly; the bounded cache is not a branch directory.
	 * Accepting a read never acknowledges or replaces a queued push. */
	async branchHead(branchId: string, thingId: string): Promise<TimelineBranchEntry> {
		this.assertActive();
		if (!this.branchStore || !this.transport.branchHead) throw new Error('Loading this branch is unavailable.');
		const lookup = parseTimelineBranchLookup({ branchId, thingId });
		const response = await this.transport.branchHead(lookup.branchId, lookup.thingId, this.controller.signal);
		this.assertActive();
		const entry = parseTimelineBranchLookupResult(response, this.store.scope.ownerId, lookup);
		await this.branchStore.accept([entry]);
		return entry;
	}
	private assertActive() {
		if (this.controller.signal.aborted) throw new Error('Timeline synchronization stopped');
	}
	pushPending(): Promise<number> {
		if (this.pushing) return this.pushing;
		this.pushing = this.push().finally(() => { this.pushing = null; });
		return this.pushing;
	}
	private async push(): Promise<number> {
		this.assertActive();
		let accepted = 0;
		// Freeze commands before reading the event queue. A command authored during
		// an upload may reference an edit that missed this pass's event snapshot;
		// defer both to the next pass instead of mistaking that version for a 404.
		const commands = await this.branchStore?.pending() ?? [];
		const noteCommands = await this.noteStore?.pending() ?? [];
		const refused = new Set<string>(); let outcomeFailure: unknown;
		// A bounded drain: later edits schedule another pass. Uncertain replies
		// stop the pass; definitive recovery refusals retain all dependent work.
		const writes = await this.store.pendingWrites();
		// A note for a version that has not been uploaded yet waits for it;
		// the server cannot know that event and would refuse the note as missing.
		const waiting = new Set(writes.map(row => row.event.id));
		for (const { event, recoveryProof } of writes) {
			this.assertActive();
			if ([...event.parentIds, ...event.dependencies.map(link => link.eventId)].some(id => refused.has(id))) { refused.add(event.id); continue; }
			if (recoveryProof && !this.transport.recoverOutcome) throw new Error('This server does not support Action history recovery. Your local outcome is preserved.');
			let entry: TimelineEntry;
			try {
				entry = parseTimelineEntry(await (recoveryProof
					? this.transport.recoverOutcome!(event, recoveryProof, this.controller.signal)
					: this.transport.push(event, this.controller.signal)));
			} catch (error: any) {
				this.assertActive();
				// A retired signing key or missing admission must not indefinitely
				// block unrelated edits. Keep the outcome and dependent work intact.
				if (!recoveryProof || ![400, 404, 409, 413, 422].includes(error?.status)) throw error;
				refused.add(event.id); outcomeFailure ??= error; continue;
			}
			this.assertActive();
			if (entry.event.id !== event.id) throw new Error('Timeline server acknowledged a different event');
			await this.store.accept([entry]);
			waiting.delete(event.id);
			accepted++;
		}
		let branchFailure: unknown;
		for (const command of commands) {
			this.assertActive();
			if (refused.has(command.eventId)) continue;
			if (!this.transport.branch) throw new Error('This server does not support branch synchronization. Your command is preserved.');
			let result: TimelineBranchResult;
			try { result = await this.transport.branch(command, this.controller.signal); }
			catch (error: any) {
				this.assertActive();
				if (![400, 404, 409, 413, 422].includes(error?.status)) throw error;
				await this.branchStore!.reject(command.operationId, error.status, error.error || error.message || 'Branch command was refused. Pull and compare the versions.');
				branchFailure ??= error; continue;
			}
			this.assertActive();
			const entry = parseTimelineEntry(result.entry); const branch = parseTimelineBranchEntry(result);
			if (result.ok !== true || entry.event.id !== `branch-op-${command.operationId}` || entry.event.mode !== 'effect' || entry.event.source !== 'api' || entry.event.after?.adapter !== 'timeline-branch' || JSON.stringify(parseTimelineBranchEntry(entry.event.after.value as any)) !== JSON.stringify(branch)) throw new Error('Server acknowledged a different branch operation');
			await this.store.accept([entry]);
			this.assertActive();
			await this.branchStore!.accept([branch], command.operationId);
			// An acknowledged named head is saved work, including retries after reload.
			// Release only that exact draft; a newer editor pin must survive.
			await this.store.releaseDraft(command.eventId);
			accepted++;
		}
		let noteFailure: unknown;
		for (const command of noteCommands) {
			this.assertActive();
			if (command.command !== 'remove-note' && (refused.has(command.eventId) || waiting.has(command.eventId))) continue;
			if (!this.transport.note) throw new Error('This server does not support note synchronization. Your note is preserved.');
			let response: TimelineNoteResult;
			try { response = await this.transport.note(command, this.controller.signal); }
			catch (error: any) {
				this.assertActive();
				if (![400, 404, 409, 413, 422].includes(error?.status)) throw error;
				await this.noteStore!.reject(command.operationId, error.status, error.error || error.message || 'Note command was refused.');
				noteFailure ??= error; continue;
			}
			this.assertActive();
			const result = parseTimelineNoteResult(response, this.store.scope.ownerId, command);
			if ('removed' in result) await this.noteStore!.removed([result.noteId], command.operationId);
			else await this.noteStore!.accept([result.note], { operationId: command.operationId });
			accepted++;
		}
		if (branchFailure) throw new TimelineBranchCommandRefusal('A branch push needs attention. Its selected version remains in History.');
		if (noteFailure) throw new TimelineNoteCommandRefusal('A note needs attention. Your other changes are synced.');
		if (outcomeFailure) throw outcomeFailure;
		return accepted;
	}
	/** Notes travel beside the entries they belong to; a server without them
	 * omits the field, and an unknown event or another account fails the read. */
	private pageNotes(input: unknown, eventIds: string[]): TimelineNote[] | undefined {
		if (input === undefined) return undefined;
		if (!Array.isArray(input) || input.length > TIMELINE_PAGE_SIZE * TIMELINE_NOTES_PER_EVENT) throw new Error('Invalid Timeline page');
		const events = new Set(eventIds); const seen = new Set<string>();
		return input.map(item => {
			const note = parseTimelineNote(item);
			if (note.ownerId !== this.store.scope.ownerId || !events.has(note.eventId) || seen.has(note.id)) throw new Error('Invalid Timeline page');
			seen.add(note.id); return note;
		});
	}
	branchPage(thingId: string, before?: number): Promise<TimelineBranchPage> {
		const key = JSON.stringify([thingId, before ?? null]); const current = this.branchPages.get(key); if (current) return current;
		const next = this.readBranchPage(thingId, before).finally(() => this.branchPages.delete(key)); this.branchPages.set(key, next); return next;
	}
	private async readBranchPage(thingId: string, before?: number): Promise<TimelineBranchPage> {
		this.assertActive();
		if (!this.branchStore || !this.transport.branches) throw new Error('Branch synchronization is unavailable.');
		if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new Error('Invalid branch cursor');
		const response = await this.transport.branches(thingId, before, this.controller.signal); this.assertActive();
		if (!Array.isArray(response.branches) || response.branches.length > 40) throw new Error('Invalid branch page');
		const branches = response.branches.map(parseTimelineBranchEntry); const seen = new Set<string>();
		for (const entry of branches) { if (entry.head.thingId !== thingId || seen.has(entry.head.id)) throw new Error('Invalid branch page scope'); seen.add(entry.head.id); }
		if (response.nextBefore !== null && (!Number.isSafeInteger(response.nextBefore) || response.nextBefore < 1 || !branches.length || (before !== undefined && response.nextBefore >= before))) throw new Error('Invalid branch continuation');
		await this.branchStore.accept(branches);
		return { branches, nextBefore: response.nextBefore };
	}
	async entry(eventId: string): Promise<TimelineEntry> {
		this.assertActive();
		if (!this.transport.entry) throw new Error('Loading this version is unavailable.');
		const response = await this.transport.entry(eventId, this.controller.signal); this.assertActive();
		const wrapped = !!response && typeof response === 'object' && 'entry' in response;
		const entry = parseTimelineEntry(wrapped ? response.entry : response);
		if (entry.event.id !== eventId) throw new Error('Server returned a different version');
		const notes = this.pageNotes(wrapped ? response.notes : undefined, [eventId]);
		await this.store.accept([entry]);
		if (notes) await this.noteStore?.accept(notes, { events: [eventId] });
		return entry;
	}
	page(thingId: string | null, cursor: TimelineCursor = {}): Promise<TimelinePage> {
		const key = JSON.stringify([thingId, cursor.before ?? null, cursor.after ?? null, cursor.related ?? false, cursor.relatedRevision ?? null]);
		const current = this.pages.get(key);
		if (current) return current;
		const next = this.readPage(thingId, cursor).finally(() => this.pages.delete(key));
		this.pages.set(key, next); return next;
	}
	private async readPage(thingId: string | null, cursor: TimelineCursor = {}): Promise<TimelinePage> {
		this.assertActive();
		if (cursor.related && (!timelineRelatedId(thingId) || ((cursor.before !== undefined || cursor.after !== undefined) && !cursor.relatedRevision)) ||
			(cursor.relatedRevision !== undefined && (!cursor.related || !timelineRelatedRevision(cursor.relatedRevision)))) throw new Error('Invalid related history cursor');
		if (cursor.before !== undefined && cursor.after !== undefined) throw new Error('Choose one Timeline paging direction');
		for (const position of [cursor.before, cursor.after]) if (position !== undefined && (!Number.isSafeInteger(position) || position < 1)) throw new Error('Invalid Timeline cursor');
		const response = await this.transport.page({ thingId, before: cursor.before ?? null, after: cursor.after ?? null, limit: TIMELINE_PAGE_SIZE, ...(cursor.related ? { related: true, ...(cursor.relatedRevision ? { relatedRevision: cursor.relatedRevision } : {}) } : {}) }, this.controller.signal);
		this.assertActive();
		const related = cursor.related ? parseRelatedTimelineScope(response.related, thingId!) : undefined;
		const changed = !!related && cursor.relatedRevision !== undefined && related.revision !== cursor.relatedRevision;
		if (response.reset !== undefined && response.reset !== true || (response.reset === true) !== changed || (!related && response.related !== undefined)) throw new Error('Invalid related history continuation');
		const paging = response.reset ? {} : cursor;
		if (!Array.isArray(response.entries) || response.entries.length > TIMELINE_PAGE_SIZE) throw new Error('Invalid Timeline page');
		const entries = response.entries.map(parseTimelineEntry);
		const seen = new Set<number>();
		let previous: number | null = null;
		for (const entry of entries) {
			const position = entry.receipt.position;
			if ((related ? !related.thingIds.includes(entry.event.thingId) : thingId !== null && entry.event.thingId !== thingId) || seen.has(position) ||
				(paging.before !== undefined && position >= paging.before) || (paging.after !== undefined && position <= paging.after) ||
				(previous !== null && (paging.after !== undefined ? position <= previous : position >= previous))) throw new Error('Invalid Timeline page order');
			seen.add(position);
			previous = position;
		}
		for (const key of ['nextBefore', 'nextAfter'] as const) {
			const position = response[key];
			if (position !== null && (!Number.isSafeInteger(position) || position < 1 || !seen.has(position))) throw new Error('Invalid Timeline continuation');
		}
		if (paging.after !== undefined ? response.nextBefore !== null : response.nextAfter !== null) throw new Error('Invalid Timeline continuation direction');
		const next = paging.after !== undefined ? response.nextAfter : response.nextBefore;
		if (next !== null && next !== previous) throw new Error('Timeline continuation would skip events');
		const ids = entries.map(entry => entry.event.id);
		const notes = this.pageNotes(response.notes, ids);
		await this.store.accept(entries);
		if (notes) await this.noteStore?.accept(notes, { events: ids });
		return { entries, nextBefore: response.nextBefore, nextAfter: response.nextAfter, ...(related ? { related } : {}), ...(response.reset ? { reset: true } : {}), ...(notes ? { notes } : {}) };
	}
}
