import assert from 'node:assert/strict';
import test from 'node:test';
import { alignDefinitionsToPage } from './componentDefinitions';

test('large and deep page comparisons align nested authored component identities', () => {
	const wrap = (component: string) => {
		let children: any[] = [{ id: 'slot', type: 'component', component }];
		for (let index = 0; index < 32; index++) children = [{ id: `wrapper-${index}`, type: ['container', 'condition', 'element', 'collection'][index % 4], children }];
		return children;
	};
	const rows = Array.from({ length: 1400 }, (_, index) => ({ id: `row-${index}`, type: 'text' }));
	const definition = { present: true as const, value: { name: 'Recorded card' } };
	const aligned = alignDefinitionsToPage({ original: definition }, [...rows, ...wrap('original')], [...rows, ...wrap('restored')]);
	assert.deepEqual(Object.keys(aligned), ['restored']);
	assert.deepEqual(aligned.restored, definition);
});

test('comparison preserves duplicate-identity and cycle refusals', () => {
	assert.throws(() => alignDefinitionsToPage({}, [{ id: 'duplicate' }, { id: 'duplicate' }], []), /duplicate block identities/);
	const block: any = { type: 'condition', children: [] };
	block.children.push(block);
	assert.throws(() => alignDefinitionsToPage({}, [block], []), /cycle/);
});
