import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORIES, PAGES, PAGE_BY_SLUG, buildPageBySlug, pagesInCategory } from './catalog';
import { FEATURES } from './features';
import {
	EMPTY_PUBLICATIONS,
	HUB_KEY,
	MAX_PUBLICATION_CHANGES,
	SOCIAL_KEY,
	allPublishableKeys,
	applyPublicationChanges,
	categoryKey,
	categoryPageKeys,
	changesFor,
	createVisibility,
	normalizePublications,
	pageKey,
	pageSections,
	parsePublicationKey,
	resolvePublicationKey,
	sectionKey,
	socialFeatureKey,
	summarizePublications,
	validatePublicationChanges
} from './publishing';

test('every catalog surface has a publishable key and every key resolves back to its surface', () => {
	const keys = allPublishableKeys();
	assert.equal(keys.length, 2 + FEATURES.length + CATEGORIES.length + PAGES.length);
	assert.equal(new Set(keys).size, keys.length, 'keys are unique');
	assert.ok(keys.length <= MAX_PUBLICATION_CHANGES, 'a publish-everything sweep fits in one request');
	for (const key of keys) {
		const resolved = resolvePublicationKey(key);
		assert.equal(resolved.ok, true, key);
	}
	assert.deepEqual(resolvePublicationKey(HUB_KEY), { ok: true, target: { type: 'hub' }, label: 'Marketing hub' });
	assert.deepEqual(resolvePublicationKey(SOCIAL_KEY), { ok: true, target: { type: 'social' }, label: 'Social image suite' });
});

test('section ids are stable per type, unique per page, and resolve through the catalog', () => {
	let repeated = 0;
	for (const entry of PAGES) {
		const page = buildPageBySlug(entry.slug)!;
		const sections = pageSections(page);
		assert.equal(sections.length, page.sections.length, entry.slug);
		assert.equal(new Set(sections.map((section) => section.id)).size, sections.length, `${entry.slug} section ids collide`);
		for (const section of sections) {
			if (section.id.includes('/')) repeated += 1;
			assert.equal(section.key, sectionKey(entry.slug, section.id));
			assert.equal(resolvePublicationKey(section.key).ok, true, section.key);
		}
	}
	assert.ok(repeated > 0, 'the catalog has pages with repeated block types, so the ordinal suffix is exercised');
	const feed = pageSections(buildPageBySlug('landing/feed')!);
	assert.equal(feed[0].id, 'hero');
	assert.equal(feed[feed.length - 1].id, 'cta');
});

test('keys that name nothing in the catalog are rejected, including inherited object names', () => {
	for (const key of [
		'',
		'page:',
		'page:constructor',
		'page:__proto__',
		'category:toString',
		'social:valueOf',
		'section:landing/feed#nope',
		'section:landing/feed#hero/1',
		'section:landing/feed#hero/x',
		'section:nope#hero',
		'page:landing/feed/',
		'page:Landing/Feed',
		'hub:extra',
		'pages:landing/feed',
		42,
		null,
		undefined
	]) {
		assert.equal(resolvePublicationKey(key).ok, false, String(key));
	}
	assert.equal(parsePublicationKey('x'.repeat(300)), null);
});

test('changes are validated per target: sections hide, everything else publishes, duplicates collapse', () => {
	assert.deepEqual(validatePublicationChanges([]), { ok: false, error: 'changes is empty' });
	assert.equal(validatePublicationChanges('nope').ok, false);
	assert.equal(validatePublicationChanges(new Array(MAX_PUBLICATION_CHANGES + 1).fill({ key: HUB_KEY, state: 'published' })).ok, false);
	assert.equal(validatePublicationChanges([{ key: HUB_KEY, state: 'hidden' }]).ok, false, 'the hub cannot be hidden');
	assert.equal(validatePublicationChanges([{ key: 'section:landing/feed#hero', state: 'published' }]).ok, false, 'a section cannot be published');
	assert.equal(validatePublicationChanges([{ key: 'page:landing/feed', state: 'yes' }]).ok, false);
	assert.equal(validatePublicationChanges([{ key: 'page:nope', state: 'published' }]).ok, false);
	const validated = validatePublicationChanges([
		{ key: 'page:landing/feed', state: 'published' },
		{ key: 'page:landing/feed', state: null },
		{ key: 'section:landing/feed#hero', state: 'hidden' },
		{ key: HUB_KEY, state: 'published' }
	]);
	assert.equal(validated.ok, true);
	if (validated.ok) {
		assert.deepEqual(validated.changes, [
			{ key: 'page:landing/feed', state: null },
			{ key: 'section:landing/feed#hero', state: 'hidden' },
			{ key: HUB_KEY, state: 'published' }
		]);
	}
});

test('normalize tolerates junk and applyPublicationChanges mirrors the server projection', () => {
	assert.deepEqual(normalizePublications(null), EMPTY_PUBLICATIONS);
	assert.deepEqual(normalizePublications({ published: ['a', 'a', 7, ''], hidden: 'x', updatedAt: 3, audit: { a: { at: 'now', by: 1 }, b: 'junk' } }), {
		published: ['a'],
		hidden: [],
		updatedAt: null,
		audit: { a: { at: 'now', by: null } }
	});
	const next = applyPublicationChanges(EMPTY_PUBLICATIONS, [
		{ key: HUB_KEY, state: 'published' },
		{ key: 'page:landing/feed', state: 'published' },
		{ key: 'section:landing/feed#social', state: 'hidden' }
	]);
	assert.deepEqual(next.published, [HUB_KEY, 'page:landing/feed']);
	assert.deepEqual(next.hidden, ['section:landing/feed#social']);
	const cleared = applyPublicationChanges(next, [
		{ key: 'page:landing/feed', state: null },
		{ key: 'section:landing/feed#social', state: null }
	]);
	assert.deepEqual(cleared.published, [HUB_KEY]);
	assert.deepEqual(cleared.hidden, []);
});

