// Shared, crawler-safe preview model for Thingtime URLs. The same anonymous
// projection powers both the Open Graph text tags and the image-card renderer,
// so a social preview cannot reveal anything the public page does not reveal.

export type SocialPreviewKind =
	| 'home'
	| 'feed'
	| 'explore'
	| 'docs'
	| 'collection'
	| 'text-post'
	| 'image-post'
	| 'gallery'
	| 'poll'
	| 'listing'
	| 'thingtime'
	| 'share'
	| 'comment'
	| 'reply'
	| 'media'
	| 'webpage'
	| 'profile'
	| 'thing';

// `kind` is the semantic surface; `variant` selects a recognisably different
// card composition. They deliberately stay separate: a shared photo set is a
// share semantically, while its card still has a photo collage, and a comment
// with a video remains a comment with a video treatment rather than a generic
// post. This keeps every shareable Thingtime shape distinguishable at a glance.
export type SocialPreviewVariant =
	| 'app'
	| 'feed'
	| 'explore'
	| 'docs'
	| 'collection'
	| 'text-post'
	| 'image-post'
	| 'gallery'
	| 'poll'
	| 'listing'
	| 'thingtime'
	| 'share'
	| 'comment'
	| 'reply'
	| 'media-image'
	| 'media-video'
	| 'media-audio'
	| 'media-file'
	| 'webpage'
	| 'profile'
	| 'thing';

export type SocialPreviewImage = {
	attachmentId: string;
	label: string;
};

export type SocialPreview = {
	kind: SocialPreviewKind;
	variant: SocialPreviewVariant;
	path: string;
	title: string;
	description: string;
	eyebrow: string;
	article: boolean;
	author?: string;
	initial?: string;
	badges: string[];
	options: string[];
	images: SocialPreviewImage[];
	imageCount: number;
	revision?: string;
};

export const SOCIAL_PREVIEW_WIDTH = 1200;
export const SOCIAL_PREVIEW_HEIGHT = 630;

const SITE_NAME = 'Thingtime';
const DESCRIPTION_MAX = 200;
const TITLE_MAX = 70;

const staticVariantFor = (kind: SocialPreviewKind): SocialPreviewVariant => {
	switch (kind) {
		case 'home':
			return 'app';
		case 'feed':
		case 'explore':
		case 'docs':
		case 'collection':
		case 'profile':
			return kind;
		default:
			return 'app';
	}
};

export const cleanSocialText = (value: unknown): string =>
	typeof value === 'string'
		? value
				.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
				.replace(/\s+/g, ' ')
				.trim()
		: '';

export const truncateSocialText = (value: string, max: number): string => {
	const codePoints = Array.from(value);
	return codePoints.length <= max
		? value
		: `${codePoints
				.slice(0, max - 1)
				.join('')
				.trimEnd()}…`;
};

const cleanList = (values: unknown, limit: number): string[] =>
	Array.isArray(values) ? values.map(cleanSocialText).filter(Boolean).slice(0, limit) : [];

const initialOf = (value: string): string => Array.from(value.trim())[0]?.toUpperCase() || 'T';

export const normaliseSocialPreviewPath = (value: unknown): string => {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 2048) {
		return '/';
	}
	const path = value.split('?')[0]?.split('#')[0] || '/';
	return path.startsWith('/') && !path.startsWith('//') ? path : '/';
};

export const socialPreviewCardUrl = (origin: string, path: string, revision?: string): string => {
	const query = new URLSearchParams({ path: normaliseSocialPreviewPath(path) });
	if (revision) query.set('v', truncateSocialText(revision, 80));
	return `${origin}/social-card?${query.toString()}`;
};

