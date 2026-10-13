import assert from 'node:assert/strict';
import test from 'node:test';
import { integrationBuilderSeeds, LIBRARY_PROVIDERS, libraryComponentId } from './builderPages';
import { LIBRARY_EXAMPLES } from './catalog';
import { LIBRARY_BUILDER_INDEX, libraryBuilderHref, libraryExamplePageId, libraryServicePageId } from './builderLinks';
import { validateThingtimeCrystal, MAX_WEBPAGE_BLOCKS } from '../schemas/registry';
import { countBlocks, type WebpageBlock } from '../components/Builder/webpageBlocks';
import { capabilitySatisfies, thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';

const seeds = integrationBuilderSeeds();
const byId = new Map(seeds.map((seed) => [seed.shareId, seed]));
const walk = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap((block) => [block, ...walk(block.children || [])]);

test('the complete hierarchy has one index, every service, and every example as real schema-valid Things', () => {
	assert.equal(seeds.filter((s) => s.kind === 'webpage').length, 1 + LIBRARY_PROVIDERS.length + LIBRARY_EXAMPLES.length);
	assert.equal(seeds.filter((s) => s.kind === 'component').length, LIBRARY_EXAMPLES.length);
	assert.equal(byId.size, seeds.length);
	assert.equal(new Set(LIBRARY_PROVIDERS.map(libraryServicePageId)).size, LIBRARY_PROVIDERS.length);
	for (const seed of seeds) {
		const validated = validateThingtimeCrystal([seed.kind], seed.crystalInput);
		assert.ok(validated.ok, `${seed.shareId}: ${validated.ok === false ? validated.error : ''}`);
		if (seed.kind === 'webpage') {
			assert.deepEqual(validated.crystal.blocks, seed.crystalInput.blocks);
			assert.ok(countBlocks(seed.crystalInput.blocks as WebpageBlock[]) <= MAX_WEBPAGE_BLOCKS - 8, seed.shareId);
		}
	}
});

test('service pages include each runnable example exactly once, with resolvable component and builder links', () => {
	for (const provider of LIBRARY_PROVIDERS) {
		const blocks = walk(byId.get(libraryServicePageId(provider))!.crystalInput.blocks as WebpageBlock[]);
		assert.deepEqual(
			blocks.filter((b) => b.type === 'component').map((b) => b.component),
			LIBRARY_EXAMPLES.filter((e) => e.provider === provider).map((e) => libraryComponentId(e.id))
		);
	}
	for (const seed of seeds.filter((s) => s.kind === 'webpage')) {
		for (const block of walk(seed.crystalInput.blocks as WebpageBlock[])) {
			if (block.type === 'component') assert.equal(byId.get(block.component!)?.kind, 'component');
			if (block.href?.startsWith('/builder?'))
				assert.equal(byId.get(new URL(block.href, 'https://example.test').searchParams.get('page')!)?.kind, 'webpage');
		}
	}
	assert.equal(new URL(libraryBuilderHref(), 'https://example.test').searchParams.get('page'), LIBRARY_BUILDER_INDEX);
	for (const example of LIBRARY_EXAMPLES) {
		const blocks = walk(byId.get(libraryExamplePageId(example.id))!.crystalInput.blocks as WebpageBlock[]);
		assert.equal(blocks.filter((b) => b.type === 'component').length, 1);
		const crystal = byId.get(libraryComponentId(example.id))!.crystalInput;
		assert.deepEqual(crystal.render, { chakra: 'IntegrationExample', props: { exampleId: example.id, inputJson: '{inputJson}' } });
	}
});

test('integration-only seeding negotiates an additive capability without accepting older or breaking servers', () => {
	const manifest = thingtimeCapabilityManifest('https://example.test');
	const feature = 'api.admin-webpages-seed-demos';
	assert.equal(manifest.features[feature].version, '1.2.0');
	assert.ok(manifest.operations.some((o) => o.feature === feature && o.methods.includes('POST')));
	assert.equal(capabilitySatisfies('1.1.0', '1.2.0'), false);
	assert.equal(capabilitySatisfies('2.0.0', '1.2.0'), false);
	assert.equal(capabilitySatisfies('1.2.1', '1.2.0'), true);
});
