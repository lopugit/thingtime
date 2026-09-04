import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSocialMetaTags } from './socialMeta';
import { normaliseSocialPreviewPath, socialPreviewCardUrl, staticSocialPreview } from './socialPreview';

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

test('static public routes get route-specific social context', () => {
	const feed = staticSocialPreview('/feed');
	const docs = staticSocialPreview('/docs/api');
	const component = staticSocialPreview('/components/colourful-button');
	assert.equal(feed.kind, 'feed');
	assert.match(feed.description, /Posts, photos, polls/i);
	assert.equal(docs.kind, 'docs');
	assert.match(docs.title, /docs/i);
	assert.match(component.title, /Colourful Button/);
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
