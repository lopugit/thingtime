import { timelineScopeKey, type TimelineScope } from './contract.ts';
import { parseTimelineBranch, parseTimelineBranchHead, parseTimelineBranchEntry, parseTimelineBranchCommand, type TimelineBranch, type TimelineBranchHead, type TimelineBranchCommand, type TimelineBranchEntry } from './branches.ts';

export const TIMELINE_BRANCH_CACHE_HEADS = 160;
export const TIMELINE_BRANCH_PENDING_LIMIT = 128;
export type QueuedBranchCommand = { command: TimelineBranchCommand; failure?: { status: number; message: string } | null };
export type BranchLocalState = {
	branches: { scope: string; branch: TimelineBranch; accessedAt: number }[];
	heads: { scope: string; head: TimelineBranchHead; accessedAt: number }[];
	pending: (QueuedBranchCommand & { scope: string; queuedAt: number })[];
};
export interface TimelineBranchBackend {
	readBranchState(scope: string): Promise<BranchLocalState>;
	changeBranchState(scope: string, update: (state: BranchLocalState) => BranchLocalState): Promise<void>;
}

/** These arrays are bounded in-memory transaction views. Each contained
 * branch, head and queued command is its own IndexedDB record. */
export class TimelineBranchStore {
	readonly key: string;
	constructor(readonly scope: TimelineScope, private backend: TimelineBranchBackend, private now = Date.now) { this.key = timelineScopeKey(scope); this.scope = Object.freeze({ ...scope }); }
	private validate(input: BranchLocalState): BranchLocalState {
		if (input.heads.length > TIMELINE_BRANCH_CACHE_HEADS || input.branches.length > TIMELINE_BRANCH_CACHE_HEADS + TIMELINE_BRANCH_PENDING_LIMIT || input.pending.length > TIMELINE_BRANCH_PENDING_LIMIT) throw new Error('Timeline branch cache is damaged. Pending commands are preserved.');
		const check = (scope: string, ownerId?: string, at?: number) => {
			if (scope !== this.key || (ownerId !== undefined && ownerId !== this.scope.ownerId) || !Number.isFinite(at)) throw new Error('Timeline branch cache scope is damaged. Pending commands are preserved.');
		};
		return {
			branches: input.branches.map(row => { const branch = parseTimelineBranch(row.branch); check(row.scope, branch.ownerId, row.accessedAt); return { ...row, branch }; }),
			heads: input.heads.map(row => { const head = parseTimelineBranchHead(row.head); check(row.scope, head.ownerId, row.accessedAt); return { ...row, head }; }),
			pending: input.pending.map(row => { check(row.scope, undefined, row.queuedAt); if (row.failure && (![400, 404, 409, 413, 422].includes(row.failure.status) || typeof row.failure.message !== 'string' || row.failure.message.length > 512)) throw new Error('Invalid branch failure record'); return { ...row, command: parseTimelineBranchCommand(row.command) }; })
		};
	}
	private change(update: (state: BranchLocalState) => BranchLocalState) { return this.backend.changeBranchState(this.key, state => this.validate(update(this.validate(state)))); }
	async enqueue(input: TimelineBranchCommand): Promise<void> {
		const command = parseTimelineBranchCommand(input);
		await this.change(state => {
			const old = state.pending.find(row => row.command.operationId === command.operationId);
			if (old) { if (JSON.stringify(old.command) !== JSON.stringify(command)) throw new Error('Branch operation identity was reused with different content'); return state; }
			if (state.pending.length >= TIMELINE_BRANCH_PENDING_LIMIT) throw new Error('Too many branch commands are waiting. Reconnect to push them first.');
			const queuedAt = Math.max(this.now(), ...state.pending.map(row => row.queuedAt + 1));
			return { ...state, pending: [...state.pending, { scope: this.key, command, queuedAt }] };
		});
	}
	async pending(): Promise<TimelineBranchCommand[]> {
		const state = this.validate(await this.backend.readBranchState(this.key));
		return state.pending.filter(row => !row.failure).sort((a, b) => a.queuedAt - b.queuedAt).map(row => row.command);
	}
	async queued(): Promise<QueuedBranchCommand[]> { return this.validate(await this.backend.readBranchState(this.key)).pending.map(({ command, failure }) => ({ command, failure })); }
	async reject(operationId: string, status: number, message: string) {
		if (![400, 404, 409, 413, 422].includes(status)) throw new Error('An uncertain branch command must remain pending');
		await this.change(state => ({ ...state, pending: state.pending.map(row => row.command.operationId === operationId ? { ...row, failure: { status, message: message.slice(0, 512) } } : row) }));
	}
	async retryRejected(operationId: string) { await this.change(state => ({ ...state, pending: state.pending.map(row => row.command.operationId === operationId ? { ...row, failure: null } : row) })); }
	/** Only a definitive server refusal can be dismissed. An uncertain commit
 * keeps its original request identity until its result has been reconciled. */
	async dismissRejected(operationId: string) {
		await this.change(state => {
			if (state.pending.some(row => row.command.operationId === operationId && !row.failure)) throw new Error('Sync this command to check its result before dismissing it');
			return { ...state, pending: state.pending.filter(row => row.command.operationId !== operationId) };
		});
	}
	async forThing(thingId: string): Promise<TimelineBranchEntry[]> {
		const state = this.validate(await this.backend.readBranchState(this.key));
		const branches = new Map(state.branches.map(row => [row.branch.id, row.branch]));
		return state.heads.filter(row => row.head.thingId === thingId).map(row => {
			const branch = branches.get(row.head.branchId); if (!branch) throw new Error('Timeline branch metadata is missing'); return { branch, head: row.head };
		});
	}
	async accept(inputs: TimelineBranchEntry[], operationId?: string): Promise<void> {
		const entries = inputs.map(parseTimelineBranchEntry);
		if (entries.length > 40 || entries.some(entry => entry.branch.ownerId !== this.scope.ownerId)) throw new Error('Invalid branch response scope');
		await this.change(state => {
			const command = operationId ? state.pending.find(row => row.command.operationId === operationId)?.command : null;
			if (command && (entries.length !== 1 || entries[0].branch.id !== command.branchId || entries[0].head.thingId !== command.thingId || entries[0].head.eventId !== command.eventId || entries[0].head.revision !== command.expectedRevision + 1 || (command.command === 'create-branch' && entries[0].branch.name !== command.name))) throw new Error('Server acknowledged a different branch command');
			const branches = new Map(state.branches.map(row => [row.branch.id, row])); const heads = new Map(state.heads.map(row => [row.head.id, row]));
			for (const entry of entries) {
				const oldBranch = branches.get(entry.branch.id); const oldHead = heads.get(entry.head.id);
				if (oldBranch && JSON.stringify(oldBranch.branch) !== JSON.stringify(entry.branch)) throw new Error('Immutable branch identity changed');
				if (oldHead?.head.revision === entry.head.revision && JSON.stringify(oldHead.head) !== JSON.stringify(entry.head)) throw new Error('Branch revision identity changed');
				branches.set(entry.branch.id, { scope: this.key, branch: entry.branch, accessedAt: this.now() });
				if (!oldHead || oldHead.head.revision <= entry.head.revision) heads.set(entry.head.id, { scope: this.key, head: entry.head, accessedAt: this.now() });
			}
			const keptHeads = [...heads.values()].sort((a, b) => b.accessedAt - a.accessedAt || b.head.updatedAt.localeCompare(a.head.updatedAt)).slice(0, TIMELINE_BRANCH_CACHE_HEADS);
			const pending = state.pending.filter(row => row.command.operationId !== operationId);
			const keptIds = new Set([...keptHeads.map(row => row.head.branchId), ...pending.map(row => row.command.branchId)]);
			return { branches: [...branches.values()].filter(row => keptIds.has(row.branch.id)), heads: keptHeads, pending };
		});
	}
	/** Dropping downloaded branch labels/heads never discards queued work. */
	async clearCache() { await this.change(state => ({ ...state, branches: [], heads: [] })); }
}
