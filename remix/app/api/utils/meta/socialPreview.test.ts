import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSocialMetaTags, resolveSocialMeta, renderSocialMetaHtml } from './socialMeta';
import { DEFAULT_PAGE_TITLE, pageTitle } from '../../../utils/pageTitle';
import { readFileSync } from 'node:fs';
import {
	normaliseSocialMediaKind,
	normaliseSocialPreviewPath,
	socialMediaVariant,
	socialPreviewCardUrl,
	socialPreviewFromPublicPost,
	socialPreviewRevision,
	staticSocialPreview
} from './socialPreview';

test('uncustomized pages use the press-kit PNG and safe shared page titles', async () => {
	for (const [path, title] of [
		['/', DEFAULT_PAGE_TITLE],
		['/branding', 'Thingtime - Brand resources'],
		['/unknown/private-name?token=secret', DEFAULT_PAGE_TITLE],
		['/settings', 'Thingtime - Settings']
	]) {
		const { tags } = await resolveSocialMeta(new Request(`https://thingtime.example${path}`));
		const values = new Map(tags.map((tag) => [tag.key, tag.content]));
		assert.equal(values.get('og:title'), title);
		assert.equal(values.get('twitter:title'), title);
		assert.equal(values.get('og:image'), 'https://thingtime.example/branding/presskit/thingtime-og-card-1200x630.png?v=20260917');
		assert.equal(values.get('twitter:image'), values.get('og:image'));
		assert.equal(values.get('twitter:card'), 'summary_large_image');
		assert.doesNotMatch(renderSocialMetaHtml(tags), /secret-token|token=secret/);
	}
	const custom = await resolveSocialMeta(new Request('https://thingtime.example/feed'));
	assert.match(custom.tags.find((tag) => tag.key === 'og:image')!.content, /\/social-card\?/);
	assert.equal(pageTitle('/branding', '[LC]'), '[LC] Thingtime - Brand resources');
	// the connections routes label from the SHARED table, so the server-rendered
	// social meta and the client-set document.title agree (root.tsx used to carry
	// its own copy of this one case)
	assert.equal(pageTitle('/connections'), 'Thingtime - Connections');
	assert.equal(pageTitle('/connections/feed'), 'Thingtime - Connections');
	assert.equal(pageTitle('/profile-secret'), DEFAULT_PAGE_TITLE);
	assert.equal(pageTitle('/', '[LC]'), `[LC] ${DEFAULT_PAGE_TITLE}`);
});

test('static shell fallback uses the same real 1200x630 branding image', () => {
	const html = readFileSync(new URL('../../../../index.html', import.meta.url), 'utf8');
	assert.match(html, /og:image" content="https:\/\/thingtime.com\/branding\/presskit\/thingtime-og-card-1200x630.png/);
	assert.doesNotMatch(html, /og:image" content="\/android-icon/);
	const png = readFileSync(new URL('../../../../public/branding/presskit/thingtime-og-card-1200x630.png', import.meta.url));
	assert.equal(png.readUInt32BE(16), 1200);
	assert.equal(png.readUInt32BE(20), 630);
});

test('social preview paths never become a redirect or an arbitrary route', () => {
	assert.equal(normaliseSocialPreviewPath('/post/hello?source=chat'), '/post/hello');
	assert.equal(normaliseSocialPreviewPath('//elsewhere.example/post'), '/');
	assert.equal(normaliseSocialPreviewPath('/post\\evil'), '/');
	assert.equal(normaliseSocialPreviewPath(null), '/');
});

test('social-card URLs carry only a normalized local path and a safe revision', () => {
	assert.equal(
		socialPreviewCardUrl('https://thingtime.example', '/post/hello?source=chat', '2026-09-04T12:00:00.000Z'),
		'https://thingtime.example/social-card?path=%2Fpost%2Fhello&r=brand-20261029&v=2026-09-04T12%3A00%3A00.000Z'
	);
});

