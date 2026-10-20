import { createSyncIgnorePolicy } from './syncIgnore';
import { openSyncJournal } from './journal.client';
import type { InventoryCursor, InventoryIdentity } from './inventoryJournal';
import { assertProgressScope, parseSyncProgressDescriptor, type SyncProgressDescriptor, type SyncProgressRow, type SyncProgressSource } from './progressProjection';
import { syncPathKey, type SyncEntry, type SyncScope } from './reconcile';

/** Each query owns its journal handle and abort signal. Stopping an uploader
 * does not revoke read access; account/origin/root changes do. */
export function createJournalSyncProgressSource(descriptor: SyncProgressDescriptor, currentScope: () => SyncScope,
	open: typeof openSyncJournal = openSyncJournal): SyncProgressSource {
	const saved = parseSyncProgressDescriptor(descriptor);
	return { async *rows(signal) {
		assertProgressScope(saved, currentScope); signal?.throwIfAborted();
		const journal = await open();
		try {
			const access = { scope: saved.scope, currentScope, signal }, inventory = journal.inventory(access), runs = journal.pagedRuns(access);
			if (saved.run.streaming) {
				let next: string | null = null;
				do {
					const page = await runs.streamEntries(saved.run, next ?? undefined);
					const operations = await runs.operationsForPaths(saved.run, page.entries.map(entry => entry.path));
					for (const [i, entry] of page.entries.entries()) yield { entry, operation: operations[i] };
					next = page.next;
				} while (next);
				return;
			}
			const entries = async function* (capture: InventoryIdentity): AsyncGenerator<SyncEntry> {
				let next: InventoryCursor | null = null;
				do { const page = await inventory.read(capture, next ?? undefined); for (const entry of page.entries) yield entry; next = page.next; } while (next);
			};
			const left = entries(saved.run.plan.local), right = entries(saved.run.plan.remote);
			let a = await left.next(), b = await right.next(), batch: SyncEntry[] = [];
			const ignored = createSyncIgnorePolicy(saved.run.plan.ignoreRules, saved.run.plan.excludedPaths);
			const flush = async () => {
				const operations = await runs.operationsForPaths(saved.run, batch.map(entry => entry.path));
				return batch.map((entry, i): SyncProgressRow => {
					const operation = operations[i];
					return { entry: operation?.mutation.kind === 'copy' ? operation.mutation.source : operation?.mutation.kind === 'trash' ? operation.mutation.expected : entry,
						operation, excluded: ignored.ignored(entry.path, entry.kind) };
				});
			};
			while (!a.done || !b.done) {
				assertProgressScope(saved, currentScope); signal?.throwIfAborted();
				// IndexedDB string keys use code-unit order, not locale order.
				const order = a.done ? 1 : b.done ? -1 : syncPathKey(a.value.path) < syncPathKey(b.value.path) ? -1 : syncPathKey(a.value.path) > syncPathKey(b.value.path) ? 1 : 0;
				if (order === 0) {
					if (a.value!.path !== b.value!.path) throw Error('Sync progress filenames require collision review.');
					batch.push(a.value!); a = await left.next(); b = await right.next();
				} else if (order < 0) { batch.push(a.value!); a = await left.next(); }
				else { batch.push(b.value!); b = await right.next(); }
				if (batch.length === 128) { for (const row of await flush()) yield row; batch = []; }
			}
			if (batch.length) for (const row of await flush()) yield row;
			// Even an empty inventory must verify the selected run exists.
			else await runs.operationsForPaths(saved.run, []);
		} finally { journal.close(); }
	} };
}
