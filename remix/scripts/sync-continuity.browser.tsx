import './mobile-sync-editor.browser';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { nativeSyncTasks } from '../app/fileSync/nativeSyncTasks.client';
import { resumeNativeSyncJobs } from '../app/fileSync/NativeSyncBootstrap';
import { getElectronBridge } from '../app/utils/electronBridge';
import { rootIdentity } from '../app/utils/rootIdentity';
import type { SyncScope } from '../app/fileSync/reconcile';
let releaseContext!: () => void, waitingContext = new URLSearchParams(location.search).has('cold'), contextGate = new Promise<void>(resolve => { releaseContext = resolve; });
let release!: () => void, hold = false, gate = Promise.resolve(), held = 0, failure = '';
const bridge = getElectronBridge()!, original = bridge.folderSyncRequest!;
bridge.folderSyncRequest = async request => {
 if (waitingContext && request.action === 'context') await contextGate;
 if (hold && ['scan', 'scan-capture', 'scan-stream'].includes(String(request.action))) { held++; await gate; }
 if ((request as any).capturePolicy === 'backup-supported') {
  const capture = { id: (request as any).captureId ?? (request as any).capture?.id, generation: (request as any).captureId ?? (request as any).capture?.generation, totalEntries: 0, coverage: 'full', consistency: 'per-entry', totalSkipped: 0 };
  const base = { ...request, origin: 'https://desktop-sync.invalid', roots: [], excludedPaths: (request as any).excludedPaths ?? [], complete: true };
  if (request.action === 'scan-capture' || request.action === 'scan-status') return { ...base, backupCapture: { ...capture, state: 'complete' } } as any;
  if (request.action === 'scan-page') return { ...base, inventoryPage: { capture: (request as any).capture, offset: 0, entries: [], nextOffset: null } } as any;
  if (request.action === 'scan-skips') return { ...base, skippedPage: { capture: (request as any).capture, offset: 0, skipped: [], totalSkipped: 0, nextOffset: null } } as any;
  if (request.action === 'scan-discard') return { ...base, discarded: true } as any;
 }
 const result = await original(request) as any;
 if (['scan-stream', 'scan-changes', 'scan-stream-finish'].includes(String(request.action))) return { ...result, changesPage: {
  id: (request as any).captureId, generation: (request as any).captureId, state: request.action === 'scan-stream-finish' ? 'complete' : 'indexed', revision: 0,
  changes: [], nextSequence: 0, hasMore: false, totalEntries: 0, totalSkipped: 0
 } };
 return result;
};
const binding = () => {
 const row = (window as any).syncInspectionFixture.savedRows().find((r: any) => r.thingtime.includes('file-sync'));
 const saved = readOwnedFileSyncConfiguration(row, row.author.id);
 const scope: SyncScope = { origin: 'https://desktop-sync.invalid', ownerId: row.author.id, deviceId: saved.configuration.deviceId, dataPlane: 'home', rootId: saved.id };
 return { saved, scope };
};
Object.assign(window, { continuityFixture: {
 releaseContext() { waitingContext = false; releaseContext(); },
 hold() { hold = true; gate = new Promise(resolve => { release = resolve; }); },
 release() { hold = false; release?.(); },
 state: () => ({ held, task: nativeSyncTasks.read(), failure }),
 async attention() {
  const { saved, scope } = binding(), journal = await openSyncJournal();
  try { const jobs = journal.jobs({ scope, currentScope: () => scope }); const job = await jobs.admit(saved, crypto.randomUUID(), 300_000); await jobs.attention(job); }
  finally { journal.close(); }
 },
 async schedule() {
  const { saved, scope } = binding(), journal = await openSyncJournal();
  try { const jobs = journal.jobs({ scope, currentScope: () => scope }); const job = await jobs.admit(saved, crypto.randomUUID(), 300_000); await jobs.finish(job, Date.now() - 300_001); }
  finally { journal.close(); }
  void resumeNativeSyncJobs(scope.ownerId, rootIdentity.read().generation, new AbortController().signal).catch(error => { failure = error.message; });
 },
 invalidate() { rootIdentity.changed(); }
} });
