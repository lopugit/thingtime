import assert from 'node:assert/strict';
import test from 'node:test';
import { priorityReadinessBlocks, priorityReadinessDisplay, syncProgressBlocks, syncProgressDisplay, syncProgressNodeDisplay } from './syncProgressBlocks';
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

test('preparation identifies its actual phase and counts separately from uploaded receipts', () => {
	const progress = { stage: 'scanning' as const, indexed: 1000, indexTotal: 1000, confirmed: 0, total: 0,
		preparation: { phase: 'cloud' as const, completed: 128, total: 900 } };
	const display = syncProgressDisplay({}, progress, 'running', false).sync;
	assert.match(display.indexDescription, /1,000 entries indexed of 1,000/);
	assert.match(display.indexDescription, /Preparing cloud destinations · 128 \/ 900 items processed/);
	assert.doesNotMatch(display.indexDescription, /Validating structure/);
	assert.match(display.uploadDescription, /Preparing upload · 0 \/ 0 operations confirmed/);
	const stopped = syncProgressDisplay({}, progress, 'paused', false).sync;
	assert.doesNotMatch(stopped.indexDescription, /Preparing cloud/); assert.match(stopped.uploadDescription, /^Paused/);
	const unknown = syncProgressDisplay({}, { ...progress, preparation: { phase: 'index-plan', completed: 128 } }, 'running', false).sync;
	assert.match(unknown.indexDescription, /Checking changed folders · 128 items processed/);
	assert.doesNotMatch(unknown.indexDescription, /128 \/|%/);
});

test('streaming transfers remain active before a sealed index and totals may grow', () => {
	for (const direction of ['upload', 'download'] as const) {
		const progress = { stage: 'transferring' as const, direction, indexState: 'indexing' as const, indexed: 3, confirmed: 1, total: 2 };
		for (const hasIndex of [false, true]) {
			const display = syncProgressDisplay({}, progress, 'running', hasIndex).sync;
			assert.match(display.indexDescription, /Indexing while files transfer/);
			assert.match(display.indexDescription, /3 index observations saved/);
			assert.match(display.uploadDescription, direction === 'upload' ? /^Uploading/ : /^Downloading/);
			assert.match(display.uploadDescription, /1 \/ 2 operations confirmed so far · Total may grow/);
			assert.equal(display.transferTitle, `2. ${direction === 'upload' ? 'Upload' : 'Download'} files and folders`);
		}
		const stopped = syncProgressDisplay({}, progress, 'paused', true).sync;
		assert.match(stopped.indexDescription, /^Indexing paused before completion/);
	}
});

test('watching a drained stream is distinct from completed sync', () => {
	const progress = { stage: 'transferring' as const, indexState: 'watching' as const, indexed: 3, confirmed: 2, total: 2 };
	const watching = syncProgressDisplay({}, progress, 'running', true).sync;
	assert.match(watching.indexDescription, /Watching for new and changed files/);
	assert.match(watching.uploadDescription, /^Waiting for new indexed files/);
	assert.doesNotMatch(watching.uploadDescription, /^Complete/);
	const complete = syncProgressDisplay({}, { ...progress, indexState: 'complete', stage: 'complete' }, 'complete', true).sync;
	assert.match(complete.uploadDescription, /^Complete/);
	assert.doesNotMatch(complete.uploadDescription, /Total may grow/);
	const planning = syncProgressDisplay({}, { ...progress, indexState: 'complete', totalFinal: false }, 'running', true).sync;
	assert.match(planning.indexDescription, /Preparing remaining indexed entries/);
	assert.match(planning.uploadDescription, /Total may grow/);
});

test('folder rows count cumulative child folders while preserving source totals', () => {
	const totals = { path: 'Documents', kind: 'folder' as const, files: 1, folders: 2, indexedBytes: 10, excluded: 0, unchanged: 0,
		operations: 3, confirmed: 3, transferFiles: 1, confirmedFiles: 1, bytesTotal: 10, bytesConfirmed: 10 };
	assert.match(syncProgressNodeDisplay(totals, undefined, 'complete').counts, /1 files · 1 subfolders/);
	assert.equal(totals.folders, 2);
	assert.match(syncProgressNodeDisplay({ ...totals, path: '' }, undefined, 'complete').counts, /2 folders/);
	assert.equal(syncProgressNodeDisplay({ ...totals, confirmed: 0, activeFile: { path: 'Documents/file', size: 10 } }, { stage: 'transferring', direction: 'download', confirmed: 0, total: 3, path: 'Documents/file', size: 10, bytes: 5 }, 'running').status, 'Downloading');
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

 test('a failed unsealed scan never claims that indexing is still running or complete', () => {
    const display = syncProgressDisplay({}, { stage: 'scanning', confirmed: 0, total: 0, indexed: 128 }, 'error', false, 'Unreadable entry').sync;
    assert.equal(display.indexDescription, 'Indexing stopped before completion. 128 entries observed.');
    assert.match(display.uploadDescription, /^Error/);
    assert.equal(display.current, 'Unreadable entry');
 });


test('priority readiness fields stay individually editable and explain saved observations without claiming completion', () => {
 const blocks = settingsDocumentBlocks(priorityReadinessBlocks);
 for (const field of ['title', 'gate', 'proof', 'candidate', 'status']) assert.ok(findBlock(blocks, 'sync-priority-readiness-' + field));
 const progress = { stage: 'transferring' as const, total: 128, confirmed: 0,
  priorityReadiness: { gate: 'enabled' as const, preferencesCount: 5, preferencesRevision: 3, proofCursor: 128, proofCutoff: 300, candidateOrdinal: 2, candidateSequence: 280, blocker: 'proof-pending' as const, measured: true, reserved: true } };
 const running = priorityReadinessDisplay(progress, 'running');
 assert.match(running.priorityGate, /enabled.*5 saved priorities.*revision 3/);
 assert.match(running.priorityProof, /128 \/ 300.*not an upload count/);
 assert.match(running.priorityCandidate, /priority 2.*observation 280.*reserved/);
 assert.match(running.priorityStatus, /waiting for legacy index validation/);
 const paused = priorityReadinessDisplay(JSON.parse(JSON.stringify(progress)), 'paused');
 assert.match(paused.priorityStatus, /^Saved observation/);
 const unsupported = priorityReadinessDisplay({ ...progress, priorityReadiness: { ...progress.priorityReadiness, gate: 'unsupported' } }, 'running');
 assert.match(unsupported.priorityGate, /unsupported/); assert.doesNotMatch(unsupported.priorityStatus, /complete|ready/);
 const unknown = priorityReadinessDisplay({ ...progress, priorityReadiness: { ...progress.priorityReadiness, measured: false } }, 'running');
 assert.match(unknown.priorityStatus, /Waiting for the scheduler.*No completion is inferred/);
 assert.equal(priorityReadinessDisplay(undefined, 'running').hasPriorityReadiness, false);
});
