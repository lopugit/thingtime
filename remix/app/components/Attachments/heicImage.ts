/** HEIC is an input format. Stored images remain JPEG so every viewer can render them. */
export const HEIC_IMAGE_ACCEPT = '.heic,.heif,image/heic,image/heif,image/heic-sequence,image/heif-sequence';
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
export const MAX_HEIC_BYTES = 64 * 1024 * 1024;
export const isHeicImage = (file: { type: string; name?: string }): boolean =>
	HEIC_TYPES.has(file.type.trim().toLowerCase()) || /\.hei[cf]$/i.test(file.name || '');

export class HeicImageError extends Error {}

type Decoder = (file: File) => Promise<Blob>;
const decodeHeic: Decoder = async (file) => {
	// Lazy, eval-free browser decoder; no third-party upload or server codec dependency.
	const { heicTo } = await import('heic-to/csp');
	return heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
};

export const createHeicImagePreparer = (decode: Decoder = decodeHeic) => {
	// Retries must send the same bytes for an existing upload request identity.
	// Weak keys release converted bytes when the selected File leaves the draft.
	const prepared = new WeakMap<File, Promise<File>>();
	return (file: File): Promise<File> => {
		if (!isHeicImage(file)) return Promise.resolve(file);
		if (!file.size || file.size > MAX_HEIC_BYTES) return Promise.reject(new HeicImageError('Choose a HEIC or HEIF photo between 1 byte and 64 MiB.'));
		const cached = prepared.get(file);
		if (cached) return cached;
		const result = (async () => {
			try {
				const jpeg = await decode(file);
				if (!jpeg.size || jpeg.type !== 'image/jpeg') throw new Error('Invalid decoded image');
				if (jpeg.size > MAX_HEIC_BYTES) throw new HeicImageError('The converted photo exceeds 64 MiB. Choose a smaller photo.');
				const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
				return new File([jpeg], `${name}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
			} catch (error) {
				prepared.delete(file);
				if (error instanceof HeicImageError) throw error;
				throw new HeicImageError('This HEIC/HEIF photo could not be converted. Try another photo or export it as JPEG.');
			}
		})();
		prepared.set(file, result);
		return result;
	};
};

export const prepareHeicImage = createHeicImagePreparer();
