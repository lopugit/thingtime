import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSuiteComponentRefs } from './suiteComponentBindings';
import type { DemoBlock } from './webpageDemos';

test('installed nested controls bind to private ids without rewriting unrelated references or args', () => {
	const blocks: DemoBlock[] = [
		{
			id: 'layout',
			type: 'container',
			children: [
				{ id: 'form', type: 'component', component: 'demo-site-forms-contact', args: { brand: 'Keep me' } },
				{ id: 'library', type: 'component', component: 'other-card' }
			]
		}
	];
	const result = bindSuiteComponentRefs(blocks, { 'demo-site-forms-contact': 'private-control' });
	assert.equal(result[0].children![0].component, 'private-control');
	assert.deepEqual(result[0].children![0].args, { brand: 'Keep me' });
	assert.equal(result[0].children![1].component, 'other-card');
	assert.equal(blocks[0].children![0].component, 'demo-site-forms-contact');
});
