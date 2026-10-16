import { cloudFileSyncEntry, parseCloudFile, parseCloudFileCommit, type CloudFile, type CloudFileCommit } from './cloudFile';
import { sameSyncScope, sameSyncStamp, validateSyncScope, type SyncScope } from './reconcile';
import { validateSyncRun, type SyncOperation, type SyncRun } from './execute';

/** Queue metadata only. File bytes remain attachments; history stays in Timeline. */
export type CloudWrite = { operation: SyncOperation; scope: SyncScope; folderId: string | null; before: CloudFile | null };
export type CloudSyncRun = SyncRun & { cloudWrites: CloudWrite[] };
export function parseCloudWrite(value: CloudWrite): CloudWrite {
 const row = structuredClone(value);
 validateSyncScope(row.scope);
 validateSyncRun({ version: 1, id: 'validate-' + row.operation?.id, scope: row.scope, operations: [row.operation] });
 if (row.scope.dataPlane !== 'home') throw Error('Cloud file sync requires the home data plane.');
 const op = row.operation, m = op?.mutation;
 if (!m || (m.kind === 'copy' ? m.from !== 'local' || m.source.kind !== 'file' || !m.source.fingerprint : m.side !== 'remote' || m.expected.kind !== 'file')) throw Error('This cloud writer requires a file upload or remote Trash operation.');
 const expected = m.kind === 'copy' ? m.expectedTarget : m.expected;
 row.before = row.before === null ? null : parseCloudFile(row.before);
 if (row.before?.trashed || !sameSyncStamp(expected, row.before ? cloudFileSyncEntry(row.before, m.path) : null) ||
  (row.before && row.before.folderId !== row.folderId) || (row.before && row.before.name !== m.path.split('/').at(-1))) throw Error('Cloud destination changed before preparing the run.');
 // Reuse the API's closed identifier/name validation, including UUID operation IDs.
 parseCloudFileCommit({ id: row.before?.id ?? op.id, operationId: op.id, expectedRevision: row.before?.revision ?? null,
  name: m.path.split('/').at(-1), folderId: row.folderId, attachmentId: 'pending', contentVersion: '0'.repeat(64), trashed: m.kind === 'trash' });
 return row;
}
export function prepareCloudSyncRun(run: SyncRun, targets: { folderId: string | null; before: CloudFile | null }[]): CloudSyncRun {
 validateSyncRun(run);
 if (targets.length !== run.operations.length) throw Error('Every cloud operation requires a pinned destination.');
 return parseCloudSyncRun({ ...structuredClone(run), cloudWrites: run.operations.map((operation, i) => ({ operation, scope: run.scope, ...targets[i] })) });
}
export function parseCloudSyncRun(value: SyncRun & { cloudWrites?: unknown }): CloudSyncRun {
 validateSyncRun(value);
 const run = structuredClone(value) as CloudSyncRun;
 if (!Array.isArray(run.cloudWrites) || run.cloudWrites.length !== run.operations.length) throw Error('Cloud destinations are missing from the durable sync run.');
 run.cloudWrites = run.cloudWrites.map((write, i) => {
  const row = parseCloudWrite(write);
  const expected = { ...run.operations[i], confirmed: false }, actual = { ...row.operation, confirmed: false };
  if (!sameSyncScope(row.scope, run.scope) || JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('Cloud destination does not belong to this operation.');
  return row;
 });
 return run;
}
export function cloudWriteCommit(write: CloudWrite, content: CloudFile['content']): CloudFileCommit {
 const m = write.operation.mutation;
 return parseCloudFileCommit({ id: write.before?.id ?? write.operation.id, operationId: write.operation.id,
  expectedRevision: write.before?.revision ?? null, name: m.path.split('/').at(-1), folderId: write.folderId,
  attachmentId: content.attachmentId, contentVersion: content.version, trashed: m.kind === 'trash' });
}
