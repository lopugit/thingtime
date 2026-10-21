import { CLOUD_NATIVE_DOWNLOAD_REQUIREMENTS, parseSignedDownloadTarget } from './signedDownloadTarget';
import { cloudRequests, type CloudTransportRuntime } from './cloudTransport';
import { cloudFileSyncEntry, parseCloudFile, type CloudFile } from './cloudFile';
import { sameSyncStamp, validateSyncScope, type SyncScope } from './reconcile';
import type { FingerprintSource } from './contentFingerprint';
import { MAX_ATTACHMENT_RANGE_BYTES, readExactRange } from '../api/utils/attachments/attachmentRanges';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';

/** Pinned cloud bytes for native staged publication. A destination adapter must
 * verify the complete planned fingerprint before atomic/CAS publication and
 * retain its receipt by operation ID. Reading bytes alone never overwrites files. */
export function createCloudDownloadSource(
	runtime: CloudTransportRuntime,
	inputScope: SyncScope,
	inputFile: CloudFile,
	signal?: AbortSignal
): FingerprintSource {
	const scope = { ...inputScope },
		file = parseCloudFile(structuredClone(inputFile));
	validateSyncScope(scope);
	if (scope.dataPlane !== 'home' || file.trashed) throw Error('Download source is unavailable.');
	const { check: checkContext, json, negotiate } = cloudRequests(runtime, scope, signal);
	const check = async () => {
		await negotiate(file.content.size === 0
			? { 'api.files': '1.8.0', 'api.attachment-content': '1.16.0' }
			: { 'api.files': '1.0.0', 'api.attachment-content': '1.14.0' });
		const current = parseCloudFile((await json('/api/v1/files?' + new URLSearchParams({ id: file.id }))).file);
		if (
			current.trashed ||
			current.folderId !== file.folderId ||
			current.name !== file.name ||
			!sameSyncStamp(cloudFileSyncEntry(file, file.name), cloudFileSyncEntry(current, current.name))
		)
			throw Error('Cloud source changed. Preserve the staged download.');
		checkContext();
	};
	return {
		nativeCloud: structuredClone({ scope, file }),
		downloadTarget: async (offset, length, callerSignal) => {
			callerSignal?.throwIfAborted();
			if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_ATTACHMENT_RANGE_BYTES || !Number.isSafeInteger(offset + length) || offset + length > file.content.size) throw Error('Invalid native download range.');
			const active = AbortSignal.any([...(signal ? [signal] : []), ...(callerSignal ? [callerSignal] : [])]), targetRequests = cloudRequests(runtime, scope, active);
			await targetRequests.negotiate(CLOUD_NATIVE_DOWNLOAD_REQUIREMENTS); await check(); active.throwIfAborted();
			const value = await targetRequests.json('/api/v1/attachments/content?' + new URLSearchParams({ id: file.content.attachmentId, target: '1', range: '1', version: file.content.version, offset: String(offset), length: String(length) }));
			callerSignal?.throwIfAborted(); await check();
			return parseSignedDownloadTarget(value.target, scope.ownerId, file, offset, length);
		},
		size: file.content.size,
		check,
		verify: check,
		read: async (offset, length, callerSignal) => {
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				!Number.isSafeInteger(length) ||
				length < 0 ||
				length > 32 * 1024 * 1024 ||
				offset + length > file.content.size
			)
				throw Error('Invalid cloud download range.');
			const active = AbortSignal.any([...(signal ? [signal] : []), ...(callerSignal ? [callerSignal] : [])]);
			const guard = () => {
				active.throwIfAborted();
				checkContext();
			};
			guard();
			await check();
			guard();
			const bytes = new Uint8Array(length);
			for (let at = 0; at < length; at += MAX_ATTACHMENT_RANGE_BYTES) {
				guard();
				const range = { version: file.content.version, offset: offset + at, length: Math.min(MAX_ATTACHMENT_RANGE_BYTES, length - at) };
				const query = new URLSearchParams({
					id: file.content.attachmentId,
					range: '1',
					version: range.version,
					offset: String(range.offset),
					length: String(range.length)
				});
				const response = await runtime.fetch(new URL('/api/v1/attachments/content?' + query, scope.origin), {
					method: 'GET',
					credentials: 'same-origin',
					cache: 'no-store',
					redirect: 'error',
					signal: AbortSignal.any([active, AbortSignal.timeout(30_000)]),
					headers: { [EXPECTED_ACTOR_HEADER]: scope.ownerId, [EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane }
				});
				try {
					guard();
				} catch (error) {
					await response.body?.cancel().catch(() => {});
					throw error;
				}
				if (!response.ok) {
					await response.body?.cancel();
					throw Error(`Cloud download request failed (${response.status}); retain this run for retry or reconciliation.`);
				}
				if (response.headers.get('ETag') !== `"${range.version}"`) {
					await response.body?.cancel();
					throw Error('Cloud range version is unavailable or changed.');
				}
				const paced = runtime.resources && response.body ? new Response(runtime.resources.stream('download', response.body, active), { status: response.status, headers: response.headers }) : response;
				bytes.set(await readExactRange(paced, range, file.content.size, guard), at);
				guard();
			}
			await check();
			guard();
			return bytes;
		}
	};
}
