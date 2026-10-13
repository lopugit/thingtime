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
import { organizationId, organizationStructuredData } from './brandIdentity';
import { isIndexableStaticPath } from './indexablePaths';
import {
	DEFAULT_SOCIAL_IMAGE_PATH,
	normaliseSocialPreviewPath,
	resolveSocialPreview,
	socialPreviewCardUrl,
	staticSocialPreview,
	type SocialPreview
} from './socialPreview';
import { pageTitle } from '../../../utils/pageTitle';

export type SocialMetaTag = { attr: 'property' | 'name'; key: string; content: string };

export type SocialMeta = { tags: SocialMetaTag[]; canonical: string; structuredData: Record<string, unknown> };

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
	imageAlt: string;
	// all routes use a real 1200×630 PNG social card
	largeImage: boolean;
};

export const buildSocialMetaTags = (origin: string, path: string, page: Partial<PageMeta> = {}): SocialMetaTag[] => {
	const meta: PageMeta = {
		title: pageTitle(path),
		description: GENERIC_SITE_DESCRIPTION,
		type: 'website',
		image: null,
		imageAlt: 'Colourful Thingtime wordmark on a white background with a rainbow border',
		largeImage: true,
		...page
	};
	const image = meta.image || `${origin}${DEFAULT_SOCIAL_IMAGE_PATH}`;
	return [
		named('description', meta.description),
		property('og:site_name', SITE_NAME),
		property('og:type', meta.type),
		property('og:title', meta.title),
		property('og:description', meta.description),
		property('og:url', `${origin}${normaliseSocialPreviewPath(path)}`),
		property('og:image', image),
		...(image.startsWith('https://') ? [property('og:image:secure_url', image)] : []),
		property('og:image:type', 'image/png'),
		property('og:image:width', '1200'),
		property('og:image:height', '630'),
		property('og:image:alt', meta.imageAlt),
		named('twitter:card', meta.largeImage ? 'summary_large_image' : 'summary'),
		named('twitter:title', meta.title),
		named('twitter:description', meta.description),
		named('twitter:image', image),
		named('twitter:image:alt', meta.imageAlt)
	];
};

// Only intentional public discovery surfaces are indexable by default. A safe
// generic card is still useful for sharing settings/invite/missing URLs, but
// it must not advertise a private screen or a failed lookup as public content.
export const socialPageIsIndexable = (path: string, preview: SocialPreview): boolean =>
	(preview.indexable !== false && Boolean(preview.publicContent)) || isIndexableStaticPath(path);