export const staticSocialPreview = (pathInput: string): SocialPreview => {
	const path = normaliseSocialPreviewPath(pathInput);
	const segments = path.split('/').filter(Boolean);
	const segment = segments[0] || '';
	const label = (value: string): string => value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
	const detail = (() => {
		switch (segment) {
			case 'feed':
				return {
					kind: 'feed' as const,
					title: 'Your Thingtime feed',
					description: 'Posts, photos, polls, finds and little moments from your people.',
					eyebrow: 'THINGTIME · FEED',
					badges: ['Fresh things', 'People you follow']
				};
			case 'profile':
				return {
					kind: 'profile' as const,
					title: 'Your Thingtime profile',
					description: 'Your posts, photos, polls and the things you want people to find.',
					eyebrow: 'THINGTIME · PROFILE',
					badges: ['Your people', 'Your things']
				};
			case 'explore':
				return {
					kind: 'explore' as const,
					title: 'Explore Thingtime',
					description: 'Discover conversations, photos, polls and useful things worth keeping.',
					eyebrow: 'THINGTIME · EXPLORE',
					badges: ['Trending now', 'Made by people']
				};
			case 'docs':
				return {
					kind: 'docs' as const,
					title: 'Thingtime docs',
					description: 'The product, API and design system behind a world where everything is a thing.',
					eyebrow: 'THINGTIME · DOCS',
					badges: ['Build with Thingtime', 'API + SDK']
				};
			case 'design-system':
				return {
					kind: 'docs' as const,
					title: 'Thingtime design system',
					description: 'The colourful, flexible building blocks behind the Thingtime experience.',
					eyebrow: 'THINGTIME · DESIGN SYSTEM',
					badges: ['Components', 'Themes']
				};
			case 'schemas':
				return {
					kind: 'collection' as const,
					title: 'Thingtime schemas',
					description: 'Browse the building blocks that make every kind of thing understandable.',
					eyebrow: 'THINGTIME · SCHEMAS',
					badges: ['Open building blocks', 'Make it yours']
				};
			case 'themes':
				return {
					kind: 'collection' as const,
					title: 'Thingtime themes',
					description: 'A colourful collection of ways to make Thingtime feel like yours.',
					eyebrow: 'THINGTIME · THEMES',
					badges: ['Colour your space', 'Made to share']
				};
			case 'components':
				return {
					kind: 'collection' as const,
					title: 'Thingtime components',
					description: 'Reusable interface pieces, ready to explore and make your own.',
					eyebrow: 'THINGTIME · COMPONENTS',
					badges: ['Composable', 'Shareable']
				};
			case 'actions':
				return {
					kind: 'collection' as const,
					title: 'Thingtime actions',
					description: 'Small, clear actions that turn your things into useful little workflows.',
					eyebrow: 'THINGTIME · ACTIONS',
					badges: ['Do more', 'Keep context']
				};
			case 'search':
				return {
					kind: 'collection' as const,
					title: 'Search Thingtime',
					description: 'Find the people, posts and things that matter to you.',
					eyebrow: 'THINGTIME · SEARCH',
					badges: ['People', 'Posts', 'Things']
				};
			case 'things':
				return {
					kind: 'collection' as const,
					title: 'Your Things',
					description: 'A place for the files, notes, ideas and tiny details you want to keep close.',
					eyebrow: 'THINGTIME · THINGS',
					badges: ['Everything is a thing', 'Made for keeping']
				};
			default:
				return {
					kind: 'home' as const,
					title: 'Thingtime',
					description: 'Everything is a thing — share posts, run polls and build a home for the things you care about.',
					eyebrow: 'THINGTIME · EVERYDAY MAGIC',
					badges: ['Posts', 'Photos', 'Polls']
				};
		}
	})();
	// Named catalogue and documentation pages deserve a useful title too, even
	// though they have no user-authored database record to resolve. That makes
	// a copied /components/button or /docs/api/things URL distinguishable in a
	// chat thread at a glance.
	const leaf = segments.at(-1) || '';
	if (segments.length > 1 && ['docs', 'schemas', 'themes', 'components', 'actions'].includes(segment)) {
		const category = segment === 'docs' ? 'docs' : segment.slice(0, -1);
		// Bounded like every data-backed preview: the leaf is a raw URL segment,
		// so an unbounded one would put a path-length og:title/og:description in
		// the head (the card itself wraps and clamps by measured width anyway).
		return {
			...detail,
			variant: staticVariantFor(detail.kind),
			path,
			title: truncateSocialText(`Thingtime ${category}: ${label(leaf)}`, TITLE_MAX),
			description: truncateSocialText(`${detail.description} Open ${label(leaf)} on Thingtime.`, DESCRIPTION_MAX),
			article: false,
			options: [],
			images: [],
			imageCount: 0
		};
	}
	return { ...detail, variant: staticVariantFor(detail.kind), path, article: false, options: [], images: [], imageCount: 0 };
};

