import assert from 'node:assert/strict';
import test from 'node:test';

import { ALL_SUITES } from '~/schemas/appSuites/index';
import { BEHAVIOUR_SUITES, materializeSuite, summarizeBehaviourSuite, type BehaviourSuite } from '~/schemas/behaviourSuites';
import { getWebpageDemo, getWebpageDemos, webpageDemoCrystal, webpageDemoPageKey, webpageDemoShareId } from '~/schemas/webpageDemos';
import {
	DEMO_LIBRARY_PATH,
	KIND_FILTERS,
	KIND_LABELS,
	SEEDED_CACHE_MAX,
	catalogPageId,
	demoDetailHref,
	demoMatchesSearch,
	demoPageIdentity,
	isSuiteKind,
	mergeSeededCache,
	parseKindFilter,
	resolveDemoEntry,
	runtimeIdentityFor,
	suiteActionNames,
	suiteComponentsByRef,
	suiteFlavourOf,
	suiteKindLabel,
	suiteMatchesSearch,
	suitePageViews,
	suitesForKind,
	templateCrystalOf,
	type KindFilter
} from './demoDetail';

// The rules the demo library and the dedicated demo page share. Each one is
// pinned here so the two surfaces cannot drift: which entry a slug names,
// which kinds the chip row renders, how suites partition into apps /
// interactive / behaviour suites, what a suite page renders, what runtime
// identity a catalog render gets, and what "use this template" creates.

const fakeSuite = (overrides: Partial<BehaviourSuite> & { key: string }): BehaviourSuite => ({
	title: overrides.key,
	emoji: '🧪',
	description: `${overrides.key} suite`,
	story: [],
	tone: 'paper',
	schemas: [],
	components: [],
	actions: [],
	data: [],
	...overrides
});

test('resolveDemoEntry: a demo slug first, then a suite or app key, else null', () => {
	const demo = resolveDemoEntry('hero-centered-paper', ALL_SUITES);
	assert.equal(demo?.kind, 'demo');
	assert.equal(demo?.kind === 'demo' && demo.demo.slug, 'hero-centered-paper');

	const suite = resolveDemoEntry('guestbook', ALL_SUITES);
	assert.equal(suite?.kind, 'suite');
	assert.equal(suite?.kind === 'suite' && suite.suite.key, 'guestbook');

	const app = resolveDemoEntry('pokeworld', ALL_SUITES);
	assert.equal(app?.kind, 'suite');
	assert.ok(app?.kind === 'suite' && app.suite.app, 'pokeworld resolves through ALL_SUITES as an app');

	assert.equal(resolveDemoEntry('not-a-thing', ALL_SUITES), null);
	assert.equal(resolveDemoEntry('', ALL_SUITES), null);
	assert.equal(resolveDemoEntry('  ', ALL_SUITES), null);
});

test('resolveDemoEntry: a demo slug wins over a suite of the same spelling', () => {
	const collision = fakeSuite({ key: 'hero-centered-paper' });
	const entry = resolveDemoEntry('hero-centered-paper', [collision]);
	assert.equal(entry?.kind, 'demo');
});

test('resolveDemoEntry: the registry module is what makes app keys resolve', () => {
	// BEHAVIOUR_SUITES alone knows nothing about the apps — a caller that
	// forgets to import schemas/appSuites/index would 404 /builder/demos/pokeworld
	assert.equal(resolveDemoEntry('pokeworld', BEHAVIOUR_SUITES), null);
	assert.equal(resolveDemoEntry('pokeworld', ALL_SUITES)?.kind, 'suite');
});

test('demoDetailHref: the dedicated page under the library path, slug encoded', () => {
	assert.equal(DEMO_LIBRARY_PATH, '/builder/demos');
	assert.equal(demoDetailHref('hero-centered-paper'), '/builder/demos/hero-centered-paper');
	assert.equal(demoDetailHref('a b/c'), '/builder/demos/a%20b%2Fc');
});

test('the kind chip row renders EVERY labelled kind, interactive included', () => {
	const labelled = Object.keys(KIND_LABELS) as KindFilter[];
	assert.deepEqual(KIND_FILTERS, labelled, 'the row is derived from the labels — nothing can be labelled yet left out');
	assert.equal(KIND_FILTERS[0], 'all');
	for (const kind of ['all', 'section', 'page', 'component', 'interactive', 'suite', 'app'] as KindFilter[]) {
		assert.ok(KIND_FILTERS.includes(kind), `${kind} is in the row`);
	}
	assert.equal(KIND_LABELS.interactive, '🧮 Interactive');
	assert.equal(KIND_LABELS.suite, '🧪 Behaviour suites');
	assert.equal(KIND_LABELS.app, '📱 Apps');
});

