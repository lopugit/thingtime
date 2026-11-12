import assert from 'node:assert/strict';
import test from 'node:test';
import { backupRestoreReviewMatches, type BackupRestoreReview } from './backupWorkspaceModel';
import { backupWorkspaceBlocks, backupWorkspaceDisclosureBlocks } from './backupWorkspaceBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { resolveBlockProps } from '../Builder/templateBlocks';
import { parseTransientBinding } from '../Builder/transientBlockActions';
import { findBlock, type WebpageBlock } from '../Builder/webpageBlocks';
const selection = { snapshotId: 'sealed-snapshot', sourceRootId: 'root', destination: { id: 'folder', revision: 'timeline-head-7', name: 'Recovery', path: 'Things / Recovery' } };
const review: BackupRestoreReview = { ...selection, id: 'review-1', hash: 'immutable-hash', summary: 'One closed graph', coverage: 'Selected graph only', history: 'Exact archived versions', limitations: ['Whole account unsupported'], executable: true };
test('restore admission binds exact graph root, immutable review and destination Timeline head', () => {
 assert.equal(backupRestoreReviewMatches(review, selection), true);
 assert.equal(backupRestoreReviewMatches(review, { ...selection, destination: { ...selection.destination, revision: 'timeline-head-8' } }), false);
 assert.equal(backupRestoreReviewMatches(review, { ...selection, sourceRootId: 'other-root' }), false);
 assert.equal(backupRestoreReviewMatches({ ...review, snapshotId: 'different-seal' }, selection), false);
 assert.equal(backupRestoreReviewMatches({ ...review, hash: '' }, selection), false);
});
test('authored controls and repeated fields remain individually editable; disclosures start collapsed', () => {
 const blocks = settingsDocumentBlocks(backupWorkspaceBlocks);
 const walk = (items: WebpageBlock[]): WebpageBlock[] => items.flatMap(item => [item, ...walk(item.children || [])]);
 for (const block of walk(blocks)) {
  if (block.props?.['data-tt-action'] !== '$transient') continue;
  const props = resolveBlockProps(block.props, { backup: { busy: false }, item: { id: 'selected-record' } });
  assert.ok(parseTransientBinding(JSON.stringify(props['data-tt-action-inputs'])), block.id);
 }
 for (const id of ['backup-entry-path', 'backup-entry-history', 'backup-entry-check', 'backup-job-progress', 'backup-snapshot-integrity', 'backup-review-coverage', 'backup-storage-option', 'backup-folder-shared-browser', 'backup-job-cancel']) assert.ok(findBlock(blocks, id));
 for (const id of ['backup-review-advanced', 'backup-snapshots', 'backup-jobs']) assert.equal(findBlock(blocks, id)?.props?.open, undefined);
});

test('normal device entry stays collapsed and preserves authored nested blocks during additive migration', () => {
 const authored = structuredClone(backupWorkspaceBlocks);
 findBlock(authored, 'backup-entry-history')!.text = 'My saved history: {item.history}';
 const wrapped = backupWorkspaceDisclosureBlocks(authored);
 assert.equal(wrapped[0].tag, 'details'); assert.equal(wrapped[0].props?.open, undefined);
 assert.equal(findBlock(wrapped, 'backup-entry-history')!.text, 'My saved history: {item.history}');
 assert.equal(backupWorkspaceDisclosureBlocks(wrapped), wrapped);
});
