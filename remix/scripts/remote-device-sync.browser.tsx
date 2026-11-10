import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
import { openSyncJournal, syncScopeKey } from '../app/fileSync/journal.client';
import { writeStampedCache } from '../app/hooks/localCache';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';
import type { FileSyncConfiguration } from '../app/fileSync/configuration';
import { rootIdentity } from '../app/utils/rootIdentity';
import { deviceFolderIdentity, resolveDeviceFolders } from '../app/fileSync/deviceFolders';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, ChakraProvider } from '@chakra-ui/react';
import { SyncFolderCard } from '../app/components/Devices/SyncFolderCard';
import { MobileSyncConnections } from '../app/components/Devices/MobileSyncConnections';
import { MobileFolderAccess } from '../app/components/Devices/MobileFolderAccess';
import { MobileDeviceSetupCard } from '../app/components/Devices/MobileDeviceSetupCard';
import { RemoteDeviceSync } from '../app/components/Devices/RemoteDeviceSync';
import { contentPartPlan, fingerprintSource } from '../app/fileSync/contentFingerprint';
import { cloudFileSyncEntry, type CloudFile } from '../app/fileSync/cloudFile';
import { requireThingtimeCapability } from '../app/api/utils/capabilities/requireCapability.client';
import { DeviceSyncPanel } from '../app/components/Devices/DeviceSyncBrowser';
import { apiEndpointDocs } from '../app/docs/apiDocs';
import type { RemoteSyncStatus } from '../app/fileSync/remoteSyncProtocol';
import { NativeSyncBootstrap } from '../app/fileSync/NativeSyncBootstrap';
import type { NativePhotoRunProgress } from '../app/fileSync/nativePhotoRunProgress';

// Browser fixture uses the canonical registry, without importing server gateway runtime.
const fixtureCapabilities = (origin: string) => ({ schemaVersion: 1, origin, features: Object.fromEntries(apiEndpointDocs.map(doc => [`api.${doc.id}`, { version: doc.featureVersion ?? '1.0.0' }])) });

// Synthetic account, native bridge and HTTP fixtures. Unknown requests fail closed.
const params = new URLSearchParams(location.search);
const nativeOnly = params.has('nativeOnly');
const autoPhotos = params.has('autoPhotos') || nativeOnly, oldPhotoApp = params.has('oldPhotoApp');
const photoRecovery = params.has('photoRecovery') || autoPhotos, editPhotos = params.has('editPhotos'), mobilePanel = params.has('mobilePanel');
const photoTransfer = !nativeOnly && (editPhotos || autoPhotos);
const mobile = photoRecovery || mobilePanel || params.has('remoteMobile');
const ownerId = params.get('owner') || 'remote-sync-owner', deviceId = params.get('device') || (mobile ? 'sync-iphone' : 'remote-sync-mac');
const databaseKey = 'remote-sync-fixture-rows' + (params.size ? ':' + JSON.stringify([ownerId, deviceId]) : '');
const photoFilesKey = databaseKey + ':published-photos';
const nativeRunKey = databaseKey + ':sole-native-photos';
const offlinePauseCase = autoPhotos && params.has('offlinePause');
const photosRoot = '4d3c4fd6-6232-4b07-9c9d-3bfd3550437a';
const photoRoots = [{ id: photosRoot, name: 'Photo Library', sourceKind: 'photos' as const, photoAccess: 'full' as const }];
const minimumBudgetCase = autoPhotos && params.has('minimumBudget');
const budgetCase = autoPhotos && (params.has('budget') || minimumBudgetCase);
const minimumPartBytes = 8_388_608;
const configuration: FileSyncConfiguration = { configurationVersion: budgetCase ? 4 : 1,
 ...(budgetCase ? { photoAutomation: { notificationIntervalMs: 1_800_000, uploadBytesPerHour: minimumBudgetCase ? 1_000_000 : 1_000_000_000 } } : {}),
 name: mobile ? 'iPhone Photos' : 'Documents backup',
 deviceId, localRootId: mobile ? photosRoot : 'local-documents', ...(mobile ? { sourceKind: 'photos' as const } : {}),
 remoteFolderId: photoRecovery ? 'fixture-folder-0' : 'cloud-documents', mode: 'backup', paused: params.has('paused'), propagateDeletes: false,
 network: photoRecovery && !autoPhotos ? 'wifi' : 'any', chargingOnly: autoPhotos && params.has('chargingOnly'), excludedPaths: [] };
