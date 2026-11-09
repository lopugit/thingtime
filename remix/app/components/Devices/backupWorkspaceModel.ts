import type { BackupJobView } from '~/backups/workflow';
import type { BackupWorkspaceCatalog, BackupWorkspaceDestination, BackupWorkspaceEntry, BackupWorkspacePage, BackupWorkspaceReview, BackupWorkspaceSelection, BackupWorkspaceSnapshot, BackupWorkspaceCommand } from '~/backups/workspace';
export type BackupWorkspaceScope = { ownerId: string; apiOrigin: string; dataPlane: 'home'; identity: string };
export type BackupSnapshot = BackupWorkspaceSnapshot;
export type BackupEntry = BackupWorkspaceEntry;
export type BackupDestination = BackupWorkspaceDestination;
export type BackupJob = BackupJobView;
export type BackupPage<T> = BackupWorkspacePage<T>;
export type BackupCatalog = BackupWorkspaceCatalog;
export type BackupRestoreSelection = BackupWorkspaceSelection;
export type BackupRestoreReview = BackupWorkspaceReview;
export type BackupWorkspaceAdapter = {
 catalog(signal: AbortSignal, cursors?: { snapshotCursor?: string; jobCursor?: string }): Promise<BackupCatalog>;
 browse(snapshotId: string, signal: AbortSignal, cursor?: string): Promise<BackupPage<BackupEntry>>;
 destination(id: string, signal: AbortSignal): Promise<BackupDestination>;
 job(id: string, signal: AbortSignal): Promise<BackupJob>;
 review(id: string, signal: AbortSignal): Promise<BackupRestoreReview>;
 command(command: BackupWorkspaceCommand, signal: AbortSignal): Promise<BackupJob>;
};
export function backupRestoreReviewMatches(review: BackupRestoreReview, selection: BackupRestoreSelection): boolean {
 return !!review.id && !!review.hash && review.snapshotId === selection.snapshotId && review.sourceRootId === selection.sourceRootId &&
  review.destination.id === selection.destination.id && review.destination.revision === selection.destination.revision;
}
export function backupJobProgress(job: BackupJob): string {
 return `${job.progress.items.toLocaleString()} items processed · ${job.progress.bytes} bytes · ${job.progress.phase}`;
}
export const backupJobActive = (job: BackupJob) => job.status === 'queued' || job.status === 'running';
