import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fallbackSocialMeta, injectSocialMeta, renderSocialMetaHtml, resolveSocialMeta, socialMetaFromPreview } from './socialMeta';
import { socialPreviewFromPublicPost, staticSocialPreview } from './socialPreview';

const origin = 'https://thingtime.example';
const graphPage = (meta: ReturnType<typeof socialMetaFromPreview>) => (meta.structuredData['@graph'] as any[])[1];

test('every shell gets one matching canonical, Open Graph identity and server title', async () => {
	const shell = readFileSync(new URL('../../../../index.html', import.meta.url), 'utf8');
	for (const path of ['/', '/invite', '/things', '/feed', '/branding', '/docs/api', '/settings', '/unknown']) {
		const meta = await resolveSocialMeta(new Request(`${origin}${path}?token=private#secret`));
		const html = injectSocialMeta(shell, renderSocialMetaHtml(meta));
		assert.equal(meta.canonical, `${origin}${path}`);
		assert.equal(meta.tags.find((tag) => tag.key === 'og:url')?.content, meta.canonical);
		assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
		assert.equal((html.match(/property="og:image"/g) || []).length, 1);
		assert.equal((html.match(/<title>/g) || []).length, 1);
		assert.ok(html.includes(`<title>${meta.tags.find((tag) => tag.key === 'og:title')!.content}</title>`));
		assert.doesNotMatch(html, /token=private|#secret/);
		const json = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
		assert.equal(json['@context'], 'https://schema.org');
		assert.equal(json['@graph'][1].url, meta.canonical);
		assert.match(html, /rel="alternate" type="application\/atom\+xml"/);
		// the publishing Organization (brand logo for search) rides on every shell
		const organization = json['@graph'][2];
		assert.equal(organization['@type'], 'Organization');
		assert.equal(organization['@id'], `${origin}/#organization`);
		assert.equal(json['@graph'][0].publisher['@id'], organization['@id']);
		assert.equal(organization.logo.url, `${origin}/branding/generated/icon/thingtime-icon-1024x1024.png`);
		assert.ok(Array.isArray(organization.sameAs) && organization.sameAs.length > 0);
	}
});

test('public UGC metadata and JSON-LD use the same bounded anonymous projection', () => {
	const preview = socialPreviewFromPublicPost('/post/public', {
		author: { displayName: 'Artist' },
		text: 'A public photo',
		thingtime: ['post'],
		attachments: [{ id: 'photo', mediaKind: 'image' }]
	});
	const meta = socialMetaFromPreview(origin, preview);
	const page = graphPage(meta);
	assert.equal(page.mainEntity['@type'], 'SocialMediaPosting');
	assert.equal(page.mainEntity.author.name, 'Artist');
	assert.equal(page.mainEntity.description, preview.description);
	assert.equal(page.primaryImageOfPage.url, meta.tags.find((tag) => tag.key === 'og:image')!.content);
	assert.equal(meta.tags.find((tag) => tag.key === 'robots')!.content, 'index, follow, max-image-preview:large');
});

test('private, missing and failed targets stay generic, noindex and without structured UGC', () => {
	for (const path of [
		'/post/private',
		'/post/missing',
		'/thing/missing',
		'/p/unpublished',
		'/profile/missing',
		'/media/private',
		'/invite',
		'/settings',
		'/things',
		'/messages',
		'/admin',
		'/unknown'
	]) {
		const meta = fallbackSocialMeta(new Request(`${origin}${path}?accessToken=secret`));
		assert.equal(meta.tags.find((tag) => tag.key === 'robots')!.content, 'noindex, follow');
		assert.equal(graphPage(meta).mainEntity, undefined);
		assert.doesNotMatch(renderSocialMetaHtml(meta), /accessToken|secret/);
	}
	assert.equal(graphPage(fallbackSocialMeta(new Request(`${origin}/things`)))['@type'], 'CollectionPage');
});

test('user-authored script terminators, quotes, dollar substitutions and Unicode stay inert', () => {
	const text = '</script><script>alert("x")</script> & $& $` $\' \u2028';
	const preview = socialPreviewFromPublicPost('/post/public', { author: { displayName: text }, text });
	const meta = socialMetaFromPreview(origin, preview);
	const html = injectSocialMeta('<head><title>Old</title></head>', renderSocialMetaHtml(meta));
	assert.equal((html.match(/<script/g) || []).length, 1);
	assert.doesNotMatch(html, /<script>alert|<title><\/script>/);
	const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
	assert.equal(data['@graph'][1].mainEntity.author.name, preview.author);
	assert.match(html, /&lt;\/script&gt;/);
});

test('image metadata advertises real dimensions and alt text, and HTTPS only when secure', () => {
	for (const origin of ['https://thingtime.example', 'http://localhost:15320']) {
		const meta = socialMetaFromPreview(origin, staticSocialPreview('/'));
		const tags = new Map(meta.tags.map((tag) => [tag.key, tag.content]));
		assert.equal(tags.get('og:image:width'), '1200');
		assert.equal(tags.get('og:image:height'), '630');
		assert.equal(tags.get('og:image:alt'), tags.get('twitter:image:alt'));
		assert.equal(tags.has('og:image:secure_url'), origin.startsWith('https:'));
		assert.ok(tags.get('og:image')!.startsWith(origin));
		assert.match(tags.get('og:image')!, /\?v=20260917$/);
	}
});

test('profile, comment and generic Thing types do not invent commerce or rich-result facts', () => {
	for (const [kind, type] of [
		['profile', 'Person'],
		['comment', 'Comment'],
		['reply', 'Comment'],
		['thing', 'CreativeWork'],
		['webpage', 'CreativeWork']
	] as const) {
		const meta = socialMetaFromPreview(origin, { ...staticSocialPreview('/thing/example'), kind, publicContent: true, author: 'Public author' });
		assert.equal(graphPage(meta).mainEntity['@type'], type);
		assert.doesNotMatch(JSON.stringify(meta.structuredData), /aggregateRating|offers|price|datePublished/);
	}
	const meta = fallbackSocialMeta(new Request(`${origin}/index.html?source=chat`));
	assert.equal(meta.canonical, `${origin}/`);
});
