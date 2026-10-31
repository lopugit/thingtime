'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { fetchGithubReleaseCatalog, githubNextPage, isAllowedGithubReleaseAssetUrl, releaseCatalogState } = require('../lib/github-release-catalog.cjs');

test('GitHub release catalog follows every Link page without an arbitrary history cap', async () => {
	const first = 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100';
	const second = 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100&page=2';
	const third = 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100&page=3';
	const calls = [];
	const pages = new Map([
		[first, { value: [{ id: 1 }], headers: { link: `<${second}>; rel="next"` } }],
		[second, { value: [{ id: 2 }], headers: { link: `<${third}>; rel="next"` } }],
		[third, { value: [{ id: 3 }], headers: {} }]
	]);
	const catalog = await fetchGithubReleaseCatalog(first, async (url) => {
		calls.push(url);
		return pages.get(url);
	});
	assert.deepEqual(calls, [first, second, third]);
	assert.deepEqual(catalog.releases, [{ id: 1 }, { id: 2 }, { id: 3 }]);
	assert.equal(catalog.truncated, false);
});

test('GitHub release catalog fails closed on malformed pages and reports Link loops', async () => {
	await assert.rejects(
		fetchGithubReleaseCatalog('https://api.github.com/repos/lopugit/thingtime/releases?per_page=100', async () => ({ value: { id: 1 }, headers: {} })),
		/invalid release catalog page/u
	);
	const first = 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100';
	const loop = await fetchGithubReleaseCatalog(first, async () => ({ value: [{ id: 1 }], headers: { link: `<${first}>; rel="next"` } }));
	assert.equal(loop.truncated, true);
	assert.equal(githubNextPage('<https://example.test/releases?page=2>; rel="next"'), null);
	assert.equal(isAllowedGithubReleaseAssetUrl('https://github.com/lopugit/thingtime/releases/download/v1/Thingtime.zip'), true);
	assert.equal(isAllowedGithubReleaseAssetUrl('https://release-assets.githubusercontent.com/github-production-release-asset/1/Thingtime.zip'), true);
	assert.equal(isAllowedGithubReleaseAssetUrl('https://example.test/Thingtime.zip'), false);
});

test('catalog state preserves local recovery bundles when GitHub is unavailable', () => {
	const cachedBundle = { key: 'installed-0.1.0-abcdef123456', version: '0.1.0' };
	const state = releaseCatalogState({
		cachedBundles: [cachedBundle],
		catalogError: 'GitHub releases are temporarily unavailable. Cached recovery bundles remain available on this Mac.',
		currentVersion: '0.1.1',
		feedUrl: 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100'
	});
	assert.deepEqual(state.cachedBundles, [cachedBundle]);
	assert.deepEqual(state.releases, []);
	assert.match(state.catalogError, /Cached recovery bundles/u);
});
