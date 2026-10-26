import type { ConflictReviewView } from './conflictReviewController';
import type { FolderCapabilities, FolderRequest, MobileFolder, MobileTrashRequest } from './mobileFolders.client';
import type { ForegroundSyncProgress, SyncInventoryDescriptor } from './foregroundSync';
import type { SyncProgressDescriptor } from './progressProjection';
import type { SpeedReading } from './transferSpeed';
import { validSyncPath } from './reconcile';
import { validateRemoteSyncDetailsCommand, type RemoteSyncDetailsCommand } from './remoteSyncDetails';

/** A control channel, never a file transport. Bytes, native grants and journals
 * remain on the paired device. Only the existing management operations cross it. */
export type RemoteFolderRequest = Extract<FolderRequest, { action: 'remove' | 'version-list' | 'version-inspect' | 'trash-list' | 'trash-restore-reviewed' }> |
	{ action: 'list' | 'choose' } |
	Extract<FolderRequest, { action: 'version-restore-reviewed' | 'version-restore-status' }> |
	{ action: 'trash-inspect'; rootId: string; trash: MobileTrashRequest };
export type RemoteSyncCommand =
	| { action: 'status'; cursor?: string }
	| { action: 'folders'; request: RemoteFolderRequest }
	| { action: 'start'; connectionId: string; expectedUpdatedAt: string; intervalMs?: number }
	| { action: 'pause'; connectionId: string }
	| { action: 'review'; connectionId: string; reviewId: string; operation: 'reload' | 'next' | 'previous' | 'choose' | 'finish' | 'cancel'; path?: string; from?: 'local' | 'remote' | null; revision?: number; resolution?: 'resolve' | 'retain' }
	| RemoteSyncDetailsCommand;

export type RemoteSyncStatus = {
	version: 1; deviceId: string; observedAt: string; roots: MobileFolder[]; rootsReady: boolean; rootsObservedAt?: string; capabilities: FolderCapabilities; nextCursor?: string;
	jobs: { connectionId: string; state: 'runnable' | 'scheduled' | 'paused' | 'attention' | 'complete'; intervalMs?: number; nextRunAt?: number; retryAt?: number }[];
	task: null | { connectionId: string; active: boolean; stopping?: boolean; status?: 'running' | 'paused' | 'error' | 'complete'; waiting?: boolean;
		progress: ForegroundSyncProgress & { message?: string }; transferRates?: { upload: SpeedReading; download: SpeedReading };
		progressDescriptor?: SyncProgressDescriptor; inventoryDescriptor?: SyncInventoryDescriptor;
		review?: { id: string; view: ConflictReviewView } };
};

export const REMOTE_SYNC_SOURCE_PATH_REQUIREMENTS = { 'api.devices-sync-control': '1.1.0' } as const;

export const REMOTE_SYNC_COMMAND_BYTES = 64 * 1024;
// Native metadata pages already permit 1 MiB; preserve those pages plus their
// control envelope instead of imposing a smaller browser-only data limit.
export const REMOTE_SYNC_RESULT_BYTES = 2 * 1024 * 1024;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const invalid = () => Error('Invalid remote sync command.');

export function validateRemoteSyncCommand(value: unknown): RemoteSyncCommand {
	if (!object(value) || new TextEncoder().encode(JSON.stringify(value)).byteLength > REMOTE_SYNC_COMMAND_BYTES) throw invalid();
	switch (value.action) {
		case 'status': if (!exact(value, ['action', 'cursor']) || (value.cursor !== undefined && (typeof value.cursor !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value.cursor) || !Number.isSafeInteger(Number(value.cursor))))) throw invalid(); break;
		case 'start':
			if (!exact(value, ['action', 'connectionId', 'expectedUpdatedAt', 'intervalMs']) || !id(value.connectionId) ||
				typeof value.expectedUpdatedAt !== 'string' || value.expectedUpdatedAt.length > 40 || !Number.isFinite(Date.parse(value.expectedUpdatedAt)) ||
				(value.intervalMs !== undefined && ![60_000, 300_000, 900_000, 3_600_000].includes(Number(value.intervalMs))) ||
				(value.intervalMs !== undefined && typeof value.intervalMs !== 'number')) throw invalid();
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
