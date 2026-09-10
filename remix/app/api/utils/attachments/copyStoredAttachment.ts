import type { AttachmentResult } from './attachments';
import type { AttachmentAccessViewer } from './attachmentAccess';
import type { AttachmentDoc, AttachmentStore } from './attachmentStore';
import type { AttachmentS3 } from './privateS3';
import { isDeepStrictEqual } from 'node:util';
import { toAttachmentPublicMetadata } from './attachmentCore';

type CopyDependencies = {
	canCopy: (ownerId: string) => Promise<boolean>;
	read: (viewer: AttachmentAccessViewer, id: unknown) => Promise<AttachmentResult<{ doc: AttachmentDoc }>>;
	start: (ownerId: string, input: unknown) => Promise<AttachmentResult<{ upload: Record<string, unknown> }>>;
	complete: (ownerId: string, input: unknown) => Promise<AttachmentResult<{ attachment: Record<string, unknown> }>>;
	remove: (ownerId: string, input: unknown) => Promise<AttachmentResult<{ deferred: boolean; retryAt?: string }>>;
	store: Pick<AttachmentStore, 'getOwned' | 'markPartsIssued' | 'insertLinkedReady'>;
	readyDraftTtlMs: number;
	getS3: () => AttachmentS3;
	plan: (bytes: number) => { partCount: number; partSizeBytes: number };
	uuid: () => string;
	now: () => Date;
};

