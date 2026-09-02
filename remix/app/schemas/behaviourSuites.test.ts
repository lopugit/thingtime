import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_WEBPAGE_BLOCKS, validateThingtimeCrystal } from './registry';
import {
	BEHAVIOUR_SUITES,
	getBehaviourSuite,
	materializeSuite,
	suiteActionShareId,
	suitePageShareId,
	suiteRefsFor,
	suiteSlug,
	summarizeBehaviourSuite,
	type SuiteMode
} from './behaviourSuites';
import { countDemoBlocks, type DemoBlock } from './webpageDemos';

// A suite is only a demo if every part of it would save through the real
// write gates — in BOTH materialisations (the seeded system copy and the
// viewer's installed copy), whose only difference is how references resolve.

const MODES: SuiteMode[] = ['system', 'own'];

const expectValid = (kinds: string[], crystal: Record<string, unknown>, label: string) => {
	const validated = validateThingtimeCrystal(kinds, crystal);
	assert.equal(validated.ok, true, `${label}: ${validated.ok === false ? validated.error : ''}`);
	return validated.ok === true ? validated.crystal : {};
};

test('every suite part clears its kind gate in both materialisations', () => {
	assert.ok(BEHAVIOUR_SUITES.length >= 10, `expected at least 10 suites, got ${BEHAVIOUR_SUITES.length}`);
	for (const suite of BEHAVIOUR_SUITES) {
		for (const mode of MODES) {
			const materialized = materializeSuite(suite, mode);
			for (const schema of materialized.schemas) expectValid(['schema'], schema.crystal, `${mode} schema ${schema.slug}`);
			for (const component of materialized.components) expectValid(['component'], component.crystal, `${mode} component ${component.slug}`);
			for (const action of materialized.actions) {
				const crystal = expectValid(['action'], action.crystal, `${mode} action ${action.slug}`);
				// the gate must keep the program byte-identical — a rewritten step
				// would mean the seed and the install differ from the catalog
				assert.deepEqual(crystal.steps, action.crystal.steps, `${mode} action ${action.slug}: gate rewrote the steps`);
				assert.equal(crystal.actionKey, suiteSlug(suite.key, action.key));
			}
			// seed and install both stamp schemaId on top of the catalog crystal —
			// validate the shape that is actually written, not just the catalog's
			for (const entry of materialized.data) {
				expectValid(['data'], { ...entry.crystal, schemaId: `schema-demo-${suite.key}-${entry.schemaKey}` }, `${mode} data ${entry.shareId}`);
				assert.ok(suite.schemas.some((schema) => schema.key === entry.schemaKey), `${suite.key}: data names undeclared schema ${entry.schemaKey}`);
			}
			const page = expectValid(['webpage'], materialized.page.crystal, `${mode} page ${materialized.page.slug}`);
			assert.deepEqual(page.blocks, materialized.page.crystal.blocks, `${mode} page ${materialized.page.slug}: gate rewrote the blocks`);
			assert.ok(countDemoBlocks(materialized.page.crystal.blocks as DemoBlock[]) <= MAX_WEBPAGE_BLOCKS - 8, `${materialized.page.slug} leaves no edit headroom`);
		}
	}
});

test('every control binds an action the same suite declares, by actionKey', () => {
	for (const suite of BEHAVIOUR_SUITES) {
		const keys = new Set(suite.actions.map((action) => suiteSlug(suite.key, action.key)));
		const refs = suiteRefsFor(suite, 'own');
		const bound = new Set<string>();
		const walk = (node: unknown) => {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) return node.forEach(walk);
			const record = node as Record<string, unknown>;
			if (typeof record.ttAction === 'string') {
				assert.ok(keys.has(record.ttAction), `${suite.key}: control binds unknown action ${record.ttAction}`);
				bound.add(record.ttAction);
				assert.ok(record.ttActionInputs && typeof record.ttActionInputs === 'object', `${suite.key}: ${record.ttAction} control has no inputs object`);
			}
			for (const value of Object.values(record)) walk(value);
		};
		for (const component of suite.components) walk(component.render(refs));
		assert.ok(bound.size > 0, `${suite.key}: no control binds an action`);
		// every page composes only this suite's components
		const componentKeys = new Set(suite.components.map((component) => suiteSlug(suite.key, component.key)));
		const page = materializeSuite(suite, 'own').page.crystal.blocks as DemoBlock[];
		const componentBlocks: string[] = [];
		const collect = (blocks: DemoBlock[]) => {
			for (const block of blocks) {
				if (block.type === 'component' && block.component) componentBlocks.push(block.component);
				if (block.children) collect(block.children);
			}
		};
		collect(page);
		assert.ok(componentBlocks.length > 0, `${suite.key}: page has no component blocks`);
		for (const ref of componentBlocks) assert.ok(componentKeys.has(ref), `${suite.key}: page references foreign component ${ref}`);
	}
});

test('references differ only by mode: system copies name shareIds, installs name own keys', () => {
	for (const suite of BEHAVIOUR_SUITES) {
		const system = materializeSuite(suite, 'system');
		const own = materializeSuite(suite, 'own');
		for (const [index, action] of system.actions.entries()) {
			const systemText = JSON.stringify(action.crystal);
			const ownText = JSON.stringify(own.actions[index].crystal);
			for (const schema of suite.schemas) {
				const systemRef = `schema-${suiteSlug(suite.key, schema.key)}`;
				const ownRef = suiteSlug(suite.key, schema.key);
				if (systemText.includes(`"${systemRef}"`)) assert.ok(ownText.includes(`"${ownRef}"`), `${suite.key}/${action.key}: own copy should name schema ${ownRef}`);
				assert.ok(!ownText.includes(`"${systemRef}"`), `${suite.key}/${action.key}: own copy leaks system schema id`);
			}
			for (const child of suite.actions) {
				const systemRef = suiteActionShareId(suite.key, child.key);
				assert.ok(!ownText.includes(`"${systemRef}"`), `${suite.key}/${action.key}: own copy leaks system action id`);
			}
		}
		// data names the schema so both the search step and /search find it
		for (const entry of own.data) assert.equal(entry.crystal.schema, suiteSlug(suite.key, entry.schemaKey));
		assert.equal(system.page.shareId, suitePageShareId(suite.key));
	}
});

test('suite keys and slugs are unique and summaries count what the catalog holds', () => {
	const keys = BEHAVIOUR_SUITES.map((suite) => suite.key);
	assert.equal(new Set(keys).size, keys.length, 'suite keys collide');
	const slugs = new Set<string>();
	for (const suite of BEHAVIOUR_SUITES) {
		const materialized = materializeSuite(suite, 'system');
		for (const part of [...materialized.schemas, ...materialized.components, ...materialized.actions]) {
			assert.ok(!slugs.has(part.shareId), `shareId collides: ${part.shareId}`);
			slugs.add(part.shareId);
		}
		const summary = summarizeBehaviourSuite(suite);
		assert.deepEqual(summary.counts, {
			schemas: suite.schemas.length,
			components: suite.components.length,
			actions: suite.actions.length,
			data: suite.data.length
		});
		assert.equal(summary.actionIds.length, suite.actions.length);
	}
	assert.equal(getBehaviourSuite('guestbook')?.title, 'Guestbook');
	assert.equal(getBehaviourSuite('nope'), null);
});
