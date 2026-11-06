import { captureComponentBindings, type ComponentBindings } from './componentBindings.ts';
import { parseTimelineEvent, timelineScopeKey, type TimelineEvent } from './contract.ts';
import type { TimelineLocalStore } from './localStore.ts';

/** Serializes a draft's local writes. Failed writes remain queued with their
 * original ids; retry cannot orphan children or invent a second operation. */
export class TimelineDraftRecorder {
	private queued: TimelineEvent[] = [];
	private running: Promise<void> | null = null;
	private head: string | null;
	private last: string | null = null;
	private bindingEvents: TimelineEvent[] = [];
	private latest: TimelineEvent | null = null;
	dependencies: TimelineEvent['dependencies'] = [];
	private captureFailure: unknown = null;
	constructor(public store: TimelineLocalStore | null, readonly thingId: string, readonly branchId: string, readonly clientId: string, parentId: string | null = null, private uuid: () => string = () => crypto.randomUUID(), private now = () => new Date().toISOString(), private ownerId = store?.scope.ownerId) { this.head = parentId; }
	connect(store: TimelineLocalStore) {
		if (store.scope.ownerId !== this.ownerId || (this.store && timelineScopeKey(this.store.scope) !== timelineScopeKey(store.scope))) throw new Error('Draft account or data source changed.');
		this.store = store;
	}
	capture(before: unknown, after: unknown, label: string, components?: ComponentBindings): Promise<string | null> {
		let event: TimelineEvent;
		try { event = parseTimelineEvent({
			formatVersion: 1, id: this.uuid(), ownerId: this.ownerId, actorId: this.ownerId,
			thingId: this.thingId, branchId: this.branchId, parentIds: this.head ? [this.head] : [], operationId: this.uuid(),
			source: 'client', clientId: this.clientId, occurredAt: this.now(), mode: 'draft', operation: 'update', label, before, after, dependencies: this.dependencies
		});
		if (components !== undefined) {
			const captured = captureComponentBindings(event, components, this.bindingEvents, () => this.uuid());
			event = parseTimelineEvent({ ...event, dependencies: captured.dependencies });
			const known = new Set(this.bindingEvents.map(item => item.id));
			this.queued.push(...captured.events.filter(item => !known.has(item.id)));
			this.bindingEvents = captured.events;
		}
		} catch (error) { this.captureFailure = error; throw error; }
		this.captureFailure = null;
		if (JSON.stringify(event.before) === JSON.stringify(event.after) && JSON.stringify(event.dependencies) === JSON.stringify(this.dependencies)) return this.flush().then(() => this.last);
		this.dependencies = event.dependencies; this.latest = event;
		this.queued.push(event); this.head = event.id;
		return this.flush().then(() => event.id);
	}
	flush(): Promise<void> {
		if (this.captureFailure) return Promise.reject(this.captureFailure);
		if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
		return this.running.then(() => this.queued.length ? this.flush() : undefined);
	}
	private async drain() {
		while (this.queued.length) {
			const event = this.queued[0];
			if (!this.store) throw new Error('Timeline is still connecting. Keep this editor open until your changes are saved on this device.');
			const isDraft = event.thingId === this.thingId && event.branchId === this.branchId;
			await this.store.enqueue(event, { pinDraft: isDraft });
			if (isDraft) this.last = event.id; this.queued.shift();
		}
	}
	get capturedEvent() { return this.latest; }
	get eventId() { return this.last; }
	/** Capture before awaiting a save barrier: later edits must keep their pin. */
	get capturedEventId() { return this.queued[this.queued.length - 1]?.id ?? this.last; }
	get hasUnwrittenChanges() { return this.queued.length > 0; }
}
