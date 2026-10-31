import assert from 'node:assert/strict';
import test from 'node:test';

import { SITEMAP_CACHE_CONTROL, buildSitemapDocument, respondRobots, respondSitemap, type SitemapDataSource } from './sitemap';
import { SITEMAP_PAGE_SIZE } from './sitemapCore';

const origin = 'https://thingtime.example';

// A data source that records what was asked of it — the whole response path
// is exercised without MongoDB; the Mongo-backed source is covered by the
// manual TESTING.md checklist against a real data plane.
const fakeSource = (counts: { posts: number; pages: number; profiles: number }) => {
	const calls: string[] = [];
	const urlsFor = (prefix: string, page: number, total: number) =>
		Array.from({ length: Math.min(SITEMAP_PAGE_SIZE, Math.max(0, total - (page - 1) * SITEMAP_PAGE_SIZE)) }, (_, index) => ({
			loc: `${origin}/${prefix}/${(page - 1) * SITEMAP_PAGE_SIZE + index}`,
			lastmod: '2026-09-19T00:00:00.000Z'
		}));
	const record = <T,>(label: string, value: T): T => {
		calls.push(label);
		return value;
	};
	const source: SitemapDataSource = {
		countPublicPosts: async () => record('countPosts', counts.posts),
		listPublicPosts: async (page) => record(`posts:${page}`, urlsFor('post', page, counts.posts)),
		countPublicWebpages: async () => record('countPages', counts.pages),
		listPublicWebpages: async (page) => record(`pages:${page}`, urlsFor('p', page, counts.pages)),
		listPublicProfiles: async () => record('profiles', Array.from({ length: counts.profiles }, (_, index) => ({ loc: `${origin}/profile/user${index}` })))
	};
	return { source, calls };
};

test('the index advertises exactly the section files the counts justify', async () => {
	const { source, calls } = fakeSource({ posts: SITEMAP_PAGE_SIZE + 1, pages: 3, profiles: 2 });
	const document = await buildSitemapDocument(origin, new URLSearchParams(), source, new Date('2026-09-19T12:00:00.000Z'));
	assert.equal(document.status, 200);
	const locs = [...document.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, '&'));
	assert.deepEqual(locs, [
		`${origin}/sitemap.xml?section=static`,
		`${origin}/sitemap.xml?section=posts&page=1`,
		`${origin}/sitemap.xml?section=posts&page=2`,
		`${origin}/sitemap.xml?section=pages&page=1`,
		`${origin}/sitemap.xml?section=profiles`
	]);
	assert.ok(document.body.includes('<lastmod>2026-09-19T12:00:00.000Z</lastmod>'));
	// the index only counts — it never lists a page of content
	assert.deepEqual(calls.sort(), ['countPages', 'countPosts', 'profiles']);
});

test('section files page through UGC and refuse pages past the end', async () => {
	const { source, calls } = fakeSource({ posts: SITEMAP_PAGE_SIZE + 5, pages: 0, profiles: 0 });
	const second = await buildSitemapDocument(origin, new URLSearchParams('section=posts&page=2'), source);
	assert.equal(second.status, 200);
	assert.equal((second.body.match(/<url>/g) || []).length, 5);
	assert.ok(second.body.includes(`<loc>${origin}/post/${SITEMAP_PAGE_SIZE}</loc>`));
	assert.deepEqual(calls, ['countPosts', 'posts:2']);

	const missing = await buildSitemapDocument(origin, new URLSearchParams('section=posts&page=3'), source);
	assert.equal(missing.status, 404);
	assert.equal(missing.contentType, 'text/plain');

	// an empty section still answers page 1 with an empty urlset rather than 404
	const emptyPages = await buildSitemapDocument(origin, new URLSearchParams('section=pages'), source);
	assert.equal(emptyPages.status, 200);
	assert.equal((emptyPages.body.match(/<url>/g) || []).length, 0);

	const bad = await buildSitemapDocument(origin, new URLSearchParams('section=posts&page=nope'), source);
	assert.equal(bad.status, 400);
	assert.match(bad.body, /page must be an integer/);
});

test('static section needs no data source calls and profiles come straight from the source', async () => {
	const { source, calls } = fakeSource({ posts: 0, pages: 0, profiles: 2 });
	const statics = await buildSitemapDocument(origin, new URLSearchParams('section=static'), source);
	assert.equal(statics.status, 200);
	assert.ok(statics.body.includes(`<loc>${origin}/branding</loc>`));
	assert.ok(statics.body.includes('<image:loc>'));
	assert.deepEqual(calls, []);
	const profiles = await buildSitemapDocument(origin, new URLSearchParams('section=profiles'), source);
	assert.ok(profiles.body.includes(`<loc>${origin}/profile/user1</loc>`));
	assert.deepEqual(calls, ['profiles']);
});

test('HTTP responses carry the anonymous shared-cache contract and honour HEAD/405', async () => {
	const { source } = fakeSource({ posts: 0, pages: 0, profiles: 0 });
	const ok = await respondSitemap(new Request(`${origin}/sitemap.xml?section=static`, { headers: { cookie: 'tt_session=secret' } }), origin, source);
	assert.equal(ok.status, 200);
	assert.equal(ok.headers.get('content-type'), 'application/xml; charset=utf-8');
	assert.equal(ok.headers.get('cache-control'), SITEMAP_CACHE_CONTROL);
	assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
	assert.doesNotMatch(await ok.text(), /secret/);

	const head = await respondSitemap(new Request(`${origin}/sitemap.xml`, { method: 'HEAD' }), origin, source);
	assert.equal(head.status, 200);
	assert.equal(await head.text(), '');

	const post = await respondSitemap(new Request(`${origin}/sitemap.xml`, { method: 'POST' }), origin, source);
	assert.equal(post.status, 405);
	assert.equal(post.headers.get('allow'), 'GET, HEAD');

	const bad = await respondSitemap(new Request(`${origin}/sitemap.xml?section=nope`), origin, source);
	assert.equal(bad.status, 400);
	assert.equal(bad.headers.get('content-type'), 'text/plain; charset=utf-8');
	assert.equal(bad.headers.get('cache-control'), 'public, max-age=60');

	const robots = respondRobots(new Request(`${origin}/robots.txt`), origin);
	assert.equal(robots.headers.get('content-type'), 'text/plain; charset=utf-8');
	assert.equal(robots.headers.get('cache-control'), SITEMAP_CACHE_CONTROL);
	assert.match(await robots.text(), /Sitemap: https:\/\/thingtime\.example\/sitemap\.xml/);
	assert.equal(respondRobots(new Request(`${origin}/robots.txt`, { method: 'DELETE' }), origin).status, 405);
});
