import type { FileSyncApproval } from './configuredPlan';
import type { CloudFile } from './cloudFile';
import type { SyncScope } from './reconcile';
/** Canonical multipart fingerprint. This is SHA-256 of concatenated part
 * SHA-256 digests, not the whole-file SHA-256. Part boundaries are part of the
 * identity and match the attachment service's verified multipart protocol. */
export type ContentFingerprint = {
	algorithm: 'sha256-parts-v1';
	partSizeBytes: number;
	partCount: number;
	sha256: string;
};
export const EMPTY_CONTENT_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const MIN_CONTENT_PART_BYTES = 8 * 1024 * 1024;
export const MAX_CONTENT_PART_BYTES = 5 * 1024 * 1024 * 1024;
export function contentPartPlan(size: number): { partSizeBytes: number; partCount: number } {
	if (!Number.isSafeInteger(size) || size < 0) throw new Error('A stored attachment must have a nonnegative exact byte size.');
	const oneMiB = 1024 * 1024;
	const partSizeBytes = Math.ceil(Math.max(MIN_CONTENT_PART_BYTES, Math.ceil(size / 10_000)) / oneMiB) * oneMiB;
	if (partSizeBytes > MAX_CONTENT_PART_BYTES) throw new Error('Attachment is too large.');
	return { partSizeBytes, partCount: Math.ceil(size / partSizeBytes) };
}
export function validContentFingerprint(value: unknown, size: number): value is ContentFingerprint {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const f = value as ContentFingerprint;
	try {
		const plan = contentPartPlan(size);
		return f.algorithm === 'sha256-parts-v1' && f.partCount === plan.partCount && f.partSizeBytes === plan.partSizeBytes && /^[a-f0-9]{64}$/.test(f.sha256) && (size !== 0 || f.sha256 === EMPTY_CONTENT_SHA256);
	} catch { return false; }
}
export const equalContentFingerprints = (a: ContentFingerprint, b: ContentFingerprint): boolean =>
	a.algorithm === b.algorithm && a.partSizeBytes === b.partSizeBytes && a.partCount === b.partCount && a.sha256 === b.sha256;

export type NativeFileUpload = { uploadId: string; requestId: string; authorization: FileSyncApproval };
export type NativePartUpload = { uploadId: string; requestId: string; partNumber: number; offset: number; length: number };
export type FingerprintSource = {
	/** Native multipart loop and attachment completion. The caller still verifies
	 * stored bytes and publishes the canonical file/Timeline operation. */
	uploadFile?(request: NativeFileUpload, signal?: AbortSignal, progress?: (bytes: number, total: number) => void): Promise<{ fingerprint: ContentFingerprint }>;

	/** Native file-backed multipart upload. Resolves only after authenticated
	 * signing, bounded storage upload and source checks; returns the part hash. */
	uploadPart?(request: NativePartUpload, signal?: AbortSignal): Promise<{ sha256: string; payloadBytes?: number }>;

	/** Trusted native-part adapter validates the expected source before/after PUT.
	 * Only removes duplicate wrapper checks; initial, pre-complete and final
	 * source verification remain mandatory. Never supplied by cloud metadata. */
	nativePartSourceChecks?: true;

	/** Negotiated trusted Mac receipt measures only completed PUT payloads. */
	nativePartPayloadBytes?: true;

	/** Pinned descriptor for native byte transport, reauthorized by the host. */
	nativeCloud?: { scope: SyncScope; file: CloudFile };
	size: number;
	/** Read exactly this range from one pinned source version. A native adapter
	 * must refuse changed files instead of returning bytes from another version. */
	read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
	check(): void | Promise<void>;
	/** Providers with cheap range checks perform their full source validation
	 * here before publishing a file. Throwing preserves the unfinished run. */
	verify?(): void | Promise<void>;
};
/** At most one canonical part is resident. Native large-part adapters may
 * provide incremental SHA-256; the browser adapter below has an explicit cap. */
export async function fingerprintSource(source: FingerprintSource, options: {
	signal?: AbortSignal;
	hash?: (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>;
	maxPartBytes?: number;
	progress?: (bytes: number, total: number) => void;
} = {}): Promise<ContentFingerprint> {
	const size = source.size, plan = contentPartPlan(size);
	const maxPartBytes = options.maxPartBytes ?? 32 * 1024 * 1024;
	if (!Number.isSafeInteger(maxPartBytes) || maxPartBytes <= 0 || (plan.partCount > 0 && plan.partSizeBytes > maxPartBytes)) throw new Error('This file requires native streaming fingerprint support.');
	const hash = options.hash ?? (async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
	const check = async () => { options.signal?.throwIfAborted(); await source.check(); options.signal?.throwIfAborted(); if (source.size !== size) throw new Error('File changed while computing its fingerprint.'); };
	const parts = new Uint8Array(plan.partCount * 32);
	await check();
	for (let i = 0; i < plan.partCount; i++) {
		const offset = i * plan.partSizeBytes, length = Math.min(plan.partSizeBytes, size - offset);
		const bytes = await source.read(offset, length, options.signal); await check();
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) throw new Error('File read was incomplete.');
		const digest = await hash(bytes); await check();
		if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) throw new Error('Invalid SHA-256 result.');
		parts.set(digest, i * 32); options.progress?.(offset + length, size);
	}
	const digest = await hash(parts); await check();
	if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) throw new Error('Invalid SHA-256 result.');
	return { algorithm: 'sha256-parts-v1', ...plan, sha256: [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('') };
}
