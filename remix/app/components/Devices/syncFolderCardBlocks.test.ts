import assert from 'node:assert/strict';
import { syncConnectionGlanceBlocks, withStableSyncGlance } from './syncConnectionGlanceBlocks';
import { migratePhotoAutomationLabels } from './PhotoAutomationControls';
import { syncResourceField } from './syncResourceControlsBlocks';
import test from 'node:test';
import { findBlock } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { resolveBlockProps } from '../Builder/templateBlocks';
import { photoDownloadPreparation, photoQueueDisplay, syncFolderCardBlocks, syncFolderActivityLabel, withSyncFolderQuickBlocks } from './syncFolderCardBlocks';
import { remoteSyncBlocks, remoteSyncDisclosureBlocks, remoteSyncAuthoringBlocks } from './remoteSyncBlocks';
import { assertRemoteFolderEnrollment } from '~/fileSync/remoteSyncProtocol';
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


test('folder grouping migrates editable remote cards without duplicating them or replacing custom text', () => {
 const original = structuredClone(remoteSyncBlocks);
 const path = findBlock(original, 'remote-sync-connection-path')!;
 path.text = 'Original source: {item.path}';
 const migrated = remoteSyncAuthoringBlocks(original);
 assert.deepEqual(remoteSyncAuthoringBlocks(migrated), migrated);
 const folder = findBlock(migrated, 'remote-sync-root')!;
 assert.equal(findBlock([folder], 'remote-sync-connections')?.props?.itemsPath, 'item.configs');
 assert.equal(findBlock([folder], 'remote-sync-source-drafts')?.props?.itemsPath, 'item.drafts');
 assert.equal(findBlock([folder], 'remote-sync-connection-path')?.text, 'Original source: {item.path}');
 assert.ok(findBlock([folder], 'remote-sync-bytes-sent'));
});

test('an old device start reply cannot confirm durable automatic enrollment', () => {
 const reviewed = { connectionId: 'config-one', expectedUpdatedAt: '2026-11-10T12:00:00.000Z', intervalMs: 300000 };
 const receipt = { accepted: true, folderEnrollmentVersion: '1.0.0', pendingFolderValidation: false, ...reviewed };
 assert.deepEqual(assertRemoteFolderEnrollment(receipt, reviewed), { pendingFolderValidation: false });
 for (const reply of [{ accepted: true }, { ...receipt, connectionId: 'other-config' }, { ...receipt, intervalMs: 60_000 }])
  assert.throws(() => assertRemoteFolderEnrollment(reply, reviewed), /did not confirm durable automatic sync/);
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
 assert.equal(syncFolderActivityLabel({ ...state, progress: { ...progress, photoQueue: { pending: 0, unavailable: 1 } } }), 'Partial backup · waiting for Photos originals.');
 assert.equal(syncFolderActivityLabel({ ...state, progress: { ...progress, photoQueue: { pending: 0, unavailable: 0 } } }), 'Selected photos backed up.');
 assert.equal(syncFolderActivityLabel({ ...state, running: true, progress: { ...progress, stage: 'transferring', photoQueue: { pending: 5, unavailable: 0 } } }),
  'Uploading this batch · 2 of 2 operations confirmed');
});

test('photo queue reserves distinct editable values, keeping unknown separate from zero and explaining retries', () => {
 assert.deepEqual(photoQueueDisplay({ pending: 1, unavailable: 2 }), {
  order: 'Photos queue · newest first', pending: '1 original pending', unavailable: '2 originals waiting for Photos'
 });
 assert.equal(photoQueueDisplay({ pending: 0, unavailable: 0 })?.unavailable, '0 originals waiting for Photos');
 assert.equal(photoQueueDisplay({})?.pending, '— originals pending');
 assert.equal(photoQueueDisplay({})?.unavailable, '— originals waiting for Photos');
 assert.equal(photoQueueDisplay({ unavailable: 3, unavailableReasons: { 'cloud-download': 2, 'photo-read': 1 } })?.unavailable,
  '2 awaiting download · 1 awaiting Photos read retry');
 assert.equal(photoQueueDisplay({ unavailable: 3, unavailableReasons: { 'cloud-download': 5, 'photo-read': 1 } })?.unavailable,
  '3 originals waiting for Photos');
 assert.equal(photoQueueDisplay({ pending: -1, unavailable: 2 }), undefined);
 const migrated = settingsDocumentBlocks(withSyncFolderQuickBlocks(syncFolderCardBlocks));
 for (const id of ['order', 'pending', 'unavailable']) assert.ok(findBlock(migrated, 'folder-card-photo-queue-' + id));
 for (const id of ['folder-card-photo-queue-pending-state', 'folder-card-photo-unavailable-state'])
  assert.equal(findBlock(migrated, id)?.type, 'element');
});

