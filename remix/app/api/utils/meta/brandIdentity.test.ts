import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import brandingAssets from '../../../components/Branding/brandingAssets.generated.json';
import {
	ORGANIZATION_LOGO_HEIGHT,
	ORGANIZATION_LOGO_PATH,
	ORGANIZATION_LOGO_WIDTH,
	ORGANIZATION_SAME_AS,
	ORGANIZATION_WORDMARK_HEIGHT,
	ORGANIZATION_WORDMARK_PATH,
	ORGANIZATION_WORDMARK_WIDTH,
	organizationStructuredData
} from './brandIdentity';

const origin = 'https://thingtime.example';

test('the Organization logo and wordmark are committed files listed in the branding manifest', () => {
	for (const [file, w, h] of [
		[ORGANIZATION_LOGO_PATH, ORGANIZATION_LOGO_WIDTH, ORGANIZATION_LOGO_HEIGHT],
		[ORGANIZATION_WORDMARK_PATH, ORGANIZATION_WORDMARK_WIDTH, ORGANIZATION_WORDMARK_HEIGHT]
	] as const) {
		assert.ok(existsSync(new URL(`../../../../public${file}`, import.meta.url)), `${file} exists under remix/public`);
		const png = brandingAssets.variants.flatMap((variant) => variant.pngs).find((entry) => entry.url === file);
		assert.ok(png, `${file} is a generated manifest asset`);
		assert.equal(png!.w, w);
		assert.equal(png!.h, h);
	}
	// Google's Organization.logo minimum is 112×112; the icon is square.
	assert.equal(ORGANIZATION_LOGO_WIDTH, ORGANIZATION_LOGO_HEIGHT);
	assert.ok(ORGANIZATION_LOGO_WIDTH >= 112);
});

test('Organization JSON-LD is origin scoped, absolute and publishes only public identity', () => {
	const organization = organizationStructuredData(origin);
	assert.equal(organization['@type'], 'Organization');
	assert.equal(organization['@id'], `${origin}/#organization`);
	assert.equal(organization.url, `${origin}/`);
	assert.equal(organization.logo.url, `${origin}${ORGANIZATION_LOGO_PATH}`);
	assert.equal(organization.logo.contentUrl, organization.logo.url);
	assert.equal(organization.logo.width, 1024);
	assert.equal(organization.image[0].url, `${origin}${ORGANIZATION_WORDMARK_PATH}`);
	assert.deepEqual(organization.sameAs, [...ORGANIZATION_SAME_AS]);
	for (const url of organization.sameAs) assert.match(url, /^https:\/\//);
	// another origin (a preview) describes itself, never production
	assert.equal(organizationStructuredData('https://preview.example').logo.url, `https://preview.example${ORGANIZATION_LOGO_PATH}`);
	assert.doesNotMatch(JSON.stringify(organization), /email|telephone|address|token|secret/i);
});