// A card URL that never changes is not merely stale for the CDN's
// stale-while-revalidate window: unfurlers cache og:image by URL and do not
// revalidate, so the old card survives in Slack/Twitter/Discord indefinitely.
// Profiles have no updatedAt in their public projection (toPublicProfile), so
// the revision has to come from what the card draws.
test('a profile card URL changes whenever the card it names would', () => {
	const base = socialPreviewRevision('Nyik', 'DEVELOPER');
	assert.equal(base, socialPreviewRevision('Nyik', 'DEVELOPER'), 'the same profile must keep one stable cache key');
	assert.notEqual(base, socialPreviewRevision('Nyik Renamed', 'DEVELOPER'), 'a renamed profile must get a new card URL');
	assert.notEqual(base, socialPreviewRevision('Nyik', 'DESIGNER'), 'an edited bio must get a new card URL');
	// The key is a fingerprint, not the profile text: nothing readable leaks into
	// a URL that ends up in referer logs and chat transcripts.
	assert.match(base, /^[0-9a-z]{1,7}$/);
	assert.doesNotMatch(socialPreviewRevision('Nyik', 'DEVELOPER'), /Nyik|DEVELOPER/);
	// Length-prefixed, not delimited: no separator exists that cleanSocialText
	// keeps out of a display name, so a delimited key would fuse these two.
	assert.notEqual(socialPreviewRevision('ab', 'c'), socialPreviewRevision('a', 'bc'));
	assert.notEqual(socialPreviewRevision('Nyik Renamed', ''), socialPreviewRevision('Nyik', 'Renamed'));
	// It must survive the same values a preview would really hand it.
	assert.equal(typeof socialPreviewRevision('', ''), 'string');
	assert.notEqual(socialPreviewRevision('🌸 Rosie', ''), socialPreviewRevision('', ''));
	// And it must reach the card URL as a real ?v= cache buster.
	assert.match(socialPreviewCardUrl('https://thingtime.example', '/profile/lopu', base), new RegExp(`[?&]v=${base}$`));
});

test('static public routes get route-specific social context', () => {
	const feed = staticSocialPreview('/feed');
	const docs = staticSocialPreview('/docs/api');
	const component = staticSocialPreview('/components/colourful-button');
	const profile = staticSocialPreview('/profile');
	assert.equal(feed.kind, 'feed');
	assert.match(feed.description, /Posts, photos, polls/i);
	assert.equal(docs.kind, 'docs');
	assert.match(docs.title, /docs/i);
	assert.match(component.title, /Colourful Button/);
	assert.equal(profile.variant, 'profile');
});

test('a named catalogue page bounds its tags like every data-backed preview', () => {
	// The leaf is a raw URL segment, so it is as long as the caller makes it.
	const long = staticSocialPreview(`/docs/${'a'.repeat(600)}`);
	assert.ok(Array.from(long.title).length <= 70, `title was ${Array.from(long.title).length} code points`);
	assert.ok(Array.from(long.description).length <= 200, `description was ${Array.from(long.description).length} code points`);
	assert.ok(long.title.endsWith('…'));
	// Ordinary names are still printed whole.
	assert.equal(staticSocialPreview('/components/colourful-button').title, 'Thingtime component: Colourful Button');
});

test('Open Graph tags declare a full PNG card for social renderers', () => {
	const tags = buildSocialMetaTags('https://thingtime.example', '/feed', {
		title: 'Thingtime feed',
		description: 'Fresh things',
		image: 'https://thingtime.example/social-card?path=%2Ffeed',
		largeImage: true
	});
	const values = new Map(tags.map((tag) => [tag.key, tag.content]));
	assert.equal(values.get('og:image:type'), 'image/png');
	assert.equal(values.get('og:image:width'), '1200');
	assert.equal(values.get('og:image:height'), '630');
	assert.equal(values.get('twitter:card'), 'summary_large_image');
	assert.equal(values.get('twitter:image'), values.get('og:image'));
});

test('standalone media URLs get a specific image, video, audio, or file card', () => {
	for (const [input, expectedKind, expectedVariant] of [
		['image', 'image', 'media-image'],
		['video', 'video', 'media-video'],
		['audio', 'audio', 'media-audio'],
		['document', 'file', 'media-file']
	] as const) {
		assert.equal(normaliseSocialMediaKind(input), expectedKind);
		assert.equal(socialMediaVariant(input), expectedVariant);
	}
});

