import type { SavedFileSyncConfiguration } from './configuredPlan';
import type { SyncJob } from './syncJobJournal';
import type { SyncScope } from './reconcile';
import { canonicalDraftConfiguration, readSavedSyncEnrollment, type ConfigurationDraft, type ConfigurationEditorScope } from './configurationEditor';
import type { SyncTaskSnapshot } from './syncTaskRuntime';

export type SavedLocalRecoveryProof = { draftSignature: string; jobRevision: number; saved: SavedFileSyncConfiguration };
/** Only the latest exact read may install or invalidate a display proof. */
export function settleSavedLocalRecoveryProof(proofs: Record<string, SavedLocalRecoveryProof>, id: string,
 attempt: symbol, currentAttempt: symbol | undefined, proof: SavedLocalRecoveryProof | null): Record<string, SavedLocalRecoveryProof> {
 if (attempt !== currentAttempt) return proofs;
 if (proof) return { ...proofs, [id]: proof };
 if (!proofs[id]) return proofs;
 const next = { ...proofs }; delete next[id]; return next;
}
/** A later cloud list/revision or selected draft change invalidates an earlier
 * exact read, including one whose reply arrived after the newer list. */
export function savedLocalRecoveryProofCurrent(proof: SavedLocalRecoveryProof | undefined, draft: ConfigurationDraft,
 job: SyncJob | undefined, latestKnown: SavedFileSyncConfiguration | undefined): proof is SavedLocalRecoveryProof {
 return !!proof && !!job && proof.draftSignature === JSON.stringify(draft) && proof.jobRevision === job.revision &&
  (!latestKnown || JSON.stringify(proof.saved) === JSON.stringify(latestKnown));
}
/** Exact authenticated readback with a caller-supplied live identity/list
 * fence. A late reply after a newer cloud list never becomes UI proof. */
export async function verifySavedLocalRecoveryCandidate(draft: ConfigurationDraft, scope: ConfigurationEditorScope,
 job: SyncJob, get: (id: string) => Promise<unknown>, assertCurrent: () => void): Promise<SavedLocalRecoveryProof | null> {
 assertCurrent();
 const saved = await readSavedSyncEnrollment(draft, scope, { get, assertCurrent });
 assertCurrent();
 if (!saved || !savedLocalStrictRecoveryEligible(job, saved, { ...scope, rootId: draft.id }, draft.enrollment!.intervalMs)) return null;
 return { draftSignature: JSON.stringify(draft), jobRevision: job.revision, saved };
}

/** Advisory eligibility only. Native enrollment still rechecks the saved
 * configuration, folder grant, Pause and capture under its root lock. */
export function savedLocalStrictRecoveryEligible(job: SyncJob | undefined, saved: SavedFileSyncConfiguration,
 scope: SyncScope, intervalMs: number): boolean {
 return job?.scope.origin === scope.origin && job.scope.ownerId === scope.ownerId &&
  job.scope.dataPlane === scope.dataPlane && job.scope.deviceId === scope.deviceId &&
  job.scope.rootId === scope.rootId && saved.id === scope.rootId &&
  saved.configuration.deviceId === scope.deviceId && !saved.configuration.paused &&
  saved.configuration.sourceKind !== 'photos' && job.state === 'attention' &&
  job.nextRunAt === undefined && !!job.strictCaptureId && !job.folderSetupPaused &&
  job.intervalMs === intervalMs && JSON.stringify(job.reviewed) === JSON.stringify(saved);
}

/** A UI waiting hint, never authority to admit or retire a job. The saved
 * value must come from readSavedSyncEnrollment's exact cloud readback. */
export function savedLocalRecoveryPendingOnLane(input: {
 draft: ConfigurationDraft | null;
 saved: SavedFileSyncConfiguration | undefined;
 job: SyncJob | undefined;
 scope: SyncScope;
 task: SyncTaskSnapshot | null;
 automaticEnabled: boolean;
 locallyPaused: boolean;
}): boolean {
 const { draft, saved, job, scope, task } = input;
 if (!input.automaticEnabled || input.locallyPaused || !draft?.pending || !saved ||
  draft.id !== scope.rootId || draft.configuration.paused ||
  draft.enrollment?.transport !== 'local' || draft.enrollment.savedRevision !== saved.updatedAt ||
  task?.active !== true || task.scope.rootId === scope.rootId ||
  task.scope.origin !== scope.origin || task.scope.ownerId !== scope.ownerId ||
  task.scope.deviceId !== scope.deviceId || task.scope.dataPlane !== scope.dataPlane) return false;
 try {
  return JSON.stringify(canonicalDraftConfiguration(draft)) === JSON.stringify(saved.configuration) &&
   savedLocalStrictRecoveryEligible(job, saved, scope, draft.enrollment.intervalMs);
 } catch { return false; }
}

/** Only this typed failure replaces attention with waiting status. Other
 * failures retain attention even when their routine Retry is queued. */
export function savedLocalRecoveryWaitsForLane(input: Parameters<typeof savedLocalRecoveryPendingOnLane>[0]): boolean {
 return input.job?.failureReason === 'indexing-incomplete' && savedLocalRecoveryPendingOnLane(input);
}

/** A proven pending automatic check makes a manual Retry redundant while the
 * lane is occupied. Unknown failures still retain attention and details. */
export function savedLocalRecoveryRetryQueuedOnLane(input: Parameters<typeof savedLocalRecoveryPendingOnLane>[0]): boolean {
 const reason = input.job?.failureReason;
 return (reason === 'indexing-incomplete' || reason === 'unknown' || reason === undefined) &&
  savedLocalRecoveryPendingOnLane(input);
}
