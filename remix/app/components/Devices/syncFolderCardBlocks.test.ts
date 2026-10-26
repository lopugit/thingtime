import assert from 'node:assert/strict';
import test from 'node:test';
import { findBlock } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { resolveBlockProps } from '../Builder/templateBlocks';
import { syncFolderCardBlocks } from './syncFolderCardBlocks';
import { remoteSyncBlocks, remoteSyncDisclosureBlocks } from './remoteSyncBlocks';

test('generic folder summaries expose separate editable fields and a typed expansion control', () => {
 const blocks = settingsDocumentBlocks(syncFolderCardBlocks);
 for (const id of ['folder-card-title', 'folder-card-path', 'folder-card-description', 'folder-card-stats', 'folder-card-expand']) assert.ok(findBlock(blocks, id));
 const expand = findBlock(blocks, 'folder-card-expand')!;
 assert.deepEqual(resolveBlockProps(expand.props!, { folder: { disabled: false, expanded: true, expandLabel: 'Collapse folder' } }), {
  type: 'button', disabled: false, 'aria-label': 'Collapse folder', 'aria-expanded': true, 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'expand' }
 });
 assert.equal(JSON.stringify(blocks).includes('Home'), false);
});
test('saved legacy connection layouts gain a disclosure without dropping custom fields', () => {
 const original = structuredClone(remoteSyncBlocks);
 const row = findBlock(original, 'remote-sync-connection')!;
 const header = findBlock(original, 'remote-sync-card-header')!;
 header.children = header.children!.filter(block => block.id !== 'remote-sync-expand');
 row.children = row.children!.filter(block => block.id !== 'remote-sync-editor-slot');
 row.children.push({ id: 'custom-saved-description', type: 'element', tag: 'p', text: 'My saved description' });
 const guarded = remoteSyncDisclosureBlocks(original);
 assert.ok(findBlock(guarded, 'remote-sync-expand'));
 assert.ok(findBlock(guarded, 'custom-saved-description'));
 assert.equal(findBlock(guarded, 'remote-sync-start-selection')?.condition?.arg, 'item.expanded');
 assert.equal(findBlock(original, 'remote-sync-expand'), null);
});