const postImages = (post: any): SocialPreviewImage[] =>
	(Array.isArray(post?.attachments) ? post.attachments : [])
		.filter((attachment: any) => attachment?.mediaKind === 'image' && typeof attachment?.id === 'string' && !attachment?.url && !attachment?.pending)
		.slice(0, 4)
		.map((attachment: any) => ({
			attachmentId: attachment.id,
			label: cleanSocialText(attachment.title) || cleanSocialText(attachment.filenamePreview) || cleanSocialText(attachment.name) || 'Photo'
		}));

const pollOptions = (post: any): string[] => {
	const raw = post?.thing?.options;
	if (!Array.isArray(raw)) return [];
	return raw
		.map((option) => (typeof option === 'string' ? cleanSocialText(option) : cleanSocialText(option?.text)))
		.filter(Boolean)
		.slice(0, 3);
};

const formatPrice = (listing: any): string => {
	const price = typeof listing?.price === 'number' && Number.isFinite(listing.price) ? listing.price : null;
	const currency = cleanSocialText(listing?.currency);
	if (price === null) return '';
	try {
		return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(price);
	} catch {
		return `${currency || '$'}${price.toLocaleString('en')}`;
	}
};

const webpageCopy = (blocks: unknown, result: string[] = []): string[] => {
	if (!Array.isArray(blocks) || result.length >= 12) return result;
	for (const block of blocks) {
		if (!block || typeof block !== 'object') continue;
		const item = block as Record<string, unknown>;
		const text = cleanSocialText(item.text);
		if (text) result.push(text);
		// Rich text is rendered through the page renderer's sanitising allowlist.
		// The card is plainer still: it keeps only readable text, never markup.
		const html = cleanSocialText(typeof item.html === 'string' ? item.html.replace(/<[^>]*>/g, ' ') : '');
		if (html) result.push(html);
		const alt = cleanSocialText(item.alt);
		if (alt) result.push(alt);
		webpageCopy(item.children, result);
		if (result.length >= 12) break;
	}
	return result;
};

const webpageBlockCount = (blocks: unknown): number => {
	if (!Array.isArray(blocks)) return 0;
	return blocks.reduce((count, block) => {
		if (!block || typeof block !== 'object') return count;
		return count + 1 + webpageBlockCount((block as Record<string, unknown>).children);
	}, 0);
};

type StructuredThingPreview = {
	kind: string;
	title: string;
	description: string;
	badges: string[];
};

// A Thingtime post can carry an intentionally open, structured `thing`.
// Preserve the useful human context in a bounded, plain-text form rather than
// serialising JSON into a card. The selected fields cover the common shapes
// (events, tasks, notes, places and little data things) without making a
// crawler card a second detail view.
const structuredThingPreview = (value: unknown): StructuredThingPreview => {
	const thing = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const kind = cleanSocialText(thing.kind) || 'Thing';
	const title = cleanSocialText(thing.title) || cleanSocialText(thing.name) || cleanSocialText(thing.headline);
	const description = cleanSocialText(thing.description) || cleanSocialText(thing.summary) || cleanSocialText(thing.note);
	const fields: Array<[string, unknown]> = [
		['Status', thing.status],
		['Category', thing.category],
		['Location', thing.location],
		['When', thing.date || thing.startsAt || thing.startDate],
		['Priority', thing.priority]
	];
	const badges = [kind, ...fields.map(([, field]) => cleanSocialText(field)).filter(Boolean)].slice(0, 3);
	return { kind, title, description, badges };
};

