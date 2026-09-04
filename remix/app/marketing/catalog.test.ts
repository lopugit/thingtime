import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import { CATEGORIES, PAGES, PAGE_BY_SLUG, PAGE_COUNT, STYLE_FEATURE_KEYS, TOTAL_ASSET_COUNT, buildPage, buildPageBySlug, categoryCounts, searchPages, validateCatalog } from './catalog.ts';
// @ts-ignore see above
import { FEATURES } from './features.ts';
// @ts-ignore see above
import { PERSONAS } from './personas.ts';
// @ts-ignore see above
import { COMPETITORS } from './competitors.ts';
// @ts-ignore see above
import { USE_CASES } from './useCases.ts';
// @ts-ignore see above
import { CONCEPTS, TEMPLATES } from './concepts.ts';
// @ts-ignore see above
import { SOCIAL_FORMATS, TRENDS } from './trends.ts';
// @ts-ignore see above
import { SOCIAL_ASSET_COUNT, buildSocialSvg, enumerateSocialAssets, parseSocialAssetKey, socialAssetFilename, socialAssetKey, socialCaption, wrapText } from './social.ts';
// @ts-ignore see above
import { SCREEN_TARGETS, WALKTHROUGHS } from './walkthroughs.ts';
// @ts-ignore see above
import { captionFor, hashString, hookFor, pick } from './copy.ts';

test('the catalog holds well over a thousand pages and assets', () => {
	assert.ok(PAGE_COUNT >= 1000, `expected >= 1000 pages, got ${PAGE_COUNT}`);
	assert.ok(SOCIAL_ASSET_COUNT >= 1000, `expected >= 1000 social assets, got ${SOCIAL_ASSET_COUNT}`);
	assert.equal(TOTAL_ASSET_COUNT, PAGE_COUNT + SOCIAL_ASSET_COUNT);
	assert.equal(PAGES.length, PAGE_COUNT);
});

test('every category has pages and every page has a category', () => {
	const counts = categoryCounts();
	for (const category of CATEGORIES) assert.ok((counts[category.key] ?? 0) > 0, `category ${category.key} is empty`);
	for (const key of Object.keys(counts)) assert.ok(CATEGORIES.some((category) => category.key === key), `orphan category ${key}`);
});

test('source lists are internally consistent', () => {
	const featureKeys = new Set(FEATURES.map((feature) => feature.key));
	assert.equal(featureKeys.size, FEATURES.length, 'duplicate feature keys');
	for (const feature of FEATURES) {
		assert.ok(feature.highlights.length === 3, `${feature.key} needs 3 highlights`);
		assert.ok(feature.audiences.length >= 1, `${feature.key} needs audiences`);
		assert.ok(feature.tagline.split(' ').length <= 12, `${feature.key} tagline too long`);
		assert.ok(SCREEN_TARGETS[feature.screen], `${feature.key} has unknown screen ${feature.screen}`);
		for (const answer of feature.answers ?? []) assert.ok(COMPETITORS.some((competitor) => competitor.key === answer), `${feature.key} answers unknown competitor ${answer}`);
	}
	for (const persona of PERSONAS) for (const key of persona.leadFeatures) assert.ok(featureKeys.has(key), `${persona.key} leads unknown feature ${key}`);
	for (const competitor of COMPETITORS) {
		for (const key of competitor.relevantFeatures) assert.ok(featureKeys.has(key), `${competitor.key} references unknown feature ${key}`);
		assert.ok(competitor.table.length >= 5, `${competitor.key} table too short`);
	}
	for (const useCase of USE_CASES) {
		for (const key of useCase.features) assert.ok(featureKeys.has(key), `${useCase.key} references unknown feature ${key}`);
		assert.equal(useCase.steps.length, 4);
	}
	for (const template of TEMPLATES) assert.ok(USE_CASES.some((useCase) => useCase.key === template.useCase), `${template.key} references unknown use case`);
	for (const concept of CONCEPTS) assert.ok(concept.definition.length > 30 && concept.why.length > 20, `${concept.key} is too thin`);
	assert.ok(STYLE_FEATURE_KEYS.length >= 25);
});

test('the enumerated catalog passes validation', () => {
	const issues = validateCatalog();
	assert.deepEqual(issues, [], `catalog issues:\n${issues.slice(0, 40).map((issue) => `${issue.slug}: ${issue.problem}`).join('\n')}`);
});

test('every page builds with a hero first, a cta last and no placeholders', () => {
	const issues = validateCatalog({ buildAll: true });
	assert.deepEqual(issues, [], `built-page issues (${issues.length}):\n${issues.slice(0, 40).map((issue) => `${issue.slug}: ${issue.problem}`).join('\n')}`);
});

