import { isCanonicalAttachmentContentType } from './attachmentCore';
import type { AttachmentCrystal, AttachmentMediaKind } from './attachmentCore';

export const ATTACHMENT_INLINE_CONTENT_TYPES = new Set([
	'image/avif',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
	'video/3gpp',
	'video/3gpp2',
	'video/mp4',
	'video/ogg',
	'video/quicktime',
	'video/webm',
	'video/x-m4v',
	'video/x-matroska'
]);

const extensionFromName = (name: string) => {
	const match = /\.([A-Za-z0-9]{1,12})$/.exec(name);
	return match?.[1]?.toLowerCase() || '';
};

export const detectedAttachmentType = (
	detectedMime: string | undefined,
	originalName: string
): { contentType: string; mediaKind: AttachmentMediaKind; detectedContentType?: string } => {
	const mime = String(detectedMime || '').toLowerCase();

	// file-type can identify many active or browser-executable formats. Only a
	// deliberately curated passive raster/video set is ever allowed to render
	// inline. Audio is a separate safe sink: keeping its detected MIME gives the
	// native decoder the information it needs for recordings such as M4A, FLAC,
	// and Ogg instead of forcing the bytes through as application/octet-stream.
	if (mime.startsWith('audio/') && isCanonicalAttachmentContentType(mime)) {
		return { contentType: mime, mediaKind: 'audio' };
	}
	if (ATTACHMENT_INLINE_CONTENT_TYPES.has(mime)) {
		return { contentType: mime, mediaKind: mime.startsWith('image/') ? 'image' : 'video' };
	}

	// Everything else is stored and delivered as opaque bytes; the filename
	// extension never influences the decision. The sniffed type is preserved as
	// display metadata so a download row can still name the real container
	// (for example video/x-msvideo for an AVI).
	void extensionFromName(originalName);
	return {
		contentType: 'application/octet-stream',
		mediaKind: 'file',
		...(mime && mime !== 'application/octet-stream' && isCanonicalAttachmentContentType(mime) ? { detectedContentType: mime } : {})
	};
};

const asciiFilename = (name: string) => {
	const fallback = name
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[^\x20-\x7e]/g, '_')
		.replace(/["\\]/g, '_')
		.trim()
		.slice(0, 150);
	return fallback || 'attachment';
};

const encodeRfc5987 = (value: string) =>
	encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export const attachmentContentDisposition = (name: string, inline: boolean) =>
	`${inline ? 'inline' : 'attachment'}; filename="${asciiFilename(name)}"; filename*=UTF-8''${encodeRfc5987(name)}`;

export const attachmentMayRenderInline = (crystal: AttachmentCrystal): boolean =>
	(crystal.mediaKind === 'audio' && crystal.contentType.startsWith('audio/') && isCanonicalAttachmentContentType(crystal.contentType)) ||
	((crystal.mediaKind === 'image' || crystal.mediaKind === 'video') && ATTACHMENT_INLINE_CONTENT_TYPES.has(crystal.contentType));

export const attachmentPublicProjection = (id: string, crystal: AttachmentCrystal) => ({
	id,
	name: crystal.name,
	size: crystal.size,
	contentType: crystal.contentType,
	mediaKind: crystal.mediaKind,
	...(crystal.detectedContentType ? { detectedContentType: crystal.detectedContentType } : {})
});
