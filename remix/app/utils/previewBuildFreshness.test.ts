import assert from 'node:assert/strict';
import test from 'node:test';

import { isStalePreviewEntry, isVercelPreviewHost, previewEntryAssetFromHtml, previewEntryAssetFromSources } from './previewBuildFreshness';

test('recognises Vercel preview hosts without affecting production domains', () => {
	assert.equal(isVercelPreviewHost('thingtime-git-feature.vercel.app'), true);
	assert.equal(isVercelPreviewHost('THINGTIME-GIT-FEATURE.VERCEL.APP'), true);
	assert.equal(isVercelPreviewHost('thingtime.com'), false);
	assert.equal(isVercelPreviewHost('vercel.app.thingtime.com'), false);
});

test('extracts the hashed Vite entry asset from the document and live HTML', () => {
	assert.equal(
		previewEntryAssetFromSources(['https://thingtime.example/assets/vendor.js', 'https://thingtime.example/assets/index-BzJD4WWi.js']),
		'/assets/index-BzJD4WWi.js'
	);
	assert.equal(
		previewEntryAssetFromHtml(
			'<script defer src="/other.js"></script><script type="module" crossorigin src="/assets/index-New123.js?fresh=1"></script>'
		),
		'/assets/index-New123.js'
	);
});

test('reloads only when both entry assets are known and differ', () => {
	assert.equal(isStalePreviewEntry('/assets/index-old.js', '/assets/index-new.js'), true);
	assert.equal(isStalePreviewEntry('/assets/index-current.js', '/assets/index-current.js'), false);
	assert.equal(isStalePreviewEntry(null, '/assets/index-new.js'), false);
	assert.equal(isStalePreviewEntry('/assets/index-old.js', null), false);
});