let rows: any[] = JSON.parse(localStorage.getItem(databaseKey) || 'null') ?? [
 { id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } },
 ...Array.from({ length: 15 }, (_, index) => ({ id: `fixture-folder-${index}`, thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: `Folder ${String(index).padStart(2, '0')}` } })),
 { id: 'documents-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: configuration },
 { id: 'archive-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Archive backup', paused: autoPhotos || configuration.paused } },
 ...(params.has('paused') || autoPhotos ? [{ id: 'home-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, ...(autoPhotos ? { configurationVersion: 1, photoAutomation: undefined, localRootId: 'no-grant', sourceKind: 'folder' } : {}), name: 'Home backup', paused: true } }] : []),
 { id: 'other-device-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Other device private sync', deviceId: 'another-device' } },
 { id: 'other-owner-sync', thingtime: ['file-sync'], author: { id: 'another-owner' }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Other owner private sync' } }
];
const photoScope = { origin: location.origin, ownerId, dataPlane: 'home', deviceId, rootId: 'documents-sync' };
const photoEvents: Array<{ type: string; rootId?: string; configurationId?: string; deviceId?: string; jobId?: string }> = [];
const photoBytes = new Uint8Array([7, 8, 9]);
const fingerprint = await fingerprintSource({ size: photoBytes.length, check() {}, read: async (offset, length) => photoBytes.slice(offset, offset + length) });
const assetKey = 'a'.repeat(64);
const photoEntry = { id: 'fixture-native-photo', version: 'native-v1', path: assetKey + '-1.HEIC', kind: 'file' as const, size: photoBytes.length, sha256: null, fingerprint };
const photoUploads = new Map<string, { folderId: string; bytes?: number[] }>();
const photoFiles = new Map<string, CloudFile>(autoPhotos ? JSON.parse(localStorage.getItem(photoFilesKey) ?? '[]') : []), photoReceipts = new Map<string, CloudFile>();
const photoBatchId = crypto.randomUUID(), finalPhotoBatchId = crypto.randomUUID();
type NativeFixtureRun = {
 revision: string; queueId: string; progress: NativePhotoRunProgress; retryAt: number;
 confirmedPayload: number[] | null;
 leaseExpired?: boolean;
};
let nativeRun: NativeFixtureRun | null = nativeOnly ? JSON.parse(localStorage.getItem(nativeRunKey) ?? 'null') : null;
const nativeCalls: Array<{ action: string; execution?: string; revision?: string }> = [];
const webTransfers: string[] = [];
let folderSlot: string | undefined, nativeFolderContentions = 0;
let nativeTimer: ReturnType<typeof setTimeout> | undefined;
let declineNextContinuation = true;
const nativeHint = () => {
 if (document.visibilityState === 'visible') window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
  detail: { type: 'mobile-files-photo-progress' }
 }));
};
const persistNativeRun = () => {
 localStorage.setItem(nativeRunKey, JSON.stringify(nativeRun));
 nativeHint();
};
const scheduleNativeFixture = () => {
 clearTimeout(nativeTimer);
 if (!nativeRun || nativeRun.leaseExpired || nativeRun.progress.continuation === 'held' ||
     nativeRun.progress.minimumPartBytes !== undefined || !['waiting', 'uploading'].includes(nativeRun.progress.stage)) return;
 nativeTimer = setTimeout(() => {
  if (!nativeRun) return;
  if (nativeRun.progress.stage === 'waiting') {
   nativeRun.progress = { stage: 'uploading', confirmed: nativeRun.progress.confirmed, pendingOriginals: 1,
    uploadBytesPerSecond: 625_000, currentFile: { confirmedBytes: 0, sentBytes: 2, totalBytes: 3 } };
   nativeRun.retryAt = Date.now() + 25_000;
   persistNativeRun(); scheduleNativeFixture();
  } else if (nativeRun.progress.stage === 'uploading' && !nativeRun.confirmedPayload) {
   const confirmed = nativeRun.progress.confirmed;
   nativeRun.confirmedPayload = [...photoBytes];
   nativeRun.progress = { stage: 'complete', pendingOriginals: 0, confirmed: {
    ...confirmed, photos: confirmed.photos + 1, mobileBytes: confirmed.mobileBytes + photoBytes.length
   } };
   persistNativeRun();
  }
 }, Math.max(0, nativeRun.retryAt - Date.now()));
};
if (nativeOnly) {
 // A stale WebView cache must not be added to the new native ledger.
 writeStampedCache('tt:sync-progress:' + syncScopeKey(photoScope), { stage: 'transferring', confirmed: 99, total: 100,
  message: 'Legacy WebView progress must stay hidden.' });
 scheduleNativeFixture();
}
const legacyInactiveMessage = 'Folder access paused. Try again when the app is active.';
let charging = false, finishedBatch = photoFiles.size > 0, pausedPairingReply: (() => void) | undefined, pairingReads = 0, holdPairing = mobilePanel;
let inactive = autoPhotos && params.has('inactive'), dataBudget = budgetCase && !minimumBudgetCase;
let folderAccessInactive = mobilePanel && params.has('folderAccessInactive');
let offlinePauseRead = false;
const holdDiscovery = offlinePauseCase && !localStorage.getItem(databaseKey + ':paused-offline');
const readPhotoJob = async () => {
 const journal = await openSyncJournal();
 try { return await journal.jobs({ scope: photoScope, currentScope: () => photoScope }).read(); }
 finally { journal.close(); }
};
let oldPhotoEpoch: string | undefined;
if (photoRecovery && (!autoPhotos || params.has('legacyJob')) && !localStorage.getItem(databaseKey + ':seeded')) {
 const journal = await openSyncJournal();
 try {
  const jobs = journal.jobs({ scope: photoScope, currentScope: () => photoScope });
  const previous = await jobs.admit({ id: photoScope.rootId, updatedAt: autoPhotos ? rows.find(row => row.id === photoScope.rootId).updatedAt : '2026-10-22T00:00:00.000Z',
   configuration: { ...configuration, remoteFolderId: photoTransfer ? configuration.remoteFolderId : 'cloud-documents' } }, 'previous-photos-job');
  oldPhotoEpoch = crypto.randomUUID();
  const queued = await jobs.photoQueue(previous, oldPhotoEpoch);
  if (autoPhotos && queued) await jobs.attention(queued, Error(legacyInactiveMessage));
 } finally { journal.close(); }
 if (autoPhotos) {
  localStorage.setItem(databaseKey + ':seeded', '1');
  writeStampedCache('tt:sync-progress:' + syncScopeKey(photoScope), { stage: 'checking', confirmed: 0, total: 0, message: legacyInactiveMessage });
 }
 else writeStampedCache('tt:sync-progress:' + syncScopeKey(photoScope), { stage: 'checking', confirmed: 0, total: 0,
  message: 'An unfinished sync job belongs to different settings. Restore its settings before retrying.' });
}
if (photoRecovery || mobilePanel) {
 window.thingtimeNativeBridge = { platform: 'ios', isNativeWebView: true, version: '1.0.0',
  devicePairingVersion: '1.0.0', fileAccessVersion: '1.8.0', fileUploadVersion: '1.5.0',
  fileStagingVersion: '1.2.0', filePublicationVersion: '1.2.0',
  ...(autoPhotos && !oldPhotoApp ? { filePhotoAutomationVersion: nativeOnly ? '1.2.0' : '1.0.0' } : {}),
  ...(nativeOnly ? { filePhotoContinuationVersion: '1.0.0' } : {}),
  postMessage: async message => {
   const request = message.payload as any;
   const { requestId, ownerId: owner, origin, action, rootId, configurationId, deviceId: device } = request;
   if (owner !== ownerId || origin !== location.origin) throw Error('Unexpected native scope');
   if (action === 'suspend') {
    if (message.type === 'mobile-files' && folderSlot === requestId) folderSlot = undefined;
    return;
   }
   const reply = (type: string, payload: object) => {
    if (type === 'mobile-files-result' && folderSlot === requestId) folderSlot = undefined;
    window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
     detail: { type, payload: { requestId, ownerId: owner, origin, ...payload } } }));
   };
   if (message.type === 'mobile-device' && action === 'status') {
    pairingReads++;
    if (holdPairing) {
     holdPairing = false;
     pausedPairingReply = () => reply('mobile-device-result', { error: 'Device connection paused. Retry when the app is active.' });
     return;
    }
    reply('mobile-device-result', { state: 'paired', deviceId }); return;
   }
   // Build 53 accepts only one normal folder request. Pause denials
   // bypass the slot, and suspend releases only the matching operation.
   if (nativeOnly && message.type === 'mobile-files' && !['cancel-deferred-upload', 'pause-photo-runs'].includes(action)) {
    if (folderSlot) {
     nativeFolderContentions++;
     reply('mobile-files-result', { error: 'Another folder request is running.' });
     return;
    }
    folderSlot = requestId;
    await new Promise(resolve => setTimeout(resolve, 80));
    if (folderSlot !== requestId) return;
   }
   if (nativeOnly && ['arm-photo-run', 'photo-run-status', 'cancel-deferred-upload', 'run-photo-in-background'].includes(action)) {
    const id = request.authorization?.id ?? configurationId;
    const row = rows.find(candidate => candidate.id === id);
    if (rootId !== photosRoot || !row || (request.authorization?.scope.deviceId ?? device) !== deviceId)
     throw Error('Unexpected native Photos scope');
    nativeCalls.push({ action, execution: request.execution, revision: request.authorization?.updatedAt ?? request.configurationRevision });
    // Build 53 includes the owner's scoped grant list on every successful
    // gated folder reply. The immediate cancellation denial returns none.
    const result = { roots: action === 'cancel-deferred-upload' ? [] : photoRoots, rootId, configurationId: id, deviceId };
    if (action === 'arm-photo-run') {
     if (request.execution !== 'native' || request.authorization.updatedAt !== row.updatedAt || row.crystal.paused)
      throw Error('Native runner was armed without exact reviewed settings');
     if (!nativeRun || nativeRun.progress.stage === 'paused') {
      const retryAt = Date.now() + 300_000;
      nativeRun = { revision: row.updatedAt, queueId: nativeRun?.queueId ?? crypto.randomUUID(), retryAt,
       confirmedPayload: nativeRun?.confirmedPayload ?? null, progress: {
        stage: 'waiting', syncWait: 'network', retryAt: new Date(retryAt).toISOString(), pendingOriginals: 1,
        confirmed: nativeRun?.progress.confirmed ?? { photos: 2, videos: 1, other: 0, wifiBytes: 1_048_576, mobileBytes: 2_097_152, unknownBytes: 524_288 }
       } };
      persistNativeRun(); scheduleNativeFixture();
     } else if (nativeRun.leaseExpired) {
      if (nativeRun.progress.continuation === 'held' || nativeRun.progress.minimumPartBytes)
       throw Error('Waiting for user or policy must not rearm the native queue');
      nativeRun.leaseExpired = false;
      nativeRun.progress = { stage: 'complete', pendingOriginals: 0, confirmed: nativeRun.progress.confirmed };
      persistNativeRun();
     }
     reply('mobile-files-result', { ...result, configurationRevision: nativeRun.revision,
      photoRunArmed: true, scheduled: true, nativeOwnsRun: true,
      photoRunProgress: { ...nativeRun.progress, configurationRevision: nativeRun.revision } });
    } else if (action === 'photo-run-status') {
     const run = id === photoScope.rootId ? nativeRun : null;
     reply('mobile-files-result', run ? { ...result, configurationRevision: run.revision,
      photoRunProgress: { ...run.progress, configurationRevision: run.revision } } : { ...result, photoRunProgress: null });
    } else if (action === 'run-photo-in-background') {
     if (!nativeRun || nativeRun.revision !== request.configurationRevision || row.crystal.paused || !nativeRun.progress.pendingOriginals)
      throw Error('Background request did not target current native work');
     if (declineNextContinuation) {
      declineNextContinuation = false;
      reply('mobile-files-result', { ...result, configurationRevision: nativeRun.revision, photoContinuationRequested: false, photoContinuationStatus: 'declined' });
     } else {
      nativeRun.progress = { ...nativeRun.progress, stage: 'uploading', continuation: 'active',
       currentFile: { confirmedBytes: 0, sentBytes: 2, totalBytes: 3 }, uploadBytesPerSecond: 625_000 };
      nativeRun.retryAt = Date.now() + 25_000;
      persistNativeRun(); scheduleNativeFixture();
      reply('mobile-files-result', { ...result, configurationRevision: nativeRun.revision, photoContinuationRequested: true, photoContinuationStatus: 'active' });
     }
    } else {
     if (nativeRun && id === photoScope.rootId) {
      nativeRun.progress = { stage: 'paused', confirmed: nativeRun.progress.confirmed };
      clearTimeout(nativeTimer); persistNativeRun();
     }
     reply('mobile-files-result', { ...result, cancelled: true });
    }
    return;
   }
   if (nativeOnly && !['list', 'conditions'].includes(action)) {
    webTransfers.push(action);
    reply('mobile-files-result', { error: 'The WebView attempted a transfer operation on a native Photos run.' }); return;
   }
   photoEvents.push({ type: action, rootId, configurationId, deviceId: device,
    ...(action === 'cancel-deferred-upload' ? { jobId: (await readPhotoJob())?.id } : {}) });
   if (action === 'list') reply('mobile-files-result', folderAccessInactive ? { syncWait: 'inactive' } : { roots: holdDiscovery ? [] : photoRoots });
   else if (action === 'cancel-deferred-upload') reply('mobile-files-result', { roots: [], cancelled: true, rootId, configurationId });
   else if (action === 'conditions') reply('mobile-files-result', { roots: [], conditions: { network: 'cellular', charging } });
   else if (!photoTransfer || (configuration.chargingOnly && !charging) || (editPhotos && !charging)) reply('mobile-files-result', { error: 'No photo operation may run before the fixture meets its saved conditions.' });
   else {
    const base = { roots: [], rootId, complete: true, capturePolicy: request.capturePolicy };
    if (action === 'scan-capture') {
     if (inactive) {
      reply('mobile-files-result', { rootId, error: legacyInactiveMessage });
      return;
     }
     const epoch = request.photoQueueApproval.request.epoch;
     const capture = { id: request.captureId, generation: crypto.randomUUID(), totalEntries: finishedBatch ? 0 : 1, totalSkipped: 0,
      coverage: 'full', consistency: 'per-entry', photoQueue: { epoch, id: finishedBatch ? finalPhotoBatchId : photoBatchId,
       assetKeys: finishedBatch ? [] : [assetKey], pending: 0, unavailable: 0 } };
     reply('mobile-files-result', { ...base, captureId: capture.id, captureGeneration: capture.generation, indexedEntries: capture.totalEntries,
      strictCaptureState: 'complete', cloudOriginals: 0, capture });
    } else if (action === 'scan-cancel') reply('mobile-files-result', { ...base, complete: false, cancelled: true, captureId: request.captureId });
    else if (action === 'scan-skips') reply('mobile-files-result', { ...base, skippedPage: { capture: request.capture, offset: 0, totalSkipped: 0, skipped: [], nextOffset: null } });
    else if (action === 'scan-page') reply('mobile-files-result', { ...base, inventoryPage: { capture: request.capture, offset: request.offset,
     entries: request.capture.totalEntries ? [photoEntry] : [], nextOffset: null } });
    else if (action === 'scan-discard') reply('mobile-files-result', { ...base, discarded: true });
    else if (action === 'inspect') reply('mobile-files-result', { ...base, path: request.path, entry: request.path === photoEntry.path ? photoEntry : null });
    else if (action === 'read') reply('mobile-files-result', { ...base, path: request.path, chunk: { version: photoEntry.version, size: photoBytes.length,
     offset: request.offset, data: btoa(String.fromCharCode(...photoBytes.slice(request.offset, request.offset + request.length))) } });
    else if (action === 'photo-queue-finish') {
     if (request.photoBatchId === photoBatchId) finishedBatch = true;
     reply('mobile-files-result', { ...base, photoQueueFinished: request.photoBatchId });
    } else if (action === 'upload-file') {
     const upload = request.upload, approved = upload.authorization, row = rows.find(r => r.id === photoScope.rootId);
     if (minimumBudgetCase && approved.configuration.photoAutomation.uploadBytesPerHour < minimumPartBytes) {
      reply('mobile-files-result', { rootId, syncWait: 'data-budget', minimumPartBytes });
      return;
     }
     if (dataBudget) {
      reply('mobile-files-result', { rootId, syncWait: 'data-budget', retryAt: new Date(Date.now() + 300_000).toISOString() });
      return;
     }
     const reserved = photoUploads.get(upload.uploadId);
     try {
      if (!reserved || approved.updatedAt !== row.updatedAt || approved.configuration.network !== 'any' ||
          approved.configuration.chargingOnly !== row.crystal.chargingOnly || approved.configuration.remoteFolderId !== reserved.folderId)
       throw Error('Synthetic native upload was not bound to the exact saved policy');
      const response = await window.fetch(location.origin + '/fixture-photo-upload/' + upload.uploadId,
       { method: 'PUT', credentials: 'omit', redirect: 'error', body: photoBytes });
      if (!response.ok) throw Error('Synthetic native upload failed');
      reply('mobile-files-result', { ...base, uploadedFile: { uploadId: upload.uploadId, requestId: upload.requestId,
       version: photoEntry.version, size: photoBytes.length, fingerprint } });
     } catch (error) { reply('mobile-files-result', { error: error instanceof Error ? error.message : 'Synthetic upload failed' }); }
    } else reply('mobile-files-result', { error: 'Unsupported synthetic Photos action: ' + action });
   }
  }
 };
}
const initialStatus = (): RemoteSyncStatus => ({ version: 1, deviceId, observedAt: new Date().toISOString(),
 roots: [{ id: 'local-documents', name: 'Documents on Mac', sourcePath: '/Users/example/Documents on Mac' }], rootsReady: true, capabilities: { platform: params.has('iosResources') ? 'ios' : 'macos', fileAccessVersion: '1.16.0', ...(params.has('iosResources') ? {} : { fileResourceLimitsVersion: '1.1.0' }), fileTrashVersion: '1.2.0', fileVersionsVersion: '1.0.0', fileStagingVersion: '1.0.0', filePublicationVersion: '1.2.0' }, jobs: [], task: null, resourceUsage: { deviceResourceLimits: { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 }, resources: { version: 1, cpuPercent: 3, cpuStatus: 'measured', effectiveTransferConcurrency: 1, effectiveIndexingConcurrency: 1, currentUploadBytesPerSecond: 1000, currentDownloadBytesPerSecond: 2000, scanBytesPerSecond: 3000, memoryBytes: 1048576, measuredAt: Date.now() } } });
