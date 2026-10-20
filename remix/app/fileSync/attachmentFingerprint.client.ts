import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { validContentFingerprint } from './contentFingerprint';
import { sameSyncScope, validateSyncScope, validSyncPath, type SyncScope, type SyncEntry } from './reconcile';

export const ATTACHMENT_FINGERPRINT_REQUIREMENTS = { 'api.attachment-content': '1.13.0' } as const;
export function attachmentFingerprintEntry(value: unknown, attachmentId: string, path: string): SyncEntry {
	if (!value || typeof value !== 'object' || !validSyncPath(path)) throw new Error('Invalid attachment fingerprint response.');
	const response = value as Record<string, unknown>;
	if (response.ok !== true || response.id !== attachmentId || typeof attachmentId !== 'string' || !attachmentId || attachmentId.length > 512 ||
		typeof response.version !== 'string' || !/^[a-f0-9]{64}$/.test(response.version) || typeof response.size !== 'number' ||
		!validContentFingerprint(response.fingerprint, response.size)) throw new Error('Invalid attachment fingerprint response.');
	return { path, id: attachmentId, version: response.version, kind: 'file', size: response.size, sha256: null, fingerprint: { ...response.fingerprint } };
}
/** Browser transport stays on the selected origin and never interprets 404,
 * missing digests or a failed scan as permission to remove a local file. */
export async function readAttachmentSyncEntry(input: {
	attachmentId: string; path: string; scope: SyncScope; currentScope(): SyncScope; signal?: AbortSignal;
}): Promise<SyncEntry> {
	// Pin caller-owned values before any asynchronous work.
	const scope = { ...input.scope };
	const { attachmentId, path, signal } = input;
	validateSyncScope(scope);
	const check = () => {
		signal?.throwIfAborted();
		if (window.location.origin !== scope.origin || !sameSyncScope(scope, input.currentScope())) throw new Error('Sync context changed.');
	};
	check(); await requireThingtimeCapability('api.attachment-content', ATTACHMENT_FINGERPRINT_REQUIREMENTS['api.attachment-content']); check();
	const params = new URLSearchParams({ id: attachmentId, fingerprint: '1' });
	const response = await fetch(`/api/v1/attachments/content?${params}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { Accept: 'application/json' } });
	check();
	if (!response.ok) throw new Error(`Cloud file fingerprint is unavailable (${response.status}); keep the current sync state.`);
	// This endpoint has a small fixed schema; bound responses before JSON parse.
	if (!response.body) throw new Error('Missing attachment fingerprint response.');
	const reader = response.body.getReader(); let total = 0; const chunks: Uint8Array[] = [];
	try {
		for (;;) { const next = await reader.read(); check(); if (next.done) break; total += next.value.length; if (total > 8192) throw new Error('Attachment fingerprint response is too large.'); chunks.push(next.value); }
	} finally { await reader.cancel(); reader.releaseLock(); }
	const bytes = new Uint8Array(total); let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	check(); return attachmentFingerprintEntry(JSON.parse(new TextDecoder().decode(bytes)), attachmentId, path);
}