const postMediaVariant = (post: any): SocialPreviewVariant | null => {
	const kinds = new Set(
		(Array.isArray(post?.attachments) ? post.attachments : [])
			.map((attachment: any) => cleanSocialText(attachment?.mediaKind).toLowerCase())
			.filter(Boolean)
	);
	if (kinds.has('video')) return 'media-video';
	if (kinds.has('audio')) return 'media-audio';
	if (kinds.has('file') || kinds.size > 0) return 'media-file';
	return null;
};

const humanPostKind = (kind: SocialPreviewKind, thingKind?: string): string => {
	switch (kind) {
		case 'text-post':
			return 'TEXT POST';
		case 'image-post':
			return 'PHOTO POST';
		case 'gallery':
			return 'PHOTO SET';
		case 'poll':
			return 'POLL';
		case 'listing':
			return 'MARKETPLACE';
		case 'thingtime':
			return thingKind ? `THING · ${truncateSocialText(thingKind, 26).toUpperCase()}` : 'THING';
		case 'share':
			return 'SHARE';
		case 'comment':
			return 'COMMENT';
		case 'reply':
			return 'REPLY';
		default:
			return kind.replace(/-/g, ' ').toUpperCase();
	}
};

export const normaliseSocialMediaKind = (value: unknown): 'image' | 'video' | 'audio' | 'file' => {
	const kind = cleanSocialText(value).toLowerCase();
	return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : 'file';
};

export const socialMediaVariant = (value: unknown): Extract<SocialPreviewVariant, `media-${string}`> => {
	switch (normaliseSocialMediaKind(value)) {
		case 'image':
			return 'media-image';
		case 'video':
			return 'media-video';
		case 'audio':
			return 'media-audio';
		default:
			return 'media-file';
	}
};

const webpagePreview = async (path: string, id: string): Promise<SocialPreview> => {
	const fallback = staticSocialPreview(path);
	const { resolveWebpage } = await import('../webpages/webpages');
	const { viewerOf } = await import('../things/things');
	const result = await resolveWebpage(viewerOf(null), { id });
	if (!result.ok || !result.page) return fallback;
	const page: any = result.page;
	const crystal = page.crystal || {};
	const name = cleanSocialText(crystal.name) || 'A page';
	const pageText = webpageCopy(crystal.blocks).join(' ');
	const description = cleanSocialText(crystal.description) || pageText || 'A published page made with Thingtime.';
	const author = cleanSocialText(page.author?.displayName) || cleanSocialText(page.author?.username);
	const blockCount = webpageBlockCount(crystal.blocks);
	return {
		kind: 'webpage',
		variant: 'webpage',
		path,
		title: `${truncateSocialText(name, TITLE_MAX)} on ${SITE_NAME}`,
		description: truncateSocialText(description, DESCRIPTION_MAX),
		eyebrow: 'THINGTIME · PAGE',
		article: true,
		author: author || undefined,
		initial: author ? initialOf(author.replace(/^@/, '')) : undefined,
		badges: ['Published page', blockCount ? `${blockCount} content block${blockCount === 1 ? '' : 's'}` : 'Made with Thingtime'],
		options: [],
		images: [],
		imageCount: 0,
		revision: cleanSocialText(page.updatedAt) || cleanSocialText(page.createdAt)
	};
};

