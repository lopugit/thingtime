import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteComposition } from './forkCompositionCore';
import { resolveTemplate } from '../../../components/ComponentsLibrary/componentTemplate';
import { compositionReferences, storedComponentScope } from './sharedCompositionCore';

test('collection source Actions are exported and remapped in nested row templates for HTML and Chakra', () => {
	for (const tag of [{ tag: 'tt-collection' }, { chakra: 'Collection' }]) {
		const original = { render: { ...tag, props: { source: { action: 'outer', inputs: { value: 'outer' } }, itemTemplate: { ttTemplate: { ...tag, props: { source: { action: 'inner', inputs: { id: '{item.id}' } } } } } } } };
		assert.deepEqual(compositionReferences(['component'], original).map((ref) => ref.ref), ['outer', 'inner']);
		const copy = rewriteComposition(['component'], original, (_kind, ref) => `copy-${ref}`);
		assert.deepEqual(compositionReferences(['component'], copy).map((ref) => ref.ref), ['copy-outer', 'copy-inner']);
		assert.equal(copy.render.props.source.inputs.value, 'outer');
		assert.equal(copy.render.props.itemTemplate.ttTemplate.props.source.inputs.id, '{item.id}');
		assert.deepEqual(compositionReferences(['component'], { render: { ...tag, props: { source: { action: '{item.id}' }, metadata: { source: { action: 'fake' } } } } }), []);
	}
});

test('forks preserve argument programs while rebinding each saved instance and fork-of-fork', () => {
	const original = {
		savedArgs: { action: 'default', label: 'draw-default' },
		render: { tag: 'button', ttAction: 'draw-{action}', ttActionInputs: { note: '{label}' }, children: ['{label}'] }
	};
	const contexts = [undefined, { action: 'one' }, { action: 'two' }];
	const copy = rewriteComposition(['component'], original, (_kind, ref) => (ref.startsWith('draw-') ? `copy-${ref}` : ref), contexts);
	const second = rewriteComposition(['component'], copy, (_kind, ref) => (ref.startsWith('copy-draw-') ? `second-${ref}` : ref), contexts);
	for (const [doc, prefix] of [
		[copy, 'copy-'],
		[second, 'second-copy-']
	] as const) {
		assert.equal(doc.render.ttAction, 'draw-{action}');
		assert.deepEqual(doc.savedArgs, original.savedArgs);
		for (const args of contexts) {
			const result: any = resolveTemplate(doc.render, storedComponentScope(doc, args));
			assert.equal(result.props['data-tt-action'], `${prefix}draw-${args?.action || 'default'}`);
			assert.equal(result.props['data-tt-action-inputs'], '{"note":"draw-default"}');
			assert.deepEqual(result.children, ['draw-default']);
			assert.equal(result.ttActionRefs, undefined);
			assert.deepEqual(
				compositionReferences(['component'], doc, args).map(({ ref }) => ref),
				[`${prefix}draw-${args?.action || 'default'}`]
			);
		}
	}
	assert.equal((original.render as any).ttActionRefs, undefined);
});

test('forks rewrite executable references and capability scopes without rewriting ordinary content', () => {
	const original = {
		name: 'child',
		steps: [
			{ op: 'actions.invoke', action: 'child' },
			{ op: 'return', value: 'child' }
		],
		capabilities: [{ capability: 'actions.invoke', actions: ['child'] }]
	};
	const copy = rewriteComposition(['action'], original, (_kind, ref) => (ref === 'child' ? 'copy-child' : ref));
	assert.equal(copy.steps[0].action, 'copy-child');
	assert.deepEqual(copy.capabilities[0].actions, ['copy-child']);
	assert.equal(copy.steps[1].value, 'child');
	assert.equal(copy.name, 'child');
	assert.equal(original.steps[0].action, 'child');
});

test('forks retarget nested components and conditional controls', () => {
	assert.equal(
		rewriteComposition(
			['webpage'],
			{ blocks: [{ type: 'container', children: [{ type: 'component', component: 'card', source: { action: 'load' } }] }] },
			(_kind, ref) => `copy-${ref}`
		).blocks[0].children[0].source.action,
		'copy-load'
	);
	assert.equal(
		rewriteComposition(['component'], { render: { ttIf: { then: { ttAction: 'draw' } } } }, (_kind, ref) => `copy-${ref}`).render.ttIf.then.ttAction,
		'copy-draw'
	);
});

test('copied schema buttons run the copied action, without changing data or the original', () => {
	const original = { render: { children: [{ ttAction: 'draw', ttActionInputs: { note: 'draw' } }] } };
	const copy = rewriteComposition(['schema'], original, (_kind, ref) => `copy-${ref}`);
	assert.equal(copy.render.children[0].ttAction, 'copy-draw');
	assert.equal(copy.render.children[0].ttActionInputs.note, 'draw');
	assert.equal(original.render.children[0].ttAction, 'draw');
});

test('copied collection rows and dialog completion bindings follow the copied actions', () => {
	const original = {
		render: {
			tag: 'tt-collection',
			props: {
				itemsPath: 'result.rows',
				itemTemplate: { ttTemplate: { tag: 'tt-dialog', props: { closeOnAction: 'save' }, children: [{ tag: 'button', ttAction: 'save' }] } }
			}
		}
	};
	const copy = rewriteComposition(['component'], original, (_kind, ref) => (ref === 'save' ? 'copy-save' : ref));
	assert.equal(copy.render.props.itemTemplate.ttTemplate.props.closeOnAction, 'copy-save');
	assert.equal(copy.render.props.itemTemplate.ttTemplate.children[0].ttAction, 'copy-save');
	assert.deepEqual(compositionReferences(['component'], copy), [{ kind: 'action', ref: 'copy-save' }]);
	assert.equal(original.render.props.itemTemplate.ttTemplate.children[0].ttAction, 'save');
});
