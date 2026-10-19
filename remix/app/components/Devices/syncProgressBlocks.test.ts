import assert from 'node:assert/strict';
import test from 'node:test';
import { syncProgressBlocks, syncProgressDisplay, syncProgressNodeDisplay } from './syncProgressBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { findBlock } from '../Builder/webpageBlocks';
import { resolveBlockProps } from '../Builder/templateBlocks';
import { parseTransientBinding } from '../Builder/transientBlockActions';

test('the editable hierarchy exposes individual row fields and runtime-bound controls', () => {
	const blocks = settingsDocumentBlocks(syncProgressBlocks);
	for (const id of ['sync-node-name', 'sync-node-path', 'sync-node-icon', 'sync-node-counts', 'sync-node-bytes', 'sync-node-bar', 'sync-node-status', 'sync-folder-toggle', 'sync-page-next']) assert.ok(findBlock(blocks, id), id);
	const props = resolveBlockProps(findBlock(blocks, 'sync-folder-toggle')!.props!, { item: { path: 'private/home', expanded: true } });
	const binding = parseTransientBinding(JSON.stringify(props['data-tt-action-inputs']));
	assert.equal(binding?.inputs.path, 'private/home');
	assert.ok(!JSON.stringify(blocks).includes('private/home'));
	const bar = resolveBlockProps(findBlock(blocks, 'sync-node-bar')!.props!, { item: { percent: 42.1, path: 'private/home' } });
	assert.equal(bar['aria-valuenow'], 42.1);
	const fill = resolveBlockProps(findBlock(blocks, 'sync-node-bar-fill')!.props!, { item: { percent: 42.1 } });
	assert.deepEqual(fill.style, { width: '42.1%' });
});

test('indexing with unknown totals remains indeterminate and stopped state is explicit', () => {
	const display = syncProgressDisplay({}, { stage: 'scanning', confirmed: 0, total: 0, indexed: 128 }, 'running', false).sync;
	assert.match(display.indexDescription, /128/); assert.match(display.indexDescription, /still being discovered/);
	assert.doesNotMatch(display.indexDescription, /%/);
	const stopped = syncProgressDisplay({}, { stage: 'transferring', confirmed: 3, total: 9 }, 'cancelled', true).sync;
	assert.match(stopped.uploadDescription, /Cancelled.*3 \/ 9/);
});

test('folder rows count cumulative child folders while preserving source totals', () => {
	const totals = { path: 'Documents', kind: 'folder' as const, files: 1, folders: 2, indexedBytes: 10, excluded: 0, unchanged: 0,
		operations: 3, confirmed: 3, transferFiles: 1, confirmedFiles: 1, bytesTotal: 10, bytesConfirmed: 10 };
	assert.match(syncProgressNodeDisplay(totals, undefined, 'complete').counts, /1 files · 1 subfolders/);
	assert.equal(totals.folders, 2);
	assert.match(syncProgressNodeDisplay({ ...totals, path: '' }, undefined, 'complete').counts, /2 folders/);
});

test('focused folder navigation renders its children and retains global indexed totals', () => {
	const totals = { path: '', kind: 'folder' as const, files: 100, folders: 13, indexedBytes: 1000, excluded: 0, unchanged: 0,
		operations: 113, confirmed: 0, transferFiles: 100, confirmedFiles: 0, bytesTotal: 1000, bytesConfirmed: 0 };
	const focused = { ...totals, path: 'Deep/level-09', files: 1, folders: 1, indexedBytes: 10, operations: 2, transferFiles: 1, bytesTotal: 10 };
	const display = syncProgressDisplay({
		'': { history: [], busy: false, page: { parent: totals, rows: [], after: null, next: null } },
		'Deep/level-09': { history: [], busy: false, page: { parent: focused, rows: [{ ...focused, path: 'Deep/level-09/file', kind: 'file' }], after: null, next: null } }
	}, undefined, 'running', true, '', 'Deep/level-09').sync;
	assert.equal(display.currentFolder, 'Deep/level-09'); assert.equal(display.atRoot, false);
	assert.match(display.indexDescription, /100 files and 13 folders/);
	assert.equal(display.rows[0].path, 'Deep/level-09/file');
});
