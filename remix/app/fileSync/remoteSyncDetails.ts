import type { SyncInventoryDescriptor } from './foregroundSync';
import type { SyncProgressDescriptor } from './progressProjection';
import { validSyncPath } from './reconcile';
import { parseSyncPriorityPaths } from './syncPriorityJournal';

export type RemoteSyncDetailsCommand =
	| { action: 'details'; connectionId: string }
	| { action: 'progress'; connectionId: string; runId: string; parent?: string; after?: string | null }
	| { action: 'coverage'; connectionId: string; inventoryId: string; generation: string; offset?: number }
	| { action: 'priorities'; connectionId: string; operation: 'read' }
	| { action: 'priorities'; connectionId: string; operation: 'save'; paths: string[]; expectedRevision: number };
export type RemoteSyncDetails = { progressDescriptor?: SyncProgressDescriptor; inventoryDescriptor?: SyncInventoryDescriptor };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));

/** These selectors name journal metadata, never native paths or byte reads. */
export function validateRemoteSyncDetailsCommand(value: unknown): RemoteSyncDetailsCommand {
	if (!object(value) || !identifier(value.connectionId)) throw Error('Invalid remote sync detail request.');
	switch (value.action) {
		case 'details':
			if (!exact(value, ['action', 'connectionId'])) throw Error('Invalid sync detail selector.');
			break;
		case 'progress':
			if (!exact(value, ['action', 'connectionId', 'runId', 'parent', 'after']) || !identifier(value.runId) ||
				(value.parent !== undefined && value.parent !== '' && !validSyncPath(value.parent)) ||
				(value.after !== undefined && value.after !== null && !validSyncPath(value.after))) throw Error('Invalid sync progress selector.');
			break;
		case 'coverage':
			if (!exact(value, ['action', 'connectionId', 'inventoryId', 'generation', 'offset']) || !identifier(value.inventoryId) || !identifier(value.generation) ||
				(value.offset !== undefined && (!Number.isSafeInteger(value.offset) || Number(value.offset) < 0))) throw Error('Invalid backup coverage selector.');
			break;
		case 'priorities':
			if (value.operation === 'read') {
				if (!exact(value, ['action', 'connectionId', 'operation'])) throw Error('Invalid upload priority read.');
			} else if (value.operation === 'save') {
				if (!exact(value, ['action', 'connectionId', 'operation', 'paths', 'expectedRevision']) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0)
					throw Error('Invalid upload priority revision.');
				parseSyncPriorityPaths(value.paths);
			} else throw Error('Invalid upload priority operation.');
			break;
		default: throw Error('Invalid remote sync detail action.');
	}
	return structuredClone(value) as RemoteSyncDetailsCommand;
}
