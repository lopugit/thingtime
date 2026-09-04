import localforage from 'localforage';

import { attachmentMediaSrc, attachmentPlaybackContentType } from './attachmentUiCore';
import type { PublicAttachment } from './attachmentTypes';

const CACHE_VERSION = 'v1';
const store = localforage.createInstance({
	name: 'thingtime',
	storeName: 'audio_playback_cache_v1',
	description: 'User-requested offline copies of Thingtime audio attachments.'
});

export type OfflineAudioRecord = {
	version: typeof CACHE_VERSION;
	attachmentId: string;
	viewerId: string;
	contentType: string;
	bytes: Blob;
	cachedAt: number;
};

// Scope a blob to the currently authenticated Thingtime account. An anonymous
// browser can cache only a publicly readable attachment under `anonymous`; a
// later account switch cannot reuse a private listener's saved bytes.
export const audioOfflineCacheKey = (attachmentId: string, viewerId: string | null | undefined): string =>
	`thingtime:audio:${CACHE_VERSION}:${encodeURIComponent(viewerId || 'anonymous')}:${encodeURIComponent(attachmentId)}`;

export const isOfflineAudioRecord = (value: unknown): value is OfflineAudioRecord => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Partial<OfflineAudioRecord>;
	return (
		record.version === CACHE_VERSION &&
		typeof record.attachmentId === 'string' &&
		Boolean(record.attachmentId) &&
		typeof record.viewerId === 'string' &&
		typeof record.contentType === 'string' &&
		typeof record.cachedAt === 'number' &&
		Number.isFinite(record.cachedAt) &&
		typeof Blob !== 'undefined' &&
		record.bytes instanceof Blob
	);
};

export const readOfflineAudio = async (attachmentId: string, viewerId: string | null | undefined): Promise<Blob | null> => {
	if (typeof window === 'undefined') return null;
	const key = audioOfflineCacheKey(attachmentId, viewerId);
	try {
		const record = await store.getItem<unknown>(key);
		if (record === null) return null;
		if (isOfflineAudioRecord(record)) return record.bytes;
		await store.removeItem(key);
		return null;
	} catch {
		return null;
	}
};

export const removeOfflineAudio = async (attachmentId: string, viewerId: string | null | undefined): Promise<void> => {
	if (typeof window === 'undefined') return;
	await store.removeItem(audioOfflineCacheKey(attachmentId, viewerId));
};

export const saveOfflineAudio = async (attachment: PublicAttachment, viewerId: string | null | undefined): Promise<Blob> => {
	if (typeof window === 'undefined') throw new Error('Offline audio is available in a browser only.');
	if (attachment.url) throw new Error('Only Thingtime-hosted audio can be saved for offline playback.');

	const response = await fetch(attachmentMediaSrc(attachment), { credentials: 'same-origin', cache: 'no-store' });
	if (!response.ok) throw new Error('Thingtime could not download this audio file.');
	const downloaded = await response.blob();
	if (!downloaded.size || (attachment.size > 0 && downloaded.size !== attachment.size)) {
		throw new Error('Thingtime received an incomplete audio file. Please try again.');
	}
	// Blob.type from an S3 redirect may be generic for legacy rows. Preserve the
	// best detected audio MIME so an offline <audio> element gets the same hint
	// as the streaming player.
	const bytes = new Blob([downloaded], { type: attachmentPlaybackContentType(attachment) });
	const record: OfflineAudioRecord = {
		version: CACHE_VERSION,
		attachmentId: attachment.id,
		viewerId: viewerId || 'anonymous',
		contentType: bytes.type,
		bytes,
		cachedAt: Date.now()
	};
	await store.setItem(audioOfflineCacheKey(attachment.id, viewerId), record);
	return bytes;
};
