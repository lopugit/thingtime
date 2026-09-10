import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionReferences, sharedOperationAllowed } from './sharedCompositionCore';

test('saved action references use defaults, saved args and every persisted page instance', () => {
	const crystal = { args: [{ name: 'action', type: 'string', default: 'default-action' }], savedArgs: { action: 'saved-action' }, render: { ttAction: '{action}' } };
	assert.deepEqual(compositionReferences(['component'], crystal).map(({ ref }) => ref), ['saved-action']);
	assert.deepEqual(compositionReferences(['component'], crystal, { action: 'page-action' }).map(({ ref }) => ref), ['page-action']);
	assert.deepEqual(compositionReferences(['component'], { ...crystal, savedArgs: {} }).map(({ ref }) => ref), ['default-action']);
	assert.equal(compositionReferences(['webpage'], { blocks: [
		{ type: 'component', component: 'button', args: { action: 'one' } },
		{ type: 'component', component: 'button', args: { action: 'two' } }
	] }).length, 2);
});

test('saved action discovery covers inactive branches and repeat scopes without executing argument data', () => {
	const crystal = { savedArgs: { prefix: 'draw', query: 'private', index: 'private', payload: { ttAction: 'private' } }, render: { children: [
		{ ttIf: { arg: 'query.show', then: { ttAction: '{prefix}-one' }, else: { ttRepeat: { count: 2, node: { ttAction: '{prefix}-{index}' } } } } },
		{ ttAction: '{query}' }, { ttAction: '{index}' }, { ttArg: 'payload' },
		{ ttArg: 'missing', ttAction: 'ignored-by-renderer' },
		{ props: { ttAction: 'metadata' }, ttActionInputs: { ttAction: 'input' } }
	] } };
	assert.deepEqual(compositionReferences(['component'], crystal).map(({ ref }) => ref), ['draw-one', 'draw-0', 'draw-1']);
});

test('unused action binding entries and unbound token fragments grant no authority', () => {
	assert.deepEqual(compositionReferences(['component'], { render: { ttAction: 'draw-{query.id}', ttActionRefs: [['draw-', 'secret'], ['unused', 'secret']] } }), []);
	assert.deepEqual(compositionReferences(['component'], { savedArgs: { action: 'draw' }, render: { ttAction: '{action}', ttActionRefs: [['draw', 'copy-draw'], ['unused', 'secret']] } }), [{ kind: 'action', ref: 'copy-draw' }]);
});

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
