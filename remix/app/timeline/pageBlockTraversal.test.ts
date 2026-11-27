import assert from 'node:assert/strict';
import test from 'node:test';
import { pageBlockTraversal } from './pageBlockTraversal';

test('large and deep authored trees preserve every block without recursion limits', () => {
	const rows = Array.from({ length: 1500 }, (_, index) => ({ type: 'text', id: `row-${index}` }));
	assert.deepEqual([...pageBlockTraversal(rows)], rows);
	let nested: any[] = [{ type: 'component', component: 'leaf' }];
	for (let index = 0; index < 10_000; index++) nested = [{ type: 'container', children: nested }];
	assert.equal([...pageBlockTraversal(nested)].length, 10_001);
});

test('all composition containers are followed, including inactive branches, but ordinary props grant no edges', () => {
	const leaf = { type: 'component', component: 'leaf' };
	const root = [{ type: 'condition', children: [{ type: 'element', children: [{ type: 'collection', children: [leaf] }] }] }];
	assert.equal([...pageBlockTraversal(root)].at(-1), leaf);
	assert.deepEqual([...pageBlockTraversal([{ type: 'text', props: { children: [leaf] } }])].map(block => block.type), ['text']);
});

test('shared blocks and lists are traversed at each position, while ancestor cycles are refused', () => {
	const shared = { type: 'component', component: 'shared' }, children = [shared];
	assert.deepEqual([...pageBlockTraversal([{ type: 'container', children }, { type: 'element', children }])].map(block => block.type), ['container', 'component', 'element', 'component']);
	const cycle: any = { type: 'container', children: [] };
	cycle.children.push(cycle);
	assert.throws(() => [...pageBlockTraversal([cycle])], /cycle/);
	const list: any[] = [];
	list.push({ type: 'condition', children: list });
	assert.throws(() => [...pageBlockTraversal(list)], /cycle/);
});