export const socialMetaFromPreview = (origin: string, preview: SocialPreview): SocialMeta => {
	const path = normaliseSocialPreviewPath(preview.path);
	const canonical = `${origin}${path === '/index.html' ? '/' : path}`;
	const image = preview.variant === 'app' ? `${origin}${DEFAULT_SOCIAL_IMAGE_PATH}` : socialPreviewCardUrl(origin, path, preview.revision);
	const tags = buildSocialMetaTags(origin, path, {
		title: preview.title,
		description: preview.description,
		type: preview.article ? 'article' : preview.publicContent && preview.kind === 'profile' ? 'profile' : 'website',
		image,
		...(preview.variant !== 'app' ? { imageAlt: `Thingtime preview card: ${preview.title}` } : {})
	});
	const ogUrl = tags.find((tag) => tag.key === 'og:url')!;
	ogUrl.content = canonical;
	tags.push(named('robots', socialPageIsIndexable(path, preview) ? 'index, follow, max-image-preview:large' : 'noindex, follow'));
	const websiteId = `${origin}/#website`;
	const publisherId = organizationId(origin);
	const pageId = `${canonical}#webpage`;
	const imageObject = { '@type': 'ImageObject', url: image, width: 1200, height: 630 };
	const page: Record<string, unknown> = {
		'@type':
			preview.publicContent && preview.kind === 'profile'
				? 'ProfilePage'
				: ['collection', 'feed', 'explore'].includes(preview.kind)
				? 'CollectionPage'
				: 'WebPage',
		'@id': pageId,
		url: canonical,
		name: preview.title,
		description: preview.description,
		isPartOf: { '@id': websiteId },
		primaryImageOfPage: imageObject
	};
	// Only the already-whitelisted anonymous preview can supply structured
	// content. Never serialize a raw Thing/crystal, arbitrary UGC schema, token,
	// engagement count, price, or an invented rating into a search result.
	if (preview.publicContent) {
		const type =
			preview.kind === 'profile'
				? 'Person'
				: ['comment', 'reply'].includes(preview.kind)
				? 'Comment'
				: ['text-post', 'image-post', 'gallery', 'poll', 'share', 'listing', 'thingtime'].includes(preview.kind)
				? 'SocialMediaPosting'
				: 'CreativeWork';
		page.mainEntity = {
			'@type': type,
			'@id': `${canonical}#content`,
			url: canonical,
			name: type === 'Person' ? preview.author || preview.title : preview.title,
			description: preview.description,
			...(type !== 'Person' ? { mainEntityOfPage: { '@id': pageId }, image: imageObject } : {}),
			...(type !== 'Person' && preview.author ? { author: { '@type': 'Person', name: preview.author } } : {})
		};
	}
	return {
		tags,
		canonical,
		structuredData: {
			'@context': 'https://schema.org',
			// Order is a contract: [0] WebSite, [1] the page, [2] the publishing
		// Organization (its `logo` is what search engines use for the brand
		// mark in knowledge panels and brand results — brandIdentity.ts).
		'@graph': [
			{ '@type': 'WebSite', '@id': websiteId, url: `${origin}/`, name: SITE_NAME, publisher: { '@id': publisherId } },
			page,
			organizationStructuredData(origin)
		]
		}
	};
};

// Path → meta. Any data-plane failure degrades to a safe, noindex page rather
// than returning the static shell's wrong canonical/title on a deep URL.
export const fallbackSocialMeta = (request: Request): SocialMeta =>
	socialMetaFromPreview(getRequestOrigin(request), staticSocialPreview(new URL(request.url).pathname));

export const resolveSocialMeta = async (request: Request): Promise<SocialMeta> => {
	const origin = getRequestOrigin(request);
	const path = new URL(request.url).pathname;
	try {
		return socialMetaFromPreview(origin, await resolveSocialPreview(origin, path));
	} catch {
		return fallbackSocialMeta(request);
	}
};

// JSON encoding alone does not prevent </script> from closing a script element.
export const serializeStructuredData = (value: Record<string, unknown>): string =>
	JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');

export const renderSocialMetaHtml = (meta: SocialMeta | SocialMetaTag[]): string => {
	const tags = Array.isArray(meta) ? meta : meta.tags;
	const lines = tags.map((tag) => `<meta ${tag.attr}="${tag.key}" content="${escapeHtml(tag.content)}" />`);
	if (!Array.isArray(meta)) {
		lines.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`);
		lines.push(`<script type="application/ld+json">${serializeStructuredData(meta.structuredData)}</script>`);
	}
	return [`${SOCIAL_META_START} -->`, ...lines, `<!-- ${SOCIAL_META_END}`].join('\n    ');
};

// Swap the shell's marker block for the per-request one. A shell built before
// the marker existed still gets tags via the </head> fallback.
export const injectSocialMeta = (html: string, metaBlock: string): string => {
	// Match the server HTML title to the escaped Open Graph title, before JS runs.
	const title = metaBlock.match(/<meta property="og:title" content="([^"]*)"/);
	if (title) html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${title[1]}</title>`);
	const marker = /<!-- tt-social-meta:start[\s\S]*?tt-social-meta:end -->/;
	// replacement function so `$`-sequences in user-authored meta text are
	// never interpreted as String.replace substitution patterns
	if (marker.test(html)) return html.replace(marker, () => metaBlock);
	const headClose = html.search(/<\/head>/i);
	if (headClose === -1) return html;
	return `${html.slice(0, headClose)}    ${metaBlock}\n  ${html.slice(headClose)}`;
};