export const socialPreviewFromPublicPost = (path: string, post: any, context: { parent?: any; revision?: string } = {}): SocialPreview => {
	const authorName =
		cleanSocialText(post?.author?.displayName) || (cleanSocialText(post?.author?.username) ? `@${cleanSocialText(post.author.username)}` : 'Someone');
	const original = post?.isShare && post?.shareOf ? post.shareOf : null;
	const source = original || post || {};
	const sourceAuthor =
		cleanSocialText(source.author?.displayName) || (cleanSocialText(source.author?.username) ? `@${cleanSocialText(source.author.username)}` : '');
	const isComment = Array.isArray(post?.thingtime) && post.thingtime.includes('comment');
	const isReply = isComment && Array.isArray(context.parent?.thingtime) && context.parent.thingtime.includes('comment');
	const parentAuthor =
		cleanSocialText(context.parent?.author?.displayName) ||
		(cleanSocialText(context.parent?.author?.username) ? `@${cleanSocialText(context.parent.author.username)}` : '');
	const structured = structuredThingPreview(source.thing);
	const question = cleanSocialText(source.thing?.question);
	const listing = source.listing;
	const options = question ? pollOptions(source) : [];
	const images = postImages(source);
	const attachmentCount = Array.isArray(source.attachments) ? source.attachments.length : 0;
	const attachmentImageCount = Array.isArray(source.attachments)
		? source.attachments.filter((attachment: any) => attachment?.mediaKind === 'image').length
		: 0;
	const legacyImageCount = Array.isArray(source.images) ? source.images.filter((image: unknown) => typeof image === 'string' && image).length : 0;
	// Render the first four safe stored images, while keeping the true photo
	// count in the card's badge (a six-photo post is still a six-photo post).
	// Legacy image URLs contribute their count, but never become a server-side
	// fetch — their tiles intentionally use the branded fallback treatment.
	const imageCount = Math.max(attachmentImageCount, legacyImageCount);
	const sourceType = cleanSocialText(source.type).toLowerCase();
	const mediaVariant = postMediaVariant(source);
	const contentKind: SocialPreviewKind = listing
		? 'listing'
		: question
		? 'poll'
		: sourceType === 'thingtime'
		? 'thingtime'
		: imageCount > 1
		? 'gallery'
		: sourceType === 'image' || imageCount === 1
		? 'image-post'
		: 'text-post';
	const kind: SocialPreviewKind = original ? 'share' : isReply ? 'reply' : isComment ? 'comment' : contentKind;
	const variant: SocialPreviewVariant = original
		? 'share'
		: isReply
		? 'reply'
		: isComment
		? 'comment'
		: contentKind === 'text-post' && mediaVariant
		? mediaVariant
		: contentKind;
	const listingBits = listing
		? [
				formatPrice(listing),
				cleanSocialText(listing.category),
				cleanSocialText(listing.condition),
				cleanSocialText(listing.location),
				listing.sold ? 'Sold' : ''
		  ].filter(Boolean)
		: [];
	const plainText = cleanSocialText(source.text);
	const listingTitle = cleanSocialText(listing?.title);
	const summary =
		listingTitle ||
		question ||
		structured.title ||
		plainText ||
		structured.description ||
		(attachmentCount ? `${attachmentCount} shared attachment${attachmentCount === 1 ? '' : 's'}` : 'A post on Thingtime');
	const kindLabel = humanPostKind(contentKind, structured.kind);
	const badges = Array.from(
		new Set(
			[
				...(original ? [`Shared ${kindLabel.toLowerCase()}`, ...(sourceAuthor ? [`From ${sourceAuthor}`] : [])] : []),
				...(isReply ? ['Reply', ...(parentAuthor ? [`To ${parentAuthor}`] : [])] : isComment ? ['Comment'] : []),
				...(listingBits.length ? listingBits : []),
				...(contentKind === 'thingtime' ? structured.badges : []),
				...(mediaVariant && contentKind === 'text-post' ? [humanPostKind(mediaVariant as SocialPreviewKind)] : []),
				...cleanList(source.tags, 3).map((tag) => `#${tag.replace(/^#/, '')}`),
				...(imageCount > 1 ? [`${imageCount} photos`] : imageCount === 1 ? ['Photo'] : [])
			].filter(Boolean)
		)
	).slice(0, 4);
	const description = question
		? truncateSocialText(['Poll:', question, options.length ? `· ${options.join(' / ')}` : ''].filter(Boolean).join(' '), DESCRIPTION_MAX)
		: listing
		? truncateSocialText(
				[formatPrice(listing), cleanSocialText(listing.condition), cleanSocialText(listing.location), plainText].filter(Boolean).join(' · ') ||
					summary,
				DESCRIPTION_MAX
		  )
		: contentKind === 'thingtime'
		? truncateSocialText(
				[structured.description, plainText].filter(Boolean).join(' · ') || `A ${structured.kind.toLowerCase()} on ${SITE_NAME}.`,
				DESCRIPTION_MAX
		  )
		: truncateSocialText(summary, DESCRIPTION_MAX) || `A post by ${authorName} on ${SITE_NAME}.`;
	const titleLead = original ? `${authorName} shared` : isReply ? `${authorName} replied` : isComment ? `${authorName} commented` : authorName;
	return {
		kind,
		variant,
		path,
		title: `${titleLead}: ${truncateSocialText(summary, TITLE_MAX)}`,
		description,
		eyebrow: `THINGTIME · ${kind === 'share' ? `SHARED ${kindLabel}` : humanPostKind(kind, structured.kind)}`,
		article: true,
		author: authorName,
		initial: initialOf(authorName.replace(/^@/, '')),
		badges,
		options,
		images,
		imageCount,
		revision: context.revision
	};
};