test('visitors only see published surfaces; admins see everything unless they preview as a visitor', () => {
	const publications = applyPublicationChanges(EMPTY_PUBLICATIONS, [
		{ key: HUB_KEY, state: 'published' },
		{ key: categoryKey('landing'), state: 'published' },
		{ key: pageKey('landing/feed'), state: 'published' },
		{ key: sectionKey('landing/feed', 'social'), state: 'hidden' },
		{ key: socialFeatureKey('feed'), state: 'published' }
	]);

	const visitor = createVisibility({ publications, isAdmin: false, previewAsVisitor: false });
	assert.equal(visitor.everything, false);
	assert.equal(visitor.ready, true);
	assert.equal(visitor.hub, true);
	assert.equal(visitor.social, false, 'the feature set is published but the suite itself is not');
	assert.equal(visitor.socialFeature('feed'), true);
	assert.equal(visitor.category('landing'), true);
	assert.equal(visitor.category('guides'), false);
	assert.equal(visitor.page('landing/feed'), true);
	assert.equal(visitor.page('landing/messages'), false, 'a published category does not cascade to its pages');
	assert.equal(visitor.section('landing/feed', 'hero'), true);
	assert.equal(visitor.section('landing/feed', 'social'), false, 'hidden sections stay off the published page');
	assert.equal(visitor.section('landing/messages', 'hero'), false, 'sections follow their page');
	assert.deepEqual(visitor.pages(pagesInCategory('landing')).map((entry) => entry.slug), ['landing/feed']);
	assert.deepEqual(visitor.features(FEATURES).map((feature) => feature.key), ['feed']);
	assert.equal(visitor.href('/marketing'), true);
	assert.equal(visitor.href('/marketing/search?q=feed'), true);
	assert.equal(visitor.href('/marketing/social-media'), false);
	assert.equal(visitor.href('/marketing/landing'), true);
	assert.equal(visitor.href('/marketing/guides'), false);
	assert.equal(visitor.href('/marketing/landing/feed'), true);
	assert.equal(visitor.href('/marketing/landing/messages/'), false);
	assert.equal(visitor.href('/register'), true, 'app routes are never gated');
	assert.equal(visitor.href('/marketing/not-a-thing'), true, 'unknown marketing paths fall through to the normal not-found card');

	const admin = createVisibility({ publications, isAdmin: true, previewAsVisitor: false });
	assert.equal(admin.everything, true);
	assert.equal(admin.page('landing/messages'), true);
	assert.equal(admin.section('landing/feed', 'social'), true, 'admins see hidden sections (dimmed by the UI)');
	assert.equal(admin.isHidden(sectionKey('landing/feed', 'social')), true, 'the raw state is still readable for the toggle');
	assert.equal(admin.pages(pagesInCategory('landing')).length, pagesInCategory('landing').length);

	const preview = createVisibility({ publications, isAdmin: true, previewAsVisitor: true });
	assert.equal(preview.everything, false);
	assert.equal(preview.isAdmin, true);
	assert.equal(preview.page('landing/messages'), false);
	assert.equal(preview.section('landing/feed', 'social'), false);

	const cold = createVisibility({ publications: null, isAdmin: false, previewAsVisitor: false });
	assert.equal(cold.ready, false, 'a visitor with no cached or fetched state is not ready to render');
	assert.equal(cold.hub, false);
	const coldAdmin = createVisibility({ publications: null, isAdmin: true, previewAsVisitor: false });
	assert.equal(coldAdmin.ready, true, 'admins never wait on the publication fetch');
});

test('summaries and bulk helpers agree with the catalog', () => {
	const styles = categoryPageKeys('styles');
	assert.equal(styles.length, pagesInCategory('styles').length);
	assert.ok(styles.every((key) => key.startsWith('page:styles/')));
	const publications = applyPublicationChanges(EMPTY_PUBLICATIONS, [
		...changesFor(styles.slice(0, 5), 'published'),
		{ key: categoryKey('styles'), state: 'published' },
		{ key: SOCIAL_KEY, state: 'published' },
		{ key: socialFeatureKey('feed'), state: 'published' },
		{ key: sectionKey('landing/feed', 'hero'), state: 'hidden' }
	]);
	const summary = summarizePublications(publications);
	assert.equal(summary.hub, false);
	assert.equal(summary.social, true);
	assert.deepEqual(summary.socialFeatures, { total: FEATURES.length, published: 1 });
	assert.deepEqual(summary.pages, { total: PAGES.length, published: 5 });
	assert.equal(summary.hiddenSections, 1);
	const stylesSummary = summary.categories.find((category) => category.key === 'styles')!;
	assert.equal(stylesSummary.indexPublished, true);
	assert.equal(stylesSummary.published, 5);
	assert.equal(stylesSummary.total, pagesInCategory('styles').length);
	assert.equal(summary.categories.find((category) => category.key === 'landing')!.indexPublished, false);
	assert.ok(PAGE_BY_SLUG['landing/feed'], 'the sample page used across these tests exists');
});
