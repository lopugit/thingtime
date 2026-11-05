/** Presentation choices only. This module is safe to import in clients: it
 * never resolves content, reads identity, or accepts caller-supplied copy/media. */
export const SOCIAL_PREVIEW_TEMPLATES = [
	{ id: 'editorial', label: 'Editorial', description: 'Expressive type on warm paper.' },
	{ id: 'colour-blocks', label: 'Colour Blocks', description: 'Bright colour and room for photos.' },
	{ id: 'editorial-white', label: 'Editorial White', description: 'A crisp, quiet invitation.' },
	{ id: 'pink-invitation', label: 'Pink Invitation', description: 'A playful pink announcement.' },
	{ id: 'night-garden', label: 'Night Garden', description: 'Rich dark colours and botanical detail.' }
] as const;
export const SOCIAL_PREVIEW_LAYOUTS = [
	{ id: 'auto', label: 'Automatic', description: 'Choose a layout from the available content.' },
	{ id: 'text', label: 'Text', description: 'Lead with the headline and description.' },
	{ id: 'photo', label: 'Photo', description: 'Feature the first available photo.' },
	{ id: 'gallery', label: 'Gallery', description: 'Show the available photos together.' }
] as const;
export type SocialPreviewTemplate = (typeof SOCIAL_PREVIEW_TEMPLATES)[number]['id'];
export type SocialPreviewLayout = (typeof SOCIAL_PREVIEW_LAYOUTS)[number]['id'];
export type SocialPreviewDesign = { template?: SocialPreviewTemplate; layout?: SocialPreviewLayout };

export const socialPreviewDesign = (value: unknown): SocialPreviewDesign => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const input = value as Record<string, unknown>;
	return {
		...(SOCIAL_PREVIEW_TEMPLATES.some((choice) => choice.id === input.template) ? { template: input.template as SocialPreviewTemplate } : {}),
		...(SOCIAL_PREVIEW_LAYOUTS.some((choice) => choice.id === input.layout) ? { layout: input.layout as SocialPreviewLayout } : {})
	};
};

export const socialPreviewDesignFromUrl = (value: URL | string): SocialPreviewDesign => {
	try {
		const url = value instanceof URL ? value : new URL(value, 'https://preview.invalid');
		// Duplicate design parameters are ambiguous and are ignored, rather than
		// letting different consumers choose different entries for one cache key.
		return socialPreviewDesign({
			template: url.searchParams.getAll('previewTheme').length === 1 ? url.searchParams.get('previewTheme') : undefined,
			layout: url.searchParams.getAll('previewLayout').length === 1 ? url.searchParams.get('previewLayout') : undefined
		});
	} catch {
		return {};
	}
};

export const socialPreviewDesignParams = (value: SocialPreviewDesign): URLSearchParams => {
	const design = socialPreviewDesign(value);
	const params = new URLSearchParams();
	if (design.template) params.set('previewTheme', design.template);
	if (design.layout) params.set('previewLayout', design.layout);
	return params;
};

/** Same-origin link identity for metadata and image URLs. All unrelated query
 * values and fragments are discarded; callers must keep navigation separate. */
export const socialPreviewShareUrl = (origin: string, value: string, choice?: SocialPreviewDesign): string => {
	const base = new URL(origin);
	if (base.origin !== origin || !['https:', 'http:'].includes(base.protocol)) throw new Error('Use a page URL on this origin.');
	if (value.includes('\\') || /[\p{Cc}\u2028\u2029]/u.test(value)) throw new Error('Use a page URL on this origin.');
	const target = new URL(value, origin);
	if (target.origin !== origin || target.username || target.password) throw new Error('Use a page URL on this origin.');
	const path = target.pathname === '/index.html' ? '/' : target.pathname;
	const params = socialPreviewDesignParams(choice === undefined ? socialPreviewDesignFromUrl(target) : choice);
	return `${origin}${path}${params.size ? `?${params}` : ''}`;
};

export const resolveSocialPreviewDesign = (
	preview: SocialPreviewDesign & { kind?: string; variant?: string; imageCount?: number; images?: readonly unknown[] }
): { template: SocialPreviewTemplate; layout: Exclude<SocialPreviewLayout, 'auto'> } => {
	const choice = socialPreviewDesign(preview);
	const count = Math.max(preview.images?.length || 0, Number.isFinite(preview.imageCount) ? preview.imageCount || 0 : 0);
	const media = count > 0 || ['image-post', 'gallery'].includes(preview.variant || '') || preview.variant?.startsWith('media-');
	const template = choice.template || (preview.kind === 'invite' || preview.variant === 'invite' ? 'editorial-white' : media ? 'colour-blocks' : 'editorial');
	const layout = choice.layout === 'text' || count === 0 ? 'text' : !choice.layout || choice.layout === 'auto' ? (count > 1 ? 'gallery' : 'photo') : choice.layout;
	return { template, layout };
};