// The post-shaped projection of an already-resolved getThing result. Split out
// so /thing/:id can reuse the walk it has already paid for: getThing is not a
// cheap read — toPublicPosts batch-embeds comments/reactions/views, and for a
// comment or a media attachment it also walks the parent chain (uncapped depth,
// one round trip per level). Returns null when the target is not a
// world-readable post, which every caller renders as the generic card.
const publicPostPreview = async (path: string, result: any): Promise<SocialPreview | null> => {
	const post: any = result.post;
	if (!post) return null;
	// belt-and-braces on top of the anonymous viewer walk: rich meta is for
	// world-readable posts only. tt:all is directly world-readable; tt:inherit
	// (every comment) counts too because the anonymous getThing success above
	// already proved the inherited audience includes anonymous.
	const { ACL_ALL, ACL_INHERIT } = await import('../../../schemas/registry');
	if (!Array.isArray(post.acl) || !(post.acl.includes(ACL_ALL) || post.acl.includes(ACL_INHERIT))) return null;
	return socialPreviewFromPublicPost(path, post, {
		parent: result.parent,
		revision: cleanSocialText(result.thing?.updatedAt) || cleanSocialText(result.thing?.createdAt)
	});
};

const postPreview = async (path: string, id: string): Promise<SocialPreview> => {
	const fallback = staticSocialPreview(path);
	const { getThing, viewerOf } = await import('../things/things');
	const result = await getThing(viewerOf(null), id);
	if (result.ok === false) return fallback;
	return (await publicPostPreview(path, result)) || fallback;
};

const profilePreview = async (path: string, username: string): Promise<SocialPreview> => {
	const fallback = staticSocialPreview(path);
	const { findUserByUsername, toPublicProfile } = await import('../auth/users');
	const user = await findUserByUsername(username);
	if (!user) return fallback;
	const profile: any = toPublicProfile(user);
	const displayName = cleanSocialText(profile.displayName) || cleanSocialText(profile.username);
	const handle = cleanSocialText(profile.username);
	return {
		kind: 'profile',
		variant: 'profile',
		path,
		title: `${displayName} (@${handle}) on ${SITE_NAME}`,
		description: truncateSocialText(cleanSocialText(profile.bio), DESCRIPTION_MAX) || `@${handle} is on ${SITE_NAME}.`,
		eyebrow: 'THINGTIME · PROFILE',
		article: false,
		author: displayName,
		initial: initialOf(displayName),
		badges: handle ? [`@${handle}`, 'On Thingtime'] : ['On Thingtime'],
		options: [],
		images: [],
		imageCount: 0,
		revision: cleanSocialText(profile.updatedAt)
	};
};