test('every canonical post family and thread shape gets a distinct social variant', () => {
	const author = { displayName: 'Nikk', username: 'lopu' };
	const attachment = (mediaKind: string, id = mediaKind) => ({ id, mediaKind, title: `${mediaKind} attachment` });
	const cases: Array<[string, Record<string, unknown>, string]> = [
		['text', { type: 'text', text: 'A little text thought' }, 'text-post'],
		['one-photo image', { type: 'image', text: 'One photo', attachments: [attachment('image')] }, 'image-post'],
		[
			'gallery',
			{
				type: 'image',
				text: 'Four photos',
				attachments: [attachment('image', 'one'), attachment('image', 'two'), attachment('image', 'three'), attachment('image', 'four')]
			},
			'gallery'
		],
		['marketplace', { type: 'marketplace', listing: { title: 'Rainbow bike', price: 400, currency: 'AUD', condition: 'used' } }, 'listing'],
		[
			'thingtime',
			{
				type: 'thingtime',
				text: 'Bring snacks',
				thing: { kind: 'event', title: 'Sunday picnic', description: 'A tiny park get-together', location: 'Edinburgh Gardens' }
			},
			'thingtime'
		],
		['poll', { type: 'thingtime', thing: { kind: 'poll', question: 'Where should we go?', options: ['Park', 'Beach', 'Gallery'] } }, 'poll'],
		['video attachment', { type: 'text', text: 'Watch this', attachments: [attachment('video')] }, 'media-video'],
		['audio attachment', { type: 'text', text: 'Listen', attachments: [attachment('audio')] }, 'media-audio'],
		['file attachment', { type: 'text', text: 'Read this', attachments: [attachment('file')] }, 'media-file']
	];

	for (const [name, fields, expectedVariant] of cases) {
		const preview = socialPreviewFromPublicPost('/post/example', { author, thingtime: ['post'], attachments: [], images: [], tags: [], ...fields });
		assert.equal(preview.variant, expectedVariant, name);
		assert.equal(preview.path, '/post/example', name);
	}

	const shared = socialPreviewFromPublicPost('/post/share', {
		author,
		thingtime: ['post', 'share'],
		isShare: true,
		shareOf: {
			author: { displayName: 'Jade' },
			type: 'thingtime',
			thing: { kind: 'poll', question: 'Share this?' },
			attachments: [],
			images: [],
			tags: []
		},
		attachments: [],
		images: [],
		tags: []
	});
	assert.equal(shared.kind, 'share');
	assert.equal(shared.variant, 'share');
	assert.match(shared.eyebrow, /SHARED POLL/);

	const comment = socialPreviewFromPublicPost('/post/comment', {
		author,
		thingtime: ['post', 'comment'],
		type: 'text',
		text: 'I agree!',
		attachments: [],
		images: [],
		tags: []
	});
	assert.equal(comment.kind, 'comment');
	assert.equal(comment.variant, 'comment');
	const reply = socialPreviewFromPublicPost(
		'/post/reply',
		{ author, thingtime: ['post', 'comment'], type: 'text', text: 'Me too!', attachments: [], images: [], tags: [] },
		{ parent: { thingtime: ['post', 'comment'], author: { displayName: 'Jade' } } }
	);
	assert.equal(reply.kind, 'reply');
	assert.equal(reply.variant, 'reply');
	assert.ok(reply.badges.includes('To Jade'));
});

