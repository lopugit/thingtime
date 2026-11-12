import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { parseBackupCoverageDescriptor, readBackupCoveragePage } from './backupCoverage.client';
import { scope } from './foregroundSync.fixture';
import type { NativeBackupCapture, NativeScanSkip } from './nativeInventory';
test('coverage survives reopen with bounded pages and account fences across asynchronous opening', async () => {
 const factory = new IDBFactory(), open = () => openSyncJournal(factory, 'coverage-view', IDBKeyRange);
 const inventory = { id: crypto.randomUUID(), generation: crypto.randomUUID(), source: 'local' as const }, descriptor = { scope, inventory };
 const capture: NativeBackupCapture = { id: crypto.randomUUID(), generation: crypto.randomUUID(), totalEntries: 0, coverage: 'partial', consistency: 'per-entry', totalSkipped: 301 };
 const j = await open(), ledger = j.inventory({ scope, currentScope: () => scope }); await ledger.begin(inventory); await ledger.setCoverage(inventory, capture, { mode: 'backup', propagateDeletes: false });
 const skips: NativeScanSkip[] = Array.from({ length: 301 }, (_, ordinal) => ({ ordinal, path: 'skip-' + ordinal, reason: 'unreadable', scope: 'entry' }));
 for (let offset = 0; offset < skips.length; offset += 128) { const skipped = skips.slice(offset, offset + 128), end = offset + skipped.length; await ledger.appendSkips(inventory, { capture, offset, skipped, totalSkipped: 301, nextOffset: end === 301 ? null : end }); }
 await ledger.append(inventory, { ordinal: 0, entries: [], totalEntries: 0 }); await ledger.seal(inventory); j.close();
 let count = 0, offset = 0;
 do { const page = (await readBackupCoveragePage(descriptor, () => scope, offset, undefined, open))!; assert.ok(page.skipped.length <= 128); assert.equal(page.capture.coverage, 'partial'); count += page.skipped.length; if (page.nextOffset === null) break; offset = page.nextOffset; } while (true);
 assert.equal(count, 301);
 await assert.rejects(readBackupCoveragePage(descriptor, () => ({ ...scope, ownerId: 'other' }), 0, undefined, open), /account or folder changed/);
 let current = scope;
 await assert.rejects(readBackupCoveragePage(descriptor, () => current, 0, undefined, async () => { const journal = await open(); current = { ...scope, origin: 'https://other.test' }; return journal; }), /account or folder changed/);
 const controller = new AbortController(); controller.abort(); await assert.rejects(readBackupCoveragePage(descriptor, () => scope, 0, controller.signal, open), { name: 'AbortError' });
 assert.throws(() => parseBackupCoverageDescriptor({ scope, inventory: { ...inventory, source: 'remote' } }), /local inventory/);
});
