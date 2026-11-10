import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import { CATEGORIES, PAGES, pagesInCategory, searchPages } from './catalog.ts';
// @ts-ignore see above
import { FEATURE_CATEGORY_LABELS } from './features.ts';
// @ts-ignore see above
import { groupLabel, groupPages } from './pageGroups.ts';
// @ts-ignore see above
import { PERSONAS } from './personas.ts';

// The category index renders one <section> per group. React needs those keys
// unique among siblings, and display labels are not: see the "Developers"
// case below.

const PAGE_SIZE = 60;

test('group keys are unique for every category index', () => {
	for (const category of CATEGORIES) {
		const groups = groupPages(pagesInCategory(category.key).slice(0, PAGE_SIZE));
		const keys = groups.map((group) => group.key);
		assert.equal(new Set(keys).size, keys.length, `${category.key} produced a duplicate group key`);
		assert.ok(groups.length > 0, `${category.key} produced no groups`);
	}
});

test('group keys stay unique on search, where every namespace mixes', () => {
	for (const query of ['api', 'dev', 'developer', 'open', 'feed', 'share', 'thing']) {
		const results = searchPages(query, 400);
		for (const limit of [PAGE_SIZE, 120, 400]) {
			const keys = groupPages(results.slice(0, limit)).map((group) => group.key);
			assert.equal(new Set(keys).size, keys.length, `search "${query}" (limit ${limit}) produced a duplicate group key`);
		}
	}
});

test('a group label is NOT unique, so it can never be the React key', () => {
	// "Developers" is both a persona and a feature family. /marketing/search
	// mixes namespaces, so keying the section by label renders two siblings
	// under one key — React then warns and may reuse the wrong subtree.
	const personaNames = new Set(PERSONAS.map((persona) => persona.name));
	const familyNames = Object.values(FEATURE_CATEGORY_LABELS).map((label) => label.name);
	const shared = familyNames.filter((name) => personaNames.has(name));
	assert.ok(shared.includes('Developers'), `expected a persona/family name collision, got ${JSON.stringify(shared)}`);

	// The real result set that used to collide, proving the namespaced key fixes it.
	const groups = groupPages(searchPages('api', 400).slice(0, PAGE_SIZE));
	const developers = groups.filter((group) => group.label === 'Developers');
	assert.equal(developers.length, 2, 'expected both a persona and a family group labelled "Developers"');
	assert.deepEqual(
		developers.map((group) => group.key).sort(),
		['family:developer', 'persona:developers'],
		'the two same-labelled groups must stay distinct keys'
	);
});

test('every page groups under a resolvable reference', () => {
	for (const entry of PAGES) {
		const group = groupLabel(entry);
		assert.ok(group.key.length > 0, `${entry.slug} produced an empty group key`);
		assert.ok(group.label.length > 0, `${entry.slug} produced an empty group label`);
		assert.ok(!/undefined|\[object/.test(`${group.key}${group.label}${group.emoji}`), `${entry.slug} produced a bad group ${JSON.stringify(group)}`);
	}
});

test('grouping preserves every page exactly once, in first-seen order', () => {
	const pages = searchPages('thing', 200).slice(0, PAGE_SIZE);
	const groups = groupPages(pages);
	const flattened = groups.flatMap((group) => group.pages);
	assert.equal(flattened.length, pages.length, 'grouping dropped or duplicated a page');
	assert.deepEqual(new Set(flattened.map((entry) => entry.slug)).size, pages.length);
	// first-seen order: a group appears where its first page appeared
	const firstIndex = groups.map((group) => pages.indexOf(group.pages[0]));
	assert.deepEqual(firstIndex, [...firstIndex].sort((a, b) => a - b), 'groups are not in first-seen order');
});
