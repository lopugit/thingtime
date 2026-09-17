import assert from 'node:assert/strict';
import test from 'node:test';
import { isSeamlessMode, matchingTextArg, usesPageRuntime, pageRuntimeSearch } from './seamlessMode';
import { resolveTemplate } from '../ComponentsLibrary/componentTemplate';
import { componentTextOverrides } from './componentTextOverrides';
import { boundViewportDimension } from './BuilderViewport';
import { builderPoint } from './builderCoordinates';

test('editing modes choose runtime independently from presentation', () => {
	for (const mode of ['edit', 'view', 'layout', 'builder']) assert.equal(isSeamlessMode(mode), true);
	for (const mode of ['run', 'visit', 'container', null, 'unknown']) assert.equal(isSeamlessMode(mode), false);
	assert.equal(usesPageRuntime('builder'), false);
	assert.equal(usesPageRuntime('container'), true);
	for (const mode of ['edit', 'view', 'layout', 'run']) assert.equal(usesPageRuntime(mode), true);
});
test('argument matching refuses ambiguous and non-text values', () => {
	assert.equal(matchingTextArg([{ name: 'a', type: 'string' }], { a: 'Label' }, 'Label'), 'a');
	assert.equal(matchingTextArg([{ name: 'a' }, { name: 'b' }], { a: 'Label', b: 'Label' }, 'Label'), null);
	assert.equal(matchingTextArg([{ name: 'n', type: 'number' }], { n: 42 }, '42'), null);
});
test('literal edits are block-local, preserve actions and never replace runtime tokens', () => {
	const template = {
		tag: 'div',
		children: [
			{ tag: 'button', props: { 'data-tt-action': 'save' }, children: ['Save'] },
			{ tag: 'span', children: ['{result.name}'] }
		]
	};
	const prepared = componentTextOverrides(template, {}, true);
	assert.equal(prepared.labels.length, 1);
	const key = prepared.labels[0].key;
	const edited = componentTextOverrides(template, { [key]: 'Save now' });
	assert.equal((resolveTemplate(edited.render, { [key]: 'Save now' }) as any).children[0].children[0], 'Save now');
	assert.equal(edited.render.children[0].props['data-tt-action'], 'save');
	assert.equal(edited.render.children[0].props['data-tt-label-key'], undefined);
	assert.equal(edited.render.children[1].children[0], '{result.name}');
	assert.equal(template.children[0].children[0], 'Save');
	assert.equal(componentTextOverrides(template).render.children[0].children[0], 'Save');
});
test('changed template labels invalidate stale overrides and props remain untouched', () => {
	const old = componentTextOverrides({ tag: 'a', props: { href: '/Save' }, children: 'Save' });
	const next = componentTextOverrides({ tag: 'a', props: { href: '/Save' }, children: 'Continue' }, { [old.labels[0].key]: 'Changed' });
	assert.equal(next.render.children, 'Continue');
	assert.equal(next.render.props.href, '/Save');
});
test('custom viewport dimensions are bounded and finite', () => {
	assert.equal(boundViewportDimension(NaN, 390), 390);
	assert.equal(boundViewportDimension(-1, 390), 240);
	assert.equal(boundViewportDimension(100000, 390), 3840);
	assert.equal(boundViewportDimension(820.4, 390), 820);
});
test('overlay positions account for scaled preview frames', () => {
	const outer = { defaultView: null };
	const frame = {
		getBoundingClientRect: () => ({ left: 100, top: 80, width: 300, height: 400 }),
		offsetWidth: 600,
		offsetHeight: 800,
		ownerDocument: outer
	};
	const element = { ownerDocument: { defaultView: { frameElement: frame } } } as unknown as Element;
	assert.deepEqual(builderPoint(element, 200, 100), { x: 200, y: 130 });
});
test('Chakra rawChildren labels use the same per-block override contract', () => {
	const node = { chakra: 'Button', rawChildren: ['Press me'] };
	const { labels } = componentTextOverrides(node);
	assert.equal(labels.length, 1);
	const args = { [labels[0].key]: '{result.secret}' };
	assert.deepEqual((resolveTemplate(componentTextOverrides(node, args).render, { ...args, result: { secret: 'hidden' } }) as any).rawChildren, [
		'{result.secret}'
	]);
});

test('builder route controls do not leak into page inputs, unrelated query fields survive', () => {
	assert.equal(pageRuntimeSearch('/builder', '?page=id&mode=edit&customer=42'), 'customer=42');
	assert.equal(pageRuntimeSearch('/p/id', '?mode=view&customer=42'), 'customer=42');
	assert.equal(pageRuntimeSearch('/t/id', '?page=2&mode=run'), 'page=2');
	assert.equal(pageRuntimeSearch('/components/card', '?mode=edit&page=2'), 'mode=edit&page=2');
});