test('an anonymously readable unlisted photo post has contextual metadata but stays noindex', async () => {
  const { publicPostPreview } = await import('./socialPreview');
  const { socialMetaFromPreview } = await import('./socialMeta');
  const result = { ok: true, thing: { updatedAt: '2026-09-21' }, post: {
    acl: ['tt:hidden'], author: { displayName: 'Photographer' }, text: 'Classic cars at the weekend meet',
    thingtime: ['post'], attachments: [{ id: 'car-photo', mediaKind: 'image' }]
  }};
  const preview = await publicPostPreview('/post/car-meet', result);
  assert.ok(preview);
  assert.match(preview.title, /Classic cars/);
  assert.equal(preview.images[0].attachmentId, 'car-photo');
  const tags = new Map(socialMetaFromPreview('https://thingtime.example', preview).tags.map(tag => [tag.key, tag.content]));
  assert.match(tags.get('og:description')!, /Classic cars/);
  assert.match(tags.get('og:image')!, /social-card/);
  assert.equal(tags.get('robots'), 'noindex, follow');
  assert.equal(await publicPostPreview('/post/private', { ...result, ok: false }), null);
  assert.equal(await publicPostPreview('/post/private', { ...result, post: { ...result.post, acl: ['tt:user'] } }), null);
});


test('invitation links have a shared card without reading or validating their private payload', async () => {
	const expected = staticSocialPreview('/invite');
	assert.equal(expected.kind, 'invite');
	assert.equal(expected.variant, 'invite');
	assert.equal(expected.title, 'You’re invited to Thingtime');
	assert.equal(expected.indexable, false);
	assert.equal(expected.publicContent, undefined);
	// Fragments never reach a real HTTP server. These inputs also cover the
	// safe helper path and legacy query payloads; none may enter the card URL.
	for (const suffix of ['', '#valid-private-token', '#expired-private-token', '#%E0%A4%A', '?token=private&email=person%40example.com&gift=99#<script>']) {
		const meta = await resolveSocialMeta(new Request(`https://thingtime.example/invite${suffix}`));
		const tags = new Map(meta.tags.map((tag) => [tag.key, tag.content]));
		assert.equal(tags.get('og:title'), expected.title);
		assert.equal(tags.get('og:description'), expected.description);
		assert.equal(tags.get('twitter:card'), 'summary_large_image');
		assert.equal(tags.get('og:image'), 'https://thingtime.example/social-card?path=%2Finvite&r=brand-20261029&v=invite-20261029');
		assert.equal(tags.get('robots'), 'noindex, follow');
		assert.equal(meta.canonical, 'https://thingtime.example/invite');
		assert.doesNotMatch(renderSocialMetaHtml(meta), /private|expired|person|%E0|gift|<script>/);
	}
	assert.equal(pageTitle('/invite'), 'Thingtime - Invitation');
	assert.equal(pageTitle('/invite#private', '[LC]'), '[LC] Thingtime - Invitation');
});


test('metadata API accepts only same-origin paths and drops queries, fragments and caller identity', async () => {
	const { resolveSocialMetadata, socialMetadataPath } = await import('./socialMetadata');
	for (const value of ['/post/public?token=secret#secret', 'https://thingtime.example/post/public?token=secret#secret'])
		assert.equal(socialMetadataPath('https://thingtime.example', value), '/post/public');
	for (const value of ['https://other.example/post/public', '//other.example/a', 'https://user:secret@thingtime.example/a', 'file:///a', ['javascript', 'alert(1)'].join(':'), '/a\\b', '/a\nsecret'])
		assert.throws(() => socialMetadataPath('https://thingtime.example', value));
	const resolved: string[][] = [];
	const resolve = async (origin: string, path: string) => {
		resolved.push([origin, path]);
		return { ...staticSocialPreview(path), title: 'Public title', description: 'Public description', publicContent: true, secret: 'never-project', crystal: { private: true } };
	};
	const url = 'https://thingtime.example/api/v1/social-previews?path=' + encodeURIComponent('/post/public?token=secret#secret');
	const anonymous = await resolveSocialMetadata(new Request(url), resolve);
	const signedIn = await resolveSocialMetadata(new Request(url, { headers: { Cookie: 'tt_auth=private; tt_mongo=private', Authorization: 'Bearer private', 'x-tt-mongo-url': 'mongodb://attacker.invalid/thingtime' } }), resolve);
	assert.deepEqual(signedIn, anonymous);
	assert.deepEqual(resolved, [['https://thingtime.example', '/post/public'], ['https://thingtime.example', '/post/public']]);
	assert.deepEqual(Object.keys(anonymous).sort(), ['canonical', 'description', 'image', 'publicContent', 'title', 'type', 'url']);
	assert.equal(anonymous.canonical, 'https://thingtime.example/post/public');
	assert.equal(anonymous.title, 'Public title');
	assert.equal(anonymous.image.width, 1200);
	assert.equal(anonymous.image.height, 630);
	assert.equal(anonymous.image.type, 'image/png');
	assert.doesNotMatch(JSON.stringify(anonymous), /secret|private|crystal|never-project/);
	const unavailable = await resolveSocialMetadata(new Request(url), async () => { throw new Error('private database detail'); });
	const missing = await resolveSocialMetadata(new Request(url), async (_, path) => staticSocialPreview(path));
	assert.deepEqual(unavailable, missing);
	assert.equal(missing.publicContent, false);
});