let status = initialStatus(), offline = true, failure: string | null = null, writes = 0, connectionLists = 0, holdNextStart = false;
let priorities = { revision: 0, paths: [] as string[] };
const desktopFolderTest = params.get('desktopFolder');
const initialDesktopApi = 'https://selected-sync.test';
let selectedDesktopApi = initialDesktopApi;
const folderRequests: { method: string; origin: string | null }[] = [];
const folderManifests: string[] = [];
if (desktopFolderTest) Object.assign(window, {
 thingtimeDesktop: { platform: 'darwin', getInfo: async () => ({ contentOrigin: location.origin, apiOrigin: selectedDesktopApi + '/' }) }
});
let resumeFault: string | null = null; const resumeWrites: any[] = [];
const commands: any[] = [], replies = new Map<string, any>();
const heldStarts = new Set<string>();
const snapshot = () => ({ ...structuredClone(status), observedAt: new Date().toISOString() });
const json = (data: unknown, status = 200) => Response.json(data, { status });
Object.assign(window, { remoteSyncFixture: {
 failResume(value: string) { resumeFault = value; },
 setOnline(value: boolean) { offline = !value; },
 failNext(value: string) { failure = value; },
 holdStartAcknowledgement() { holdNextStart = true; },
 releaseStartAcknowledgements() { for (const requestId of heldStarts) replies.set(requestId, { ok: true, status: 'complete', result: { accepted: true } }); heldStarts.clear(); },
 changeElsewhere() { const row = rows.find(r => r.id === 'documents-sync'); row.updatedAt = new Date().toISOString(); row.crystal.name = 'Changed on another browser'; },
 state: () => structuredClone({ rows, status, commands, writes, connectionLists, priorities, resumeWrites, folderRequests, folderManifests, route: router.state.location, identityPending: rootIdentity.read().pending, pendingStartRequests: [...heldStarts].filter(requestId => replies.get(requestId)?.status === 'processing') }),
 reset() { localStorage.clear(); },
 photoRecovery: async () => ({ events: photoEvents, job: await readPhotoJob(), oldPhotoEpoch, uploaded: [...photoUploads.values()].filter(row => row.bytes), files: [...photoFiles.values()] }),
 photoScanCount: () => photoEvents.filter(event => event.type === 'scan-capture').length,
 nativeOnlyState: () => structuredClone({ nativeRun, nativeCalls, webTransfers, nativeFolderContentions }),
 setNativePhotoWait(reason: 'expired' | 'held' | 'budget') {
  if (!nativeRun?.confirmedPayload) throw Error('The native receipt is missing');
  clearTimeout(nativeTimer);
  nativeRun.leaseExpired = reason !== 'budget';
  nativeRun.progress = { stage: 'waiting', confirmed: nativeRun.progress.confirmed, pendingOriginals: 1,
   ...(reason === 'held' ? { continuation: 'held' as const } : {}),
   ...(reason === 'budget' ? { syncWait: 'data-budget' as const, minimumPartBytes: 8_388_608 } : { syncWait: 'network' as const }) };
  persistNativeRun();
 },
 expirePhotoContinuation() {
  if (!nativeRun || nativeRun.progress.continuation !== 'active') throw Error('No continued Photos task is active');
  clearTimeout(nativeTimer);
  nativeRun.progress = { stage: 'waiting', continuation: 'held', pendingOriginals: 1, confirmed: nativeRun.progress.confirmed };
  persistNativeRun();
 },
 setAppHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
 },
 setCharging(value: boolean) {
  charging = value;
  if (autoPhotos) window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-files-conditions-changed' } }));
 },
 disconnectForPause() { offlinePauseRead = true; localStorage.setItem(databaseKey + ':paused-offline', '1'); },
 returnToApp() { inactive = false; folderAccessInactive = false; window.dispatchEvent(new Event('pageshow')); },
 clearDataBudget() { dataBudget = false; },
 changeIdentity() { rootIdentity.changed(); },
 pairing: () => ({ reads: pairingReads, pending: !!pausedPairingReply }),
 deliverPause() { pausedPairingReply?.(); pausedPairingReply = undefined; },
} });
window.fetch = async (input, init) => {
 init?.signal?.throwIfAborted();
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
 if (desktopFolderTest && url.origin === initialDesktopApi && url.pathname === '/.well-known/thingtime-capabilities.json') {
  folderManifests.push(url.origin);
  if (init?.credentials !== 'omit' || init.redirect !== 'error') throw Error('Desktop public discovery must omit credentials and refuse redirects');
  return json(fixtureCapabilities(url.origin));
 }
 if (url.origin !== location.origin) throw Error('Fixture rejected external network');
 if (url.pathname === '/.well-known/thingtime-capabilities.json') return json(fixtureCapabilities(url.origin));
 if (url.pathname === '/api/v1/webpages/resolve') return json({ ok: false }, 404);
 if (url.pathname === '/api/v1/devices') return json({ ok: true, devices: [{ id: deviceId, name: mobile ? 'My iPhone' : 'My Mac', platform: mobile ? 'ios' : 'macos', pairingStatus: 'paired' }] });
 const headers = new Headers(init?.headers);
 if (nativeOnly && ['/api/v1/files', '/api/v1/attachments/uploads'].some(path => url.pathname.startsWith(path)) &&
     init?.method && init.method !== 'GET') {
  webTransfers.push(`${init.method} ${url.pathname}`);
  throw Error('The WebView attempted to transfer or publish an original on the native queue.');
 }
 if (photoTransfer && url.pathname.startsWith('/fixture-photo-upload/') && init?.method === 'PUT') {
  if (init.credentials !== 'omit' || init.redirect !== 'error' || [...headers].length) throw Error('Unexpected signed upload authority');
  const upload = photoUploads.get(url.pathname.split('/').at(-1)!);
  if (!upload || upload.bytes) throw Error('Synthetic upload replayed unexpectedly');
  const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
  const measured = await fingerprintSource({ size: bytes.length, check() {}, read: async (offset, length) => bytes.slice(offset, offset + length) });
  if (measured.sha256 !== fingerprint.sha256) throw Error('Synthetic upload bytes changed');
  upload.bytes = [...bytes];
  return new Response(null);
 }
 if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
  return json({ ok: false, error: 'Fixture scope headers missing' }, 409);
 if (url.pathname === '/api/v1/devices/folders') {
  const method = init?.method || 'GET';
  const expectedApiOrigin = headers.get('X-Thingtime-Expected-Api-Origin');
  if (desktopFolderTest) folderRequests.push({ method, origin: expectedApiOrigin });
  const folderJson = (data: unknown, status = 200) => Response.json(data, { status,
   ...(desktopFolderTest ? { headers: { 'x-thingtime-api-fallback': initialDesktopApi } } : {}) });
  if (desktopFolderTest && expectedApiOrigin !== selectedDesktopApi)
   return folderJson({ ok: false, error: 'The selected sync server changed.' }, 409);
  const scope = { origin: desktopFolderTest ? selectedDesktopApi : location.origin, ownerId, dataPlane: 'home', deviceId };
  const rootFolderId = await deviceFolderIdentity(scope, 'root');
  if (method === 'GET') {
   if (!url.searchParams.get('deviceId')) return folderJson(url.searchParams.get('cursor') ? { ok: true, devices: [{ deviceId: 'other-owned-device', rootFolderId: 'other-owned-root', name: 'Travel tablet' }], nextCursor: null } : { ok: true, devices: [{ deviceId, rootFolderId, name: 'My Mac' }], nextCursor: 'fixture-device-page-2' });
   if (desktopFolderTest === 'switched') selectedDesktopApi = 'https://replacement-sync.test';
   return folderJson({ ok: true, rootFolderId, deviceName: 'My Mac',
    folder: desktopFolderTest === 'existing' ? { id: rootFolderId, name: 'My Mac' } : rows.find(row => row.id === rootFolderId) || null });
  }
  const body = JSON.parse(String(init?.body));
  const resolved = await resolveDeviceFolders(scope, 'My Mac', body, {
   assertCurrent() { init?.signal?.throwIfAborted(); },
   async get(id) { const row = rows.find(row => row.id === id); if (!row) throw Object.assign(Error('Not found'), { status: 404 }); return row; },
   async create(input) { if (rows.some(row => row.id === input.shareId)) throw Object.assign(Error('Conflict'), { status: 409 }); rows.push({ ...input, id: input.shareId, author: { id: ownerId } }); writes++; localStorage.setItem(databaseKey, JSON.stringify(rows)); }
  });
  return folderJson({ ok: true, ...resolved });
 }
 if (url.pathname === '/api/v1/devices/sync-control') {
  if ((init?.method || 'GET') === 'GET') return json(replies.get(url.searchParams.get('requestId')!) || { ok: false, error: 'Request missing' }, replies.has(url.searchParams.get('requestId')!) ? 200 : 404);
  const body = JSON.parse(String(init?.body));
  if (body.deviceId !== deviceId || body.action !== 'enqueue') return json({ ok: false, error: 'Wrong device or operation' }, 403);
  const { command, requestId } = body;
  commands.push(structuredClone(command));
  let reply: any;
  if (offline) reply = { ok: true, status: 'error', error: 'This device is offline. Saved settings remain available.' };
  else if (failure) { reply = { ok: true, status: 'error', error: failure }; failure = null; }
  else {
   if (command.action === 'resources') {
    if (command.operation === 'save') status.resourceUsage = { ...status.resourceUsage!, deviceResourceLimits: command.deviceResourceLimits };
   } else if (command.action === 'start') {
    const saved = rows.find(r => r.id === command.connectionId);
    if (!saved || saved.crystal.deviceId !== deviceId || saved.updatedAt !== command.expectedUpdatedAt)
     return json({ ok: false, error: 'Saved connection changed. Refresh settings.' }, 409);
    status.jobs = [{ connectionId: saved.id, state: 'runnable', ...(command.intervalMs ? { intervalMs: command.intervalMs } : {}) }];
    status.task = { connectionId: saved.id, active: true, status: 'running', progress: { stage: 'transferring', confirmed: 2, total: 7, bytes: 1024, size: 4096 } };
   } else if (command.action === 'pause') {
    status.jobs = [{ connectionId: command.connectionId, state: 'paused' }];
    if (status.task) status.task = { ...status.task, active: false, status: 'paused' };
   } else if (command.action === 'priorities' && command.operation === 'save') {
    if (command.expectedRevision !== priorities.revision) return json({ ok: false, error: 'Priority revision changed' }, 409);
    priorities = { revision: priorities.revision + 1, paths: command.paths };
   }
   reply = { ok: true, status: 'complete', result: command.action === 'resources' ? status.resourceUsage : command.action === 'folders' ? { roots: status.roots } : command.action === 'status' ? snapshot() :
    command.action === 'details' ? {} : command.action === 'priorities' ? structuredClone(priorities) : { accepted: true } };
   if (command.action === 'start' && holdNextStart) {
    holdNextStart = false; heldStarts.add(requestId); reply = { ok: true, status: 'processing' };
   }
  }
  replies.set(requestId, reply);
  return json(reply);
 }
 if (photoRecovery && url.pathname === '/api/v1/files') {
  const folderId = url.searchParams.get('folderId');
  const destination = configuration.remoteFolderId;
  if (folderId === destination && (init?.method || 'GET') === 'GET') {
   photoEvents.push({ type: 'destination', rootId: folderId });
   return json({ ok: true, folder: { id: folderId, revision: 'r1', name: 'iPhone', folderId: null } });
  }
  if (photoTransfer && init?.method === 'POST') {
   const body = JSON.parse(String(init.body)), reserved = photoUploads.get(body.attachmentId);
   if (!reserved?.bytes || body.folderId !== destination || photoFiles.has(body.id)) throw Error('Fixture refused stale or duplicate Photos publication');
   const file: CloudFile = { id: body.id, folderId: destination, name: body.name, revision: 'published', trashed: false,
    content: { attachmentId: body.attachmentId, version: 'b'.repeat(64), size: photoBytes.length, fingerprint } };
   photoFiles.set(file.id, file); photoReceipts.set(body.operationId, file);
   if (autoPhotos) localStorage.setItem(photoFilesKey, JSON.stringify([...photoFiles]));
   return json({ ok: true, file });
  }
  if (photoTransfer && url.searchParams.has('operationId')) {
   const file = photoReceipts.get(url.searchParams.get('operationId')!);
   return json({ ok: true, receipt: file ? { file } : null });
  }
  if (photoTransfer && url.searchParams.get('rootId') === destination) {
   const path = url.searchParams.get('path');
   if (path) {
    const file = [...photoFiles.values()].find(row => row.name === path);
    return json({ ok: true, observation: { version: 1, complete: true, rootId: destination, rootRevision: 'r1', path,
     entry: file ? cloudFileSyncEntry(file, path) : null } });
   }
   const nodes = [...photoFiles.values()].map(file => ({ kind: 'file', path: file.name, file }));
   return new Response(JSON.stringify({ version: 1, complete: true, rootId: destination, rootRevision: 'r1', generation: crypto.randomUUID(),
    ordinal: 0, totalEntries: nodes.length, nodes }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  if (photoTransfer && url.searchParams.has('id')) {
   const file = photoFiles.get(url.searchParams.get('id')!);
   return file ? json({ ok: true, file }) : json({ ok: false }, 404);
  }
  throw Error('Unexpected Photos folder request');
 }
 if (photoTransfer && url.pathname === '/api/v1/attachments/uploads') {
  const body = JSON.parse(String(init?.body)), id = 'photo-' + body.requestId;
  if (body.fileSyncOrigin.folderId !== configuration.remoteFolderId || body.filename !== photoEntry.path) throw Error('Unexpected upload target');
  if (!photoUploads.has(id)) photoUploads.set(id, { folderId: body.fileSyncOrigin.folderId });
  return json({ ok: true, upload: { id, ...contentPartPlan(photoBytes.length) } });
 }
 if (photoTransfer && url.pathname === '/api/v1/attachments/content') {
  const id = url.searchParams.get('id');
  if (!id || !photoUploads.get(id)?.bytes) return json({ ok: false }, 404);
  return json({ ok: true, id, version: 'b'.repeat(64), size: photoBytes.length, fingerprint });
 }
 if (url.pathname !== '/api/v1/things') throw Error('Unexpected fixture request: ' + url.pathname);
 const method = init?.method || 'GET';
 if (method === 'GET') {
  const id = url.searchParams.get('id');
  if (id) {
   if (photoRecovery && id === photoScope.rootId) photoEvents.push({ type: 'configuration' });
   if (offlinePauseRead && id === photoScope.rootId) return json({ ok: false, error: 'Account is offline' }, 503);
   if (resumeFault === 'identity' && id === 'documents-sync') { resumeFault = null; rootIdentity.changed(); }
   const thing = rows.find(row => row.id === id);
   return json(thing ? { ok: true, thing } : { ok: false, error: 'Not found' }, thing ? 200 : 404);
  }
  if (url.searchParams.get('thingtime') === 'file-sync') connectionLists++;
  return json({ ok: true, things: rows.filter(row => row.thingtime.includes(url.searchParams.get('thingtime'))), nextCursor: null });
 }
 const body = JSON.parse(String(init?.body));
 if (method === 'PATCH') {
  const row = rows.find(row => row.id === body.id);
  if (!row || row.updatedAt !== body.expectedUpdatedAt) return json({ ok: false, error: 'Stale revision' }, 409);
  const resuming = row.crystal.paused === true && body.crystal.paused === false;
  if (resuming) { resumeWrites.push({ id: row.id, expectedUpdatedAt: body.expectedUpdatedAt }); if (resumeFault === 'cas') { resumeFault = null; return json({ ok: false, error: 'Stale resume revision' }, 409); } }
  row.crystal = body.replaceCrystal ? body.crystal : { ...row.crystal, ...body.crystal }; row.updatedAt = new Date().toISOString(); writes++;
  if (resuming && resumeFault === 'uncertain') { resumeFault = null; localStorage.setItem(databaseKey, JSON.stringify(rows)); return json({ ok: false, error: 'Resume reply interrupted' }, 503); }
 } else if (method === 'POST') {
  rows.push({ id: body.shareId, thingtime: body.thingtime, crystal: body.crystal, ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), author: { id: ownerId }, acl: body.acl, updatedAt: new Date().toISOString() }); writes++;
 } else throw Error('Unexpected fixture write');
 localStorage.setItem(databaseKey, JSON.stringify(rows));
 return json({ ok: true, thing: rows.find(row => row.id === (body.id || body.shareId)) });
};
const nativeFixtureHost = {
 origin: () => location.origin, capabilities: initialStatus().capabilities,
 request: async (_owner: string, request: any) => { if (request.action !== 'list') throw Error('Unexpected native fixture action'); return { roots: initialStatus().roots }; },
 authorizeDevice: async (owner: string, device: string, signal: AbortSignal) => { signal.throwIfAborted(); if (owner !== ownerId || device !== deviceId) throw Error('Wrong native fixture identity'); },
 fetch: window.fetch.bind(window), requireCapability: requireThingtimeCapability, assertCurrent() {}
};
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user: { id: ownerId, accountKind: 'user' }, dataPlane: 'home' }),
 element: <CurrentPageBuilderFixture><ChakraProvider><Box maxW="1000px" mx="auto" p={4}>{photoRecovery ? <>
  {autoPhotos && <NativeSyncBootstrap ownerId={ownerId} generation={0} />}
  {editPhotos && <Box aria-label="Account settings"><RemoteDeviceSync ownerId={ownerId} deviceId={deviceId} devicePlatform="ios" /></Box>}
  <Box aria-label="Local sync">{nativeOnly ? <MobileFolderAccess ownerId={ownerId} deviceId={deviceId} /> :
   <MobileSyncConnections ownerId={ownerId} deviceId={deviceId} roots={photoRoots} />}</Box>
 </> : params.has('native') ? <MobileSyncConnections ownerId={ownerId} deviceId={deviceId} roots={initialStatus().roots} host={nativeFixtureHost} /> : <>
  <DeviceSyncPanel ownerId={ownerId} deviceId={deviceId} devicePlatform={mobile ? 'ios' : 'macos'} pairedDeviceIds={[]} ownedDeviceIds={[deviceId]} />
  {mobilePanel && <MobileDeviceSetupCard ownerId={ownerId} syncAnchor />}
 </>}<SyncFolderCard title="Editable folder preview" path="/Sample/Folder" description="Synthetic shared card" stats="No transfer started" scopeKey="fixture-shared-card"><p>Folder details preview</p></SyncFolderCard></Box></ChakraProvider></CurrentPageBuilderFixture> }, { path: '/things', element: <h1>Folder opened</h1> }]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
