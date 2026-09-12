// Crawler-visible social meta (Open Graph / Twitter cards) for the SPA shell.
//
// The client app is a static Vite shell served by the Nitro page catch-all
// (server/routes/[...].ts), so link unfurlers — which never run JS — only see
// whatever <head> the server sends. This module resolves each public URL to
// page-specific tags plus a server-rendered 1200×630 PNG card, then swaps
// them into the shell's `tt-social-meta` marker block.
//
// Fail closed: data-backed cards are built from the same anonymous-viewer
// `getThing` path the public API uses, so private or missing data yields the
// generic site block — rich meta never leaks anything an anonymous request
// could already read.

import { getRequestOrigin } from '../health/statusTarget';
import { resolveSocialPreview, socialPreviewCardUrl } from './socialPreview';

export type SocialMetaTag = { attr: 'property' | 'name'; key: string; content: string };

export type SocialMeta = { tags: SocialMetaTag[] };

export const SOCIAL_META_START = '<!-- tt-social-meta:start';
export const SOCIAL_META_END = 'tt-social-meta:end -->';

export const GENERIC_SITE_DESCRIPTION =
	'Thingtime is where everything is a thing — share posts, run polls, and build a home for the things you care about.';

const SITE_NAME = 'Thingtime';

// Single choke point: every user-authored value passes through here when the
// tag list is rendered to HTML, so nothing unescaped can enter the head.
export const escapeHtml = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const property = (key: string, content: string): SocialMetaTag => ({ attr: 'property', key, content });
const named = (key: string, content: string): SocialMetaTag => ({ attr: 'name', key, content });

type PageMeta = {
	title: string;
	description: string;
	type: 'website' | 'article' | 'profile';
	image: string | null;
	// all routes use a real 1200×630 PNG social card
	largeImage: boolean;
};

export const buildSocialMetaTags = (origin: string, path: string, page: Partial<PageMeta> = {}): SocialMetaTag[] => {
	const meta: PageMeta = {
		title: SITE_NAME,
		description: GENERIC_SITE_DESCRIPTION,
		type: 'website',
		image: null,
		largeImage: false,
		...page
	};
	const image = meta.image || socialPreviewCardUrl(origin, path);
	return [
		named('description', meta.description),
		property('og:site_name', SITE_NAME),
		property('og:type', meta.type),
		property('og:title', meta.title),
		property('og:description', meta.description),
		property('og:url', `${origin}${path}`),
		property('og:image', image),
		property('og:image:secure_url', image),
		property('og:image:type', 'image/png'),
		property('og:image:width', '1200'),
		property('og:image:height', '630'),
		named('twitter:card', meta.largeImage ? 'summary_large_image' : 'summary'),
		named('twitter:title', meta.title),
		named('twitter:description', meta.description),
		named('twitter:image', image)
	];
};

// Path → meta. Any data-plane failure degrades to the generic site block: the
// shell must always serve, meta is best-effort garnish on top of it.
export const resolveSocialMeta = async (request: Request): Promise<SocialMeta> => {
	const origin = getRequestOrigin(request);
	let path = '/';
	try {
		path = new URL(request.url, origin).pathname || '/';
	} catch {
		// keep '/' — og:url degrades to the origin
	}

	try {
		const preview = await resolveSocialPreview(origin, path);
		return {
			tags: buildSocialMetaTags(origin, path, {
				title: preview.title,
				description: preview.description,
				type: preview.article ? 'article' : preview.kind === 'profile' ? 'profile' : 'website',
				image: socialPreviewCardUrl(origin, path, preview.revision),
				largeImage: true
			})
		};
	} catch {
		// fall through to the generic block
	}

	return { tags: buildSocialMetaTags(origin, path) };
};

export const renderSocialMetaHtml = (tags: SocialMetaTag[]): string => {
	const lines = tags.map((tag) => `<meta ${tag.attr}="${tag.key}" content="${escapeHtml(tag.content)}" />`);
	return [`${SOCIAL_META_START} -->`, ...lines, `<!-- ${SOCIAL_META_END}`].join('\n    ');
};

// Swap the shell's marker block for the per-request one. A shell built before
// the marker existed still gets tags via the </head> fallback.
export const injectSocialMeta = (html: string, metaBlock: string): string => {
	const marker = /<!-- tt-social-meta:start[\s\S]*?tt-social-meta:end -->/;
	// replacement function so `$`-sequences in user-authored meta text are
	// never interpreted as String.replace substitution patterns
	if (marker.test(html)) return html.replace(marker, () => metaBlock);
	const headClose = html.search(/<\/head>/i);
	if (headClose === -1) return html;
	return `${html.slice(0, headClose)}    ${metaBlock}\n  ${html.slice(headClose)}`;
};
