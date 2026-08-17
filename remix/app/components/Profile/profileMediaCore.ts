export type ProfileMediaSlot = 'avatar' | 'banner';

export type ProfileMediaMutation =
	| { kind: 'preserve' }
	| { kind: 'clear' }
	| { kind: 'external'; url: string }
	| { kind: 'attachment'; attachmentId: string };

export type ProfileMediaFieldSnapshot = {
	mutation: ProfileMediaMutation;
	previewUrl: string | null;
	blocking: boolean;
};

export const MAX_PROFILE_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_EXTERNAL_PROFILE_IMAGE_URL_CHARS = 2048;
export const PROFILE_MEDIA_CONTENT_TYPES = ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'] as const;
const PROFILE_MEDIA_CONTENT_TYPE_SET = new Set<string>(PROFILE_MEDIA_CONTENT_TYPES);

export const isManagedProfileMediaUrl = (value: unknown): value is string => {
	if (typeof value !== 'string' || !value.startsWith('/')) return false;
	try {
		const parsed = new URL(value, 'https://thingtime.invalid');
		return (
			parsed.origin === 'https://thingtime.invalid' && parsed.pathname === '/api/v1/attachments/content' && Boolean(parsed.searchParams.get('id'))
		);
	} catch {
		return false;
	}
};

export const isExternalProfileImageUrl = (value: unknown): value is string => {
	if (typeof value !== 'string') return false;
	const source = value.trim();
	if (
		!source ||
		source.length > MAX_EXTERNAL_PROFILE_IMAGE_URL_CHARS ||
		!/^https?:\/\//iu.test(source) ||
		source.includes('\\') ||
		/[\p{Cc}\p{Cf}\p{Cs}\s]/u.test(source)
	) {
		return false;
	}
	try {
		const parsed = new URL(source);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
};

export const initialExternalProfileImageUrl = (savedUrl: unknown): string =>
	isManagedProfileMediaUrl(savedUrl) ? '' : isExternalProfileImageUrl(savedUrl) ? savedUrl.trim() : '';

export const preservedProfileMediaSnapshot = (savedUrl: string | null): ProfileMediaFieldSnapshot => ({
	mutation: { kind: 'preserve' },
	previewUrl: savedUrl,
	blocking: false
});

export const profileImageFileError = (file: Pick<File, 'size' | 'type'>): string | null => {
	if (!PROFILE_MEDIA_CONTENT_TYPE_SET.has(file.type.trim().toLowerCase())) {
		return 'Choose a JPEG, PNG, GIF, WebP, or AVIF image.';
	}
	if (!Number.isSafeInteger(file.size) || file.size < 1) return 'Choose an image that contains data.';
	if (file.size > MAX_PROFILE_MEDIA_BYTES) return 'Profile images can be up to 64 MiB.';
	return null;
};

export const profileMediaUpdateFields = (slot: ProfileMediaSlot, mutation: ProfileMediaMutation): Record<string, string | null> => {
	const urlField = `${slot}Url`;
	const attachmentField = `${slot}AttachmentId`;
	if (mutation.kind === 'preserve') return {};
	if (mutation.kind === 'attachment') return { [attachmentField]: mutation.attachmentId };
	if (mutation.kind === 'external') return { [urlField]: mutation.url.trim(), [attachmentField]: null };
	return { [urlField]: null, [attachmentField]: null };
};

export const profileSaveErrorMessage = (error: unknown): string => {
	const status = Number((error as { status?: unknown } | null)?.status);
	if (status === 401) return 'Your session expired. Sign in again, then save your profile.';
	if (status === 400) return 'One profile image is no longer valid. Remove it or select it again.';
	if (status === 403) return 'This account cannot use that profile image. Select a new upload.';
	if (status === 404) return 'That profile image is no longer available. Select it again.';
	if (status === 409) return 'Your profile media changed while saving. Select it again, then retry.';
	if (status === 413) return 'Your profile details are too large. Shorten them, then retry.';
	if (status === 429) return 'Profile changes are moving too quickly. Wait a moment, then retry.';
	if (status === 507) return 'This account needs more free storage before it can save that image.';
	if (status === 503) return 'Profile media is temporarily unavailable. Your draft is still here to retry.';
	return 'Thingtime could not save those profile changes. Please try again.';
};
