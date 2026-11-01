import { openSyncJournal } from './journal.client';
import { inventoryIdentity } from './inventoryJournal';
import type { SyncInventoryDescriptor } from './foregroundSync';
import { sameSyncScope, validateSyncScope, type SyncScope } from './reconcile';

export type BackupCoverageDescriptor = SyncInventoryDescriptor;
export function parseBackupCoverageDescriptor(value: unknown): BackupCoverageDescriptor {
	const input = value as BackupCoverageDescriptor;
	if (!input || typeof input !== 'object') throw Error('Invalid backup coverage reference.');
	validateSyncScope(input.scope);
	const inventory = inventoryIdentity(input.inventory);
	if (inventory.source !== 'local') throw Error('Backup coverage requires a local inventory.');
	return { scope: structuredClone(input.scope), inventory };
}

/** A bounded, independently fenced view of the existing durable skip ledger. */
export async function readBackupCoveragePage(value: BackupCoverageDescriptor, currentScope: () => SyncScope,
	offset = 0, signal?: AbortSignal, open: typeof openSyncJournal = openSyncJournal) {
	const descriptor = parseBackupCoverageDescriptor(value);
	const check = () => {
		signal?.throwIfAborted();
		if (!sameSyncScope(descriptor.scope, currentScope())) throw Error('The backup account or folder changed.');
		return descriptor.scope;
	};
	check();
	const journal = await open();
	try {
		check();
		const inventory = journal.inventory({ scope: descriptor.scope, currentScope: check, signal });
		const page = await inventory.readSkips(descriptor.inventory, offset);
		check(); return page;
	} finally { journal.close(); }
}
