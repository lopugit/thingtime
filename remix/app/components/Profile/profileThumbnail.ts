import { HEIC_IMAGE_ACCEPT, isHeicImage, prepareHeicImage } from '../Attachments/heicImage';

// Bounded inline transport for pre-account forms; server normalization and moderation still run.
export const MAX_INLINE_THUMBNAIL_BYTES = 10 * 1024 * 1024;
export const INLINE_THUMBNAIL_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const INLINE_THUMBNAIL_ACCEPT = `${INLINE_THUMBNAIL_CONTENT_TYPES.join(',')},${HEIC_IMAGE_ACCEPT}`;

// The picker, the queue's selection filter and this preparer must agree. A file the
// picker offers but the queue drops never becomes an upload, and the field then stays
// blocked on a selection it cannot show, retry or remove.
export const inlineThumbnailFileError = (file: Pick<File, 'size' | 'type'> & { name?: string }): string | null => {
	if (!(INLINE_THUMBNAIL_CONTENT_TYPES as readonly string[]).includes(file.type.trim().toLowerCase()) && !isHeicImage(file))
		return 'Choose a PNG, JPEG, WebP, HEIC or HEIF image.';
	if (!Number.isSafeInteger(file.size) || file.size < 1) return 'Choose an image that contains data.';
	if (file.size > MAX_INLINE_THUMBNAIL_BYTES) return 'Choose a photo under 10 MB.';
	return null;
};

export const prepareProfileThumbnail = async (file: File) => {
	// Receives the original selection: HEIC is decoded here so the 10 MB rule stays a
	// rule about the chosen photo, never about intermediate JPEG bytes nothing transmits.
	const error = inlineThumbnailFileError(file);
	if (error) throw new Error(error);
	const bitmap = await createImageBitmap(await prepareHeicImage(file));
	try {
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 128;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Image editing is unavailable.');
		const side = Math.min(bitmap.width, bitmap.height);
		context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
		return canvas.toDataURL('image/jpeg', 0.7);
	} finally {
		bitmap.close();
	}
};
