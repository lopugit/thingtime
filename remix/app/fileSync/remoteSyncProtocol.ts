import type { SyncJobFailure } from './syncJobFailure';
import { parseSyncActivityQuery, parseSyncActivityRecord, parseSyncActivitySnapshot, type SyncActivityQuery, type SyncActivityRecord, type SyncActivitySnapshot } from './syncActivity';
import { parseDeviceSyncHistoryRange, type DeviceSyncHistoryRange } from './deviceSyncHistory';
import type { ConflictReviewView } from './conflictReviewController';
import type { FolderCapabilities, FolderRequest, MobileFolder, MobileTrashRequest } from './mobileFolders.client';
import type { ForegroundSyncProgress, SyncInventoryDescriptor } from './foregroundSync';
import type { SyncProgressDescriptor } from './progressProjection';
import type { SpeedReading } from './transferSpeed';
import { validSyncPath } from './reconcile';
import { validateRemoteSyncDetailsCommand, type RemoteSyncDetailsCommand } from './remoteSyncDetails';
import { parseDeviceSyncResourcePolicy, type DeviceSyncResourcePolicy } from './deviceResourcePolicy';
import { parseSyncResourceStatus, type SyncResourceStatus } from './resourceGovernor';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

/** A control channel, never a file transport. Bytes, native grants and journals
 * remain on the paired device. Only the existing management operations cross it. */
export type RemoteFolderRequest = Extract<FolderRequest, { action: 'remove' | 'version-list' | 'version-inspect' | 'trash-list' | 'trash-restore-reviewed' }> |
	{ action: 'list' | 'choose' } |
	Extract<FolderRequest, { action: 'version-restore-reviewed' | 'version-restore-status' }> |
	{ action: 'trash-inspect'; rootId: string; trash: MobileTrashRequest };
export type RemoteSyncCommand =
	| { action: 'status'; cursor?: string }
	| { action: 'history'; range: DeviceSyncHistoryRange }
	| ({ action: 'connection-activity'; connectionId: string } & SyncActivityQuery)
	| { action: 'resources'; operation: 'read' }
	| { action: 'resources'; operation: 'save'; deviceResourceLimits: DeviceSyncResourcePolicy }
	| { action: 'folders'; request: RemoteFolderRequest }
	| { action: 'start'; connectionId: string; expectedUpdatedAt: string; intervalMs?: number; queueOnly?: true; recoverSavedIntent?: true }
	| { action: 'pause'; connectionId: string }
	| { action: 'review'; connectionId: string; reviewId: string; operation: 'reload' | 'next' | 'previous' | 'choose' | 'finish' | 'cancel'; path?: string; from?: 'local' | 'remote' | null; revision?: number; resolution?: 'resolve' | 'retain' }
	| RemoteSyncDetailsCommand;

export type RemoteSyncStatus = {
	version: 1; deviceId: string; observedAt: string; roots: MobileFolder[]; rootsReady: boolean; rootsObservedAt?: string; capabilities: FolderCapabilities; nextCursor?: string;
	resourceUsage?: RemoteSyncResources;
 directionalProgressVersion?: '1.0.0';
 connectionActivityVersion?: '1.0.0';
 folderEnrollmentVersion?: '1.0.0';
 folderEnrollmentRecoveryVersion?: string;
	jobs: { connectionId: string; state: 'runnable' | 'scheduled' | 'paused' | 'attention' | 'complete'; intervalMs?: number; nextRunAt?: number; retryAt?: number; pendingFolderValidation?: true; strictCapturePending?: true; failureReason?: SyncJobFailure; activity?: SyncActivityRecord; progress?: Pick<ForegroundSyncProgress, 'directions' | 'totalFinal' | 'indexState' | 'statisticsObservedAt' | 'stage'> }[];
	task: null | { connectionId: string; active: boolean; stopping?: boolean; status?: 'running' | 'paused' | 'error' | 'complete'; waiting?: boolean;
		progress: ForegroundSyncProgress & { message?: string }; transferRates?: { upload: SpeedReading; download: SpeedReading };
		activity?: SyncActivitySnapshot; progressDescriptor?: SyncProgressDescriptor; inventoryDescriptor?: SyncInventoryDescriptor;
		review?: { id: string; view: ConflictReviewView } };
};

