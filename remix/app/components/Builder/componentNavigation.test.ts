import assert from 'node:assert/strict';
import test from 'node:test';
import { componentPageHref, componentNavigationState, hasComponentBackEntry } from './componentNavigation';

test('copied-page links preserve Builder identity without rewriting unrelated destinations', () => {
	const builder = { pathname: '/builder', search: '?page=copy-1&view=customer' };
	assert.equal(componentPageHref('copy-1', builder, '?view=detail&id=record-1'), '/builder?view=detail&id=record-1&page=copy-1');
	assert.equal(componentPageHref('copy-1', builder, '/p/copy-1?view=customer'), '/builder?view=customer&page=copy-1');
	assert.equal(componentPageHref('copy-1', { ...builder, search: builder.search + '&mode=view' }, '?view=detail'), '/builder?view=detail&page=copy-1&mode=view');
	for (const href of ['https://other.example/a', '//other.example', '/\\other.example/a', '/p/another?view=detail', '/builder?page=other', '/api/v1/things']) {
		assert.equal(componentPageHref('copy-1', builder, href), href);
	}
	assert.equal(componentPageHref(null, builder, '?view=detail'), '?view=detail');
});

test('Back accepts only a same-page entry and exact current destination', () => {
	const overview = { pathname: '/p/app', search: '' };
	const detail = { pathname: '/p/app', search: '?view=detail&id=one' };
	const href = componentPageHref('app', overview, detail.search);
	const state = componentNavigationState('app', overview, href);
	assert.equal(hasComponentBackEntry('app', detail, state), true);
	assert.equal(hasComponentBackEntry('different', detail, state), false);
	assert.equal(hasComponentBackEntry('app', overview, state), false);
	assert.equal(hasComponentBackEntry('app', detail, null), false);
	assert.equal(componentNavigationState('app', overview, '/p/another?view=detail'), undefined);
	const builder = { pathname: '/builder', search: '?page=app&view=detail' };
	for (const from of ['/builder?page=other', '//outside.example/', '/p/app?view=list']) {
		assert.equal(hasComponentBackEntry('app', builder, { ttComponentNavigation: { pageId: 'app', from, to: '/builder?page=app&view=detail' } }), false);
	}
});