test('Photos activity exposes individual editable fields and preserves custom card blocks', () => {
 const original = [{ id: 'custom-summary', type: 'element' as const, tag: 'p', text: 'Keep my custom summary' }];
 const blocks = withSyncFolderQuickBlocks(original);
 for (const id of ['title', 'phase', 'indexed-value', 'prepared-value', 'backlog-value', 'download-progress', 'event-label', 'event-time', 'indexing-count', 'latest-found'])
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
 assert.equal(display?.indexed, 'Not reported yet');
 assert.equal(display?.backlog, '0 originals');
 assert.equal(nativePhotoActivityDisplay({ ...active, stale: true })?.downloadPercent, undefined);
 assert.equal(nativePhotoRunGlance(active).upload.rate, 'Upload speed unavailable');
});

 test('Photos activity reserves editable metrics and logs before the first native report', () => {
 const display = nativePhotoActivityDisplay(undefined, false, true)!;
 assert.equal(display.indexed, 'Not reported yet');
 assert.equal(display.downloadPercent, undefined);
 assert.deepEqual(display.events, []);
 const blocks = withSyncFolderQuickBlocks(syncFolderCardBlocks);
 assert.equal(findBlock(blocks, 'folder-card-activity')?.tag, 'details');
 assert.equal(findBlock(blocks, 'folder-card-activity')?.props?.open, true);
 for (const metric of ['indexed', 'prepared', 'backlog']) assert.equal(findBlock(blocks, `folder-card-activity-${metric}-state`)?.type, 'element');
 assert.equal(findBlock(blocks, 'folder-card-activity-history-viewport')?.css?.height, '160px');
 const customized = structuredClone(blocks);
 findBlock(customized, 'folder-card-activity-phase')!.text = 'My backup phase';
 assert.equal(findBlock(withSyncFolderQuickBlocks(customized), 'folder-card-activity-phase')?.text, 'My backup phase');
 });

test('average upload wording migrates exact stock labels and preserves custom wording', () => {
 const original = syncResourceField('speed', 'Maximum upload speed', 'Default', 'decimal');
 const migrated = migratePhotoAutomationLabels(original);
 assert.ok(JSON.stringify(migrated).includes('Average upload speed'));
 assert.equal(JSON.stringify(migrated).includes('Maximum upload speed'), false);
 const customized = structuredClone(original);
 customized[0].text = 'My desired upload rate';
 assert.equal(migratePhotoAutomationLabels(customized)[0].text, 'My desired upload rate');
 assert.deepEqual(migratePhotoAutomationLabels(migrated), migrated);
});

test('Photos can omit only the stock download direction without changing general or customized sync cards', () => {
 const general = syncConnectionGlanceBlocks();
 assert.ok(findBlock(general, 'connection-glance-download'));
 const photos = withStableSyncGlance(general, true);
 assert.equal(findBlock(photos, 'connection-glance-download'), null);
 assert.ok(findBlock(photos, 'connection-glance-upload'));
 const customized = structuredClone(general);
 findBlock(customized, 'connection-glance-download-title')!.text = 'My downloaded files';
 assert.equal(findBlock(withStableSyncGlance(customized, true), 'connection-glance-download-title')?.text, 'My downloaded files');
});


test('Photos authority diagnostics show the closed failed operation independently of concurrent phase', () => {
 const view = { progress: { stage: 'needs-review', confirmed: { photos: 0, videos: 0, other: 0, wifiBytes: 0, mobileBytes: 0, unknownBytes: 0 },
  activity: { phase: 'waiting', reason: 'transfer-expired', failureOperation: 'reserve-photo-original' } } } as NativePhotoRunView;
 const display = nativePhotoActivityDisplay(view)!;
 assert.match(display.reason, /expired or was revoked/); assert.match(display.reason, /Reserving an original/);
 assert.doesNotMatch(display.reason, /saved backup settings/);
});
