import { getThingsCollection } from '../mongodb/collections';
import { fail, type Fail, type PublicThing } from '../things/things';
import { resolveBlockComponents } from './webpages';
import { COMPONENT_KEY_PATTERN, MAX_COMPONENT_KEY_CHARS } from '~/schemas/registry';
import {
	getAnySuite,
	materializeSuite,
	summarizeBehaviourSuite,
	type BehaviourSuiteSummary,
	type MaterializedSuite
} from '~/schemas/behaviourSuites';
import { ALL_SUITES } from '~/schemas/appSuites/index';
import {
	COMPONENT_DEMO_REFS,
	WEBPAGE_DEMO_FAMILIES,
	getWebpageDemo,
	getWebpageDemos,
	summarizeWebpageDemo,
	webpageDemoCrystal,
	webpageDemoFamilyCounts,
	webpageDemoShareId,
	type WebpageDemoFamily,
	type WebpageDemoSummary
} from '~/schemas/webpageDemos';

// Read model for the builder demo library: the deterministic catalogs
// (schemas/webpageDemos + schemas/behaviourSuites) joined with two bounded
// queries — one projection for which demos are seeded on this deployment, and
// one batched lookup of the handful of platform library components the
// component-kind demos reference. The catalogs themselves are code, so no
// demo content is ever read from the DB.

export type ListedWebpageDemo = WebpageDemoSummary & { seeded: boolean };
export type ListedBehaviourSuite = BehaviourSuiteSummary & { seeded: boolean };

export type ListWebpageDemosResult = {
	ok: true;
	total: number;
	seededCount: number;
	families: Array<WebpageDemoFamily & { count: number }>;
	demos: ListedWebpageDemo[];
	suites: ListedBehaviourSuite[];
	// the platform library components the component-kind demos reference,
	// resolved the way /webpages/resolve resolves a page's blocks — feed both
	// into buildComponentsByRef to draw those demos. A null ref means that
	// componentKey is not seeded on this deployment, so the block draws
	// nothing (the "not found" card is builder chrome, never a viewer's view).
	components: PublicThing[];
	refs: Record<string, string | null>;
	// present only for ?slug= — the full block tree for "use this template"
	demo?: ListedWebpageDemo & { crystal: Record<string, unknown> };
	// present only for ?suite= — the installable bundle (own-mode refs) plus
	// the system copy's ids for linking when seeded
	suite?: ListedBehaviourSuite & { bundle: MaterializedSuite };
};

const DEMO_KINDS = new Set(['section', 'page', 'component']);

const seededDemoShareIds = async (): Promise<Set<string>> => {
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'webpage', ownerId: 'system', tags: { $in: ['demo', 'app'] } } as any, { projection: { shareId: 1 } })
		.limit(getWebpageDemos().length + ALL_SUITES.length * 8 + 64)
		.toArray();
	return new Set(docs.map((doc: any) => doc.shareId).filter((id: unknown): id is string => typeof id === 'string'));
};

export const listWebpageDemos = async (query: {
	family?: unknown;
	kind?: unknown;
	slug?: unknown;
	suite?: unknown;
}): Promise<ListWebpageDemosResult | Fail> => {
	const family = typeof query.family === 'string' ? query.family.trim() : '';
	if (family && !WEBPAGE_DEMO_FAMILIES.some((entry) => entry.key === family)) {
		return fail(400, `Unknown demo family — one of ${WEBPAGE_DEMO_FAMILIES.map((entry) => entry.key).join(', ')}`);
	}
	const kind = typeof query.kind === 'string' ? query.kind.trim() : '';
	if (kind && !DEMO_KINDS.has(kind)) return fail(400, 'kind must be section, page, or component');
	const slug = typeof query.slug === 'string' ? query.slug.trim() : '';
	if (slug && (slug.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(slug))) {
		return fail(400, 'slug must be a lowercase-dashed demo slug');
	}
	const single = slug ? getWebpageDemo(slug) : null;
	if (slug && !single) return fail(404, 'Demo not found');
	const suiteKey = typeof query.suite === 'string' ? query.suite.trim() : '';
	if (suiteKey && (suiteKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(suiteKey))) {
		return fail(400, 'suite must be a lowercase-dashed suite key');
	}
	const singleSuite = suiteKey ? getAnySuite(suiteKey) : null;
	if (suiteKey && !singleSuite) return fail(404, 'Behaviour suite not found');

	const seeded = await seededDemoShareIds();
	// resolved anonymously on purpose: this endpoint's contract is that every
	// caller sees the same catalog, and the platform library is public anyway
	const library = await resolveBlockComponents(
		null,
		COMPONENT_DEMO_REFS.map((ref) => ({ type: 'component', component: ref }))
	);
	const all = getWebpageDemos();
	const demos = all
		.filter((demo) => (!family || demo.family === family) && (!kind || demo.kind === kind))
		.map((demo) => ({ ...summarizeWebpageDemo(demo), seeded: seeded.has(webpageDemoShareId(demo.slug)) }));
	const suites = ALL_SUITES.map((suite) => {
		const summary = summarizeBehaviourSuite(suite);
		return { ...summary, seeded: seeded.has(summary.pageId) };
	});

	const result: ListWebpageDemosResult = {
		ok: true,
		total: all.length,
		seededCount: all.filter((demo) => seeded.has(webpageDemoShareId(demo.slug))).length,
		families: webpageDemoFamilyCounts(),
		demos,
		suites,
		components: library.components,
		refs: library.refs
	};
	if (single) {
		result.demo = { ...summarizeWebpageDemo(single), seeded: seeded.has(webpageDemoShareId(single.slug)), crystal: webpageDemoCrystal(single) };
	}
	if (singleSuite) {
		const summary = summarizeBehaviourSuite(singleSuite);
		result.suite = { ...summary, seeded: seeded.has(summary.pageId), bundle: materializeSuite(singleSuite, 'own') };
	}
	return result;
};
