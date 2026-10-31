import { cloudRequests, type CloudTransportRuntime } from './cloudTransport';
import { cloudFolderSyncEntry } from './cloudFolder';
import type { SyncReceipt } from './execute';
import { SyncConnectionWait } from './syncConnectionWait';
import {
	FOLDER_BATCH_REQUIREMENTS,
	folderBatchDigest,
	parseFolderBatchDescriptor,
	parseFolderBatchProbeResponse,
	parseFolderBatchCommitResponse,
	parseNativeFolderBatchResult,
	type FolderBatchDescriptor,
	type FolderBatchFailure,
	type NativeFolderBatch,
	type FolderBatchConfirmed
} from './folderBatch';
import { UPLOAD_BATCH_LIFETIME_MS, UPLOAD_BATCH_DISPATCH_MS, UPLOAD_BATCH_METADATA_BYTES } from './uploadBatch';

/** Receipt history precedes local IO; validation is never persisted authority.
 * Only the canonical server receipt advances the existing durable journal. */
export async function executeCloudFolderBatch(
	value: FolderBatchDescriptor,
	native: NativeFolderBatch,
	runtime: CloudTransportRuntime,
	outerSignal: AbortSignal,
	input: { markCommit(ordinals: number[]): Promise<void>; confirm(receipt: SyncReceipt): Promise<void>; folder?(): void; now?(): number }
) {
	const d = parseFolderBatchDescriptor(value),
		now = input.now ?? (() => performance.now()),
		started = now();
	const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(UPLOAD_BATCH_LIFETIME_MS)]);
	const { check, negotiate } = cloudRequests(runtime, d.scope, signal, UPLOAD_BATCH_METADATA_BYTES);
	const deadline = started + UPLOAD_BATCH_LIFETIME_MS;
	const remaining = () => {
		check();
		const current = now();
		if (!Number.isFinite(started) || !Number.isFinite(current) || current < started || current >= deadline)
			throw new SyncConnectionWait('Folder batch deadline reached. Original operations are retained.');
		return Math.max(1, Math.floor(deadline - current));
	};
	await negotiate(FOLDER_BATCH_REQUIREMENTS);
	remaining();
	const request = { descriptor: d, digest: await folderBatchDigest(d) };
	const read = cloudRequests({ ...runtime, authorizeMutation: undefined }, d.scope, signal, UPLOAD_BATCH_METADATA_BYTES);
	const probe = parseFolderBatchProbeResponse(await read.json('/api/v1/files/batches', { phase: 'folder-probe', ...request }), request);
	remaining();
	const failures: FolderBatchFailure[] = [],
		confirmed = new Set<number>();
	const confirm = async (r: FolderBatchConfirmed) => {
		remaining();
		const w = d.members[r.ordinal].write;
		await input.confirm({ operationId: w.operation.id, scope: d.scope, entry: cloudFolderSyncEntry(r.folder, w.operation.mutation.path) });
		remaining();
		confirmed.add(r.ordinal);
		if (!r.replayed) input.folder?.();
	};
	for (const r of probe.results) {
		if (r.status === 'confirmed') await confirm(r);
		else if (r.status === 'failed') failures.push(r);
	}
	const terminal = () => failures.find((f) => f.retryable || ['authority-changed', 'invalid-member', 'cancelled', 'deadline'].includes(f.code));
	if (terminal()) throw folderBatchFailure(terminal()!);
	const ordinals = probe.results.filter((r) => r.status === 'source-required').map((r) => r.ordinal);
	if (!ordinals.length) return failures;
	const nativeInput = { ...request, ordinals, remainingMs: remaining() };
	const validated = parseNativeFolderBatchResult(await native(nativeInput, signal), nativeInput);
	remaining();
	const validatedAt = now(),
		ready = new Set<number>();
	for (const r of validated.results) {
		const parent = d.members[r.ordinal].parent;
		if (r.status === 'failed') failures.push({ ...r, statusCode: r.code === 'source-changed' ? 412 : 400 });
		else if (parent.kind === 'member' && !confirmed.has(parent.ordinal) && !ready.has(parent.ordinal))
			failures.push({ ordinal: r.ordinal, status: 'failed', statusCode: 409, code: 'dependency-unavailable', retryable: false });
		else ready.add(r.ordinal);
	}
	if (terminal()) throw folderBatchFailure(terminal()!);
	if (!ready.size) return failures;
	const selected = [...ready];
	const dispatchCheck = () => {
		remaining();
		if (now() - validatedAt >= UPLOAD_BATCH_DISPATCH_MS || now() < validatedAt)
			throw new SyncConnectionWait('Folder source validation expired before dispatch. Original operations are retained.');
	};
	const write = cloudRequests(
		{
			...runtime,
			authorizeMutation: async (signal) => {
				await runtime.authorizeMutation?.(signal);
				dispatchCheck();
				await input.markCommit(selected);
				dispatchCheck();
			}
		},
		d.scope,
		signal,
		UPLOAD_BATCH_METADATA_BYTES
	);
	dispatchCheck();
	const result = parseFolderBatchCommitResponse(
		await write.json('/api/v1/files/batches', { phase: 'folder-commit', ...request, ordinals: selected }),
		request,
		selected
	);
	for (const r of result.results) {
		if (r.status === 'confirmed') await confirm(r);
		else failures.push(r);
	}
	return failures;
}
export function folderBatchFailure(f: FolderBatchFailure): Error {
	return f.retryable || f.code === 'deadline'
		? new SyncConnectionWait('Folder metadata is temporarily unavailable. Original operations are retained for recovery.')
		: Error(`Folder metadata requires reconciliation (${f.code}). Original operations are retained.`);
}
