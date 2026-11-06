import { createSyncIgnorePolicy } from './syncIgnore';
import { openSyncJournal } from './journal.client';
import type { ConfirmedSyncCursor, ConfirmedHistoryTotals } from './pagedRunJournal';
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

            const histories = async function* (): AsyncGenerator<{ entry: SyncEntry; history: ConfirmedHistoryTotals }> {
                if (!early) return;
                let next: string | null = null;
                do {
                    const page = await runs.confirmedHistoryPage(early, next ?? undefined);
                    for (const row of page.rows) yield row;
                    next = page.next;
                } while (next);
            };
            const left = observations(), right = effects(), history = histories();
            let a = await left.next(), b = await right.next(), c = await history.next();
            let batch: { entry: SyncEntry; observed: boolean; early?: SyncOperation; history?: ConfirmedHistoryTotals }[] = [];
            const ignored = createSyncIgnorePolicy(saved.run.plan.ignoreRules, saved.run.plan.excludedPaths);
            const flush = async () => {
                const operations = await runs.operationsForPaths(saved.run, batch.map(({ entry }) => entry.path));
                return batch.map(({ entry, observed, early, history }, i): SyncProgressRow => {
                    const operation = operations[i];
                    return { entry: operation?.mutation.kind === 'copy' ? operation.mutation.source : operation?.mutation.kind === 'trash' ? operation.mutation.expected : entry,
                        operation, early, history, observed, excluded: observed && ignored.ignored(entry.path, entry.kind) };
                });
            };
            while (!a.done || !b.done || !c.done) {
                assertProgressScope(saved, currentScope); signal?.throwIfAborted();
                const paths = [a.done ? null : a.value.path, b.done ? null : b.value.mutation.path, c.done ? null : c.value.entry.path];
                const keys = paths.map(path => path === null ? null : syncPathKey(path));
                const first = keys.filter((key): key is string => key !== null).sort()[0];
                const selected = keys.map(key => key === first), path = paths[selected.indexOf(true)]!;
                if (paths.some((name, i) => selected[i] && name !== path)) throw Error('Sync progress filenames require collision review.');
                const effect = selected[1] ? b.value! : undefined, historical = selected[2] ? c.value! : undefined;
                if (effect && effect.mutation.kind !== 'copy') throw Error('Early sync progress contains a deletion.');
                const entry = selected[0] ? a.value! : effect?.mutation.kind === 'copy' ? effect.mutation.source : historical!.entry;
                batch.push({ entry, observed: selected[0], early: effect, history: historical?.history });
                if (selected[0]) a = await left.next();
                if (selected[1]) b = await right.next();
                if (selected[2]) c = await history.next();
                if (batch.length === 128) { for (const row of await flush()) yield row; batch = []; }
            }

			if (batch.length) for (const row of await flush()) yield row;
			else await runs.operationsForPaths(saved.run, []);
		} finally { journal.close(); }
	} };
}