const mediaPreview = async (path: string, id: string): Promise<SocialPreview> => {
	const fallback = staticSocialPreview(path);
	const { getThing, viewerOf } = await import('../things/things');
	const result = await getThing(viewerOf(null), id);
	if (result.ok === false || !(result as any).thing?.thingtime?.includes?.('attachment')) return fallback;
	const thing: any = (result as any).thing;
	const media = thing.crystal || {};
	const label = cleanSocialText(media.title) || cleanSocialText(media.filenamePreview) || cleanSocialText(media.name) || 'Shared media';
	const mediaKind = normaliseSocialMediaKind(media.mediaKind);
	const variant = socialMediaVariant(mediaKind);
	return {
		kind: 'media',
		variant,
		path,
		title: `${label} on ${SITE_NAME}`,
		description:
			truncateSocialText(cleanSocialText(media.description), DESCRIPTION_MAX) ||
			`${mediaKind[0]?.toUpperCase() || 'M'}${mediaKind.slice(1)} shared on Thingtime.`,
		eyebrow: `THINGTIME · ${mediaKind.toUpperCase()}`,
		article: true,
		badges: [mediaKind, cleanSocialText(media.contentType), typeof media.size === 'number' ? `${Math.max(0, Math.round(media.size / 1024))} KB` : '']
			.filter(Boolean)
			.slice(0, 3),
		options: [],
		images: mediaKind === 'image' && !media.url ? [{ attachmentId: thing.id, label }] : [],
		imageCount: mediaKind === 'image' ? 1 : 0,
		revision: cleanSocialText(thing.updatedAt) || cleanSocialText(thing.createdAt)
	};
};

const thingPreview = async (path: string, id: string): Promise<SocialPreview> => {
	const fallback = staticSocialPreview(path);
	const { getThing, viewerOf } = await import('../things/things');
	const result = await getThing(viewerOf(null), id);
	if (result.ok === false) return fallback;
	// A /thing/:id that resolves to a post/comment/attachment gets the richer
	// post card — from THIS result, never a second getThing for the same id.
	if (result.post) return (await publicPostPreview(path, result)) || fallback;
	const thing: any = result.thing;
	const crystal = thing?.crystal || {};
	const kind = cleanList(thing?.thingtime, 3).join(' · ') || 'Thing';
	const title = cleanSocialText(crystal.title) || cleanSocialText(crystal.name) || kind;
	const description = cleanSocialText(crystal.description) || cleanSocialText(crystal.text) || `A ${kind.toLowerCase()} on ${SITE_NAME}.`;
	return {
		kind: 'thing',
		variant: 'thing',
		path,
		title: `${truncateSocialText(title, TITLE_MAX)} on ${SITE_NAME}`,
		description: truncateSocialText(description, DESCRIPTION_MAX),
		eyebrow: `THINGTIME · ${kind.toUpperCase()}`,
		article: false,
		badges: cleanList(thing?.tags, 3).map((tag) => `#${tag.replace(/^#/, '')}`),
		options: [],
		images: [],
		imageCount: 0,
		revision: cleanSocialText(thing?.updatedAt) || cleanSocialText(thing?.createdAt)
	};
};

export const resolveSocialPreview = async (origin: string, pathInput: string): Promise<SocialPreview> => {
	const path = normaliseSocialPreviewPath(pathInput);
	try {
		const postMatch = path.match(/^\/post\/([^/]+)\/?$/);
		if (postMatch) return await postPreview(path, decodeURIComponent(postMatch[1]));
		const profileMatch = path.match(/^\/profile\/([^/]+)\/?$/);
		if (profileMatch) return await profilePreview(path, decodeURIComponent(profileMatch[1]));
		const mediaMatch = path.match(/^\/media\/([^/]+)\/?$/);
		if (mediaMatch) return await mediaPreview(path, decodeURIComponent(mediaMatch[1]));
		const webpageMatch = path.match(/^\/p\/([^/]+)\/?$/);
		if (webpageMatch) return await webpagePreview(path, decodeURIComponent(webpageMatch[1]));
		const thingMatch = path.match(/^\/thing\/([^/]+)\/?$/);
		if (thingMatch) return await thingPreview(path, decodeURIComponent(thingMatch[1]));
	} catch {
		// A malformed or unavailable public target receives the safe generic card.
	}
	return staticSocialPreview(path);
};
