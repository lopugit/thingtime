import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commanderEnterSuggestionIndex,
	commanderSearchResults,
	thingDetailPath
} from '../Search/commanderSearch.ts';

const author = {
	id: 'user-1',
	username: 'lopu',
	displayName: 'Lopu',
	avatarUrl: null
};

test('Commander search combines broad Thing, post, and person results with contextual links', () => {
	const rows = commanderSearchResults({
		things: [
			{
				id: 'post/one',
				thingtime: ['post'],
				author,
				visibility: 'public',
				acl: ['tt:all'],
				targetId: null,
				crystal: { text: 'Post crystal fallback' },
				tags: ['todo', 'work'],
				createdAt: '2026-08-27T00:00:00.000Z',
				updatedAt: '2026-08-27T00:00:00.000Z'
			},
			{
				id: 'data one',
				thingtime: ['data'],
				author,
				visibility: 'private',
				acl: ['tt:user'],
				targetId: null,
				crystal: { name: 'Morning checklist' },
				tags: [],
				createdAt: '2026-08-27T00:00:00.000Z',
				updatedAt: '2026-08-27T00:00:00.000Z'
			}
		],
		posts: {
			'post/one': { text: 'Rendered post result' } as any
		},
		people: [
			{
				id: 'user-2',
				username: 'vintage.vera',
				displayName: 'Vera',
				bio: 'Makes useful schemas',
				avatarUrl: null
			}
		]
	});

	assert.deepEqual(
		rows.map(({ resultType, title, context, href }) => ({ resultType, title, context, href })),
		[
			{
				resultType: 'thing',
				title: 'Rendered post result',
				context: 'post · @lopu · #todo #work',
				href: '/post/post%2Fone'
			},
			{
				resultType: 'thing',
				title: 'Morning checklist',
				context: 'data · @lopu',
				href: '/thing/data%20one'
			},
			{
				resultType: 'person',
				title: 'Vera',
				context: '@vintage.vera · Makes useful schemas',
				href: '/profile/vintage.vera'
			}
		]
	);
	assert.deepEqual(
		rows.map(({ icon, avatarUrl }) => ({ icon, avatarUrl })),
		[
			{ icon: '📝', avatarUrl: null },
			{ icon: '📦', avatarUrl: null },
			{ icon: '👤', avatarUrl: null }
		]
	);
});

test('Commander ranks exact and prefix people ahead of matching Thing text', () => {
	const baseThing = {
		thingtime: ['chat-message'],
		author,
		visibility: 'private',
		acl: ['tt:user'],
		targetId: null,
		tags: [],
		createdAt: '2026-09-01T00:00:00.000Z',
		updatedAt: '2026-09-01T00:00:00.000Z'
	};
	const rows = commanderSearchResults({
		query: '@lopu',
		things: [
			...Array.from({ length: 8 }, (_, index) => ({
				...baseThing,
				id: `chat-${index}`,
				crystal: { text: `A chat message mentioning @lopu (${index})` }
			}))
		],
		people: [
			{ id: 'prefix-user', username: 'lopu-test', displayName: 'Lopu test', bio: null, avatarUrl: null },
			{ id: 'exact-user', username: 'lopu', displayName: 'Nik', bio: null, avatarUrl: null },
			{ id: 'display-prefix-user', username: 'nik', displayName: 'The Lopu group', bio: null, avatarUrl: null }
		]
	});

	assert.deepEqual(
		rows.map((row) => row.id),
		['exact-user', 'prefix-user', 'display-prefix-user', 'chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4', 'chat-5', 'chat-6', 'chat-7']
	);
});

test('Commander ranks person intent tiers ahead of an exact Thing title', () => {
	const baseThing = {
		thingtime: ['data'],
		author,
		visibility: 'private',
		acl: ['tt:user'],
		targetId: null,
		tags: [],
		createdAt: '2026-09-01T00:00:00.000Z',
		updatedAt: '2026-09-01T00:00:00.000Z'
	};
	const rows = commanderSearchResults({
		query: 'lopu',
		things: [
			{ ...baseThing, id: 'generic-text', crystal: { text: 'Notes from @lopu' } },
			{ ...baseThing, id: 'exact-title', crystal: { name: 'Lopu' } }
		],
		people: [
			{ id: 'prefix-user', username: 'lopu-test', displayName: 'Lopu test', bio: null, avatarUrl: null },
			{ id: 'display-prefix-user', username: 'nik', displayName: 'The Lopu group', bio: null, avatarUrl: null }
		]
	});

	assert.deepEqual(rows.map((row) => row.id), ['prefix-user', 'display-prefix-user', 'exact-title', 'generic-text']);
});

test('Thing detail paths are canonical and URL-safe', () => {
	assert.equal(thingDetailPath('hello/world ?'), '/thing/hello%2Fworld%20%3F');
});

test('Commander Enter defaults unselected text to the pinned full-search row', () => {
	assert.equal(
		commanderEnterSuggestionIndex({
			hoveredSuggestion: null,
			showSuggestions: true,
			commandIsAction: false,
			inputValue: 'bathroom window shelf'
		}),
		0
	);
	assert.equal(
		commanderEnterSuggestionIndex({
			hoveredSuggestion: 3,
			showSuggestions: true,
			commandIsAction: false,
			inputValue: 'bathroom window shelf'
		}),
		3
	);
});

test('Commander Enter preserves explicit setters and hidden/empty suggestion states', () => {
	assert.equal(
		commanderEnterSuggestionIndex({
			hoveredSuggestion: null,
			showSuggestions: true,
			commandIsAction: true,
			inputValue: 'settings.theme = dark'
		}),
		null
	);
	assert.equal(
		commanderEnterSuggestionIndex({
			hoveredSuggestion: null,
			showSuggestions: false,
			commandIsAction: false,
			inputValue: 'hidden search'
		}),
		null
	);
	assert.equal(
		commanderEnterSuggestionIndex({
			hoveredSuggestion: null,
			showSuggestions: true,
			commandIsAction: false,
			inputValue: '   '
		}),
		null
	);
});

test('Commander result limits bound the suggestion surface', () => {
	const baseThing = {
		thingtime: ['schema'],
		author,
		visibility: 'public',
		acl: ['tt:all'],
		targetId: null,
		crystal: {},
		tags: [],
		createdAt: '2026-08-27T00:00:00.000Z',
		updatedAt: '2026-08-27T00:00:00.000Z'
	};
	const rows = commanderSearchResults({
		things: Array.from({ length: 8 }, (_, index) => ({ ...baseThing, id: `thing-${index}` })),
		people: Array.from({ length: 5 }, (_, index) => ({
			id: `person-${index}`,
			username: `person${index}`,
			displayName: null,
			bio: null,
			avatarUrl: null
		})),
		thingLimit: 2,
		peopleLimit: 1
	});

	assert.equal(rows.length, 3);
	assert.deepEqual(
		rows.map((row) => row.id),
		['thing-0', 'thing-1', 'person-0']
	);
});
