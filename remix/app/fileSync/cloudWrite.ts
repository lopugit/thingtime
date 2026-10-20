import { parseCloudFolder, parseCloudFolderCreate } from './cloudFolder';
import { parseCloudInventory, inventorySyncEntry, type CloudInventoryNode, type CloudInventory } from './cloudInventory';
import { cloudFileSyncEntry, parseCloudFile, parseCloudFileCommit, type CloudFile, type CloudFileCommit } from './cloudFile';
import { sameSyncScope, sameSyncStamp, validateSyncScope, type SyncScope } from './reconcile';
import { validateSyncOperation, validateSyncRun, type SyncOperation, type SyncRun } from './execute';
import { EMPTY_CONTENT_SHA256 } from './contentFingerprint';

const hasStoredContentIdentity = (source: import('./reconcile').SyncEntry): boolean =>
	!!source.fingerprint || (source.kind === 'file' && source.size === 0 && source.sha256 === EMPTY_CONTENT_SHA256);

/** Queue metadata only. File bytes remain attachments; history stays in Timeline. */
export type CloudWrite = { operation: SyncOperation; scope: SyncScope; folderId: string | null; before: CloudFile | null; cloudRootId?: string };
export type CloudSyncRun = SyncRun & { cloudWrites: CloudWrite[] };
export function parseCloudWrite(value: CloudWrite): CloudWrite {
	const row = structuredClone(value);
	validateSyncScope(row.scope);
	validateSyncRun({ version: 1, id: 'validate-' + row.operation?.id, scope: row.scope, operations: [row.operation] });
	if (row.cloudRootId !== undefined && (typeof row.cloudRootId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.cloudRootId)))
		throw Error('Invalid pinned cloud root.');
	if (row.scope.dataPlane !== 'home') throw Error('Cloud file sync requires the home data plane.');
	const op = row.operation,
		m = op?.mutation;
	if (m?.kind === 'trash' && m.side === 'local') {
		if (!row.cloudRootId || row.before !== null || row.folderId !== null)
			throw Error('Local Trash requires a pinned cloud root and observed path absence.');
		return row;
	}
	if (m?.kind === 'copy' && m.from === 'remote') {
		if (m.source.kind === 'folder') {
			if (row.before !== null || m.expectedTarget !== null || row.folderId === null)
				throw Error('Local folders require an absent destination and a pinned cloud parent.');
			parseCloudFolder({ id: m.source.id, revision: m.source.version, name: m.path.split('/').at(-1), folderId: row.folderId });
		} else {
			row.before = parseCloudFile(row.before);
			if (
				row.before.trashed ||
				row.before.folderId !== row.folderId ||
				row.before.name !== m.path.split('/').at(-1) ||
				!hasStoredContentIdentity(m.source) ||
				!sameSyncStamp(m.source, cloudFileSyncEntry(row.before, m.path))
			)
				throw Error('Cloud download source changed before preparing the run.');
		}
		return row;
	}
	if (isCloudFolderWrite(row)) {
		if (m.kind !== 'copy' || m.from !== 'local' || m.expectedTarget !== null || row.before !== null || row.folderId === null)
			throw Error('Cloud folder writes only create an absent folder under an explicit parent.');
		parseCloudFolderCreate({ kind: 'folder', id: op.id, operationId: op.id, name: m.path.split('/').at(-1), folderId: row.folderId });
		return row;
	}
	if (
		!m ||
		(m.kind === 'copy' ? m.from !== 'local' || m.source.kind !== 'file' || !hasStoredContentIdentity(m.source) : m.side !== 'remote' || m.expected.kind !== 'file')
	)
		throw Error('This cloud writer requires a file upload or remote Trash operation.');
	const expected = m.kind === 'copy' ? m.expectedTarget : m.expected;
	row.before = row.before === null ? null : parseCloudFile(row.before);
	if (
		row.before?.trashed ||
		!sameSyncStamp(expected, row.before ? cloudFileSyncEntry(row.before, m.path) : null) ||
		(row.before && row.before.folderId !== row.folderId) ||
		(row.before && row.before.name !== m.path.split('/').at(-1))
	)
		throw Error('Cloud destination changed before preparing the run.');
	// Reuse the API's closed identifier/name validation, including UUID operation IDs.
	parseCloudFileCommit({
		id: row.before?.id ?? op.id,
		operationId: op.id,
		expectedRevision: row.before?.revision ?? null,
		name: m.path.split('/').at(-1),
		folderId: row.folderId,
		attachmentId: 'pending',
		contentVersion: '0'.repeat(64),
		trashed: m.kind === 'trash'
	});
	return row;
}
export function prepareCloudSyncRun(run: SyncRun, targets: Pick<CloudWrite, 'folderId' | 'before' | 'cloudRootId'>[]): CloudSyncRun {
	validateSyncRun(run);
	if (targets.length !== run.operations.length) throw Error('Every cloud operation requires a pinned destination.');
	return parseCloudSyncRun({
		...structuredClone(run),
		cloudWrites: run.operations.map((operation, i) => ({ operation, scope: run.scope, ...targets[i] }))
	});
}
export function parseCloudSyncRun(value: SyncRun & { cloudWrites?: unknown }): CloudSyncRun {
	validateSyncRun(value);
	const run = structuredClone(value) as CloudSyncRun;
	if (!Array.isArray(run.cloudWrites) || run.cloudWrites.length !== run.operations.length)
		throw Error('Cloud destinations are missing from the durable sync run.');
	run.cloudWrites = run.cloudWrites.map((write, i) => {
		const row = parseCloudWrite(write);
		const expected = { ...run.operations[i], confirmed: false },
			actual = { ...row.operation, confirmed: false };
		if (!sameSyncScope(row.scope, run.scope) || JSON.stringify(actual) !== JSON.stringify(expected))
			throw Error('Cloud destination does not belong to this operation.');
		return row;
	});
	return run;
}
export function cloudWriteCommit(write: CloudWrite, content: CloudFile['content']): CloudFileCommit {
	const m = write.operation.mutation;
	return parseCloudFileCommit({
		id: write.before?.id ?? write.operation.id,
		operationId: write.operation.id,
		expectedRevision: write.before?.revision ?? null,
		name: m.path.split('/').at(-1),
		folderId: write.folderId,
		attachmentId: content.attachmentId,
		contentVersion: content.version,
		trashed: m.kind === 'trash'
	});
}

