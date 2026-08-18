import type { AttachmentCrystal, AttachmentMediaKind } from './attachmentCore';

export const ATTACHMENT_INLINE_CONTENT_TYPES = new Set([
	'image/avif',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp',
	'video/mp4',
	'video/webm'
]);

const extensionFromName = (name: string) => {
	const match = /\.([A-Za-z0-9]{1,12})$/.exec(name);
	return match?.[1]?.toLowerCase() || '';
};

export const detectedAttachmentType = (
	detectedMime: string | undefined,
	originalName: string
): { contentType: string; mediaKind: AttachmentMediaKind } => {
	const mime = String(detectedMime || '').toLowerCase();

	// file-type can identify many active or browser-executable formats. Only a
	// deliberately tiny passive raster/video set is ever allowed to render
	// inline; everything else is stored and delivered as opaque bytes.
	if (ATTACHMENT_INLINE_CONTENT_TYPES.has(mime)) {
		return { contentType: mime, mediaKind: mime.startsWith('image/') ? 'image' : 'video' };
	}

	// file-type identifies QuickTime as video/quicktime. Keep it downloadable:
	// support varies and the narrow inline policy must not expand by extension.
	void extensionFromName(originalName);
	return { contentType: 'application/octet-stream', mediaKind: 'file' };
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
	(crystal.mediaKind === 'image' || crystal.mediaKind === 'video') && ATTACHMENT_INLINE_CONTENT_TYPES.has(crystal.contentType);

export const attachmentPublicProjection = (id: string, crystal: AttachmentCrystal) => ({
	id,
	name: crystal.name,
	size: crystal.size,
	contentType: crystal.contentType,
	mediaKind: crystal.mediaKind
});
