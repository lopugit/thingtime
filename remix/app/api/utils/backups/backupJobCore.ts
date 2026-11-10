import { createHash } from 'node:crypto';
import { backupDigest, backupId, backupJson } from '../../../backups/manifest';
import type { BackupJobKind, BackupJobPhase, BackupJobView } from '../../../backups/workflow';
import type { HashCheckpointRef } from './resumableHash';

export const BACKUP_JOB_KIND = 'backup-job';
export const BACKUP_JOB_EVENT_KIND = 'backup-job-event';
export const BACKUP_JOB_LEASE_MS = 90_000;
export type BackupHashSlot = 'part' | 'composite' | 'manifest';
/** Fixed scalar cursor, independent of dataset size. Item/range history and
 * receipts live in immutable backup objects or relational child Things. */
export type BackupJobCursor = {
	phase: BackupJobPhase; planHash: string | null; sealHash: string | null;
	stage: 'start' | 'count' | 'catalog' | 'part' | 'composite' | 'clear' | 'manifest-prefix' | 'manifest' | 'seal';
	planPage: number | null; headHash: string | null; itemIndex: number;
	rangePage: number; rangeOffset: string; rangeIndex: number;
	bytesProcessed: string; manifestByteLength: string; fileIndex: number; partIndex: number; itemsProcessed: number;
	inventoryBytes: string; chunksProcessed: string; rangeChainHash: string | null; rangeChainExpected: string | null;
	snapshotSeconds: number | null; snapshotIncrement: number | null; inventoryLastId: string | null; inventoryExcluded: number; inventoryReferenceStateHash: string | null; restoreStateHash: string | null; catalogStateHash: string | null;
};
export type BackupJobOperation =
	| { kind: 'snapshot'; snapshotId: string; destinationId: string }
	| { kind: 'review'; sourceJobId: string; sourceRootId: string; destinationId: string; destinationRevision: string }
	| { kind: 'restore'; reviewJobId: string; reviewHash: string };