test('pages build deterministically', () => {
	const sample = PAGES.filter((_, index) => index % 97 === 0);
	for (const entry of sample) {
		const first = JSON.stringify(buildPage(entry));
		const second = JSON.stringify(buildPage(entry));
		assert.equal(first, second, `${entry.slug} is not deterministic`);
	}
});

test('sibling pages do not all share one headline', () => {
	const headlines = new Set(PAGES.filter((entry) => entry.kind === 'landing').map((entry) => buildPage(entry).sections[0]).map((hero) => (hero.type === 'hero' ? hero.title.replace(/[A-Z][a-z]+( [a-z]+)*/g, 'X') : '')));
	assert.ok(headlines.size >= 4, `landing heroes collapse to ${headlines.size} shapes`);
});

test('unknown slugs return null and search finds by title words', () => {
	assert.equal(buildPageBySlug('nope/nope'), null);
	const results = searchPages('passkeys');
	assert.ok(results.length > 0);
	assert.ok(results[0].slug.includes('passkeys'));
	assert.ok(PAGE_BY_SLUG['landing/feed']);
});

test('every walkthrough uses only targets its mock screen exposes', () => {
	for (const walkthrough of WALKTHROUGHS) {
		assert.ok(walkthrough.steps.length >= 3, `${walkthrough.key} has too few steps`);
		for (const step of walkthrough.steps) {
			assert.ok(SCREEN_TARGETS[walkthrough.screen].includes(step.target), `${walkthrough.key} uses unknown target ${step.target}`);
			if (step.action === 'type') assert.ok(step.text && step.text.length > 0, `${walkthrough.key} type step without text`);
		}
	}
});

test('social assets enumerate to feature × trend × format and render valid svg', () => {
	const assets = enumerateSocialAssets();
	assert.equal(assets.length, FEATURES.length * TRENDS.length * SOCIAL_FORMATS.length);
	const keys = new Set(assets.map(socialAssetKey));
	assert.equal(keys.size, assets.length);
	for (const asset of assets.filter((_, index) => index % 53 === 0)) {
		const svg = buildSocialSvg(asset);
		assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), `${socialAssetKey(asset)} is not an svg`);
		assert.ok(svg.endsWith('</svg>'));
		assert.ok(!/undefined|NaN|\[object/.test(svg), `${socialAssetKey(asset)} has a bad value`);
		assert.ok(svg.includes('thingtime'), 'brand chip missing');
		assert.ok(!svg.includes('<script'), 'no scripts in assets');
		assert.equal(parseSocialAssetKey(socialAssetKey(asset))?.feature, asset.feature);
		assert.ok(socialAssetFilename(asset, 'png').endsWith('.png'));
		assert.ok(socialCaption(asset).includes('#'));
	}
});

test('every trend and format combination renders for one feature', () => {
	for (const trend of TRENDS) {
		for (const format of SOCIAL_FORMATS) {
			const svg = buildSocialSvg({ feature: 'feed', trend: trend.key, format: format.key });
			assert.ok(svg.includes(`width="${format.width}"`), `${trend.key}/${format.key} wrong width`);
			assert.ok(svg.includes(`height="${format.height}"`), `${trend.key}/${format.key} wrong height`);
			assert.ok(!/NaN/.test(svg), `${trend.key}/${format.key} has NaN`);
			assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(svg), `${trend.key}/${format.key} has an unescaped ampersand`);
		}
	}
});

test('copy helpers are deterministic and fill every placeholder', () => {
	const feature = FEATURES[0];
	assert.equal(hookFor('tiktok', feature, 'seed'), hookFor('tiktok', feature, 'seed'));
	for (const platform of ['tiktok', 'youtube', 'instagram', 'x', 'facebook', 'linkedin', 'pinterest'] as const) {
		for (let index = 0; index < 12; index++) {
			const hook = hookFor(platform, feature, `seed-${index}`);
			assert.ok(!/\{\w+\}/.test(hook), `${platform} hook left a placeholder: ${hook}`);
			const caption = captionFor(platform, feature, `seed-${index}`);
			assert.ok(caption.includes('#'), 'caption has hashtags');
		}
	}
	assert.equal(hashString('a'), hashString('a'));
	assert.notEqual(hashString('a'), hashString('b'));
	assert.equal(pick('x', [1, 2, 3]), pick('x', [1, 2, 3]));
	assert.deepEqual(wrapText('one two three four five six', 160, 20), ['one two three', 'four five six']);
});