test('metadata route leaves inherited custom databases and rate limits anonymously before resolving', async () => {
	const { createSocialPreviewsLoader } = await import('../../../routes/api/v1/social-previews/_social-previews');
	const { runWithMongoEndpoint, getActiveMongoEndpoint } = await import('../mongodb/endpoint');
	const { resolveSocialMetadata } = await import('./socialMetadata');
	let calls = 0;
	const handler = createSocialPreviewsLoader({
		limit: async (_request, key, identity, options) => {
			assert.equal(getActiveMongoEndpoint(), null);
			assert.equal(key, 'social-previews.read');
			assert.equal(identity, null);
			assert.equal(options?.failClosed, true);
			return { allowed: true, limit: 120, remaining: 119, resetAt: new Date().toISOString() };
		},
		resolve: async (request) => {
			calls++;
			assert.equal(getActiveMongoEndpoint(), null);
			return resolveSocialMetadata(request, async (_, path) => staticSocialPreview(path));
		}
	});
	const selection = { url: 'mongodb://attacker.invalid/thingtime', savedId: null };
	await runWithMongoEndpoint(selection, async () => {
		const response = await handler({ request: new Request('https://thingtime.example/api/v1/social-previews?path=%2Finvite', { headers: { Cookie: 'tt_auth=private', 'x-tt-mongo-url': selection.url } }) });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(getActiveMongoEndpoint()?.url, selection.url);
		assert.equal((await response.json()).publicContent, false);
	});
	const refused = createSocialPreviewsLoader({ limit: async () => ({ allowed: false, limit: 120, remaining: 0, resetAt: new Date().toISOString() }), resolve: async () => { throw new Error('must not resolve'); } });
	const limited = await refused({ request: new Request('https://thingtime.example/api/v1/social-previews') });
	assert.equal(limited.status, 429);
	assert.ok(limited.headers.get('retry-after'));
	const unavailable = createSocialPreviewsLoader({ limit: async () => ({ allowed: false, unavailable: true, limit: 120, remaining: 0, resetAt: new Date().toISOString() }) });
	assert.equal((await unavailable({ request: new Request('https://thingtime.example/api/v1/social-previews') })).status, 503);
	assert.equal((await handler({ request: new Request('https://thingtime.example/api/v1/social-previews', { method: 'POST' }) })).status, 405);
	assert.equal(calls, 1);
});


test('all dynamic card URLs carry a global brand revision independently of content revision', async () => {
	const { SOCIAL_CARD_RENDERER_REVISION } = await import('./socialPreview');
	for (const path of ['/invite#secret', '/feed', '/post/public?token=secret', '/profile/example', '/p/public']) {
		const base = new URL(socialPreviewCardUrl('https://thingtime.example', path));
		const edited = new URL(socialPreviewCardUrl('https://thingtime.example', path, 'content-edit'));
		assert.equal(base.searchParams.get('r'), SOCIAL_CARD_RENDERER_REVISION);
		assert.equal(edited.searchParams.get('r'), SOCIAL_CARD_RENDERER_REVISION);
		assert.equal(edited.searchParams.get('v'), 'content-edit');
		assert.equal(base.searchParams.has('v'), false);
		assert.doesNotMatch(edited.href, /secret|token/);
	}
});
