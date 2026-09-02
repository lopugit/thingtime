import { getThingsCollection } from '../mongodb/collections';
import { fail, type Fail } from '../things/things';
import { COMPONENT_KEY_PATTERN, MAX_COMPONENT_KEY_CHARS } from '~/schemas/registry';
import {
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

// Read model for the builder demo library: the deterministic catalog
// (schemas/webpageDemos) joined with ONE projection query for which demos are
// seeded on this deployment. The catalog is code, so listing never touches
// the DB for content — only the seeded census does, and it is bounded by the
// catalog size.

export type ListedWebpageDemo = WebpageDemoSummary & { seeded: boolean };

export type ListWebpageDemosResult = {
	ok: true;
	total: number;
	seededCount: number;
	families: Array<WebpageDemoFamily & { count: number }>;
	demos: ListedWebpageDemo[];
	// present only for ?slug= — the full block tree for "use this template"
	demo?: ListedWebpageDemo & { crystal: Record<string, unknown> };
};

const DEMO_KINDS = new Set(['section', 'page', 'component']);

const seededDemoShareIds = async (): Promise<Set<string>> => {
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'webpage', ownerId: 'system', tags: 'demo' } as any, { projection: { shareId: 1 } })
		.limit(getWebpageDemos().length + 64)
		.toArray();
	return new Set(docs.map((doc: any) => doc.shareId).filter((id: unknown): id is string => typeof id === 'string'));
};

export const listWebpageDemos = async (query: { family?: unknown; kind?: unknown; slug?: unknown }): Promise<ListWebpageDemosResult | Fail> => {
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

	const seeded = await seededDemoShareIds();
	const all = getWebpageDemos();
	const demos = all
		.filter((demo) => (!family || demo.family === family) && (!kind || demo.kind === kind))
		.map((demo) => ({ ...summarizeWebpageDemo(demo), seeded: seeded.has(webpageDemoShareId(demo.slug)) }));

	const result: ListWebpageDemosResult = {
		ok: true,
		total: all.length,
		seededCount: all.filter((demo) => seeded.has(webpageDemoShareId(demo.slug))).length,
		families: webpageDemoFamilyCounts(),
		demos
	};
	if (single) {
		result.demo = { ...summarizeWebpageDemo(single), seeded: seeded.has(webpageDemoShareId(single.slug)), crystal: webpageDemoCrystal(single) };
	}
	return result;
};
