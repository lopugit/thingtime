import type { SyncJob } from './syncJobJournal';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { sameSyncScope, type SyncScope } from './reconcile';
import { CLOUD_PARENTS, PAGED_RUN_HEADS, PAGED_RUN_STORES, RETAINED_HEADS, REVIEW_STORE } from './pagedRunJournal';
import { REVIEW_DRAFT_HEADS, REVIEW_DRAFT_STORES } from './pagedReviewDraft';
import { PAGED_CHECKPOINT_HEADS } from './checkpoint';
import { PAGED_CHECKPOINT_DRAFTS } from './pagedCheckpointJournal';
import { PLAN_PIN_STORE, PLAN_STORES } from './pagedPlanJournal';
import { INVENTORY_PIN_STORE, INVENTORY_STORES } from './inventoryJournal';
import { DEVICE_SYNC_HISTORY_STORE } from './deviceSyncHistoryJournal';
import { JOURNAL_RETENTION_STORE } from './journalRetention';
import { SyncJobConfigurationChanged } from './syncJobFailure';

/** This is the unexecuted legacy setup case, not general policy migration. */
export function recoverableEmptyBackupSetup(previous: SyncJob | null, saved: SavedFileSyncConfiguration, scope: SyncScope, intervalMs: number | undefined): previous is SyncJob {
 if (!previous || scope.dataPlane !== 'home' || !sameSyncScope(previous.scope, scope) || previous.reviewed.id !== saved.id || saved.id !== scope.rootId ||
  previous.state !== 'attention' || previous.pendingFolderValidation !== true || previous.intervalMs !== intervalMs || intervalMs === undefined ||
  previous.reviewed.updatedAt === saved.updatedAt) return false;
 const emptyFields = ['folderSetupPaused', 'nextRunAt', 'retryAt', 'waitReason', 'minimumPartBytes', 'automaticPhotoRevision', 'nativeCaptureId',
  'strictCaptureId', 'nativeCaptureGeneration', 'nativeCaptureRestarts', 'photoQueueEpoch', 'localImport', 'strictCaptureRetries'] as const;
 if (emptyFields.some(field => previous[field] !== undefined)) return false;
 const keys = ['version', 'key', 'id', 'revision', 'scope', 'reviewed', 'state', 'intervalMs', 'pendingFolderValidation', 'failureReason', ...emptyFields];
 if (Object.keys(previous).some(key => !keys.includes(key as typeof keys[number]))) return false;
 const before = previous.reviewed.configuration, after = saved.configuration;
 return before.configurationVersion === 1 && after.configurationVersion === 1 && before.mode === 'two-way' && after.mode === 'backup' &&
  before.sourceKind !== 'photos' && after.sourceKind !== 'photos' && !before.paused && !after.paused && !before.propagateDeletes && !after.propagateDeletes &&
  before.deviceId === scope.deviceId && after.deviceId === scope.deviceId && JSON.stringify({ ...before, mode: 'backup' }) === JSON.stringify(after);
}

/** Count canonical and archived/orphaned execution rows, not just current heads.
 * All these stores participate in the same admission write transaction. */
export const EMPTY_SETUP_EXECUTION_STORES = [...new Set(['runs', 'checkpoints', PAGED_RUN_HEADS, ...PAGED_RUN_STORES, RETAINED_HEADS, REVIEW_STORE,
 CLOUD_PARENTS, REVIEW_DRAFT_HEADS, ...REVIEW_DRAFT_STORES, PAGED_CHECKPOINT_HEADS, PAGED_CHECKPOINT_DRAFTS, ...PLAN_STORES, PLAN_PIN_STORE,
 ...INVENTORY_STORES, INVENTORY_PIN_STORE, JOURNAL_RETENTION_STORE, DEVICE_SYNC_HISTORY_STORE])];
export function confirmEmptySetupExecution(tx: IDBTransaction, key: string, ranges: typeof IDBKeyRange, done: () => void, fail: (cause: unknown) => void) {
 let remaining = EMPTY_SETUP_EXECUTION_STORES.length * 2, failed = false;
 const finish = (exists: boolean) => {
  if (failed) return;
  try { if (exists) throw new SyncJobConfigurationChanged(); if (--remaining === 0) done(); }
  catch (cause) { failed = true; fail(cause); }
 };
 for (const name of EMPTY_SETUP_EXECUTION_STORES) {
  const store = tx.objectStore(name), current = store.getKey(key), scoped = store.openKeyCursor(ranges.bound([key], [key, []]));
  current.onsuccess = () => finish(current.result !== undefined);
  scoped.onsuccess = () => finish(scoped.result !== null);
 }
}

/** Distinct first-key namespace keeps old numeric sample/activity readers
 * compatible. History is relational and never interpreted as executable work. */
export const setupRecoveryHistoryKey = (scopeKey: string, jobId: string, revision: number): IDBValidKey => ['folder-setup-recovery:v1:' + scopeKey, jobId, revision];
export type FolderSetupRecoveryReceipt = { version: 1; previous: SyncJob; replacement: SavedFileSyncConfiguration; at: number };
