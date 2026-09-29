import { parseTimelineEntry, TIMELINE_PAGE_SIZE, type TimelineEntry, type TimelineEvent } from './contract.ts';
import type { TimelineLocalStore } from './localStore.ts';
import type { TimelineBranchStore } from './branchStore.ts';
import { parseRelatedTimelineScope, timelineRelatedId, timelineRelatedRevision, type RelatedTimelineScope } from './relatedHistory.ts';
import { parseTimelineBranchEntry, parseTimelineBranchLookup, parseTimelineBranchLookupResult, type TimelineBranchEntry, type TimelineBranchCommand, type TimelineBranchResult, type TimelineBranchPage } from './branches.ts';

export type TimelineCursor = { before?: number; after?: number; related?: true; relatedRevision?: string };
export type TimelinePageRequest = { thingId: string | null; before: number | null; after: number | null; limit: number; related?: true; relatedRevision?: string };
export type TimelinePage = { entries: TimelineEntry[]; nextBefore: number | null; nextAfter: number | null; related?: RelatedTimelineScope; reset?: true };
/** The queue persisted a definitive command outcome. History reads remain
 * healthy; the owning branch control presents the actionable refusal. */
export class TimelineBranchCommandRefusal extends Error {}
export interface TimelineTransport {
	push(event: TimelineEvent, signal: AbortSignal): Promise<TimelineEntry>;
	page(request: TimelinePageRequest, signal: AbortSignal): Promise<TimelinePage>;
	branch?(command: TimelineBranchCommand, signal: AbortSignal): Promise<TimelineBranchResult>;
	branches?(thingId: string, before: number | undefined, signal: AbortSignal): Promise<TimelineBranchPage>;
	branchHead?(branchId: string, thingId: string, signal: AbortSignal): Promise<TimelineBranchEntry>;
	entry?(eventId: string, signal: AbortSignal): Promise<TimelineEntry>;
}

/** One instance per signed-in origin/data-plane scope. The UI owns the live
 * subscription lifetime; no account-wide history download or global cursor. */
export class TimelineSync {
	private controller = new AbortController();
	private pushing: Promise<number> | null = null;
	private pages = new Map<string, Promise<TimelinePage>>();
	private branchPages = new Map<string, Promise<TimelineBranchPage>>();
	constructor(readonly store: TimelineLocalStore, private transport: TimelineTransport, readonly branchStore?: TimelineBranchStore) {}
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
		// A bounded drain: later edits schedule another pass. One failed/uncertain
		// reply stops the pass so children never run ahead of an unaccepted parent.
		for (const event of await this.store.pending()) {
			this.assertActive();
			const entry = parseTimelineEntry(await this.transport.push(event, this.controller.signal));
			this.assertActive();
			if (entry.event.id !== event.id) throw new Error('Timeline server acknowledged a different event');
			await this.store.accept([entry]);
			accepted++;
		}
		let branchFailure: unknown;
		for (const command of commands) {
			this.assertActive();
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
		if (branchFailure) throw new TimelineBranchCommandRefusal('A branch push needs attention. Its selected version remains in History.');
		return accepted;
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
		const entry = parseTimelineEntry(await this.transport.entry(eventId, this.controller.signal)); this.assertActive();
		if (entry.event.id !== eventId) throw new Error('Server returned a different version');
		await this.store.accept([entry]); return entry;
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
		await this.store.accept(entries);
		return { entries, nextBefore: response.nextBefore, nextAfter: response.nextAfter, ...(related ? { related } : {}), ...(response.reset ? { reset: true } : {}) };
	}
}
