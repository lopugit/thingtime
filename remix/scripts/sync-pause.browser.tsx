import './mobile-sync-editor.browser';
import { nativeSyncTasks } from '../app/fileSync/nativeSyncTasks.client';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import { syncScopeKey, type SyncScope } from '../app/fileSync/reconcile';
let releaseRead!: () => void, releasePause!: () => void;
const resources = { version: 1 as const, cpuPercent: 12, cpuStatus: 'measured' as const, effectiveTransferConcurrency: 2, effectiveIndexingConcurrency: 3, uploadBytesPerSecond: 312.5 };
let update: any, signal: AbortSignal | undefined, running: Promise<void> | undefined;
const api = {
 holdReads: false, reads: 0, readGate: Promise.resolve(),
 hold() { api.holdReads = true; api.readGate = new Promise<void>(resolve => { releaseRead = resolve; }); },
 releaseReads() { api.holdReads = false; releaseRead?.(); },
 releasePause() { releasePause?.(); },
 state: () => ({ aborted: signal?.aborted, task: nativeSyncTasks.read(), reads: api.reads }),
 storm() { for (let n = 1; n <= 1000; n++) update({ progress: { stage: 'transferring', resources, total: 2000, confirmed: n } }); },
 async start() {
  const row = (window as any).syncInspectionFixture.savedRows().find((r: any) => r.thingtime.includes('file-sync'));
  const saved = readOwnedFileSyncConfiguration(row, row.author.id);
  const scope: SyncScope = { origin: new URLSearchParams(location.search).get('platform') === 'desktop' ? 'https://desktop-sync.invalid' : location.origin, ownerId: row.author.id, deviceId: saved.configuration.deviceId, dataPlane: 'home', rootId: saved.id };
  const journal = await openSyncJournal(), jobs = journal.jobs({ scope, currentScope: () => scope });
  const job = await jobs.admit(saved, crypto.randomUUID(), 60_000);
  const pause = new Promise<void>(resolve => { releasePause = resolve; });
  running = nativeSyncTasks.start(scope, async (current, publish) => {
   signal = current; update = publish;
   publish({ progress: { stage: 'transferring', resources, total: 2000, confirmed: 0 } });
   await new Promise<void>(resolve => current.addEventListener('abort', () => resolve(), { once: true }));
  }, async () => { await pause; if (!await jobs.pause(job)) throw Error('Synthetic pause CAS failed'); });
  void running.finally(() => journal.close());
  return syncScopeKey(scope);
 }
};
Object.assign(window, { pauseFixture: api });
