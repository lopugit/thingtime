import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteComposition } from './forkCompositionCore';

test('forks rewrite executable references and capability scopes without rewriting ordinary content', () => {
	const original = { name: 'child', steps: [{ op: 'actions.invoke', action: 'child' }, { op: 'return', value: 'child' }], capabilities: [{ capability: 'actions.invoke', actions: ['child'] }] };
	const copy = rewriteComposition(['action'], original, (_kind, ref) => ref === 'child' ? 'copy-child' : ref);
	assert.equal(copy.steps[0].action, 'copy-child');
	assert.deepEqual(copy.capabilities[0].actions, ['copy-child']);
	assert.equal(copy.steps[1].value, 'child');
	assert.equal(copy.name, 'child');
	assert.equal(original.steps[0].action, 'child');
});

test('forks retarget nested components and conditional controls', () => {
	assert.equal(rewriteComposition(['webpage'], { blocks: [{ type: 'container', children: [{ type: 'component', component: 'card', source: { action: 'load' } }] }] }, (_kind, ref) => `copy-${ref}`).blocks[0].children[0].source.action, 'copy-load');
	assert.equal(rewriteComposition(['component'], { render: { ttIf: { then: { ttAction: 'draw' } } } }, (_kind, ref) => `copy-${ref}`).render.ttIf.then.ttAction, 'copy-draw');
});
