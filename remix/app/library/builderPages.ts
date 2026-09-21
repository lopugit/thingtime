import { LIBRARY_EXAMPLES } from './catalog';
import { exampleThings } from './reuse';
import { LIBRARY_BUILDER_INDEX, libraryBuilderHref, libraryExamplePageId, libraryServicePageId } from './builderLinks';
import { slug } from './types';
import type { WebpageBlock, WebpageCrystal } from '../components/Builder/webpageBlocks';

// Real component + webpage Things, built from the same catalogue as /library.
// No remote source, credentials or live output is copied into these documents.
export type IntegrationSeed = {
	shareId: string;
	uniqueKey: string;
	kind: string;
	tags: string[];
	crystalInput: Record<string, unknown>;
};
export const LIBRARY_PROVIDERS = [...new Set(LIBRARY_EXAMPLES.map((example) => example.provider))];
export const libraryComponentId = (id: string) => `component-integration-${id}`;
const link = (id: string, text: string, href: string): WebpageBlock => ({ id, type: 'text', text, href, css: { 'overflow-wrap': 'anywhere' } });
const heading = (text: string): WebpageBlock => ({ id: 'title', type: 'text', text, style: 'heading', tag: 'h1' });
const body = (id: string, text: string): WebpageBlock => ({ id, type: 'text', text, style: 'body' });
const component = (id: string): WebpageBlock => ({
	id: `example-${LIBRARY_EXAMPLES.findIndex((example) => example.id === id)}`,
	type: 'component',
	component: libraryComponentId(id)
});
const page = (id: string, name: string, description: string, blocks: WebpageBlock[]): IntegrationSeed => {
	const crystal: WebpageCrystal = {
		name,
		description,
		version: 1,
		pageKey: id.slice('webpage-'.length),
		blocks: [
			{
				id: 'page',
				type: 'container',
				direction: 'column',
				gap: 6,
				maxWidth: 1080,
				align: 'center',
				css: { padding: '24px 16px', width: '100%', 'min-width': '0' },
				children: blocks
			}
		]
	};
	return {
		shareId: id,
		uniqueKey: `webpage:${crystal.pageKey}`,
		kind: 'webpage',
		tags: ['webpage', 'integration-library'],
		crystalInput: { ...crystal }
	};
};

export function integrationBuilderSeeds(): IntegrationSeed[] {
	const components: IntegrationSeed[] = LIBRARY_EXAMPLES.map((example) => {
		const template = exampleThings(example, 'builder')[2].crystal;
		return {
			shareId: libraryComponentId(example.id),
			uniqueKey: `component:integration-${example.id}`,
			kind: 'component',
			tags: ['component', 'integration-library', slug(example.provider)],
			crystalInput: { ...template, name: `${example.provider} · ${example.title}`, componentKey: `integration-${example.id}` }
		};
	});
	const index = page(LIBRARY_BUILDER_INDEX, 'Integration library', 'Every integration, organised by service and ready to build with.', [
		heading('The integration builder library'),
		body(
			'intro',
			`${LIBRARY_EXAMPLES.length} examples across ${LIBRARY_PROVIDERS.length} libraries and services. Open a service to try every example together, or open any example in its own builder. Edit and save a private copy to make it yours.`
		),
		link('catalogue', 'Search all examples →', '/library'),
		...LIBRARY_PROVIDERS.map((provider) => {
			const examples = LIBRARY_EXAMPLES.filter((example) => example.provider === provider);
			return {
				...link(
					`service-${slug(provider)}`,
					`${provider} · ${examples.length} ${examples.length === 1 ? 'example' : 'examples'} →`,
					libraryBuilderHref(libraryServicePageId(provider))
				),
				css: {
					padding: '16px 20px',
					border: '1px solid var(--tt-border, #e5e5e9)',
					'border-radius': '12px',
					'font-weight': '600',
					'overflow-wrap': 'anywhere'
				}
			};
		})
	]);
	const services = LIBRARY_PROVIDERS.map((provider) => {
		const examples = LIBRARY_EXAMPLES.filter((example) => example.provider === provider);
		return page(libraryServicePageId(provider), `${provider} examples`, `All ${examples.length} ${provider} examples on one editable page.`, [
			link('index', '← All libraries & services', libraryBuilderHref()),
			heading(`${provider} examples`),
			body(
				'intro',
				`${examples.length} runnable examples. Each example loads its dependency or calls its provider only when you press Run. Keys stay in the open demo and are never saved with this page.`
			),
			...examples.map((example) => component(example.id))
		]);
	});
	const examples = LIBRARY_EXAMPLES.map((example) =>
		page(libraryExamplePageId(example.id), `${example.provider} · ${example.title}`, example.description, [
			link('index', '← All libraries & services', libraryBuilderHref()),
			link('service', `← All ${example.provider} examples`, libraryBuilderHref(libraryServicePageId(example.provider))),
			heading(example.title),
			body('description', example.description),
			component(example.id),
			link('source', 'Source, documentation & reusable Things →', `/library/${example.id}`)
		])
	);
	return [...components, index, ...services, ...examples];
}