test('isSuiteKind / parseKindFilter', () => {
	assert.equal(isSuiteKind('suite'), true);
	assert.equal(isSuiteKind('app'), true);
	assert.equal(isSuiteKind('interactive'), true);
	assert.equal(isSuiteKind('all'), false);
	assert.equal(isSuiteKind('section'), false);
	assert.equal(parseKindFilter('interactive'), 'interactive');
	assert.equal(parseKindFilter('page'), 'page');
	assert.equal(parseKindFilter(null), 'all');
	assert.equal(parseKindFilter(''), 'all');
	assert.equal(parseKindFilter('bogus'), 'all');
	assert.equal(parseKindFilter('__proto__'), 'all', 'prototype keys are not kinds');
	assert.equal(parseKindFilter('toString'), 'all');
});

test('suitesForKind partitions apps, interactive suites, and behaviour suites (flavour read defensively)', () => {
	const app = fakeSuite({ key: 'an-app', app: { tagline: 'an app' }, pages: [{ key: 'home', name: 'Home', blocks: () => [] }] });
	const interactive = fakeSuite({ key: 'calc', ...({ flavour: 'interactive' } as object) });
	const plain = fakeSuite({ key: 'plain' });
	const oddFlavour = fakeSuite({ key: 'odd', ...({ flavour: 42 } as object) });
	const all = [app, interactive, plain, oddFlavour];

	assert.deepEqual(suitesForKind('app', all).map((suite) => suite.key), ['an-app']);
	assert.deepEqual(suitesForKind('interactive', all).map((suite) => suite.key), ['calc']);
	assert.deepEqual(suitesForKind('suite', all).map((suite) => suite.key), ['plain', 'odd'], 'neither app nor interactive → behaviour suite');
	assert.deepEqual(suitesForKind('all', all), []);
	assert.deepEqual(suitesForKind('section', all), []);

	assert.equal(suiteFlavourOf(app), 'app');
	assert.equal(suiteFlavourOf(interactive), 'interactive');
	assert.equal(suiteFlavourOf(plain), 'suite');
	assert.equal(suiteKindLabel(app), 'app');
	assert.equal(suiteKindLabel(interactive), 'interactive suite');
	assert.equal(suiteKindLabel(plain), 'behaviour suite');
});

test('suitesForKind over the real registry: the two apps, the demo originals as suites', () => {
	const apps = suitesForKind('app', ALL_SUITES).map((suite) => suite.key);
	assert.ok(apps.includes('pokeworld') && apps.includes('starsalign'));
	const suites = suitesForKind('suite', ALL_SUITES).map((suite) => suite.key);
	assert.ok(suites.includes('guestbook'));
	assert.ok(!suites.includes('pokeworld'), 'an app is never listed as a behaviour suite');
	// every registered suite lands in at least one suite chip
	const covered = new Set([...apps, ...suites, ...suitesForKind('interactive', ALL_SUITES).map((suite) => suite.key)]);
	for (const suite of ALL_SUITES) assert.ok(covered.has(suite.key), `${suite.key} is reachable from a chip`);
});

test('suiteComponentsByRef keys every own-mode component crystal by its slug', () => {
	const suite = ALL_SUITES.find((entry) => entry.key === 'guestbook')!;
	const materialized = materializeSuite(suite, 'own');
	const byRef = suiteComponentsByRef(materialized);
	assert.equal(Object.keys(byRef).length, materialized.components.length);
	for (const component of materialized.components) {
		assert.equal(byRef[component.slug]?.id, component.slug);
		assert.equal(byRef[component.slug]?.crystal, component.crystal);
	}
});

test('suiteActionNames maps the own-mode actionKey a control names to a display name', () => {
	const suite = ALL_SUITES.find((entry) => entry.key === 'guestbook')!;
	const names = suiteActionNames(materializeSuite(suite, 'own'));
	assert.ok(names['demo-guestbook-sign'], 'own-mode keys are demo-<suite>-<key>');
	assert.match(names['demo-guestbook-sign'], /Sign guestbook/);
	const empty = suiteActionNames(materializeSuite(fakeSuite({ key: 'none', page: () => [] }), 'own'));
	assert.deepEqual(empty, {});
});

test('suitePageViews: an app lists every page entry-first with its /p/ pageKey; a suite is one page', () => {
	const pokeworld = ALL_SUITES.find((entry) => entry.key === 'pokeworld')!;
	const pages = suitePageViews(pokeworld, materializeSuite(pokeworld, 'own'));
	assert.equal(pages.length, pokeworld.pages!.length);
	assert.equal(pages[0].pageKey, 'pokeworld', 'the entry page IS the suite key');
	assert.equal(pages[0].shareId, 'webpage-pokeworld');
	assert.equal(pages[0].name, 'Game');
	const pokedex = pages.find((page) => page.key === 'pokedex')!;
	assert.equal(pokedex.pageKey, 'pokeworld-pokedex');
	assert.equal(pokedex.name, 'Pokédex');
	assert.ok(pokedex.blocks.length > 0);
	assert.ok(pokedex.previewBg);

	const guestbook = ALL_SUITES.find((entry) => entry.key === 'guestbook')!;
	const single = suitePageViews(guestbook, materializeSuite(guestbook, 'own'));
	assert.equal(single.length, 1);
	assert.equal(single[0].pageKey, 'demo-suite-guestbook');
	assert.equal(single[0].shareId, 'webpage-demo-suite-guestbook');
	assert.equal(single[0].name, 'Home', 'a single-page suite names its one page');
});

