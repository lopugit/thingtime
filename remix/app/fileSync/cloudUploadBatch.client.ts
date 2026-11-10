import { cloudRequests, type CloudTransportRuntime } from './cloudTransport';
import { cloudFileSyncEntry } from './cloudFile';
import type { SyncReceipt } from './execute';
import type { TransferActivity } from './transferActivity';
import { SyncConnectionWait } from './syncConnectionWait';
import {
	parseNativeUploadBatchResult,
	parseUploadBatchCommitResponse,
	uploadBatchDigest,
	UPLOAD_BATCH_METADATA_BYTES,
	UPLOAD_BATCH_REQUIREMENTS,
	type NativeUploadBatch,
	type UploadBatchDescriptor,
	type UploadBatchFailure,
	type UploadBatchConfirmed
} from './uploadBatch';

/** Existing MPU storage and canonical file writers; only independent work is
 * grouped. Every outcome retains its original operation and upload identity. */
export async function executeCloudUploadBatch(
	descriptor: UploadBatchDescriptor,
	native: NativeUploadBatch,
	runtime: CloudTransportRuntime,
	signal: AbortSignal,
	input: { markCommit(ordinals: number[]): Promise<void>; confirm(receipt: SyncReceipt): Promise<void>; transfer?(value: TransferActivity): void }
) {
	const { check, json, negotiate } = cloudRequests(runtime, descriptor.scope, signal, UPLOAD_BATCH_METADATA_BYTES);
	await negotiate(UPLOAD_BATCH_REQUIREMENTS);
	const request = { descriptor, digest: await uploadBatchDigest(descriptor) };
	check();
	input.transfer?.({ direction: 'upload', bytes: 0 });
	let value;
	try {
		value = await native(request, {}, signal);
	} catch (error) {
		input.transfer?.({ direction: 'upload', bytes: null });
		throw error;
	}
	check();
	const result = parseNativeUploadBatchResult(value, request);
	// A batch receipt is acknowledged payload telemetry, not wire progress. All
	// measurements share the pre-dispatch baseline; never use retained offsets.
	if (result.payloads.some((p) => p.bytes === null)) input.transfer?.({ direction: 'upload', bytes: null });
	else input.transfer?.({ direction: 'upload', bytes: result.payloads.reduce((n, p) => n + p.bytes!, 0) });
	const failures: UploadBatchFailure[] = [];
	const confirm = async (r: UploadBatchConfirmed) => {
		check();
		const write = descriptor.members[r.ordinal].write;
		const receipt = { operationId: write.operation.id, scope: descriptor.scope, entry: cloudFileSyncEntry(r.file, write.operation.mutation.path) };
		await input.confirm(receipt);
		check();
		if (!r.replayed) input.transfer?.({ direction: 'upload', kind: 'file' });
	};
	for (const r of result.results) {
		if (r.status === 'confirmed') await confirm(r);
		else if (r.status === 'failed') failures.push(r);
	}
	const terminal = failures.find((r) => ['authority-changed', 'invalid-member', 'cancelled'].includes(r.code));
	if (terminal) throw uploadBatchFailure(terminal);
	const verified = result.results.filter((r) => r.status === 'verified');
	if (verified.length) {
		// Native final source checks followed stored fingerprint lookup. This
		// POST retains the shared fresh configuration/native mutation policy.
		await input.markCommit(verified.map((r) => r.ordinal));
		check();
		const committed = parseUploadBatchCommitResponse(
			await json('/api/v1/files/batches', {
				phase: 'commit',
				...request,
				contents: verified.map((r) => r.content)
			}),
			request,
			verified.map((r) => r.ordinal)
		);
		for (const r of committed.results) {
			if (r.status === 'confirmed') await confirm(r);
			else failures.push(r);
		}
	}
	return failures;
}

export function uploadBatchFailure(error: UploadBatchFailure): Error {
	if (error.retryable)
		return new SyncConnectionWait('A bounded upload batch is temporarily unavailable. Original operations are retained for recovery.');
	return Error(`Upload batch member requires reconciliation (${error.code}). Original operations are retained.`);
}
