'use strict';

function isAllowedGithubReleaseAssetUrl(value) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'https:' && [
			'github.com',
			'objects.githubusercontent.com',
			'github-releases.githubusercontent.com',
			'release-assets.githubusercontent.com'
		].includes(parsed.hostname.toLowerCase());
	} catch {
		return false;
	}
}

function releaseCatalogState({ cachedBundles, catalogError = null, currentVersion, feedUrl, releases = [], truncated = false } = {}) {
	return {
		cachedBundles: Array.isArray(cachedBundles) ? cachedBundles : [],
		catalogError: typeof catalogError === 'string' && catalogError ? catalogError : null,
		checkedAt: new Date().toISOString(),
		currentVersion: typeof currentVersion === 'string' ? currentVersion : null,
		feedUrl: typeof feedUrl === 'string' ? feedUrl : null,
		releases: Array.isArray(releases) ? releases : [],
		truncated: truncated === true
	};
}

function githubNextPage(linkHeader) {
	if (typeof linkHeader !== 'string') return null;
	for (const link of linkHeader.split(',')) {
		const match = link.match(/^\s*<([^>]+)>;\s*rel="next"\s*$/u);
		if (match?.[1] && /^https:\/\/api\.github\.com\//iu.test(match[1])) return match[1];
	}
	return null;
}

/**
 * Follow the GitHub REST Link header until the repository has no more release
 * pages. A visited-URL guard protects the desktop from a malformed or looping
 * feed without silently imposing a made-up release-history limit.
 */
async function fetchGithubReleaseCatalog(feedUrl, requestPage) {
	if (typeof feedUrl !== 'string' || !/^https:\/\/api\.github\.com\//iu.test(feedUrl)) {
		throw new Error('Thingtime release catalog must use the GitHub API over HTTPS.');
	}
	if (typeof requestPage !== 'function') throw new Error('Thingtime release catalog request handler is unavailable.');

	const releases = [];
	const visitedUrls = new Set();
	let url = feedUrl;
	while (url && !visitedUrls.has(url)) {
		visitedUrls.add(url);
		const response = await requestPage(url);
		if (!Array.isArray(response?.value)) throw new Error('GitHub returned an invalid release catalog page.');
		releases.push(...response.value);
		url = githubNextPage(response.headers?.link);
	}

	return { releases, truncated: Boolean(url) };
}

module.exports = {
	fetchGithubReleaseCatalog,
	githubNextPage,
	isAllowedGithubReleaseAssetUrl,
	releaseCatalogState
};