test('runtimeIdentityFor: the seeded copy when it exists, else a catalog: id that can never be a shareId', () => {
	const page = { pageKey: 'pokeworld-party', shareId: 'webpage-pokeworld-party' };
	assert.deepEqual(runtimeIdentityFor(page, true), { pageId: 'webpage-pokeworld-party', source: 'system' });
	assert.deepEqual(runtimeIdentityFor(page, false), { pageId: 'catalog:pokeworld-party', source: null });
	assert.equal(catalogPageId('hero-centered-paper'), 'catalog:hero-centered-paper');
	assert.ok(!catalogPageId('x').startsWith('webpage-'));
});

test('demoPageIdentity mirrors the catalog shareId/pageKey', () => {
	const demo = getWebpageDemo('hero-centered-paper')!;
	assert.deepEqual(demoPageIdentity(demo), { pageKey: webpageDemoPageKey(demo.slug), shareId: webpageDemoShareId(demo.slug) });
	assert.equal(demoPageIdentity(demo).pageKey, 'demo-hero-centered-paper');
});

test('templateCrystalOf drops the catalog pageKey, keeps the blocks, and points at the seeded original only when it exists', () => {
	const demo = getWebpageDemo('hero-centered-paper')!;
	const catalog = webpageDemoCrystal(demo);
	assert.ok('pageKey' in catalog, 'the catalog crystal carries the key');

	const unseeded = templateCrystalOf(demo, { seeded: false });
	assert.ok(!('pageKey' in unseeded), 'a copy is a personal page, never a keyed twin');
	assert.ok(!('forkOf' in unseeded));
	assert.equal(unseeded.name, demo.name);
	assert.deepEqual(unseeded.blocks, demo.blocks);
	assert.equal(unseeded.previewBg, demo.previewBg);

	const seeded = templateCrystalOf(demo, { seeded: true });
	assert.ok(!('pageKey' in seeded));
	assert.equal(seeded.forkOf, webpageDemoShareId(demo.slug));
});

test('mergeSeededCache is bounded and keeps the newest entries', () => {
	let cache = mergeSeededCache(null, 'a', true);
	assert.deepEqual(cache, { a: true });
	cache = mergeSeededCache(cache, 'b', false);
	assert.deepEqual(cache, { a: true, b: false });
	cache = mergeSeededCache(cache, 'a', false);
	assert.deepEqual(Object.keys(cache), ['b', 'a'], 're-writing an id moves it to the newest slot');
	assert.equal(cache.a, false);

	let bounded: Record<string, boolean> | null = null;
	for (let index = 0; index < 10; index++) bounded = mergeSeededCache(bounded, `id-${index}`, true, 4);
	assert.deepEqual(Object.keys(bounded!), ['id-6', 'id-7', 'id-8', 'id-9']);
	assert.ok(SEEDED_CACHE_MAX >= getWebpageDemos().length, 'the default bound covers the whole demo catalog');
	// garbage in the stored value never poisons the merge
	assert.deepEqual(mergeSeededCache({ x: 'yes' as unknown as boolean }, 'y', true), { x: false, y: true });
	assert.deepEqual(mergeSeededCache('nope' as unknown as Record<string, boolean>, 'y', true), { y: true });
});

test('search matchers: name/tags/description for demos, title/description/key for suites', () => {
	const demo = getWebpageDemo('hero-centered-paper')!;
	assert.equal(demoMatchesSearch(demo, ''), true);
	assert.equal(demoMatchesSearch(demo, demo.name.toLowerCase().slice(0, 4)), true);
	assert.equal(demoMatchesSearch(demo, 'zzzz-no-such-demo'), false);
	const suite = ALL_SUITES.find((entry) => entry.key === 'guestbook')!;
	assert.equal(suiteMatchesSearch(suite, 'guest'), true);
	assert.equal(suiteMatchesSearch(suite, ''), true);
	assert.equal(suiteMatchesSearch(suite, 'zzzz-no-such-suite'), false);
});

test('the summary the API answers with agrees with the page identities the detail page renders', () => {
	for (const suite of ALL_SUITES) {
		const summary = summarizeBehaviourSuite(suite);
		const pages = suitePageViews(suite, materializeSuite(suite, 'own'));
		assert.equal(pages[0].shareId, summary.pageId, `${suite.key}: entry shareId`);
		assert.equal(pages[0].pageKey, summary.pageKey, `${suite.key}: entry pageKey`);
		assert.deepEqual(pages.map((page) => page.shareId), summary.pageIds, `${suite.key}: every page`);
	}
});
