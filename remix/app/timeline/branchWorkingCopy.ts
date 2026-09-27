import { branchEditableSnapshot, branchEditCommand } from './branchCheckout.ts';
import { parseTimelineBranchEntry, type TimelineBranchEntry, type TimelineBranchCommand } from './branches.ts';
import { TimelineDraftRecorder } from './draftRecorder.ts';
import type { TimelineLocalStore } from './localStore.ts';
import type { TimelineBranchStore } from './branchStore.ts';
import type { TimelineSync } from './sync.ts';
import type { TimelineEvent, TimelineSnapshot } from './contract.ts';

export type BranchConnection = { store: TimelineLocalStore; branches: TimelineBranchStore; sync: TimelineSync };
export type BranchSaveState = 'saved' | 'pending' | 'refused' | 'advanced';
/** Shared field/visual editing session. All durable state uses the existing
 * canonical event recorder, branch records and immutable command outbox. */
export class TimelineBranchWorkingCopy {
	target: TimelineBranchEntry;
	snapshot: TimelineSnapshot;
	private basis: TimelineSnapshot;
	private recorder: TimelineDraftRecorder;
	private resumed: string | null = null;
	private command: TimelineBranchCommand | null = null;
	private busy = false;
	private reconciling: Promise<BranchSaveState> | null = null;
	edited = false;
	constructor(readonly connection: BranchConnection, target: TimelineBranchEntry, snapshot: TimelineSnapshot, private knownBasis = true) {
		this.target = parseTimelineBranchEntry(target);
		if (this.target.branch.ownerId !== connection.store.scope.ownerId) throw new Error('Branch account changed.');
		this.snapshot = this.basis = branchEditableSnapshot(snapshot);
		this.recorder = this.newRecorder(target.head.eventId);
	}
	private newRecorder(parentId: string) {
		return new TimelineDraftRecorder(this.connection.store, this.target.head.thingId, this.target.branch.id, crypto.randomUUID(), parentId);
	}
	get saving() {
		return this.busy;
	}
	get locked() {
		return this.busy || !!this.command;
	}
	get hasUnwrittenChanges() {
		return this.recorder.hasUnwrittenChanges;
	}
	change(value: TimelineSnapshot, label = `Edit ${this.target.branch.name}`) {
		if (this.locked) throw new Error('Finish syncing this branch push before editing again.');
		const next = branchEditableSnapshot(value);
		const written = this.recorder.capture(this.snapshot, next, label);
		this.edited ||= JSON.stringify(this.snapshot) !== JSON.stringify(next);
		this.snapshot = next;
		return written;
	}
	resume(event: TimelineEvent) {
		if (this.locked) throw new Error('Finish syncing this branch push before resuming a draft.');
		if (
			event.ownerId !== this.target.branch.ownerId ||
			event.thingId !== this.target.head.thingId ||
			event.branchId !== this.target.branch.id ||
			!event.after ||
			event.mode !== 'draft'
		)
			throw new Error('This draft belongs to another branch.');
		this.snapshot = branchEditableSnapshot(event.after);
		this.resumed = event.id;
		this.recorder = this.newRecorder(event.id);
		this.edited = true;
	}
	async save(): Promise<BranchSaveState> {
		if (this.busy) throw new Error('This branch is already saving.');
		this.busy = true;
		try {
			await this.recorder.flush();
			const eventId = this.recorder.eventId ?? this.resumed;
			if (!eventId) return 'saved';
			this.command ??= branchEditCommand(this.target, eventId);
			await this.connection.branches.enqueue(this.command);
			try {
				await this.connection.sync.pushPending();
			} catch {
				/* The durable queue distinguishes refusal from uncertain transport. */
			}
			return await this.reconcile();
		} finally {
			this.busy = false;
		}
	}
	reconcile(): Promise<BranchSaveState> {
		this.reconciling ??= this.readReceipt().finally(() => {
			this.reconciling = null;
		});
		return this.reconciling;
	}
	private async readReceipt(): Promise<BranchSaveState> {
		if (!this.command) return 'saved';
		const pending = (await this.connection.branches.queued()).find((row) => row.command.operationId === this.command!.operationId);
		if (pending) return pending.failure ? 'refused' : 'pending';
		const acknowledged = (await this.connection.branches.forThing(this.target.head.thingId)).find(
			(entry) => entry.branch.id === this.target.branch.id
		);
		// The cache may already contain somebody else's later push. Keep this editor
		// fixed until explicitly reopened; never pretend its content is that head.
		if (!acknowledged || acknowledged.head.eventId !== this.command.eventId || acknowledged.head.revision !== this.command.expectedRevision + 1)
			return 'advanced';
		await this.connection.store.releaseDraft(this.command.eventId);
		this.target = acknowledged;
		this.knownBasis = true;
		this.basis = this.snapshot;
		this.recorder = this.newRecorder(acknowledged.head.eventId);
		this.command = null;
		this.resumed = null;
		this.edited = false;
		return 'saved';
	}
	async discard() {
		if (this.locked) throw new Error('Check the pending branch push before discarding.');
		if (!this.knownBasis) throw new Error('Reconnect and reopen this branch to load the saved version before discarding.');
		const written = this.change(this.basis, 'Discard branch edits');
		this.busy = true;
		try {
			await written;
			await this.recorder.flush();
			const eventId = this.recorder.eventId ?? this.resumed;
			if (eventId) await this.connection.store.releaseDraft(eventId);
			this.recorder = this.newRecorder(this.target.head.eventId);
			this.resumed = null;
			this.edited = false;
		} finally {
			this.busy = false;
		}
	}
}
