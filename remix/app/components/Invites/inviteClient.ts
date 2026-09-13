import { changesRootIdentity, rootIdentity } from '~/utils/rootIdentity';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
export const inviteRequest = async (body: Record<string, unknown>, register = false) => {
	await requireThingtimeCapability(register ? 'api.auth-register' : 'api.auth-invites', register ? '1.2.0' : '1.0.0');
	const response = await fetch(register ? '/api/v1/auth/register' : '/api/v1/auth/invites', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		cache: 'no-store',
		referrerPolicy: 'no-referrer'
	});
	const data = await response.json();
	if (!response.ok || !data.ok) throw new Error(data.error || 'The invite request failed. Please try again.');
	if (register && changesRootIdentity('/api/v1/auth/register', data)) rootIdentity.changed();
	return data;
};
export const avatarThumbnail = async (file: File) => {
	if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)
		throw new Error('Choose a PNG, JPEG or WebP image under 10 MB.');
	const bitmap = await createImageBitmap(file);
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
