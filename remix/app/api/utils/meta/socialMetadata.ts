import { getRequestOrigin } from '../health/statusTarget';
import { socialMetaFromPreview } from './socialMeta';
import { normaliseSocialPreviewPath, resolveSocialPreview, staticSocialPreview, type SocialPreview } from './socialPreview';
import { resolveSocialPreviewDesign, SOCIAL_PREVIEW_LAYOUTS, SOCIAL_PREVIEW_TEMPLATES, socialPreviewDesignFromUrl, socialPreviewShareUrl } from '../../../utils/socialPreviewDesign';

// Resolve only a page on the serving origin. No HTTP fetch, redirects, caller
// credentials, arbitrary query values or fragments participate in lookup.
export const socialMetadataPath = (origin: string, value: string | null): string => {
	const target = new URL(socialPreviewShareUrl(origin, value ?? '/'));
	return `${normaliseSocialPreviewPath(target.pathname)}${target.search}`;
};

export const resolveSocialMetadata = async (
	request: Request,
	resolve: (origin: string, path: string) => Promise<SocialPreview> = resolveSocialPreview
) => {
	const origin = getRequestOrigin(request);
	const path = socialMetadataPath(origin, new URL(request.url).searchParams.get('path'));
	let preview: SocialPreview;
	try { preview = await resolve(origin, path); } catch { preview = staticSocialPreview(path); }
	// An injected resolver or cold fallback still receives the identical validated
	// presentation choice. It cannot affect the anonymous content boundary.
	preview = { ...preview, path: normaliseSocialPreviewPath(path), ...socialPreviewDesignFromUrl(path) };
	const meta = socialMetaFromPreview(origin, preview);
	const value = (key: string) => meta.tags.find((tag) => tag.key === key)?.content || '';
	return {
		title: value('og:title'),
		description: value('og:description'),
		url: meta.canonical,
		canonical: meta.canonical,
		type: value('og:type'),
		publicContent: preview.publicContent === true,
		design: resolveSocialPreviewDesign(preview),
		choices: { templates: SOCIAL_PREVIEW_TEMPLATES, layouts: SOCIAL_PREVIEW_LAYOUTS },
		image: { url: value('og:image'), width: 1200, height: 630, type: 'image/png', alt: value('og:image:alt') }
	};
};
