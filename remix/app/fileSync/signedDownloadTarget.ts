import type { CloudFile } from './cloudFile';
import { equalContentFingerprints, validContentFingerprint, type ContentFingerprint } from './contentFingerprint';
export const CLOUD_NATIVE_DOWNLOAD_REQUIREMENTS = { 'api.attachment-content': '1.17.0' } as const;
export type SignedDownloadTarget = { version: 1; ownerId: string; attachmentId: string; contentVersion: string; size: number; offset: number; length: number; fingerprint: ContentFingerprint; url: string; expiresAt: string; headers: { Range: string } };
/** Whitelist ephemeral transport authority. It must never enter saved progress,
 * a journal, Things, diagnostics or persistent browser storage. */
export function parseSignedDownloadTarget(value: unknown, ownerId: string, file: CloudFile, offset: number, length: number, now = Date.now()): SignedDownloadTarget {
 const t = value as SignedDownloadTarget, content = file.content;
 if (!t || t.version !== 1 || t.ownerId !== ownerId || t.attachmentId !== content.attachmentId || t.contentVersion !== content.version ||
 t.size !== content.size || !Number.isSafeInteger(t.size) || t.size < 0 || t.offset !== offset || t.length !== length || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 2 * 1024 * 1024 || !Number.isSafeInteger(offset + length) || offset + length > t.size ||
 !validContentFingerprint(t.fingerprint, t.size) || !equalContentFingerprints(t.fingerprint, content.fingerprint) || !t.headers || Object.keys(t.headers).length !== 1 || t.headers.Range !== `bytes=${offset}-${offset+length-1}`) throw Error('Signed download target changed. Preserve the staged file.');
 let url: URL; try { url = new URL(t.url); } catch { throw Error('Signed download target unavailable.'); }
 const expires = Date.parse(t.expiresAt);
 if (url.protocol !== 'https:' || url.username || url.password || url.hash || !Number.isFinite(expires) || expires <= now || expires > now + 60000) throw Error('Signed download target expired or unavailable. Retry the same range.');
 return { version: 1, ownerId, attachmentId: t.attachmentId, contentVersion: t.contentVersion, size: t.size, offset, length, fingerprint: structuredClone(t.fingerprint), url: t.url, expiresAt: t.expiresAt, headers: { Range: t.headers.Range } };
}
/** Upload-only policies do not depend on signed download authority. */
export function fileSyncDownloadRequirements(configuration: Pick<import('./configuration').FileSyncConfiguration, 'mode' | 'resourceLimits'>): Record<string, string> {
 return configuration.resourceLimits?.cpuPercent && ['download', 'two-way'].includes(configuration.mode) ? { ...CLOUD_NATIVE_DOWNLOAD_REQUIREMENTS } : {};
}
