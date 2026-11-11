import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { type BehaviourSuite, type MaterializedSuite } from '~/schemas/behaviourSuites';
import { getWebpageDemo, webpageDemoCrystal, webpageDemoPageKey, webpageDemoShareId, type DemoBlock, type WebpageDemo, type WebpageDemoKind } from '~/schemas/webpageDemos';
import type { ComponentsByRef } from './WebpageBlocksRenderer';

// Pure helpers shared by the demo library (/builder/demos) and the dedicated
// demo page (/builder/demos/:slug): slug resolution, the kind chips, the
// suite partition (apps / interactive / behaviour suites), the block trees a
// suite page renders, the page runtime identity a catalog render gets, and
// the "use this template" crystal. No React, no DOM — every rule the two
// surfaces share lives here so they cannot drift, and demoDetail.test.ts
// pins each one.

// ── the catalog entry a slug names ──────────────────────────────────────────

export type DemoEntry = { kind: 'demo'; slug: string; demo: WebpageDemo } | { kind: 'suite'; slug: string; suite: BehaviourSuite };

// A demo slug wins over a suite key of the same spelling (demo slugs are the
// larger, older namespace); anything else is "not here".
export const resolveDemoEntry = (slug: string, suites: BehaviourSuite[]): DemoEntry | null => {
	const clean = typeof slug === 'string' ? slug.trim() : '';
	if (!clean) return null;
	const demo = getWebpageDemo(clean);
	if (demo) return { kind: 'demo', slug: clean, demo };
	const suite = suites.find((entry) => entry.key === clean) || null;
	return suite ? { kind: 'suite', slug: clean, suite } : null;
};

export const DEMO_LIBRARY_PATH = '/builder/demos';

export const demoDetailHref = (slug: string): string => `${DEMO_LIBRARY_PATH}/${encodeURIComponent(slug)}`;

// ── the kind chips ──────────────────────────────────────────────────────────

export type KindFilter = WebpageDemoKind | 'all' | 'interactive' | 'suite' | 'app';

export const KIND_LABELS: Record<KindFilter, string> = {
	all: 'Everything',
	section: 'Sections',
	page: 'Pages',
	component: 'Component blocks',
	interactive: '🧮 Interactive',
	suite: '🧪 Behaviour suites',
	app: '📱 Apps'
};

// The chip row renders exactly this list — derived from the labels so a kind
// can never be labelled yet left out of the row (that bug shipped once).
export const KIND_FILTERS: KindFilter[] = Object.keys(KIND_LABELS) as KindFilter[];

const SUITE_KINDS: ReadonlySet<KindFilter> = new Set<KindFilter>(['interactive', 'suite', 'app']);

export const isSuiteKind = (kind: KindFilter): boolean => SUITE_KINDS.has(kind);

export const parseKindFilter = (raw: string | null | undefined): KindFilter =>
	typeof raw === 'string' && Object.prototype.hasOwnProperty.call(KIND_LABELS, raw) ? (raw as KindFilter) : 'all';

// ── the suite partition ─────────────────────────────────────────────────────

export type SuiteFlavour = 'app' | 'interactive' | 'suite';

// `flavour` is landing on BehaviourSuite from another branch — read it
// defensively so this file compiles before and after. An app is an app first
// (its install path differs); an interactive suite is a single-page program
// that exists to be played with (calculators, converters); everything else is
// a behaviour suite.
export const suiteFlavourOf = (suite: BehaviourSuite): SuiteFlavour => {
	if (suite.app) return 'app';
	return (suite as { flavour?: unknown }).flavour === 'interactive' ? 'interactive' : 'suite';
};

export const suitesForKind = (kind: KindFilter, suites: BehaviourSuite[]): BehaviourSuite[] => {
	if (kind === 'app') return suites.filter((suite) => !!suite.app);
	if (kind === 'interactive') return suites.filter((suite) => (suite as { flavour?: unknown }).flavour === 'interactive');
	if (kind === 'suite') return suites.filter((suite) => !suite.app && (suite as { flavour?: unknown }).flavour !== 'interactive');
	return [];
};

export const suiteKindLabel = (suite: BehaviourSuite): string => {
	const flavour = suiteFlavourOf(suite);
	return flavour === 'app' ? 'app' : flavour === 'interactive' ? 'interactive suite' : 'behaviour suite';
};

// ── what a suite renders ────────────────────────────────────────────────────

// A suite's controls render from the catalog's own component crystals, so a
// preview needs no resolve round trip and no seed.
export const suiteComponentsByRef = (materialized: MaterializedSuite): ComponentsByRef => {
	const out: ComponentsByRef = {};
	for (const component of materialized.components) out[component.slug] = { id: component.slug, crystal: component.crystal };
	return out;
};

// own-mode actionKey → the action's display name, for the run confirmation
// ("Run “Sign guestbook”?" beats "Run this program?")
export const suiteActionNames = (materialized: MaterializedSuite): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const action of materialized.actions) out[action.slug] = typeof action.crystal.name === 'string' && action.crystal.name ? action.crystal.name : action.key;
	return out;
};

