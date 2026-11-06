import './mobile-sync-editor.browser';
import { openSyncJournal } from '../app/fileSync/journal.client';
import { readOwnedFileSyncConfiguration } from '../app/fileSync/configuredPlan';
import type { SyncScope } from '../app/fileSync/reconcile';
Object.assign(window, { attentionFixture: {
 async fail(kind: 'legacy' | 'generic' | 'authorization') {
  const row = (window as any).syncInspectionFixture.savedRows().find((r: any) => r.thingtime.includes('file-sync'));
  const saved = readOwnedFileSyncConfiguration(row, row.author.id);
  const scope: SyncScope = { origin: 'https://desktop-sync.invalid', ownerId: row.author.id, deviceId: saved.configuration.deviceId, dataPlane: 'home', rootId: saved.id };
  const journal = await openSyncJournal();
  try {
   const jobs = journal.jobs({ scope, currentScope: () => scope });
   const job = await jobs.admit(saved, crypto.randomUUID(), 300_000);
   if (kind === 'legacy') await jobs.transition(job, 'attention');
   else await jobs.attention(job, Error(kind === 'authorization' ? 'Cloud sync request failed (403; read; ACCESS_DENIED); retain this run for retry or reconciliation.' : 'secret=synthetic-secret /Users/synthetic-private/path'));
  } finally { journal.close(); }
 }
} });
