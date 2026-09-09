import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionReferences, sharedOperationAllowed } from './sharedCompositionCore';

test('composition edges follow nested stored controls but never input or metadata references', () => {
	const refs = compositionReferences(['component'], {
		source: { action: 'initial' },
		render: { children: [{ ttIf: { then: { ttAction: 'draw', ttActionInputs: { ttAction: 'private-secret' } }, else: { ttEach: { node: { ttAction: 'again' } } } } }] },
		metadata: { ttAction: 'unrelated' }
	});
	assert.deepEqual(refs.map(({ ref }) => ref), ['initial', 'draw', 'again']);
});

test('dynamic user-controlled references do not grant inherited access', () => {
	assert.deepEqual(compositionReferences(['component'], { source: { action: '{input.action}' }, render: { ttAction: '{arg}' } }), []);
	assert.deepEqual(compositionReferences(['action'], { steps: [{ op: 'things.get', id: '$input.id' }, { op: 'things.get', id: 'stored-id' }, { op: 'actions.invoke', action: 'child' }] }), [
		{ kind: 'data', ref: 'stored-id' }, { kind: 'action', ref: 'child' }
	]);
});

test('shared execution has no saved-data mutation operations and defaults unknown operations to denied', () => {
	for (const op of ['things.create', 'things.update', 'things.delete', 'unknown']) assert.equal(sharedOperationAllowed(op), false);
	for (const op of ['return', 'compute', 'things.get', 'things.search', 'actions.invoke', 'each']) assert.equal(sharedOperationAllowed(op), true);
});

test('Chakra rawChildren controls are part of the same composition graph', () => {
	assert.deepEqual(compositionReferences(['component'], { render: { chakra: 'Box', rawChildren: [{ chakra: 'Button', ttAction: 'draw' }] } }), [{ kind: 'action', ref: 'draw' }]);
});

test('schema templates include stored actions but not field values or action inputs', () => {
	assert.deepEqual(compositionReferences(['schema'], {
		render: { children: [{ ttAction: 'schema-button', ttActionInputs: { ttAction: 'not-a-grant' } }] },
		fields: [{ name: 'ttAction', default: 'not-a-grant' }]
	}), [{ kind: 'action', ref: 'schema-button' }]);
});