export type SuitePageView = {
	key: string;
	// the URL identity: /p/<pageKey> once seeded or installed
	pageKey: string;
	// the seeded system copy's id
	shareId: string;
	name: string;
	description: string;
	blocks: DemoBlock[];
	previewBg: string;
};

// Every page of a suite, entry first (materializeSuite orders them). App
// pages carry the SuitePageDef name ("Party", "Pokédex"); a single-page suite
// is its one page.
export const suitePageViews = (suite: BehaviourSuite, materialized: MaterializedSuite): SuitePageView[] =>
	materialized.pages.map((page, index) => {
		const def = suite.pages?.find((entry) => entry.key === page.key) || null;
		const crystal = page.crystal as { blocks?: unknown; previewBg?: unknown; description?: unknown };
		return {
			key: page.key,
			pageKey: page.pageKey,
			shareId: page.shareId,
			name: def?.name || (index === 0 ? 'Home' : page.key),
			description: def?.description || (typeof crystal.description === 'string' ? crystal.description : ''),
			blocks: Array.isArray(crystal.blocks) ? (crystal.blocks as DemoBlock[]) : [],
			previewBg: typeof crystal.previewBg === 'string' && crystal.previewBg ? crystal.previewBg : ''
		};
	});

// ── the page runtime identity a catalog render gets ─────────────────────────

// A block tree rendered straight from the code catalog has no thing behind
// it. It still needs a runtime id (source results cache per page id), so it
// gets a `catalog:` id that can never collide with a shareId; once the entry
// is seeded on this deployment the render adopts the seeded copy's identity
// (same cache lines as /p/, `source: 'system'` so `$install` means the same
// thing it means there).
export const catalogPageId = (pageKey: string): string => `catalog:${pageKey}`;

export type RuntimeIdentity = { pageId: string; source: 'system' | null };

export const runtimeIdentityFor = (page: { pageKey: string; shareId: string }, seeded: boolean): RuntimeIdentity =>
	seeded ? { pageId: page.shareId, source: 'system' } : { pageId: catalogPageId(page.pageKey), source: null };

export const demoPageIdentity = (demo: Pick<WebpageDemo, 'slug'>): { pageKey: string; shareId: string } => ({
	pageKey: webpageDemoPageKey(demo.slug),
	shareId: webpageDemoShareId(demo.slug)
});

// ── "use this template" ─────────────────────────────────────────────────────

// The crystal a copied demo is created with: the catalog crystal WITHOUT its
// pageKey (a copy is a personal page, never a keyed twin of the seeded demo —
// keys are how installed APP pages shadow the system copy, and a template must
// not), named after the demo, and pointing at the seeded original via forkOf
// only when that original exists on this deployment.
export const templateCrystalOf = (demo: WebpageDemo, options: { seeded: boolean }): Record<string, unknown> => {
	const { pageKey: _pageKey, ...crystal } = webpageDemoCrystal(demo) as Record<string, unknown> & { pageKey?: string };
	return {
		...crystal,
		name: demo.name,
		...(options.seeded ? { forkOf: webpageDemoShareId(demo.slug) } : {})
	};
};

// ── the seeded flags' optimistic tier ───────────────────────────────────────

// House rule: never flash an unknown state when a last-known one exists. The
// seeded census is a progressive detail (it decides which links to show), so
// the last answer per id paints first and the fetch reconciles it. Bounded
// so the map never grows past the catalog.
export const SEEDED_CACHE_KEY = 'tt-builder-demo-seeded';
export const SEEDED_CACHE_MAX = 400;

export type SeededCache = Record<string, boolean>;

export const mergeSeededCache = (current: SeededCache | null, id: string, seeded: boolean, max = SEEDED_CACHE_MAX): SeededCache => {
	const next: SeededCache = {};
	const entries = Object.entries(current && typeof current === 'object' ? current : {}).filter(([key]) => key !== id);
	// drop the OLDEST entries (insertion order) once past the bound
	for (const [key, value] of entries.slice(Math.max(0, entries.length - (max - 1)))) next[key] = value === true;
	next[id] = seeded;
	return next;
};

export const readSeededCache = (id: string): boolean | null => {
	const cache = readLocalCache<SeededCache>(SEEDED_CACHE_KEY);
	if (!cache || typeof cache !== 'object') return null;
	return typeof cache[id] === 'boolean' ? cache[id] : null;
};

export const writeSeededCache = (id: string, seeded: boolean): void => {
	writeLocalCache(SEEDED_CACHE_KEY, mergeSeededCache(readLocalCache<SeededCache>(SEEDED_CACHE_KEY), id, seeded));
};

// ── search ──────────────────────────────────────────────────────────────────

export const suiteMatchesSearch = (suite: BehaviourSuite, needle: string): boolean =>
	!needle || suite.title.toLowerCase().includes(needle) || suite.description.toLowerCase().includes(needle) || suite.key.includes(needle);

export const demoMatchesSearch = (demo: WebpageDemo, needle: string): boolean =>
	!needle || demo.name.toLowerCase().includes(needle) || demo.tags.some((tag) => tag.includes(needle)) || demo.description.toLowerCase().includes(needle);