export type BackupJobLease = Readonly<{ jobId: string; generation: number; leaseId: string }>;
export const backupJobDigest = (value: unknown) => createHash('sha256').update(backupJson(value)).digest('hex');
export const sameBackupJobValue = (a: unknown, b: unknown) => backupJobDigest(a) === backupJobDigest(b);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v);
const decimal = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const keys = (v: any, expected: string) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === expected;
export function parseBackupJobOperation(input: BackupJobOperation): BackupJobOperation {
	if (input?.kind === 'snapshot' && keys(input, 'destinationId,kind,snapshotId') &&
		backupId(input.snapshotId) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(input.destinationId)) return { ...input };
	if (input?.kind === 'review' && keys(input, 'destinationId,destinationRevision,kind,sourceJobId,sourceRootId') &&
		backupId(input.sourceJobId) && [input.sourceRootId, input.destinationId, input.destinationRevision].every(id)) return { ...input };
	if (input?.kind === 'restore' && keys(input, 'kind,reviewHash,reviewJobId') && backupId(input.reviewJobId) && backupDigest(input.reviewHash)) return { ...input };
	throw Error('Invalid protected backup operation');
}
export function parseBackupJobCursor(input: BackupJobCursor): BackupJobCursor {
	if (!keys(input, 'bytesProcessed,catalogStateHash,chunksProcessed,fileIndex,headHash,inventoryBytes,inventoryExcluded,inventoryLastId,inventoryReferenceStateHash,itemIndex,itemsProcessed,manifestByteLength,partIndex,phase,planHash,planPage,rangeChainExpected,rangeChainHash,rangeIndex,rangeOffset,rangePage,restoreStateHash,sealHash,snapshotIncrement,snapshotSeconds,stage') ||
		!['inventory', 'capture', 'verify', 'review', 'restore', 'complete'].includes(input.phase) ||
		!['start', 'count', 'catalog', 'part', 'composite', 'clear', 'manifest-prefix', 'manifest', 'seal'].includes(input.stage) ||
		![input.itemIndex, input.fileIndex, input.partIndex, input.itemsProcessed, input.rangePage, input.rangeIndex, input.inventoryExcluded].every(count) ||
		!((input.snapshotSeconds === null && input.snapshotIncrement === null) ||
			(count(input.snapshotSeconds) && count(input.snapshotIncrement) && input.snapshotSeconds <= 0xffffffff && input.snapshotIncrement <= 0xffffffff)) ||
		!(input.inventoryLastId === null || id(input.inventoryLastId)) ||
		!(input.planPage === null || count(input.planPage)) ||
		![input.planHash, input.sealHash, input.headHash, input.rangeChainHash, input.rangeChainExpected, input.inventoryReferenceStateHash, input.restoreStateHash, input.catalogStateHash].every(value => value === null || backupDigest(value)) ||
		![input.rangeOffset, input.bytesProcessed, input.manifestByteLength, input.inventoryBytes, input.chunksProcessed].every(decimal)) throw Error('Invalid protected backup cursor');
	return { ...input };
}
export const initialBackupJobCursor = (kind: BackupJobKind): BackupJobCursor => ({
	phase: kind === 'snapshot' ? 'inventory' : kind, stage: 'start', planHash: null, sealHash: null, planPage: null, headHash: null,
	itemIndex: 0, rangePage: 0, rangeOffset: '0', rangeIndex: 0, bytesProcessed: '0', manifestByteLength: '0', fileIndex: 0, partIndex: 0, itemsProcessed: 0,
	inventoryBytes: '0', chunksProcessed: '0', rangeChainHash: null, rangeChainExpected: null,
	snapshotSeconds: null, snapshotIncrement: null, inventoryLastId: null, inventoryExcluded: 0, inventoryReferenceStateHash: null, restoreStateHash: null, catalogStateHash: null
});
export function assertBackupHashReference(ref: HashCheckpointRef, bindingHash: string) {
	if (!keys(ref, 'algorithm,bindingHash,complete,finalDigest,implementation,offset,operationId,previousDigest,sequence,stateDigest,stepId') ||
		ref.algorithm !== 'sha256' || ref.implementation !== 'hash-wasm:4.12.0:sha256' || ref.bindingHash !== bindingHash ||
		![ref.bindingHash, ref.stateDigest].every(backupDigest) || ![ref.operationId, ref.stepId].every(backupId) ||
		!count(ref.sequence) || !decimal(ref.offset) || typeof ref.complete !== 'boolean' ||
		!(ref.previousDigest === null || backupDigest(ref.previousDigest)) ||
		!(ref.complete ? backupDigest(ref.finalDigest) : ref.finalDigest === null)) throw Error('Invalid protected hash reference');
}
/** UUID-v4-shaped stable operation identity. Every hash stream includes its
 * item/part identity; the job UUID itself is never reused as a hash operation. */
export function backupHashOperationId(jobId: string, stream: BackupHashSlot, item: string, part: string) {
	if (!backupId(jobId) || !['part', 'composite', 'manifest'].includes(stream) || !id(item) || !id(part)) throw Error('Invalid backup hash identity');
	const chars = backupJobDigest(['thingtime-backup-hash-v1', jobId, stream, item, part]).slice(0, 32).split('');
	chars[12] = '4'; chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16], 16) % 4];
	const value = chars.join('');
	return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export function backupJobView(doc: any): BackupJobView {
	const cursor = parseBackupJobCursor(doc.backupCursor);
	return { id: doc.shareId, kind: doc.backupOperation.kind, status: doc.backupStatus,
		progress: { phase: cursor.phase, items: cursor.itemsProcessed, bytes: cursor.bytesProcessed },
		createdAt: new Date(doc.createdAt).toISOString(), updatedAt: new Date(doc.updatedAt).toISOString(), issue: doc.backupIssue ?? null };
}
