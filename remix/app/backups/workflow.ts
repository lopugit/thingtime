/** Public projections contain lifecycle metadata only. Session references,
 * leases, provider bindings and protected engine checkpoints never leave the
 * dedicated backup coordinator. These types alone grant no execution. */
export type BackupJobStatus = 'queued' | 'running' | 'paused' | 'needs-attention' | 'cancelled' | 'completed';
export type BackupJobKind = 'snapshot' | 'review' | 'restore';
export type BackupJobPhase = 'inventory' | 'capture' | 'verify' | 'review' | 'restore' | 'complete';
export type BackupJobProgress = {
	phase: BackupJobPhase;
	items: number;
	bytes: string;
};
export type BackupJobView = {
	id: string; kind: BackupJobKind; status: BackupJobStatus;
	progress: BackupJobProgress; createdAt: string; updatedAt: string;
	/** Fixed allowlisted failure labels; never provider/database error text. */
	issue: 'execution-unavailable' | 'authorization-changed' | 'destination-changed' | 'source-changed' | 'snapshot-expired' | 'snapshot-unavailable' | 'dispatch-unconfirmed' | 'step-failed' | null;
};
