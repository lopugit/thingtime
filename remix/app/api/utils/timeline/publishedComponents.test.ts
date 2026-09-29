import assert from 'node:assert/strict';
import test from 'node:test';
import { comparePublishedComponents, planPublishedComponentCopies } from './publishedComponents';
import { parsePublishedVersionPreview, parseVersionRequest, type VersionRequest } from '../../../timeline/publishedVersion';
import { componentBindingSnapshot } from '../../../timeline/componentBindings';
import type { ComponentDefinitionVersion } from '../../../timeline/componentDefinitions';
const value = (text: string) =>
	(
		componentBindingSnapshot('card', {
			id: 'source-card',
			crystal: { name: 'Card', componentKey: 'card', version: 7, render: { tag: 'div', children: text } }
		}).value as any
	).component;
const fields = (text: string): ComponentDefinitionVersion => ({ card: { present: true, value: value(text) } });
const request: VersionRequest = { command: 'preview-version', mode: 'merge', eventId: 'source', componentMode: 'recorded', componentChoices: {} };
const live = (text: string) => ({ current: fields(text), result: fields(text), fingerprint: 'a'.repeat(64) });
const content = {
	crystal: {
		name: 'Page',
		blocks: [
			{
				type: 'container',
				id: 'outer',
				children: [
					{ type: 'component', id: 'a', component: 'card', args: { message: 'card' } },
					{ type: 'text', id: 'text', text: 'card' }
				]
			}
		]
	},
	extended: null,
	tags: [],
	acl: ['tt:user'],
	geo: null,
	folderId: null
};
test('published comparison considers standalone component changes since the base, with explicit atomic conflicts', () => {
	const unchanged = comparePublishedComponents(request, fields('base'), fields('incoming'), live('base'), ['card']);
	assert.deepEqual(unchanged.result, fields('incoming'));
	assert.equal(unchanged.conflicts.length, 0);
	const changed = comparePublishedComponents(request, fields('base'), fields('incoming'), live('live edit'), ['card']);
	assert.deepEqual(
		changed.conflicts.map((item) => item.path),
		[['card']]
	);
	const chosen = comparePublishedComponents(
		{ ...request, componentChoices: { '["card"]': 'incoming' } },
		fields('base'),
		fields('incoming'),
		live('live edit'),
		['card']
	);
	assert.equal(chosen.conflicts.length, 0);
	assert.deepEqual(chosen.result, fields('incoming'));
	assert.throws(
		() =>
			comparePublishedComponents(
				{ ...request, componentChoices: { '["other"]': 'incoming' } },
				fields('base'),
				fields('incoming'),
				live('live edit'),
				['card']
			),
		/no longer match/
	);
});
test('unknown and explicitly unavailable historical definitions cannot silently restore live values', () => {
	for (const incoming of [{ card: { present: false as const } }, { card: { present: true as const, value: null } }]) {
		const compared = comparePublishedComponents({ ...request, mode: 'restore' }, {}, incoming, live('current'), ['card']);
		assert.equal(compared.missing.length + compared.unavailable.length, 1);
		if (compared.missing.length) assert.throws(() => planPublishedComponentCopies('operation', content, compared.result), /not recorded/);
		else {
			const placeholder = planPublishedComponentCopies('operation', content, compared.result).copies[0];
			assert.equal((placeholder.crystal.render as any).children, 'This component was unavailable in the recorded version.');
			assert.equal(placeholder.crystal.forkOf, undefined);
		}
		assert.deepEqual(
			comparePublishedComponents({ ...request, mode: 'restore', componentMode: 'current' }, {}, incoming, live('current'), ['card']).result,
			fields('current')
		);
	}
});
test('copy planning is deterministic, deduplicated, isolated from shared keys, and rewrites executable page references only', () => {
	const definitions = { ...fields('old'), alias: fields('old').card };
	const plan = planPublishedComponentCopies('operation-a', content, definitions);
	assert.equal(plan.copies.length, 1);
	const copy = plan.copies[0];
	assert.notEqual(copy.shareId, 'source-card');
	assert.notEqual(copy.crystal.componentKey, 'card');
	assert.equal(copy.crystal.componentKey, copy.shareId);
	assert.equal(copy.crystal.forkOf, 'source-card');
	assert.deepEqual(plan, planPublishedComponentCopies('operation-a', content, definitions));
	assert.notEqual(copy.shareId, planPublishedComponentCopies('operation-b', content, definitions).copies[0].shareId);
	const block = plan.content.crystal.blocks[0];
	assert.equal(block.children[0].component, copy.shareId);
	assert.equal(block.children[0].args.message, 'card');
	assert.equal(block.children[1].text, 'card');
	assert.equal(content.crystal.blocks[0].children[0].component, 'card');
});
test('published component preview validates exact resource, references, projection, availability and budgets', () => {
	const snapshot = { adapter: 'thing-content', version: 1, value: content };
	const components = comparePublishedComponents({ ...request, mode: 'restore' }, {}, fields('old'), live('current'), ['card']);
	const preview = {
		eventId: 'source',
		thingId: 'page',
		thingtime: ['webpage'],
		mode: 'restore',
		expectedHeadId: 'head',
		baseEventId: null,
		current: snapshot,
		incoming: snapshot,
		result: snapshot,
		conflicts: [],
		components
	};
	const command = { ...request, mode: 'restore' as const };
	assert.equal(parsePublishedVersionPreview(preview, 'source', 'page', command).components!.copyCount, 1);
	assert.throws(() => parsePublishedVersionPreview({ ...preview, thingId: 'other' }, 'source', 'page', command), /another version/);
	assert.throws(
		() => parsePublishedVersionPreview({ ...preview, components: { ...components, result: {} } }, 'source', 'page', command),
		/another page/
	);
	assert.throws(
		() => parsePublishedVersionPreview({ ...preview, components: { ...components, missing: ['card'] } }, 'source', 'page', command),
		/availability/
	);
	const injected = structuredClone(preview);
	(injected.components.result.card as any).value.secure = 'secret';
	assert.throws(() => parsePublishedVersionPreview(injected, 'source', 'page', command), /projection/);
	assert.throws(() => parsePublishedVersionPreview({ ...preview, padding: 'a'.repeat(16 * 1024 * 1024) }, 'source', 'page', command), /byte budget/);
	const apply = { ...command, command: 'apply-version', expectedHeadId: 'head', operationId: '177abf25-b322-4ac0-9707-a59c36e7bcd5' };
	assert.throws(() => parseVersionRequest(apply), /Review the components/);
	assert.equal(parseVersionRequest({ ...apply, expectedComponents: components.fingerprint }).componentMode, 'recorded');
	assert.throws(
		() =>
			parseVersionRequest({
				...apply,
				expectedComponents: components.fingerprint,
				componentMode: 'current',
				componentChoices: { '["card"]': 'incoming' }
			}),
		/do not accept/
	);
});

