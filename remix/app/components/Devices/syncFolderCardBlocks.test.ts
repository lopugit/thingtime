import assert from 'node:assert/strict';
import test from 'node:test';
import { findBlock } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { resolveBlockProps } from '../Builder/templateBlocks';
import { photoDownloadPreparation, photoQueueDisplay, syncFolderCardBlocks, syncFolderActivityLabel, withSyncFolderQuickBlocks } from './syncFolderCardBlocks';
import { remoteSyncBlocks, remoteSyncDisclosureBlocks } from './remoteSyncBlocks';
import { nativePhotoActivityDisplay, nativePhotoCanContinue, nativePhotoRunGlance, type NativePhotoRunView } from './nativePhotoRunView';

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


test('historical progress never labels a missing grant as ready', () => {
 const state = { paused: false, rootsReady: true, hasRoot: false, taskPaused: false, running: false };
 assert.equal(syncFolderActivityLabel(state), 'Folder access missing');
 assert.equal(syncFolderActivityLabel({ ...state, hasRoot: true, taskPaused: true }), 'Paused');
 assert.equal(syncFolderActivityLabel({ ...state, hasRoot: true }), 'No active transfer');
 assert.equal(syncFolderActivityLabel({ ...state, rootsReady: false }), 'Checking folder access');
});

test('collapsed folder quick actions and error/destination fields remain individually editable', () => {
 const original = [{ id: 'custom-summary', type: 'element' as const, tag: 'p', text: 'Keep my custom summary' }];
 const migrated = withSyncFolderQuickBlocks(original);
 assert.ok(findBlock(migrated, 'custom-summary'));
 for (const id of ['folder-card-quick-action', 'folder-card-destination', 'folder-card-error']) assert.ok(findBlock(migrated, id));
 assert.deepEqual(withSyncFolderQuickBlocks(migrated), migrated);
 assert.equal(findBlock(migrated, 'folder-card-action-state')?.condition?.arg, 'folder.hasAction');
 const quick = findBlock(remoteSyncDisclosureBlocks(remoteSyncBlocks), 'remote-sync-quick');
 assert.ok(quick); assert.equal((quick.props?.['data-tt-action-inputs'] as any)?.operation, 'quick');
});

test('connection status distinguishes waiting, Photos preparation and a partial backup', () => {
 const state = { paused: false, rootsReady: true, hasRoot: true, taskPaused: false, running: true, photos: true };
 const progress = { stage: 'scanning' as const, confirmed: 0, total: 0 };
 assert.equal(syncFolderActivityLabel({ ...state, progress }), 'Preparing Photos backup…');
 assert.equal(syncFolderActivityLabel({ ...state, running: false, waiting: true, progress: { ...progress, message: 'Waiting for Wi-Fi.' } }), 'Waiting for Wi-Fi.');
 assert.equal(syncFolderActivityLabel({ ...state, running: false, failed: true, progress }), 'Needs attention');
 assert.equal(syncFolderActivityLabel({ ...state, running: false, progress: { ...progress, stage: 'complete', coverage: 'partial', skipped: 2 } }), 'Partial backup · 2 items need review.');
});

test('iCloud preparation only presents observed fractions and never claims an unfinished download is complete', () => {
 assert.equal(photoDownloadPreparation(), undefined);
 assert.equal(photoDownloadPreparation({ fraction: NaN }), undefined);
 assert.equal(photoDownloadPreparation({ fraction: 1.01 }), undefined);
 assert.equal(photoDownloadPreparation({ fraction: 0 })?.percent, undefined);
 assert.equal(photoDownloadPreparation({ fraction: 0.467 })?.percent, 46.7);
 assert.equal(photoDownloadPreparation({ fraction: 1 })?.percent, 99.9);
 const migrated = withSyncFolderQuickBlocks(syncFolderCardBlocks);
 assert.ok(findBlock(migrated, 'folder-card-preparation-label'));
 assert.ok(findBlock(migrated, 'folder-card-preparation-progress'));
});

test('limited photo access reports only the selected photos after a successful backup', () => {
 const state = { paused: false, rootsReady: true, hasRoot: true, taskPaused: false, running: false, photos: true };
 const progress = { stage: 'complete' as const, confirmed: 2, total: 2, photoAccess: 'limited' as const };
 assert.equal(syncFolderActivityLabel({ ...state, progress }), 'Selected photos backed up.');
 const message = 'An original is only in iCloud. Download it in Photos or explicitly allow cellular in this connection.';
 assert.equal(syncFolderActivityLabel({ ...state, progress: { ...progress, message, coverage: 'partial', skipped: 1 }, waiting: true }), message);
});


