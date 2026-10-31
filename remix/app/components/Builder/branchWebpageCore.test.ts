import assert from 'node:assert/strict';
import test from 'node:test';
import { branchWebpageCrystal, updateBranchWebpage, branchBuilderHref, branchComponentRefs } from './branchWebpageCore';
import type { TimelineSnapshot } from '../../timeline/contract';
const source: TimelineSnapshot = {
	adapter: 'thing-content',
	version: 1,
	value: {
		crystal: {
			name: 'Page',
			suiteKey: 'suite',
			custom: false,
			blocks: [
				{ type: 'text', id: 'title', text: 'Original' },
				{ type: 'component', id: 'card', component: 'my-card', args: { count: 0 } }
			]
		},
		extended: { untouched: true },
		tags: ['tag'],
		geo: null,
		acl: ['tt:user'],
		folderId: 'folder'
	}
};
test('visual changes preserve complete content metadata, false/zero values and independent source snapshots', () => {
	const changed = updateBranchWebpage(source, { name: 'Draft page', acl: ['tt:all'], blocks: [{ type: 'text', id: 'title', text: 'New text' }] });
	assert.equal(branchWebpageCrystal(changed).name, 'Draft page');
	assert.equal((changed.value as any).crystal.custom, false);
	assert.equal((changed.value as any).folderId, 'folder');
	assert.deepEqual((changed.value as any).extended, { untouched: true });
	assert.equal((source.value as any).crystal.blocks[1].args.count, 0);
	assert.deepEqual((source.value as any).acl, ['tt:user']);
	assert.deepEqual(branchComponentRefs(branchWebpageCrystal(source).blocks), ['my-card']);
	assert.throws(() => branchWebpageCrystal({ ...source, value: { ...(source.value as any), crystal: { fields: [] } } }), /block-based page/);
	assert.throws(() =>
		updateBranchWebpage(source, {
			blocks: [
				{ type: 'text', id: 'duplicate' },
				{ type: 'text', id: 'duplicate' }
			]
		})
	);
});
test('branch Builder links retain account, source and named branch identity independently of the head revision', () => {
	const href = branchBuilderHref('branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', 'page', 'owner', 'home');
	const url = new URL(href, 'https://thingtime.test');
	assert.equal(url.pathname, '/builder');
	assert.equal(url.searchParams.get('historyOwner'), 'owner');
	assert.equal(url.searchParams.get('dataPlane'), 'home');
	assert.equal(url.searchParams.get('page'), 'page');
	assert.throws(() => branchBuilderHref('main', 'page', 'owner', 'home'));
	assert.throws(() => branchBuilderHref('branch-177abf25-b322-4ac0-9707-a59c36e7bcd5', 'page', 'owner', 'other'));
});