test('prototype-shaped refs remain own values or explicit missing history', () => {
	const compared = comparePublishedComponents({ ...request, mode: 'restore' }, {}, {}, { current: {}, result: {}, fingerprint: 'a'.repeat(64) }, [
		'constructor',
		'__proto__'
	]);
	assert.deepEqual(compared.missing, ['__proto__', 'constructor']);
	assert.deepEqual(compared.result.constructor, { present: false });
});

test('merging after a page restore reviews incoming definitions against copied block references', () => {
	const copied = {
		copy: {
			present: true as const,
			value: { ...value('base'), id: 'copied-id', crystal: { ...value('base').crystal, componentKey: 'copied-id', forkOf: 'source-card' } }
		}
	};
	const original = { crystal: { blocks: [{ id: 'stable', type: 'component', component: 'card' }] } };
	const restored = { crystal: { blocks: [{ id: 'stable', type: 'component', component: 'copy' }] } };
	const pages = { base: original, current: restored, incoming: original, result: restored };
	const comparison = comparePublishedComponents(
		request,
		fields('base'),
		fields('incoming'),
		{ current: copied, result: copied, fingerprint: 'a'.repeat(64) },
		['copy'],
		pages
	);
	assert.deepEqual(
		comparison.conflicts.map((conflict) => conflict.path),
		[['copy']]
	);
	const chosen = comparePublishedComponents(
		{ ...request, componentChoices: { '["copy"]': 'incoming' } },
		fields('base'),
		fields('incoming'),
		{ current: copied, result: copied, fingerprint: 'a'.repeat(64) },
		['copy'],
		pages
	);
	assert.deepEqual(chosen.result.copy, fields('incoming').card);
});

test('published previews do not reject existing large content because three snapshots share one response', () => {
	const snapshot = { adapter: 'thing-content', version: 1, value: { ...content, crystal: { value: 'x'.repeat(2_250_000) } } };
	const components = {
		current: {},
		incoming: {},
		result: {},
		conflicts: [],
		missing: [],
		unavailable: [],
		copyCount: 0,
		fingerprint: 'a'.repeat(64)
	};
	const preview = {
		thingtime: ['data'],
		eventId: 'source',
		thingId: 'page',
		mode: 'restore',
		expectedHeadId: 'head',
		baseEventId: null,
		current: snapshot,
		incoming: snapshot,
		result: snapshot,
		conflicts: [],
		components
	};
	assert.equal(
		(parsePublishedVersionPreview(preview, 'source', 'page', { ...request, mode: 'restore' }).result.value as any).crystal.value.length,
		2_250_000
	);
});
