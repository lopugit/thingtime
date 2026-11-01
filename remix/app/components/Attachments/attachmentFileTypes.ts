import { HEIC_IMAGE_ACCEPT } from './heicImage';

export const IMAGE_UPLOAD_CONTENT_TYPES = ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const;

const TYPE_LABELS: Record<string, string> = {
	'image/avif': 'AVIF',
	'image/gif': 'GIF',
	'image/jpeg': 'JPEG (.jpg, .jpeg)',
	'image/png': 'PNG',
	'image/webp': 'WebP'
};

// Use the same list for picker filtering and visible guidance. HEIC/HEIF are
// accepted as inputs wherever their converted PNG output is accepted.
export const uploadFileTypes = (allowedContentTypes?: readonly string[], imageOnly = false) => {
	const types = allowedContentTypes?.length ? allowedContentTypes : imageOnly ? IMAGE_UPLOAD_CONTENT_TYPES : null;
	if (!types) return { accept: undefined, label: 'All file types' };
	const normalized = [...new Set(types.map((type) => type.toLowerCase()))];
	const convertsHeic = normalized.includes('image/png');
	return {
		accept: [...normalized, ...(convertsHeic ? [HEIC_IMAGE_ACCEPT] : [])].join(','),
		label: [...normalized.map((type) => TYPE_LABELS[type] || type), ...(convertsHeic ? ['HEIC', 'HEIF'] : [])].join(', ')
	};
};
