import { isHeicImage, prepareHeicImage } from '../Attachments/heicImage';

// Bounded inline transport for pre-account forms; server normalization and moderation still run.
export const prepareProfileThumbnail = async (file: File) => {
	if ((!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && !isHeicImage(file)) || file.size > 10 * 1024 * 1024)
		throw new Error('Choose a PNG, JPEG, WebP, HEIC or HEIF image under 10 MB.');
	const bitmap = await createImageBitmap(await prepareHeicImage(file));
	try {
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 128;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Image editing is unavailable.');
		const side = Math.min(bitmap.width, bitmap.height);
		context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
		return canvas.toDataURL('image/png');
	} finally {
		bitmap.close();
	}
};
