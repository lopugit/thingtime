/** Only public, fixed explanations cross into durable job diagnostics. Never
 * persist native/server messages: they can contain paths, URLs or credentials. */
export const SYNC_JOB_FAILURES = {
 unknown: 'The failure reason is unavailable. Check folder access and connection status, then retry, or pause sync.',
 'configuration-changed': 'The unfinished job uses different settings. Pause sync before starting with the new settings.',
 'host-changed': 'The sync host or selected server changed. Reopen this connection before retrying.',
 'account-changed': 'The active account changed. Reopen folder access before retrying.',
 'update-required': 'This sync connection requires a newer Thingtime app. Update the app before retrying.',
 'indexing-interrupted': 'Indexing was repeatedly interrupted. Check folder access and local storage before retrying.',
 'cloud-authorization': 'The cloud request was refused. Check this connection’s sign-in and access before retrying.',
 'pause-cleanup-unconfirmed': 'Sync is paused, but native indexing cleanup could not be confirmed. Reopen this connection before resuming.',
 'job-changed': 'The saved sync job changed. Refresh this connection and retry the action.',
 'cloud-conflict': 'The cloud request needs reconciliation. Review this connection before retrying.',
} as const;
export class SyncJobConfigurationChanged extends Error {
 constructor() { super('An unfinished sync job belongs to different settings. Restore its settings before retrying.'); }
}
export type SyncJobFailure = keyof typeof SYNC_JOB_FAILURES;
export function isSyncJobFailure(value: unknown): value is SyncJobFailure {
 return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SYNC_JOB_FAILURES, value);
}
export function syncJobFailure(cause: unknown): SyncJobFailure {
 if (cause instanceof SyncJobConfigurationChanged) return 'configuration-changed';
 if (!(cause instanceof Error)) return 'unknown';
 switch (cause.message) {
  case 'Pause saved. Native indexing cleanup could not be confirmed.': return 'pause-cleanup-unconfirmed';
  case 'The sync job changed while stopping. Please retry.': return 'job-changed';
  case 'The active sync host changed.': case 'The selected sync server changed.': return 'host-changed';
  case 'The active account changed.': case 'The active account changed. Reopen folder access.': return 'account-changed';
  case 'Update Thingtime to continue sync outside this screen.':
  case 'Update Thingtime before using a CPU target for downloads. This connection requires scoped native signed-range downloads.':
  case 'Update Thingtime Mac before using this connection’s Gitignore rules.': return 'update-required';
  case 'Backup indexing was repeatedly interrupted. Check folder access and local storage before retrying.': return 'indexing-interrupted';
 }
 if (/^Cloud sync request failed \((401|403)(?:; [^)\r\n]*)?\); retain this run for retry or reconciliation\.$/.test(cause.message)) return 'cloud-authorization';
 if (/^Cloud sync request failed \((409|412)(?:; [^)\r\n]*)?\); retain this run for retry or reconciliation\.$/.test(cause.message)) return 'cloud-conflict';
 return 'unknown';
}
export function syncJobFailureMessage(reason?: SyncJobFailure) {
 return SYNC_JOB_FAILURES[reason ?? 'unknown'];
}

/** Remote projections without a reason deliberately use the same unknown copy. */
export function syncJobAttentionMessage(job: { intervalMs?: number; failureReason?: SyncJobFailure }) {
 return `${job.intervalMs ? 'Automatic sync' : 'An earlier transfer'} needs attention. ${syncJobFailureMessage(job.failureReason)}`;
}
