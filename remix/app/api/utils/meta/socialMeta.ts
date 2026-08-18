// Crawler-visible social meta (Open Graph / Twitter cards) for the SPA shell.
//
// The client app is a static Vite shell served by the Nitro page catch-all
// (server/routes/[...].ts), so link unfurlers — which never run JS — only see
// whatever <head> the server sends. This module resolves the request path to
// a set of meta tags (post permalinks and profiles get page-specific tags,
// everything else keeps the site defaults) and swaps them into the shell's
// `tt-social-meta` marker block.
//
// Fail closed: post tags are built from the same anonymous-viewer `getThing`
// path the public API uses, so a private or missing post yields exactly the
// generic site block (and the API's own 404 status) — rich meta never leaks
// anything an anonymous GET /api/v1/things?id= would not already return.

import { getRequestOrigin } from '../health/statusTarget';
import { attachmentContentPath } from '~/utils/attachmentContentUrl';
import { absoluteThirdPartyProfileMediaUrl } from '~/utils/profileMediaUrl';

export type SocialMetaTag = { attr: 'property' | 'name'; key: string; content: string };

export type SocialMeta = { tags: SocialMetaTag[] };

export const SOCIAL_META_START = '<!-- tt-social-meta:start';
export const SOCIAL_META_END = 'tt-social-meta:end -->';

export const GENERIC_SITE_DESCRIPTION =
	'Thingtime is where everything is a thing — share posts, run polls, and build a home for the things you care about.';

const SITE_NAME = 'Thingtime';
const BRAND_IMAGE_PATH = '/android-icon-192x192.png';
const TITLE_MAX = 70;
const DESCRIPTION_MAX = 200;

// Meta content is a single attribute value: strip control characters and
// collapse author-entered newlines/runs of whitespace into single spaces.
const cleanText = (value: unknown): string =>
	typeof value === 'string' ? value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim() : '';

// Truncate by code points (mirrors things.ts canonicalTag): a UTF-16 slice
// could bisect a surrogate pair at the cap and emit U+FFFD in the served bytes.
const truncate = (value: string, max: number): string => {
	const codePoints = Array.from(value);
	return codePoints.length <= max ? value : `${codePoints.slice(0, max - 1).join('').trimEnd()}…`;
};

// Single choke point: every user-authored value passes through here when the
// tag list is rendered to HTML, so nothing unescaped can enter the head.
export const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

// Managed attachment paths become absolute against the request origin;
// already-absolute http(s) links pass through; data:/control-char/credential
// spellings are dropped (crawlers cannot fetch a data: og:image anyway).
const absoluteMediaUrl = (origin: string, value: string | null | undefined): string | null => {
	const resolved = absoluteThirdPartyProfileMediaUrl(value ?? null, origin);
	return resolved && !resolved.startsWith('data:') ? resolved : null;
};

const property = (key: string, content: string): SocialMetaTag => ({ attr: 'property', key, content });
const named = (key: string, content: string): SocialMetaTag => ({ attr: 'name', key, content });

type PageMeta = {
	title: string;
	description: string;
	type: 'website' | 'article' | 'profile';
	image: string | null;
	// summary_large_image only when the page carries real content imagery
	largeImage: boolean;
};

const buildTags = (origin: string, path: string, page: Partial<PageMeta> = {}): SocialMetaTag[] => {
	const meta: PageMeta = {
		title: SITE_NAME,
		description: GENERIC_SITE_DESCRIPTION,
		type: 'website',
		image: null,
		largeImage: false,
		...page
	};
	const image = meta.image || `${origin}${BRAND_IMAGE_PATH}`;
	return [
		named('description', meta.description),
		property('og:site_name', SITE_NAME),
		property('og:type', meta.type),
		property('og:title', meta.title),
		property('og:description', meta.description),
		property('og:url', `${origin}${path}`),
		property('og:image', image),
		named('twitter:card', meta.largeImage ? 'summary_large_image' : 'summary'),
		named('twitter:title', meta.title),
		named('twitter:description', meta.description)
	];
};

const pollOptionLabels = (thing: Record<string, any> | null): string[] => {
	const options: unknown = thing?.options;
	if (!Array.isArray(options)) return [];
	return options
		.map((option: unknown) =>
			typeof option === 'string' ? cleanText(option) : cleanText((option as { text?: unknown } | null)?.text)
		)
		.filter(Boolean);
};

