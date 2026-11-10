// Generated-data browser acceptance only; no account, file bytes or network API.
import { openSyncJournal, withSyncRootLock } from '../app/fileSync/journal.client';
import { syncScopeKey, type SyncEntry } from '../app/fileSync/reconcile';

const scope = { origin: location.origin, ownerId: 'metadata-cleanup-browser-fixture', dataPlane: 'home', deviceId: 'fixture-device', rootId: 'fixture-root' };
const access = { scope, currentScope: () => scope, cleanup: 'foreground' as const };
const capture = { id: 'cleanup-browser-capture', generation: 'original', source: 'local' as const };
const preserved = { id: 'unmanaged-browser-capture', generation: 'original', source: 'local' as const };
const entries = (count: number): SyncEntry[] => Array.from({ length: count }, (_, i) => ({ path: `item-${String(i).padStart(5, '0')}`, id: `item-${i}`,
	version: 'original', kind: 'file', size: 3, sha256: 'a'.repeat(64) }));

Object.assign(window, { syncMetadataFixture: {
	scopeKey: syncScopeKey(scope),
	async seedAndStop() {
		return withSyncRootLock(scope, async () => {
			const journal = await openSyncJournal();
			try {
				const inventory = journal.inventory(access), rows = entries(270); await inventory.begin(capture);
				for (let ordinal = 0, offset = 0; offset < rows.length; ordinal++, offset += 128) {
					const page = rows.slice(offset, offset + 128); await inventory.append(capture, { ordinal, entries: page,
						...(offset + page.length === rows.length ? { totalEntries: rows.length } : {}) });
				}
				await inventory.seal(capture);
				const unmanaged = journal.inventory({ ...access, cleanup: undefined }); await unmanaged.begin(preserved);
				await unmanaged.append(preserved, { ordinal: 0, entries: entries(1), totalEntries: 1 }); await unmanaged.seal(preserved);
				const step = await journal.maintenance(access).step();
				let reused = false; try { await inventory.begin(capture); reused = true; } catch { /* retired identity is unavailable */ }
				return { step, reused, preserved: (await unmanaged.read(preserved)).totalEntries };
			} finally { journal.close(); }
		});
	},
	async finishAfterRestart() {
		return withSyncRootLock(scope, async () => {
			const journal = await openSyncJournal();
			try {
				const steps: number[] = []; await journal.maintenance(access).collect(p => steps.push(p.deleted));
				const inventory = journal.inventory(access), next = { ...capture, generation: 'after-cleanup' };
				await inventory.begin(next); await inventory.append(next, { ordinal: 0, entries: entries(1), totalEntries: 1 }); await inventory.seal(next);
				return { steps, preserved: (await inventory.read(preserved)).totalEntries, recreated: (await inventory.read(next)).totalEntries };
			} finally { journal.close(); }
		});
	}
} });
