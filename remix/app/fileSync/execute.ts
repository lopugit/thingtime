import { MAX_SYNC_SCAN_ENTRIES, sameSyncContent, sameSyncScope, sameSyncStamp, validSyncEntry, validateSyncScope, type SyncDecision, type SyncEntry, type SyncPlan, type SyncScope, type SyncSide } from './reconcile';

export type SyncMutation = Extract<SyncDecision, { kind: 'copy' | 'trash' }>;
export type SyncOperation = { id: string; mutation: SyncMutation; confirmed: boolean };
export type SyncRun = { version: 1; id: string; scope: SyncScope; operations: SyncOperation[] };
export type SyncReceipt = { operationId: string; scope: SyncScope; entry: SyncEntry | null };
export type SyncReceiptLookup = { status: 'missing' } | { status: 'pending' } | { status: 'complete'; receipt: SyncReceipt };

/** Native adapters must durably deduplicate IDs, enforce destination CAS and
 * source version/hash checks, stage verified bytes before publication, and
 * trash recoverably (folders only when empty). The account/API adapter must
 * call the normal authorized, accounted file writers and Timeline recording.
 * These guarantees cannot be implemented by a read followed by blind overwrite.
 */
export type SyncExecutionPort = {
	currentScope(): SyncScope;
	read(side: SyncSide, path: string): Promise<SyncEntry | null>;
	lookup(operationId: string, scope: SyncScope): Promise<SyncReceiptLookup>;
	apply(operation: SyncOperation, scope: SyncScope): Promise<SyncReceipt>;
	/** Resolve only after the complete immutable run is durable. Must serialize
	 * one runner per root (native lock / browser Web Lock), including restarts. */
	persist(run: SyncRun): Promise<void>;
};

const depth = (path: string) => path.split('/').length;
const order = (a: SyncMutation, b: SyncMutation): number => {
	if (a.kind !== b.kind) return a.kind === 'copy' ? -1 : 1;
	// Build parents first; remove children before empty parents. No destructive
	// work begins until every copy has a durable confirmation.
	const difference = depth(a.path) - depth(b.path);
	if (difference) return a.kind === 'copy' ? difference : -difference;
	return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
};

/** Validate persisted state before trusting it after a restart or migration. */
export const validateSyncRun = (run: SyncRun): void => {
	if (!run || run.version !== 1 || !Array.isArray(run.operations) || run.operations.length > MAX_SYNC_SCAN_ENTRIES) throw new Error('Invalid persisted sync run.');
	validateSyncScope(run.scope);
	const ids = new Set<string>();
	for (const id of [run.id, ...run.operations.map(operation => operation?.id)]) {
		if (typeof id !== 'string' || !id || id.length > 128 || ids.has(id)) throw new Error('Invalid persisted sync identity.');
		ids.add(id);
	}
	const paths = new Set<string>();
	for (let i = 0; i < run.operations.length; i++) {
		const operation = run.operations[i], m = operation.mutation;
		if (!m || typeof operation.confirmed !== 'boolean' || paths.has(m.path)) throw new Error('Invalid persisted sync mutation.');
		paths.add(m.path);
		if (m.kind === 'copy') {
			if (!['local', 'remote'].includes(m.from) || !validSyncEntry(m.source) || m.source.path !== m.path ||
				(m.expectedTarget !== null && (!validSyncEntry(m.expectedTarget) || m.expectedTarget.path !== m.path))) throw new Error('Invalid persisted sync copy.');
		} else if (m.kind !== 'trash' || !['local', 'remote'].includes(m.side) || !validSyncEntry(m.expected) || m.expected.path !== m.path) throw new Error('Invalid persisted sync deletion.');
		if (i && (order(run.operations[i - 1].mutation, m) > 0 || (!run.operations[i - 1].confirmed && operation.confirmed))) throw new Error('Invalid persisted sync order.');
	}
};

export const createSyncRun = (plan: SyncPlan, uuid: () => string = () => crypto.randomUUID()): SyncRun => {
	if (plan.decisions.some(decision => decision.kind === 'conflict')) throw new Error('Resolve sync conflicts before applying this plan.');
	const ids = new Set<string>();
	const nextId = () => {
		const value = uuid();
		if (!value || ids.has(value)) throw new Error('Sync operation IDs must be unique.');
		ids.add(value); return value;
	};
	const run: SyncRun = { version: 1, id: nextId(), scope: { ...plan.scope }, operations: plan.decisions
		.filter((decision): decision is SyncMutation => decision.kind === 'copy' || decision.kind === 'trash')
		.sort(order).map(mutation => ({ id: nextId(), mutation: structuredClone(mutation), confirmed: false })) };
	validateSyncRun(run);
	return run;
};

/** An interrupted/uncertain run is resumed with the SAME persisted record.
 * In particular, never rebuild a plan and generate new IDs after a lost reply.
 */
export const executeSyncRun = async (saved: SyncRun, port: SyncExecutionPort, signal?: AbortSignal): Promise<SyncRun> => {
	const run = structuredClone(saved);
	validateSyncRun(run);
	const check = () => {
		signal?.throwIfAborted();
		if (!sameSyncScope(run.scope, port.currentScope())) throw new Error('Sync context changed.');
	};
	const durable = async () => { check(); await port.persist(structuredClone(run)); check(); };
	check();
	// Even a brand-new run reaches durable storage before its first byte moves.
	await durable();
	for (const operation of run.operations) {
		check();
		if (operation.confirmed) continue;
		const previous = await port.lookup(operation.id, run.scope); check();
		if (previous.status === 'pending') throw new Error('Sync operation is still pending; resume this run later.');
		let receipt: SyncReceipt;
		if (previous.status === 'complete') receipt = previous.receipt;
		else {
			const mutation = operation.mutation;
			const local = await port.read('local', mutation.path); check();
			const remote = await port.read('remote', mutation.path); check();
			if (mutation.kind === 'copy') {
				if (!sameSyncStamp(mutation.source, mutation.from === 'local' ? local : remote) ||
					!sameSyncStamp(mutation.expectedTarget, mutation.from === 'local' ? remote : local)) throw new Error('Sync file changed; preserve this run and reconcile before retrying.');
			} else if (!sameSyncStamp(mutation.expected, mutation.side === 'local' ? local : remote) ||
				(mutation.side === 'local' ? remote : local) !== null) throw new Error('Sync deletion changed; preserve the file and reconcile before retrying.');
			receipt = await port.apply(structuredClone(operation), run.scope); check();
		}
		if (receipt.operationId !== operation.id || !sameSyncScope(receipt.scope, run.scope)) throw new Error('Invalid sync receipt identity.');
		const mutation = operation.mutation;
		if (mutation.kind === 'trash' ? receipt.entry !== null : !receipt.entry || !validSyncEntry(receipt.entry) || receipt.entry.path !== mutation.path || !sameSyncContent(receipt.entry, mutation.source)) throw new Error('Sync receipt does not confirm the requested content.');
		operation.confirmed = true;
		await durable();
	}
	return run;
};
