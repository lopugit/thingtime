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
		['/invite#secret-token', DEFAULT_PAGE_TITLE],
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
		'https://thingtime.example/social-card?path=%2Fpost%2Fhello&v=2026-09-04T12%3A00%3A00.000Z'
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