export const REMOTE_SYNC_SOURCE_PATH_REQUIREMENTS = { 'api.devices-sync-control': '1.1.0' } as const;
export const REMOTE_SYNC_DIRECTION_REQUIREMENTS = { 'api.devices-sync-control': '1.3.0' } as const;
export const REMOTE_SYNC_ENROLLMENT_REQUIREMENTS = { 'api.devices-sync-control': '1.5.0' } as const;
export const REMOTE_SYNC_ENROLLMENT_RECOVERY_REQUIREMENTS = { 'api.devices-sync-control': '1.6.0' } as const;
export const REMOTE_SYNC_ACTIVITY_REQUIREMENTS = { 'api.devices-sync-control': '1.5.0' } as const;
export const REMOTE_SYNC_HISTORY_REQUIREMENTS = { 'api.devices-sync-control': '1.4.0' } as const;
export const REMOTE_SYNC_RESOURCE_REQUIREMENTS = { 'api.devices-sync-control': '1.2.0' } as const;
export type RemoteSyncResources = { deviceResourceLimits: DeviceSyncResourcePolicy; resources?: SyncResourceStatus };
export const supportsRemoteResourceControls = (capabilities: FolderCapabilities | undefined) => capabilities?.platform === 'macos' &&
	capabilitySatisfies(capabilities.fileAccessVersion ?? '', '1.16.0') && capabilitySatisfies(capabilities.fileResourceLimitsVersion ?? '', '1.1.0');

export const REMOTE_SYNC_COMMAND_BYTES = 64 * 1024;
// Native metadata pages already permit 1 MiB; preserve those pages plus their
// control envelope instead of imposing a smaller browser-only data limit.
export const REMOTE_SYNC_RESULT_BYTES = 2 * 1024 * 1024;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const invalid = () => Error('Invalid remote sync command.');

export function assertRemoteFolderEnrollment(value: unknown, expected: {
 connectionId: string; expectedUpdatedAt: string; intervalMs: number;
}): { pendingFolderValidation: boolean } {
 if (!object(value) || !exact(value, ['accepted', 'folderEnrollmentVersion', 'connectionId', 'expectedUpdatedAt', 'intervalMs', 'pendingFolderValidation']) ||
  value.accepted !== true || value.folderEnrollmentVersion !== '1.0.0' || value.connectionId !== expected.connectionId ||
  value.expectedUpdatedAt !== expected.expectedUpdatedAt || value.intervalMs !== expected.intervalMs || typeof value.pendingFolderValidation !== 'boolean')
  throw Error('The device did not confirm durable automatic sync. Check its saved sync status before retrying.');
 return { pendingFolderValidation: value.pendingFolderValidation };
}

export function parseRemoteSyncResources(value: unknown): RemoteSyncResources {
	if (!object(value) || !exact(value, ['deviceResourceLimits', 'resources']) || !object(value.deviceResourceLimits) ||
		!exact(value.deviceResourceLimits, ['transferBytesPerSecond', 'scanBytesPerSecond', 'cpuPercent'])) throw Error('Invalid device resource response.');
	const deviceResourceLimits = parseDeviceSyncResourcePolicy(value.deviceResourceLimits);
	if (value.resources === undefined) return { deviceResourceLimits };
	const metrics = value.resources;
	const optional = ['currentUploadBytesPerSecond', 'currentDownloadBytesPerSecond', 'transferBytesPerSecond', 'scanBytesPerSecond', 'scanBytes', 'scanElapsedSeconds', 'memoryBytes', 'measuredAt'];
	if (!object(metrics) || !exact(metrics, ['version', 'cpuScopes', 'cpuPercent', 'cpuStatus', 'effectiveTransferConcurrency', 'effectiveIndexingConcurrency', 'uploadBytesPerSecond', 'downloadBytesPerSecond', ...optional]) ||
		(metrics.cpuScopes !== undefined && (!Array.isArray(metrics.cpuScopes) || metrics.cpuScopes.length > 3 ||
			new Set(metrics.cpuScopes).size !== metrics.cpuScopes.length || metrics.cpuScopes.some(scope => !['source-thread', 'indexer-process', 'transport-process'].includes(scope)))) ||
		optional.some(key => metrics[key] !== undefined && metrics[key] !== null && (typeof metrics[key] !== 'number' || !Number.isFinite(metrics[key]) || Number(metrics[key]) < 0))) throw Error('Invalid device resource response.');
	return { deviceResourceLimits, resources: parseSyncResourceStatus(metrics) };
}

export function validateRemoteSyncStatusActivity(value: unknown) {
 if (!object(value)) return;
 const version = value.connectionActivityVersion;
 const jobs = Array.isArray(value.jobs) ? value.jobs : [];
 const task = object(value.task) ? value.task : null;
 if (version !== undefined && version !== '1.0.0') throw invalid();
 for (const job of jobs) if (object(job) && job.activity !== undefined) {
  if (version !== '1.0.0') throw invalid();
  parseSyncActivityRecord(job.activity);
 }
 if (task?.activity !== undefined) {
  if (version !== '1.0.0' || task.active !== true) throw invalid();
  parseSyncActivitySnapshot(task.activity);
 }
}