const postMeta = async (origin: string, path: string, id: string): Promise<SocialMeta> => {
	// lazy: things.ts is the heaviest util in the tree — page shells that are
	// not post permalinks must never pay its import cost
	const { ACL_ALL, ACL_INHERIT } = await import('../../../schemas/registry');
	const { getThing, viewerOf } = await import('../things/things');

	const result = await getThing(viewerOf(null), id);
	// missing and private are the same failure here (findViewableThingAs), so
	// the generic-meta response never distinguishes them. Status stays 200: h3
	// treats a 404 Response from this middleware position as "unhandled" and
	// falls through to nitro's SPA renderer (the raw source index.html), so a
	// 404 could never actually be delivered — and the pre-social-meta
	// production behavior for these URLs was a 200 static shell anyway.
	if (result.ok === false) return { tags: buildTags(origin, path) };

	const post = result.post;
	// belt-and-braces on top of the anonymous viewer walk: rich meta is for
	// world-readable posts only. tt:all is directly world-readable; tt:inherit
	// (every comment) counts too because the anonymous getThing success above
	// already proved the inherited audience includes anonymous.
	if (!post || !Array.isArray(post.acl) || !(post.acl.includes(ACL_ALL) || post.acl.includes(ACL_INHERIT))) {
		return { tags: buildTags(origin, path) };
	}

	const author = post.author;
	const authorLabel = cleanText(author?.displayName) || (author?.username ? `@${cleanText(author.username)}` : 'Someone');
	const question = cleanText(post.thing?.question);
	const text = question || cleanText(post.text);
	const options = question ? pollOptionLabels(post.thing) : [];

	const firstImageAttachment = post.attachments.find((attachment) => attachment.mediaKind === 'image');
	const postImage = firstImageAttachment
		? absoluteMediaUrl(origin, attachmentContentPath(firstImageAttachment.id))
		: absoluteMediaUrl(origin, post.images.find((imageUrl) => typeof imageUrl === 'string' && imageUrl.trim()));
	const image = postImage || absoluteMediaUrl(origin, author?.avatarUrl);

	const description = question
		? truncate(['Poll:', text, options.length ? `· ${options.join(' / ')}` : ''].filter(Boolean).join(' '), DESCRIPTION_MAX)
		: truncate(text, DESCRIPTION_MAX) || `A post by ${authorLabel} on ${SITE_NAME}.`;

	return {
		tags: buildTags(origin, path, {
			title: text ? `${authorLabel}: ${truncate(text, TITLE_MAX)}` : `${authorLabel} on ${SITE_NAME}`,
			description,
			type: 'article',
			image,
			largeImage: Boolean(postImage)
		})
	};
};

const profileMeta = async (origin: string, path: string, username: string): Promise<SocialMeta> => {
	const { findUserByUsername, toPublicProfile } = await import('../auth/users');

	const user = await findUserByUsername(username);
	// unknown profile: generic block, 200 (see the post-permalink status note)
	if (!user) return { tags: buildTags(origin, path) };

	// public projection only — never email/verification/storage fields
	const profile = toPublicProfile(user);
	const displayName = cleanText(profile.displayName) || cleanText(profile.username);
	const handle = cleanText(profile.username);

	return {
		tags: buildTags(origin, path, {
			title: `${displayName} (@${handle}) on ${SITE_NAME}`,
			description: truncate(cleanText(profile.bio), DESCRIPTION_MAX) || `@${handle} is on ${SITE_NAME}.`,
			type: 'profile',
			image: absoluteMediaUrl(origin, profile.avatarUrl)
		})
	};
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
		const postMatch = path.match(/^\/post\/([^/]+)\/?$/);
		if (postMatch) return await postMeta(origin, path, decodeURIComponent(postMatch[1]));

		const profileMatch = path.match(/^\/profile\/([^/]+)\/?$/);
		if (profileMatch) return await profileMeta(origin, path, decodeURIComponent(profileMatch[1]));
	} catch {
		// fall through to the generic block
	}

	return { tags: buildTags(origin, path) };
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
