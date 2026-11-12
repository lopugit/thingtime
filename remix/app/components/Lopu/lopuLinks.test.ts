import assert from 'node:assert/strict';
import test from 'node:test';
import { lopuResultLinks, normalizeLopuLinks, safeLopuHref } from '~/utils/lopuLinks';
import { publicLopuMessageMeta } from '~/api/utils/messenger/externalAi';
import { lopuMessageMeta, toolLinks } from './lopuTurnCore';

test('page reads, related components and search hits retain navigable receipts through history projection', () => {
	const data = {
		page: { id: 'page/1', name: 'Comparison' },
		components: [{ id: 'c1', componentKey: 'table', name: 'Table' }],
		hits: [{ id: 'a1', kind: 'action', key: 'compare', name: 'Compare' }],
		links: [{ url: 'https://example.com/specs', title: 'Specs' }]
	};
	const links = lopuResultLinks(data);
	assert.deepEqual(
		links.map((link) => link.href),
		['/builder?page=page%2F1', '/actions/compare', '/components/table', 'https://example.com/specs']
	);
	assert.deepEqual(toolLinks({ id: 'read', name: 'get_page', status: 'ok', result: { ok: true, summary: 'Read', data } } as any), links);
	const projected = publicLopuMessageMeta({ role: 'assistant', toolCalls: [{ name: 'get_page', ok: true, links, secret: 'never-copy' }] });
	assert.deepEqual(lopuMessageMeta({ lopu: projected })?.toolCalls[0].links, links);
	assert.doesNotMatch(JSON.stringify(projected), /never-copy/);
});

test('unsafe, malformed, unresolved and private payload references never become links', () => {
	for (const href of [
		'javascript:alert(1)',
		'data:text/html,x',
		'//evil.test',
		'/\\evil.test',
		'https://user:secret@example.com',
		'https://example.com/\nsecret'
	])
		assert.equal(safeLopuHref(href), null);
	assert.deepEqual(lopuResultLinks({ page: { id: null }, refs: { missing: null }, crystal: { arbitrary: { id: 'not-a-reference' } } }), []);
	assert.deepEqual(normalizeLopuLinks([{ href: 'javascript:x', label: 'Open' }]), []);
	assert.equal(lopuResultLinks({ things: Array.from({ length: 150 }, (_, i) => ({ id: `thing-${i}` })) }).length, 100);
	const cycle: any = {};
	cycle.related = [cycle];
	assert.deepEqual(lopuResultLinks(cycle), []);
});

test('reminder lists link their public Things, related Things and destination conversations', () => {
	assert.deepEqual(
		lopuResultLinks([{ id: 'private-control', thingId: 'task', relatedThingIds: ['reference'], chatId: 'conversation' }]).map((link) => link.href),
		['/thing/reference', '/lopu/conversation', '/thing/task']
	);
	assert.deepEqual(
		lopuResultLinks({ relatedThings: [{ id: 'reference', title: 'Related' }] }).map((link) => link.href),
		['/thing/reference']
	);
	assert.deepEqual(
		lopuResultLinks({ pageIds: { home: 'page' }, componentIds: { card: 'component' } }).map((link) => link.href),
		['/builder?page=page', '/components/component']
	);
});