test('refused background scheduling tells the user to keep the app open without hiding transfer progress', () => {
 const state = { paused: false, rootsReady: true, hasRoot: true, taskPaused: false, running: true, photos: true };
 const progress = { stage: 'transferring' as const, confirmed: 1, total: 3, backgroundTransfer: 'foreground-only' as const };
 assert.equal(syncFolderActivityLabel({ ...state, progress }),
  'Transfer in progress · 1 of 3 operations confirmed · Keep Thingtime open; iOS could not schedule background processing.');
});

test('a completed batch does not close a Photos queue with pending or unavailable originals', () => {
 const state = { paused: false, rootsReady: true, hasRoot: true, taskPaused: false, running: false, photos: true };
 const progress = { stage: 'complete' as const, confirmed: 2, total: 2, photoAccess: 'limited' as const };
 assert.equal(syncFolderActivityLabel({ ...state, progress: { ...progress, photoQueue: { pending: 1, unavailable: 0 } } }), 'More Photos originals are queued.');
 assert.equal(syncFolderActivityLabel({ ...state, progress: { ...progress, photoQueue: { pending: 0, unavailable: 1 } } }), 'Partial backup · some originals are unavailable.');
 assert.equal(syncFolderActivityLabel({ ...state, progress: { ...progress, photoQueue: { pending: 0, unavailable: 0 } } }), 'Selected photos backed up.');
 assert.equal(syncFolderActivityLabel({ ...state, running: true, progress: { ...progress, stage: 'transferring', photoQueue: { pending: 5, unavailable: 0 } } }),
  'Uploading this batch · 2 of 2 operations confirmed');
});

test('photo queue counts are distinct editable blocks and only render observed positive counts', () => {
 assert.deepEqual(photoQueueDisplay({ pending: 1, unavailable: 2 }), {
  order: 'Photos queue · newest first', pending: '1 original pending', unavailable: '2 originals unavailable'
 });
 assert.equal(photoQueueDisplay({ pending: 0, unavailable: 0 })?.unavailable, '');
 assert.equal(photoQueueDisplay({ pending: -1, unavailable: 2 }), undefined);
 const migrated = settingsDocumentBlocks(withSyncFolderQuickBlocks(syncFolderCardBlocks));
 for (const id of ['order', 'pending', 'unavailable']) assert.ok(findBlock(migrated, 'folder-card-photo-queue-' + id));
});

test('Photos activity exposes individual editable fields and preserves custom card blocks', () => {
 const original = [{ id: 'custom-summary', type: 'element' as const, tag: 'p', text: 'Keep my custom summary' }];
 const blocks = withSyncFolderQuickBlocks(original);
 for (const id of ['title', 'phase', 'indexed-value', 'prepared-value', 'backlog-value', 'download-progress', 'event-label', 'event-time'])
  assert.ok(findBlock(blocks, 'folder-card-activity-' + id));
 assert.equal(findBlock(blocks, 'custom-summary'), original[0]);
 assert.deepEqual(withSyncFolderQuickBlocks(blocks), blocks);
});

test('Photos preparation can request continued execution before counts without reopening held or finished work', () => {
 const progress: NonNullable<NativePhotoRunView['progress']> = {
  stage: 'preparing', confirmed: { photos: 0, videos: 0, other: 0, wifiBytes: 0, mobileBytes: 0, unknownBytes: 0 }
 };
 const view = { revision: '2026-11-08T00:00:00.000Z', stale: false, progress };
 assert.equal(nativePhotoCanContinue(view), true, 'old native preparation has no activity or queue count');
 assert.equal(nativePhotoCanContinue({ ...view, stale: true }), false);
 assert.equal(nativePhotoCanContinue({ ...view, previousRevision: true }), false);
 assert.equal(nativePhotoCanContinue({ ...view, progress: { ...progress, continuation: 'held' } }), false);
 assert.equal(nativePhotoCanContinue({ ...view, progress: { ...progress, continuation: 'active' } }), false);
 for (const stage of ['waiting', 'complete', 'paused', 'needs-review'] as const)
  assert.equal(nativePhotoCanContinue({ ...view, progress: { ...progress, stage, activity: { phase: 'indexing' } } }), false);
 const active = { ...view, progress: { ...progress, stage: 'uploading' as const, uploadBytesPerSecond: 625_000,
  activity: { phase: 'downloading' as const, downloadFraction: 0, backlogOriginals: 0 } } };
 const display = nativePhotoActivityDisplay(active);
 assert.equal(display?.downloadPercent, 0);
 assert.equal(display?.indexed, '');
 assert.equal(display?.backlog, '0 originals');
 assert.equal(nativePhotoActivityDisplay({ ...active, stale: true })?.downloadPercent, undefined);
 assert.equal(nativePhotoRunGlance(active).upload.rate, 'Upload speed unavailable');
});
