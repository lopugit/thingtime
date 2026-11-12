import { getHomeThingsCollection } from '../mongodb/collections';
import { getAttachmentDownload } from '../attachments/attachments';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { deviceHash } from './deviceCore';
import { preparedSoundFilename } from './deviceAlertCore';

/** Only durable owned approved upload bytes may become executable device media. */
export async function resolveDeviceMedia(ownerId: string, deviceId: string, kind: string, input: any, session?: any) {
	const things = await getHomeThingsCollection();
	if (kind === 'notification.show' && input?.sound?.kind === 'prepared') {
		const row = await things.findOne(
			{ thingtime: 'device-alert-sound', ownerId, targetId: deviceId, 'crystal.soundId': input.sound.id, 'crystal.status': 'ready' },
			session ? { session } : undefined
		);
		const device = await things.findOne({ thingtime: 'device', ownerId, shareId: deviceId }, session ? { session } : undefined);
		if (!row || !device?.crystal?.alertCacheGeneration || row.crystal.cacheGeneration !== device.crystal.alertCacheGeneration)
			return { ok: false as const, status: 409, error: 'This sound is not prepared in the current device installation' };
		const audio = await ownedAudio(ownerId, row.crystal.attachmentId, row.crystal.versionId, session);
		if (audio.ok === false) return audio;
		return { ok: true as const, input };
	}
	if (!['media.play', 'media.prepare'].includes(kind)) return { ok: true as const, input };
	const audio = await ownedAudio(ownerId, input.attachmentId, input.versionId, session);
	if (audio.ok === false) return audio;
	const soundId = kind === 'media.prepare' ? deviceHash('prepared-sound', ownerId, deviceId, input.attachmentId, audio.versionId) : undefined;
	return { ok: true as const, input: { ...input, versionId: audio.versionId, ...(soundId ? { soundId } : {}) } };
}
export async function ownedAudio(ownerId: string, attachmentId: string, versionId?: string, session?: any) {
	const row = await (
		await getHomeThingsCollection()
	).findOne({ shareId: attachmentId, ownerId, thingtime: 'attachment' }, session ? { session } : undefined);
	const moderation = row?.moderation;
	// Audio is not image-analyzable. Only a protected, completed pipeline decision may skip analysis.
	const approved =
		moderation?.status === 'clear' ||
		(moderation?.status === 'skipped' &&
			moderation?.analyzedAt &&
			(moderation?.categories?.includes('not-analyzable') || moderation?.provider === 'off'));
	if (
		!row ||
		row.attachmentState !== 'ready' ||
		row.attachmentPurpose !== 'file' ||
		row.attachmentLinked ||
		row.attachmentExpiresAt ||
		typeof row.objectVersionId !== 'string' ||
		typeof row.objectKey !== 'string' ||
		!approved ||
		moderation?.flagPending === true ||
		!/^audio\//.test(row.crystal?.detectedContentType || row.crystal?.contentType || '')
	)
		return { ok: false as const, status: 404, error: 'Approved owned audio upload not found' };
	const pinned = attachmentContentVersion(row.shareId, row.objectKey, row.objectVersionId);
	if (versionId !== undefined && versionId !== pinned) return { ok: false as const, status: 409, error: 'The uploaded audio version changed' };
	return { ok: true as const, versionId: pinned, attachmentId, contentType: row.crystal.detectedContentType || row.crystal.contentType };
}
export async function downloadDeviceMedia(ownerId: string, attachmentId: string, versionId: string) {
	const audio = await ownedAudio(ownerId, attachmentId, versionId);
	if (audio.ok === false) return audio;
	const result = await getAttachmentDownload({ id: ownerId }, attachmentId, true);
	if (result.ok === false) return result;
	if (result.version !== versionId) return { ok: false as const, status: 409, error: 'The uploaded audio version changed' };
	// A second authorization read fences replacement/moderation during URL creation.
	const current = await ownedAudio(ownerId, attachmentId, versionId);
	if (current.ok === false) return current;
	return {
		ok: true as const,
		url: result.url,
		attachmentId,
		versionId,
		size: result.size,
		contentType: audio.contentType,
		expiresAt: result.expiresAt
	};
}
export { preparedSoundFilename };