// Internal only: the caller supplies a viewer, never a source URL, bucket,
// object key, upload id or owner identity. The normal upload lifecycle owns
// quota, finalization, moderation, version verification and deletion refunds.
export const copyStoredAttachment = async (
	deps: CopyDependencies, viewer: AttachmentAccessViewer, id: unknown, signal?: AbortSignal
): Promise<AttachmentResult<{ id: string; attachment: Record<string, unknown> }>> => {
	if (!viewer?.id) return { ok: false, status: 401, error: 'Sign in to copy files' };
	let cleanupId: string | undefined;
	const abort = new AbortController();
	const cancel = () => abort.abort();
	if (signal?.aborted) cancel();
	signal?.addEventListener('abort', cancel, { once: true });
	const timeout = setTimeout(() => abort.abort(), 120_000);
	timeout.unref?.();
	const missing = (): AttachmentResult<never> => ({ ok: false, status: 404, error: 'Attachment not found' });
	try {
		if (abort.signal.aborted) throw new Error('Copy timed out');
		// Internal service calls do not pass through the upload HTTP adapter.
		// Preserve its post-purpose approval boundary before reserving anything.
		if (!await deps.canCopy(viewer.id)) return { ok: false, status: 403, error: 'File copying requires a user account approved for public uploads' };
		const initial = await deps.read(viewer, id);
		if (initial.ok === false) return initial;
		const source = initial.doc;
		// Purpose-specific attachments cannot be replayed onto a general app.
		// An admin review permission also must not republish blocked bytes.
		if ((source.attachmentPurpose && source.attachmentPurpose !== 'post') || source.moderation?.status === 'blocked' || source.moderation?.status === 'pending') return missing();
		const linked = source.attachmentLinked === true;
		if (!linked && (!source.objectVersionId || source.objectVersionId === 'null')) return missing();
		// A linked copy preserves a URL, not its bytes. It cannot re-moderate a
		// flagged external object, so never turn that flag into a skipped verdict.
		if (linked && (source.objectSizeBytes !== 0 || source.moderation?.status === 'nsfw')) return missing();
		const stillReadable = async () => {
			if (abort.signal.aborted) throw new Error('Copy timed out');
			if (!await deps.canCopy(viewer.id)) throw new Error('Copy permission changed');
			const fresh = await deps.read(viewer, source.shareId);
			if (!fresh.ok || fresh.doc.ownerId !== source.ownerId || fresh.doc.objectKey !== source.objectKey ||
				fresh.doc.objectVersionId !== source.objectVersionId || fresh.doc.objectSizeBytes !== source.objectSizeBytes ||
				(fresh.doc.attachmentLinked === true) !== linked ||
				(linked && (!isDeepStrictEqual(fresh.doc.crystal, source.crystal) || fresh.doc.moderation?.status === 'nsfw')) ||
				(fresh.doc.attachmentPurpose && fresh.doc.attachmentPurpose !== 'post') ||
				fresh.doc.moderation?.status === 'blocked' || fresh.doc.moderation?.status === 'pending') throw new Error('Copy source changed');
		};
		if (linked) {
			const metadata = toAttachmentPublicMetadata(source.shareId, source.crystal);
			if (!metadata?.url) return missing();
			const { id: _id, nsfw: _nsfw, pending: _pending, ...crystal } = metadata;
			await stillReadable();
			cleanupId = deps.uuid();
			const copy = await deps.store.insertLinkedReady({ id: cleanupId, ownerId: viewer.id, crystal,
				purpose: 'post', expiresAt: new Date(deps.now().getTime() + deps.readyDraftTtlMs) });
			if (copy.shareId !== cleanupId || copy.ownerId !== viewer.id || copy.targetId || copy.attachmentLinked !== true) throw new Error('Copy is unavailable');
			await stillReadable();
			return { ok: true, id: cleanupId, attachment: { ...crystal, id: cleanupId } };
		}
		cleanupId = deps.uuid();
		const started = await deps.start(viewer.id, { requestId: cleanupId, filename: source.crystal.name, contentType: source.crystal.contentType, sizeBytes: source.objectSizeBytes, purpose: 'post' });
		if (!started.ok) throw started;
		if (typeof started.upload.id !== 'string') throw new Error('Copy upload is unavailable');
		cleanupId = started.upload.id;
		const destination = await deps.store.getOwned(viewer.id, cleanupId);
		if (!destination || destination.ownerId !== viewer.id || destination.attachmentState !== 'pending' || !destination.uploadId ||
			destination.objectSizeBytes !== source.objectSizeBytes || destination.targetId || !source.objectVersionId ||
			!destination.attachmentExpiresAt || destination.attachmentExpiresAt <= deps.now()) throw new Error('Copy upload is unavailable');
		const plan = deps.plan(source.objectSizeBytes);
		const s3 = deps.getS3();
		// Mark before starting any S3 write. A timed-out copy can still have an
		// in-flight part; cleanup must keep its reservation until settlement.
		await deps.store.markPartsIssued(viewer.id, cleanupId, deps.now());
		for (let partNumber = 1; partNumber <= plan.partCount; partNumber++) {
			await stillReadable();
			const start = (partNumber - 1) * plan.partSizeBytes;
			await s3.copyUploadPart({
				objectKey: destination.objectKey, uploadId: destination.uploadId, partNumber,
				sourceObjectKey: source.objectKey, sourceVersionId: source.objectVersionId,
				// S3 rejects byte-range copies of sources below 5 MiB. A one-part
				// copy needs no range and still exactly matches its reservation.
				...(plan.partCount > 1 ? { range: { start, end: Math.min(source.objectSizeBytes, start + plan.partSizeBytes) - 1 } } : {}),
				signal: abort.signal
			});
		}
		await stillReadable();
		const completed = await deps.complete(viewer.id, { uploadId: cleanupId });
		if (!completed.ok) throw completed;
		await stillReadable();
		return { ok: true, id: cleanupId, attachment: completed.attachment };
	} catch {
		abort.abort();
		let cleanupPending = false;
		if (cleanupId) {
			try { const removed = await deps.remove(viewer.id, { id: cleanupId }); cleanupPending = !removed.ok || removed.deferred; }
			catch { cleanupPending = true; }
		}
		// Do not surface S3 errors, keys, versions or arbitrary upstream prose.
		return { ok: false, status: 422, error: `Could not copy the file. The original is unchanged.${cleanupPending ? ' Private partial-upload cleanup is pending.' : ''}` };
	} finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
};
