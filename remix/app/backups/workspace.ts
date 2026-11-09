import type { BackupJobView } from './workflow';
import type { BackupDestinationStatus } from './destinations';

/** Safe first-party projections. IDs select server-validated saved resources;
 * they never confer access to a store, checkpoint, credential or archived grant. */
export type BackupWorkspacePage<T> = { items: T[]; nextCursor: string | null };
export type BackupWorkspaceAvailability =
 | { available: true }
 | { available: false; reason: 'not-configured' | 'environment-unavailable' | 'primary-storage-unavailable' | 'invalid-configuration' | 'worker-unavailable' | 'worker-unverified' | 'execution-unavailable' };
export type BackupWorkspaceSnapshot = {
 id: string; name: string; createdAt: string;
 integrity: 'verified' | 'unverified' | 'invalid';
 coverage: 'complete-selected' | 'partial' | 'unknown';
 description: string;
};
export type BackupWorkspaceEntry = {
 id: string; name: string; path: string;
 kind: 'file' | 'folder' | 'data' | 'unsupported';
 bytes: number | null; versions: number | null;
 selectable: boolean; reason: string | null;
};
export type BackupWorkspaceDestination = { id: string; revision: string; name: string; path: string };
export type BackupWorkspaceCatalog = {
 snapshots: BackupWorkspacePage<BackupWorkspaceSnapshot>;
 jobs: BackupWorkspacePage<BackupJobView>;
 destinations: BackupDestinationStatus[];
 storage: BackupWorkspaceAvailability;
 worker: BackupWorkspaceAvailability;
 /** Describes actual supported/excluded families; never implies whole account. */
 coverageNote: string;
};
/** One chosen graph root may contain arbitrarily many descendants/dependencies.
 * The server certifies its entire selected closure; IDs are never raw intents. */
export type BackupWorkspaceSelection = {
 snapshotId: string; sourceRootId: string; destination: BackupWorkspaceDestination;
};
export type BackupWorkspaceReview = {
 id: string; hash: string; snapshotId: string; sourceRootId: string;
 destination: BackupWorkspaceDestination;
 summary: string; coverage: string; history: string; limitations: string[];
 executable: boolean;
};
export type BackupWorkspaceCommand =
 | { action: 'snapshot'; requestId: string; destinationId: string }
 | { action: 'review'; requestId: string; selection: { snapshotId: string; sourceRootId: string; destination: Pick<BackupWorkspaceDestination, 'id' | 'revision'> } }
 | { action: 'restore'; requestId: string; reviewId: string; reviewHash: string }
 | { action: 'pause' | 'resume' | 'retry' | 'cancel'; jobId: string };
export const BACKUP_WORKSPACE_PATH = '/api/v1/backups/workspace';
export const BACKUP_WORKSPACE_REQUIREMENTS = { 'api.backup-workspace': '1.0.0', 'api.backup-dispatch': '1.0.0' } as const;
