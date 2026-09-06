import assert from 'node:assert/strict';
import test from 'node:test';

import {
	COLLECTION_SCHEMA_VERSIONS,
	MAX_WEBPAGE_BLOCKS,
	MAX_WEBPAGE_BLOCKS_BYTES,
	MAX_COMPONENT_KEY_CHARS,
	COMPONENT_KEY_PATTERN,
	validateThingtimeCrystal
} from './registry.ts';
import {
	COMPONENT_DEMO_REFS,
	WEBPAGE_DEMO_FAMILIES,
	countDemoBlocks,
	getWebpageDemo,
	getWebpageDemos,
	summarizeWebpageDemo,
	webpageDemoCrystal,
	webpageDemoFamilyCounts,
	webpageDemoPageKey,
	webpageDemoShareId,
	type DemoBlock
} from './webpageDemos.ts';

// The library's contract: a few hundred demos, every one of which the real
// webpage write gate accepts unchanged. A registry bound tightened later fails
// here instead of at seed time.

test('the demo library holds between 200 and 500 demos with unique slugs', () => {
	const demos = getWebpageDemos();
	assert.ok(demos.length >= 200, `expected at least 200 demos, got ${demos.length}`);
	assert.ok(demos.length <= 500, `expected at most 500 demos, got ${demos.length}`);
	assert.equal(new Set(demos.map((demo) => demo.slug)).size, demos.length, 'slugs collide');
});

test('every demo clears validateThingtimeCrystal(["webpage"]) unchanged', () => {
	assert.ok(COLLECTION_SCHEMA_VERSIONS.things >= 1);
	for (const demo of getWebpageDemos()) {
		const crystal = webpageDemoCrystal(demo);
		const validated = validateThingtimeCrystal(['webpage'], crystal);
		// assert.ok narrows the union, so the crystal below needs no second guard
		assert.ok(validated.ok, `${demo.slug}: ${validated.ok === false ? validated.error : ''}`);
		// the gate must not have had to drop or rewrite anything — seeds and
		// viewer forks then share byte-identical blocks
		assert.deepEqual(validated.crystal.blocks, demo.blocks, `${demo.slug}: gate rewrote the block tree`);
		assert.equal(validated.crystal.pageKey, webpageDemoPageKey(demo.slug));
	}
});

test('every demo stays inside the block count and byte budgets with headroom for edits', () => {
	for (const demo of getWebpageDemos()) {
		const count = countDemoBlocks(demo.blocks);
		assert.ok(count >= 1 && count <= MAX_WEBPAGE_BLOCKS - 8, `${demo.slug}: ${count} blocks leaves no room to add any`);
		assert.ok(JSON.stringify(demo.blocks).length <= MAX_WEBPAGE_BLOCKS_BYTES - 2048, `${demo.slug}: too close to the byte cap`);
	}
});

test('slugs, pageKeys, and shareIds follow the reserved lowercase-dashed grammar', () => {
	for (const demo of getWebpageDemos()) {
		assert.match(demo.slug, COMPONENT_KEY_PATTERN, demo.slug);
		assert.ok(webpageDemoPageKey(demo.slug).length <= MAX_COMPONENT_KEY_CHARS, demo.slug);
		assert.equal(webpageDemoShareId(demo.slug), `webpage-demo-${demo.slug}`);
		assert.equal(summarizeWebpageDemo(demo).id, webpageDemoShareId(demo.slug));
	}
});

test('every family in the registry has demos and every demo names a registered family', () => {
	const counts = webpageDemoFamilyCounts();
	for (const family of counts) assert.ok(family.count > 0, `family ${family.key} is empty`);
	const keys = new Set(WEBPAGE_DEMO_FAMILIES.map((family) => family.key));
	for (const demo of getWebpageDemos()) {
		assert.ok(keys.has(demo.family), `${demo.slug} names unknown family ${demo.family}`);
		assert.ok(demo.tags.includes(demo.family) && demo.tags.includes('demo'), `${demo.slug} tags miss family/demo`);
	}
	assert.ok(counts.find((family) => family.kind === 'page')!.count >= 20, 'expected at least 20 full-page demos');
});

// api/utils/webpages/demos resolves exactly COMPONENT_DEMO_REFS to hand the
// gallery its ref → component map, so a component block naming anything else
// would draw nothing (an unresolved ref is invisible outside the builder — the
// "not found" card is edit chrome). Keep the two in lockstep.
test('component-block demos reference only the declared library component keys', () => {
	const refs = new Set<string>();
	const walk = (blocks: DemoBlock[]) => {
		for (const block of blocks) {
			if (block.type === 'component') refs.add(String(block.component || ''));
			if (block.children) walk(block.children);
		}
	};
	for (const demo of getWebpageDemos()) walk(demo.blocks);
	assert.ok(refs.size > 0, 'no demo references a library component');
	for (const ref of refs) assert.ok(COMPONENT_DEMO_REFS.includes(ref), `${ref} is not in COMPONENT_DEMO_REFS`);
	for (const ref of COMPONENT_DEMO_REFS) {
		// the platform library names every entry <library>-<family>-<variant>;
		// a family stem like "thingtime-card" is not a componentKey and resolves
		// to nothing
		assert.match(ref, COMPONENT_KEY_PATTERN, ref);
		assert.ok(ref.split('-').length >= 3, `${ref} looks like a family stem, not a seeded componentKey`);
		assert.ok(refs.has(ref), `${ref} is declared but no demo uses it`);
	}
});

test('the catalog is deterministic and memoised', () => {
	const first = getWebpageDemos();
	assert.equal(getWebpageDemos(), first, 'catalog rebuilt on a second call');
	const hero = getWebpageDemo('hero-centered-paper');
	assert.ok(hero, 'hero-centered-paper is missing');
	assert.deepEqual(hero!.blocks, first.find((demo) => demo.slug === 'hero-centered-paper')!.blocks);
	assert.equal(getWebpageDemo('nope-nope'), null);
});
