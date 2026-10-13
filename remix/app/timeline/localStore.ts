import {
	parseTimelineEntry, parseTimelineEvent, timelineEventText, timelineScopeKey,
	type TimelineEntry, type TimelineEvent, type TimelineReceipt, type TimelineScope
} from './contract.ts';
import { parseActionOutcomeRecovery, type ActionOutcomeRecovery } from './actionRecovery.ts';

/** Queue/view aggregate with local bookkeeping. The durable IndexedDB backend
 * stores its event and individual links using the shared records.ts schemas. */
export type LocalTimelineRow = {
	scope: string; event: TimelineEvent; receipt: TimelineReceipt | null;
	status: 'pending' | 'accepted'; accessedAt: number; bytes: number; draftKey?: string | null;
	recoveryProof?: string;
};
/** Small, atomically maintained index. Quota checks and pruning never load all
 * snapshot payloads or rewrite them just to touch an access timestamp. */
export type TimelineLocalIndex = Omit<LocalTimelineRow, 'event' | 'recoveryProof'> & { id: string; thingId: string; occurredAt: string };
export type TimelineLocalSelection = { thingId?: string; thingIds?: string[]; status?: 'pending' | 'accepted'; draftKey?: string };
export type TimelineLocalTransaction = { put: LocalTimelineRow[]; remove: string[]; touch?: { id: string; accessedAt: number; draftKey?: string | null }[] };
export interface TimelineLocalBackend {
	read(scope: string, selection?: TimelineLocalSelection): Promise<LocalTimelineRow[]>;
	/** Atomic across tabs. Load payloads ONLY for ids whose identity is checked. */
	change(scope: string, payloadIds: string[], update: (index: TimelineLocalIndex[], existing: LocalTimelineRow[]) => TimelineLocalTransaction): Promise<void>;
}
export const TIMELINE_CACHE_MAX_BYTES = 24 * 1024 * 1024;
export const TIMELINE_CACHE_MAX_EVENTS = 160;
export const TIMELINE_PENDING_MAX_BYTES = 64 * 1024 * 1024;
export const TIMELINE_PENDING_MAX_EVENTS = 2000;

export function timelineLocalIndex(row: LocalTimelineRow): TimelineLocalIndex {
	return { scope: row.scope, id: row.event.id, thingId: row.event.thingId, occurredAt: row.event.occurredAt, receipt: row.receipt, status: row.status, accessedAt: row.accessedAt, bytes: row.bytes, draftKey: row.draftKey ?? null };
}
export function validateTimelineIndex(index: TimelineLocalIndex, scope: string): void {
	if (index.scope !== scope || !index.id || !index.thingId || !Number.isSafeInteger(index.bytes) || index.bytes < 1 || !Number.isFinite(index.accessedAt) ||
		(index.status !== 'pending' && index.status !== 'accepted') || (index.status === 'pending' ? index.receipt !== null : !index.receipt || index.receipt.eventId !== index.id || !Number.isSafeInteger(index.receipt.position)))
		throw new Error('Timeline local index is damaged. Pending changes have been preserved.');
}
export function validateTimelineRow(row: LocalTimelineRow, scope: string): LocalTimelineRow {
	validateTimelineIndex(timelineLocalIndex(row), scope);
	const event = row.receipt ? parseTimelineEntry({ event: row.event, receipt: row.receipt }).event : parseTimelineEvent(row.event);
	if (row.recoveryProof !== undefined) {
		if (row.status !== 'pending') throw new Error('Accepted Timeline records cannot retain delivery proofs');
		parseActionOutcomeRecovery({ formatVersion: 1, event, dataPlane: JSON.parse(scope)[1], proof: row.recoveryProof });
	}
	if (row.bytes !== rowBytes(event, row.receipt, row.recoveryProof)) throw new Error('Timeline local record is damaged. Pending changes have been preserved.');
	return { ...row, event };
}
const assertIdentity = (existing: LocalTimelineRow | undefined, event: TimelineEvent) => {
	if (existing && timelineEventText(existing.event) !== timelineEventText(event)) throw new Error('Timeline event identity was reused with different content');
};
const assertOwner = (scope: TimelineScope, event: TimelineEvent) => {
	if (event.ownerId !== scope.ownerId) throw new Error('Timeline event belongs to another account');
};
const rowBytes = (event: TimelineEvent, receipt: TimelineReceipt | null, recoveryProof?: string) => new TextEncoder().encode(JSON.stringify({ event, receipt, ...(recoveryProof === undefined ? {} : { recoveryProof }) })).byteLength;
const rowFor = (scope: string, event: TimelineEvent, receipt: TimelineReceipt | null, now: number, recoveryProof?: string): LocalTimelineRow => ({
	scope, event, receipt, status: receipt ? 'accepted' : 'pending', accessedAt: now,
	bytes: rowBytes(event, receipt, recoveryProof), ...(recoveryProof === undefined ? {} : { recoveryProof })
});