export function validateRemoteSyncCommand(value: unknown): RemoteSyncCommand {
	if (!object(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength > REMOTE_SYNC_COMMAND_BYTES) throw invalid();
	switch (value.action) {
		case 'connection-activity':
			if (!exact(value, ['action', 'connectionId', 'before', 'limit']) || !id(value.connectionId)) throw invalid();
			return { action: 'connection-activity', connectionId: value.connectionId, ...parseSyncActivityQuery(value) };
		case 'history':
			if (!exact(value, ['action', 'range'])) throw invalid();
			return { action: 'history', range: parseDeviceSyncHistoryRange(value.range) };
		case 'resources':
			if (value.operation === 'read') { if (!exact(value, ['action', 'operation'])) throw invalid(); }
			else if (value.operation === 'save') {
				if (!exact(value, ['action', 'operation', 'deviceResourceLimits'])) throw invalid();
				parseRemoteSyncResources({ deviceResourceLimits: value.deviceResourceLimits });
			} else throw invalid();
			break;
		case 'status': if (!exact(value, ['action', 'cursor']) || (value.cursor !== undefined && (typeof value.cursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.cursor) || !Number.isSafeInteger(Number(value.cursor))))) throw invalid(); break;
		case 'start':
			if (!exact(value, ['action', 'connectionId', 'expectedUpdatedAt', 'intervalMs', 'queueOnly', 'recoverSavedIntent']) || !id(value.connectionId) ||
				typeof value.expectedUpdatedAt !== 'string' || value.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(value.expectedUpdatedAt)) ||
				(value.intervalMs !== undefined && ![60_000, 300_000, 900_000, 3_600_000].includes(Number(value.intervalMs))) ||
				(value.intervalMs !== undefined && typeof value.intervalMs !== 'number') ||
				(value.queueOnly !== undefined && (value.queueOnly !== true || value.intervalMs === undefined)) ||
				(value.recoverSavedIntent !== undefined && (value.recoverSavedIntent !== true || value.intervalMs === undefined || value.queueOnly !== undefined))) throw invalid();
			break;
		case 'pause': if (!exact(value, ['action', 'connectionId']) || !id(value.connectionId)) throw invalid(); break;
		case 'review': {
			if (!exact(value, ['action', 'connectionId', 'reviewId', 'operation', 'path', 'from', 'revision', 'resolution']) || !id(value.connectionId) || !id(value.reviewId) ||
				!['reload', 'next', 'previous', 'choose', 'finish', 'cancel'].includes(String(value.operation))) throw invalid();
			if (value.operation === 'choose' && (!validSyncPath(value.path) || ![null, 'local', 'remote'].includes(value.from as any) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) throw invalid();
			if (value.operation === 'finish' && (!['resolve', 'retain'].includes(String(value.resolution)) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0)) throw invalid();
			if (value.operation !== 'choose' && ['path', 'from'].some(key => key in value)) throw invalid();
			if (!['choose', 'finish'].includes(String(value.operation)) && 'revision' in value) throw invalid();
			if (value.operation !== 'finish' && 'resolution' in value) throw invalid();
			break;
		}
		case 'folders': {
			if (!exact(value, ['action', 'request']) || !object(value.request)) throw invalid();
			const r = value.request;
			const keys: Record<string, string[]> = {
				list: ['action'], choose: ['action'], remove: ['action', 'rootId'],
				'trash-list': ['action', 'rootId', 'cursor'], 'version-list': ['action', 'rootId', 'cursor'],
				'trash-inspect': ['action', 'rootId', 'trash'], 'trash-restore-reviewed': ['action', 'rootId', 'trash', 'restore'],
				'version-inspect': ['action', 'rootId', 'versionId', 'expected'],
				'version-restore-reviewed': ['action', 'rootId', 'restore'], 'version-restore-status': ['action', 'rootId', 'restore']
			};
			if (typeof r.action !== 'string' || !Object.prototype.hasOwnProperty.call(keys, r.action) || !exact(r, keys[r.action])) throw invalid();
			if (!['list', 'choose'].includes(r.action) && !id(r.rootId)) throw invalid();
			if ('cursor' in r && (typeof r.cursor !== 'string' || r.cursor.length > 512)) throw invalid();
			if (r.action.startsWith('trash-') && r.action !== 'trash-list' && (!object(r.trash) || r.trash.rootId !== r.rootId || !object(r.trash.scope) || !object(r.trash.operation))) throw invalid();
			if (r.action.includes('restore') && !object(r.restore)) throw invalid();
			if (r.action === 'version-inspect' && (!id(r.versionId) || !object(r.expected))) throw invalid();
			break;
		}
		default: return validateRemoteSyncDetailsCommand(value);
	}
	return structuredClone(value) as RemoteSyncCommand;
}
