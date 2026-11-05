import { createSyncIgnorePolicy } from './syncIgnore';
import { openSyncJournal } from './journal.client';
import type { ConfirmedSyncCursor } from './pagedRunJournal';
import type { SyncOperation } from './execute';
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
			const observations = async function* (): AsyncGenerator<SyncEntry> {
				const left = entries(saved.run.plan.local), right = entries(saved.run.plan.remote);
				let a = await left.next(), b = await right.next();
				while (!a.done || !b.done) {
					const ak = a.done ? null : syncPathKey(a.value.path), bk = b.done ? null : syncPathKey(b.value.path);
					if (ak !== null && ak === bk && a.value!.path !== b.value!.path) throw Error('Sync progress filenames require collision review.');
					if (ak !== null && (bk === null || ak <= bk)) {
						yield a.value!; a = await left.next(); if (ak === bk) b = await right.next();
					} else { yield b.value!; b = await right.next(); }
				}
			};
			const early = await runs.earlyProgressSource(saved.run);
			const effects = async function* (): AsyncGenerator<SyncOperation> {
				if (!early) return;
				let next: ConfirmedSyncCursor | null = null;
				do {
					const page = await runs.readConfirmed(early, next ?? undefined);
					for (const { operation } of page.rows) yield operation;
					next = page.next;
				} while (next);
			};
			const left = observations(), right = effects();
			let a = await left.next(), b = await right.next();
			let batch: { entry: SyncEntry; observed: boolean; early?: SyncOperation }[] = [];
			const ignored = createSyncIgnorePolicy(saved.run.plan.ignoreRules, saved.run.plan.excludedPaths);
			const flush = async () => {
				const operations = await runs.operationsForPaths(saved.run, batch.map(({ entry }) => entry.path));
				return batch.map(({ entry, observed, early }, i): SyncProgressRow => {
					const operation = operations[i];
					return { entry: operation?.mutation.kind === 'copy' ? operation.mutation.source : operation?.mutation.kind === 'trash' ? operation.mutation.expected : entry,
						operation, early, observed, excluded: observed && ignored.ignored(entry.path, entry.kind) };
				});
			};
			while (!a.done || !b.done) {
				assertProgressScope(saved, currentScope); signal?.throwIfAborted();
				const ak = a.done ? null : syncPathKey(a.value.path), bk = b.done ? null : syncPathKey(b.value.mutation.path);
				if (ak !== null && (bk === null || ak <= bk)) {
					const entry = a.value!;
					if (ak === bk && entry.path !== b.value!.mutation.path) throw Error('Sync progress filenames require collision review.');
					batch.push({ entry, observed: true, ...(ak === bk ? { early: b.value! } : {}) });
					a = await left.next(); if (ak === bk) b = await right.next();
				} else {
					const early = b.value!, mutation = early.mutation;
					if (mutation.kind !== 'copy') throw Error('Early sync progress contains a deletion.');
					batch.push({ entry: mutation.source, observed: false, early }); b = await right.next();
				}
				if (batch.length === 128) { for (const row of await flush()) yield row; batch = []; }
			}
			if (batch.length) for (const row of await flush()) yield row;
			else await runs.operationsForPaths(saved.run, []);
		} finally { journal.close(); }
	} };
}