export class TimelineLocalStore {
	readonly key: string;
	constructor(readonly scope: TimelineScope, private backend: TimelineLocalBackend, private now = Date.now) {
		this.key = timelineScopeKey(scope); this.scope = Object.freeze({ ...scope });
	}
	private change(ids: string[], update: Parameters<TimelineLocalBackend['change']>[2]) {
		return this.backend.change(this.key, ids, (index, rows) => {
			index.forEach(item => validateTimelineIndex(item, this.key));
			const existing = rows.map(row => validateTimelineRow(row, this.key));
			existing.forEach(row => assertOwner(this.scope, row.event));
			return update(index, existing);
		});
	}
	async enqueue(input: TimelineEvent, options: { pinDraft?: boolean } = {}): Promise<void> {
		const event = parseTimelineEvent(input); assertOwner(this.scope, event);
		if (event.source !== 'client' || event.actorId !== this.scope.ownerId) throw new Error('Only this account’s client events can be queued');
		const row = rowFor(this.key, event, null, this.now());
		const draftKey = options.pinDraft ? JSON.stringify([event.thingId, event.branchId]) : null;
		if (draftKey && event.mode !== 'draft') throw new Error('Only a draft can be pinned for recovery');
		row.draftKey = draftKey;
		await this.change([event.id], (index, rows) => {
			const existing = rows.find(item => item.event.id === event.id); assertIdentity(existing, event);
			if (existing) return { put: [], remove: [] };
			const pending = index.filter(item => item.status === 'pending' || (item.draftKey && item.draftKey !== draftKey));
			if (pending.length >= TIMELINE_PENDING_MAX_EVENTS || pending.reduce((bytes, item) => bytes + item.bytes, row.bytes) > TIMELINE_PENDING_MAX_BYTES)
				throw new Error('Timeline local storage is full. Reconnect to sync pending changes.');
			return { put: [row], remove: [], touch: draftKey ? index.filter(item => item.draftKey === draftKey).map(item => ({ id: item.id, accessedAt: item.accessedAt, draftKey: null })) : [] };
		});
	}
	async accept(inputs: TimelineEntry[]): Promise<void> {
		const entries = inputs.map(parseTimelineEntry); entries.forEach(({ event }) => assertOwner(this.scope, event));
		await this.change(entries.map(entry => entry.event.id), (index, rows) => {
			const byId = new Map(rows.map(row => [row.event.id, row]));
			const put = new Map<string, LocalTimelineRow>();
			for (const { event, receipt } of entries) {
				const existing = byId.get(event.id); assertIdentity(existing, event);
				if (existing?.receipt && JSON.stringify(existing.receipt) !== JSON.stringify(receipt)) throw new Error('Timeline receipt identity changed');
				const row = rowFor(this.key, event, receipt, this.now()); row.draftKey = index.find(item => item.id === event.id)?.draftKey ?? null; byId.set(event.id, row); put.set(event.id, row);
			}
			return { put: [...put.values()], remove: [] };
		});
		await this.prune();
	}
	/** Server-attested outcomes enter the SAME durable, bounded outbox. Ordinary
	 * enqueue remains client-only; proof verification is always server-side. */
	async enqueueRecovery(input: ActionOutcomeRecovery): Promise<void> {
		const recovery = parseActionOutcomeRecovery(input); const { event, proof } = recovery;
		assertOwner(this.scope, event);
		if (recovery.dataPlane !== this.scope.dataPlane) throw new Error('Action history belongs to another database');
		const row = rowFor(this.key, event, null, this.now(), proof);
		await this.change([event.id], (index, rows) => {
			const existing = rows.find(item => item.event.id === event.id); assertIdentity(existing, event);
			if (existing) return { put: [], remove: [] };
			const pending = index.filter(item => item.status === 'pending' || item.draftKey);
			if (pending.length >= TIMELINE_PENDING_MAX_EVENTS || pending.reduce((bytes, item) => bytes + item.bytes, row.bytes) > TIMELINE_PENDING_MAX_BYTES)
				throw new Error('Timeline local storage is full. Reconnect to sync pending changes.');
			return { put: [row], remove: [] };
		});
	}
	private async read(selection?: TimelineLocalSelection) {
		return (await this.backend.read(this.key, selection)).map(row => { const checked = validateTimelineRow(row, this.key); assertOwner(this.scope, checked.event); return checked; });
	}
	/** Exact bounded batch read for immutable dependency records. */
	async entries(ids: string[]): Promise<LocalTimelineRow[]> {
		if (ids.length > 128 || new Set(ids).size !== ids.length) throw new Error('Invalid Timeline dependency batch');
		let found: LocalTimelineRow[] = [];
		await this.change(ids, (_index, rows) => { found = rows; return { put: [], remove: [], touch: rows.map(row => ({ id: row.event.id, accessedAt: this.now() })) }; });
		return found;
	}

