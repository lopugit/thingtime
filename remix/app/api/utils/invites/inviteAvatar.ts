import sharp from 'sharp';
import { resolveConfiguredModerationProvider } from '../moderation/providers';
import { InviteError, MAX_AVATAR_BYTES } from './inviteCore';

// Invites carry a bounded thumbnail, never an arbitrary media URL or attachment
// reference. Decode and re-encode on the server to remove metadata/active content.
// This narrow signup upload does not grant general public/private upload rights.
export const normalizeInviteAvatar = async (value: unknown): Promise<string | null> => {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string' || value.length > 32_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value))
		throw new InviteError(400, 'Choose a small PNG, JPEG or WebP avatar.');
	let bytes: Buffer;
	try {
		const source = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
		const image = sharp(source, { limitInputPixels: 1_000_000, animated: false });
		const metadata = await image.metadata();
		if (!['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new Error('Unsupported image');
		bytes = await image.rotate().resize(128, 128, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
		if (bytes.length > MAX_AVATAR_BYTES) throw new Error('Image too large');
	} catch {
		throw new InviteError(400, 'This avatar could not be read. Choose another image.');
	}
	const choice = await resolveConfiguredModerationProvider();
	if (choice.kind === 'provider') {
		let verdict;
		try {
			verdict = await choice.provider.analyzeImage({ bytes, contentType: 'image/jpeg', filename: 'invite-avatar.jpg' });
		} catch {
			throw new InviteError(503, 'Avatar review is unavailable. Try again shortly.');
		}
		if (verdict.nsfw || verdict.tosViolation) throw new InviteError(400, 'Please choose a different avatar suitable for a public profile.');
	}
	return `data:image/jpeg;base64,${bytes.toString('base64')}`;
};
