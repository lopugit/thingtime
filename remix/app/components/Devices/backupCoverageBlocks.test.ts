import assert from 'node:assert/strict';
import test from 'node:test';
import { backupCoverageBlocks, backupCoverageDisplay } from './backupCoverageBlocks';
import { findBlock } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { resolveBlockProps } from '../Builder/templateBlocks';
test('partial coverage exposes individually editable repeated fields and bounded paging controls', () => {
 const document = settingsDocumentBlocks(backupCoverageBlocks);
 for (const id of ['backup-coverage-title', 'backup-coverage-status', 'backup-skip-path', 'backup-skip-reason', 'backup-skip-scope', 'backup-coverage-next']) assert.ok(findBlock(document, id), id);
 const page = { capture: { id: crypto.randomUUID(), generation: crypto.randomUUID(), totalEntries: 1, coverage: 'partial' as const, consistency: 'per-entry' as const, totalSkipped: 301 }, offset: 0, nextOffset: 128, totalSkipped: 301, skipped: [{ ordinal: 0, path: 'private-path', reason: 'unreadable' as const, scope: 'subtree' as const }] };
 const display = backupCoverageDisplay(page, false).coverage; assert.match(display.status, /Partial backup.*not a complete backup/); assert.equal(display.nextDisabled, false); assert.equal(display.firstDisabled, true); assert.equal(display.rows[0].scope, 'Folder and descendants may be missing');
 assert.deepEqual(resolveBlockProps(findBlock(document, 'backup-coverage-next')!.props!, { coverage: display })['data-tt-action-inputs'], { operation: 'next' });
 assert.ok(!JSON.stringify(document).includes('private-path')); assert.equal(backupCoverageDisplay(page, true).coverage.nextDisabled, true); assert.equal(backupCoverageDisplay({ ...page, offset: 256, nextOffset: null }, false).coverage.nextDisabled, true);
});