	async pending(): Promise<TimelineEvent[]> {
		return (await this.pendingWrites()).map(row => row.event);
	}
	async pendingWrites(): Promise<LocalTimelineRow[]> {
		const rows = await this.read({ status: 'pending' });
		const pending = new Map(rows.map(row => [row.event.id, row.event]));
		const ordered: TimelineEvent[] = []; const visiting = new Set<string>();
		const visit = (event: TimelineEvent) => {
			if (!pending.has(event.id)) return;
			if (visiting.has(event.id)) throw new Error('Timeline pending graph contains a cycle');
			visiting.add(event.id);
			for (const parent of [...event.parentIds, ...event.dependencies.map(dependency => dependency.eventId)]) { const dependency = pending.get(parent); if (dependency) visit(dependency); }
			visiting.delete(event.id); pending.delete(event.id); ordered.push(event);
		};
		for (const event of [...pending.values()]) visit(event);
		const byId = new Map(rows.map(row => [row.event.id, row]));
		return ordered.map(event => byId.get(event.id)!);
	}
	async forThing(thingId: string | null): Promise<LocalTimelineRow[]> {
		return this.forSelection(thingId === null ? undefined : { thingId });
	}
	async forThings(thingIds: string[]): Promise<LocalTimelineRow[]> {
		if (!thingIds.length || thingIds.length > 128 || new Set(thingIds).size !== thingIds.length || thingIds.some(id => !id || id.length > 200)) throw new Error('Invalid Timeline view targets');
		return this.forSelection({ thingIds });
	}
	private async forSelection(selection?: TimelineLocalSelection): Promise<LocalTimelineRow[]> {
		const result = await this.read(selection);
		await this.change([], () => ({ put: [], remove: [], touch: result.map(row => ({ id: row.event.id, accessedAt: this.now() })) }));
		return result.sort((a, b) => (b.receipt?.position ?? Number.MAX_SAFE_INTEGER) - (a.receipt?.position ?? Number.MAX_SAFE_INTEGER) || b.event.occurredAt.localeCompare(a.event.occurredAt));
	}
	async draft(thingId: string, branchId: string): Promise<TimelineEvent | null> {
		const rows = await this.read({ draftKey: JSON.stringify([thingId, branchId]) });
		if (rows.length > 1) throw new Error('Timeline has conflicting draft pointers. Open History to recover them.');
		return rows[0]?.event ?? null;
	}
	/** A save clears only the draft it published, never edits made while saving. */
	async releaseDraft(eventId: string): Promise<void> {
		await this.change([], index => ({ put: [], remove: [], touch: index.filter(item => item.id === eventId && item.draftKey).map(item => ({ id: item.id, accessedAt: item.accessedAt, draftKey: null })) }));
	}
	/** Clearing cache never deletes pending work or remote history. */
	async prune(maxEvents = TIMELINE_CACHE_MAX_EVENTS, maxBytes = TIMELINE_CACHE_MAX_BYTES): Promise<void> {
		await this.change([], index => {
			const cached = index.filter(row => row.status === 'accepted' && !row.draftKey).sort((a, b) => b.accessedAt - a.accessedAt || b.receipt!.position - a.receipt!.position);
			let bytes = 0; let count = 0; const remove: string[] = [];
			for (const row of cached) {
				if (count >= maxEvents || bytes + row.bytes > maxBytes) remove.push(row.id);
				else { bytes += row.bytes; count++; }
			}
			return { put: [], remove };
		});
	}
}