export const isCloudFolderWrite = (write: CloudWrite): boolean =>
	write.operation.mutation.kind === 'copy' && write.operation.mutation.source.kind === 'folder';

/** Bind one operation to its original cloud observation and explicit parent.
 * The caller supplies a parent from the sealed inventory or a prepared folder
 * operation, never a later live scan. Both journal paths use this same policy. */
export function prepareCloudInventoryWrite(operation: SyncOperation, scope: SyncScope, rootId: string,
	before: CloudInventoryNode | null, folderId: string | null): CloudWrite {
	validateSyncOperation(operation);
	const m = operation.mutation;
	if (before && before.path !== m.path) throw Error('Cloud operation path changed.');
	if (m.kind === 'trash' && m.side === 'local') {
		if (before) throw Error('A local Trash path is still present in the cloud inventory.');
		return parseCloudWrite({ operation, scope, folderId: null, before: null, cloudRootId: rootId });
	}
	if (!folderId) throw Error('A cloud parent is missing from the complete inventory and prepared run.');
	if (before && (before.kind === 'file' ? before.file.folderId : before.folderId) !== folderId) throw Error('Cloud inventory parent changed.');
	if (m.kind === 'copy' && m.from === 'remote') {
		if (!before || before.kind !== m.source.kind) throw Error('Cloud download source is missing from the complete inventory.');
		if (!sameSyncStamp(m.source, inventorySyncEntry(before))) throw Error('Cloud download source changed.');
	} else if (m.kind === 'copy' && m.source.kind === 'folder') {
		if (before || m.expectedTarget !== null || m.from !== 'local') throw Error('Cloud folder destination already exists or requires another adapter.');
	} else if (before && before.kind !== 'file') throw Error('Cloud file destination changed kind.');
	return parseCloudWrite({ operation, scope, folderId, before: before?.kind === 'file' ? before.file : null, cloudRootId: rootId });
}

/** Bind every path to the complete observation and preallocate parent IDs from
 * the immutable run. A restart never generates a second folder tree. */
export function prepareCloudInventoryRun(run: SyncRun, value: CloudInventory): CloudSyncRun {
	validateSyncRun(run);
	const inventory = parseCloudInventory(value, value.rootId);
	const nodes = new Map(inventory.nodes.map(node => [node.path, node]));
	const parents = new Map<string, string>([['', inventory.rootId]]);
	for (const node of inventory.nodes) if (node.kind === 'folder') parents.set(node.path, node.id);
	const cloudWrites = run.operations.map(operation => {
		const m = operation.mutation, parent = m.path.split('/').slice(0, -1).join('/');
		const write = prepareCloudInventoryWrite(operation, run.scope, inventory.rootId, nodes.get(m.path) ?? null, parents.get(parent) ?? null);
		if (m.kind === 'copy' && m.from === 'local' && m.source.kind === 'folder') parents.set(m.path, operation.id);
		return write;
	});
	return parseCloudSyncRun({ ...run, cloudWrites });
}
