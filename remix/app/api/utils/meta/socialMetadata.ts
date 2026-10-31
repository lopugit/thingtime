import { getRequestOrigin } from '../health/statusTarget';
import { socialMetaFromPreview } from './socialMeta';
import { normaliseSocialPreviewPath, resolveSocialPreview, staticSocialPreview, type SocialPreview } from './socialPreview';

// Resolve only a page on the serving origin. No HTTP fetch, redirects, caller
// credentials, query values or fragments participate in the preview lookup.
export const socialMetadataPath = (origin: string, value: string | null): string => {
	const input = value ?? '/';
	if (input.includes('\\') || Array.from(input).some((character) => character.charCodeAt(0) < 32)) throw new Error('Use a page URL on this origin.');
	const target = new URL(input, origin);
	if (target.origin !== origin || target.username || target.password || !['https:', 'http:'].includes(target.protocol))
		throw new Error('Use a page URL on this origin.');
	return normaliseSocialPreviewPath(target.pathname);
};

export const resolveSocialMetadata = async (
	request: Request,
	resolve: (origin: string, path: string) => Promise<SocialPreview> = resolveSocialPreview
) => {
	const origin = getRequestOrigin(request);
	const path = socialMetadataPath(origin, new URL(request.url).searchParams.get('path'));
	let preview: SocialPreview;
	try { preview = await resolve(origin, path); } catch { preview = staticSocialPreview(path); }
	const meta = socialMetaFromPreview(origin, { ...preview, path });
	const value = (key: string) => meta.tags.find((tag) => tag.key === key)?.content || '';
	return {
		title: value('og:title'),
		description: value('og:description'),
		url: meta.canonical,
		canonical: meta.canonical,
		type: value('og:type'),
		publicContent: preview.publicContent === true,
		image: { url: value('og:image'), width: 1200, height: 630, type: 'image/png', alt: value('og:image:alt') }
	};
};
