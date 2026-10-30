import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticRoutePreview, DEFAULT_ROUTE_PAGE_TITLE, type AutomaticRouteEntry } from './automaticRoutePreview';
import { pageTitle } from './pageTitle';

test('all real explicit routes receive defaults while unknown paths and secrets stay generic', () => {
	for (const path of ['/mail', '/apps/manage', '/settings/security', '/docs/api/content/example', '/agent-browsers/task-id']) {
		const preview = automaticRoutePreview(path);
		assert.ok(preview, path);
		assert.ok(preview.routeTitle.startsWith('Thingtime'));
		assert.ok(preview.variant);
	}
	const one = automaticRoutePreview('/profile/private-one?token=secret#fragment');
	const two = automaticRoutePreview('/profile/private-two');
	assert.deepEqual(one, two);
	assert.doesNotMatch(JSON.stringify(one), /private-one|private-two|secret|fragment/);
	for (const path of ['/unknown/private-secret', '/profile-secret', '//elsewhere.invalid/', '/profile\\evil', '/marketing/unknown/deep'])
		assert.equal(automaticRoutePreview(path), null);
	assert.equal(pageTitle('/profile-secret'), DEFAULT_ROUTE_PAGE_TITLE);
	assert.equal(automaticRoutePreview('/p/private-id')?.title, 'A page on Thingtime');
	assert.equal(automaticRoutePreview('/t/private-id')?.title, 'A page on Thingtime');
	assert.equal(automaticRoutePreview('/thing/private-id')?.title, 'A thing on Thingtime');
	assert.equal(pageTitle('/p/private-id'), 'Thingtime - Page');
	assert.equal(automaticRoutePreview('/docs/api/private-group/private-id')?.routeTitle, 'Thingtime - Docs API');
	assert.equal(pageTitle('/thing/private-id'), 'Thingtime - Thing');
	assert.equal(pageTitle('/invite#private'), 'Thingtime - Invitation');
	assert.equal(pageTitle('/branding', '[LC]'), '[LC] Thingtime - Brand resources');
	assert.equal(pageTitle('/connections/feed'), 'Thingtime - Connections');
	assert.equal(pageTitle('/', '[LC]'), `[LC] ${DEFAULT_ROUTE_PAGE_TITLE}`);
});

test('matching handles literal precedence, optional parameters, encoded paths and wildcard refusal', () => {
	const routes: AutomaticRouteEntry[] = [
		{ pattern: '/new/:secret?', label: 'New', preview: {} },
		{ pattern: '/new/special', label: 'Special', preview: { title: 'Custom share headline' } },
		{ pattern: '/all/*', label: 'All', preview: {} }
	];
	assert.equal(automaticRoutePreview('/new', routes)?.variant, 'webpage');
	assert.deepEqual(automaticRoutePreview('/new/token', routes), automaticRoutePreview('/new', routes));
	assert.equal(automaticRoutePreview('/new/special', routes)?.title, 'Custom share headline');
	assert.equal(automaticRoutePreview('/new/%73pecial', routes)?.routeTitle, 'Thingtime - Special');
	assert.equal(automaticRoutePreview('/new/%2Fsecret', routes), null);
	assert.equal(automaticRoutePreview('/new/%E0%A4%A', routes), null);
	assert.equal(automaticRoutePreview('/all/a', routes), null);
	assert.equal(automaticRoutePreview('/new/private/deep', routes), null);
});
