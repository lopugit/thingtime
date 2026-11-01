// Named JSON exports keep Nitro's lazy-module initialization intact.
import { features } from './generated/inventory.json';
import manifest from './generated/manifest.json';
import { featureRecipe } from './recipes';
import type { Feature } from './types';
// Present author-facing features first; inventory identity is independent of order.
const languageOrder = ['html', 'css', 'javascript', 'webapi'];
const kindOrder = ['element', 'property', 'built-in', 'interface', 'attribute', 'selector', 'function', 'at-rule', 'language'];
export const WEB_FEATURES = (features as Feature[])
	.slice()
	.sort(
		(a, b) =>
			languageOrder.indexOf(a.language) - languageOrder.indexOf(b.language) ||
			(kindOrder.includes(a.kind) ? kindOrder.indexOf(a.kind) : 99) - (kindOrder.includes(b.kind) ? kindOrder.indexOf(b.kind) : 99) ||
			a.name.localeCompare(b.name)
	);
const byId = new Map(WEB_FEATURES.map((f) => [f.id, f]));
const clean = (v: unknown, max = 180) => (typeof v === 'string' ? v.slice(0, max) : '');
const route = (params: Record<string, string | number>) =>
	`/p/web-standards?${new URLSearchParams(
		Object.entries(params)
			.filter(([, v]) => v !== '' && v !== 0)
			.map(([k, v]) => [k, String(v)])
	)}`;
const coverage = new Map<string, string>();
export const featureCoverage = (f: Feature) => {
	if (!coverage.has(f.id)) coverage.set(f.id, featureRecipe(f).coverage);
	return coverage.get(f.id)!;
};
export function componentForFeature(id: string) {
	const f = byId.get(id);
	if (!f) throw new Error('Feature not found');
	const demo = featureRecipe(f);
	return {
		name: f.name.split(' (')[0].slice(0, 60),
		description: `${f.language} ${f.kind} · ${demo.coverage}. ${demo.note}`.slice(0, 800),
		category: 'Web standards',
		args: [],
		render: {
			tag: 'section',
			props: { style: { display: 'grid', gap: '16px', minWidth: 0 } },
			children: [
				{ tag: 'h2', children: [f.name] },
				{ tag: 'p', children: [demo.note] },
				{ tag: 'a', props: { href: f.spec, target: '_blank', rel: 'noopener noreferrer' }, children: ['Read the standard ↗'] },
				{ tag: 'tt-web-platform', props: { program: demo.program } }
			]
		}
	};
}
export function browseStandards(raw: unknown = {}) {
	const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const language = clean(input.language, 20),
		q = clean(input.q, 120),
		kind = clean(input.kind, 40),
		mode = clean(input.coverage, 30);
	const parts = q.toLowerCase().split(/\s+/).filter(Boolean);
	const subset = WEB_FEATURES.filter(
		(f) =>
			(!language || f.language === language) &&
			(!kind || f.kind === kind) &&
			parts.every((part) => `${f.name} ${f.group} ${f.kind}`.toLowerCase().includes(part)) &&
			(!mode || featureCoverage(f) === mode)
	);
	const pages = Math.max(1, Math.ceil(subset.length / 18));
	const page = Math.min(pages, Math.max(1, Math.trunc(Number(input.page) || 1)));
	const feature = byId.get(clean(input.feature, 160));
	const params = { language, q, kind, coverage: mode };
	const cards = subset.slice((page - 1) * 18, page * 18).map((f) => ({
		id: f.id,
		name: f.name,
		language: f.language,
		kind: f.kind,
		group: f.group,
		status: f.status,
		coverage: featureCoverage(f),
		href: route({ ...params, feature: f.id })
	}));
	const selected = feature ? { ...feature, ...featureRecipe(feature), component: componentForFeature(feature.id) } : null;
	return {
		title: 'The web, made of Things.',
		total: WEB_FEATURES.length,
		matched: subset.length,
		page,
		pages,
		cards,
		selected,
		q,
		language,
		kind,
		coverage: mode,
		hasPrevious: page > 1,
		hasNext: page < pages,
		previous: route({ ...params, page: page - 1 }),
		next: route({ ...params, page: page + 1 }),
		back: route(params),
		generatedAt: manifest.generatedAt.slice(0, 10),
		counts: Object.entries(manifest.counts).map(([language, kinds]) => ({
			language,
			total: Object.values(kinds).reduce((a, b) => Number(a) + Number(b), 0),
			href: route({ language })
		})),
		kinds: [...new Set(WEB_FEATURES.filter((f) => !language || f.language === language).map((f) => f.kind))].sort(),
		standards: [
			{ name: 'HTML Living Standard', href: 'https://html.spec.whatwg.org/' },
			{ name: 'CSS Snapshot 2026', href: 'https://www.w3.org/TR/css-2026/' },
			{ name: 'ECMAScript 2026', href: 'https://tc39.es/ecma262/2026/' },
			{ name: 'ECMA-402 2026', href: 'https://tc39.es/ecma402/2026/' },
			{ name: 'W3C Webref', href: 'https://github.com/w3c/webref' }
		]
	};
}
