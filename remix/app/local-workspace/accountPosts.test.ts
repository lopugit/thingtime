import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { AccountPostCache, accountPostProjection, overlayAccountPost } from './accountPosts';
const scope = { kind: 'account' as const, origin: 'https://example.test', ownerId: 'viewer', dataPlane: 'home' },
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const post = (id = 'post') => ({
	id,
	thingtime: ['post'],
	type: 'text',
	text: 'A retained post',
	author: { id: 'other', username: 'other', displayName: 'Other', avatarUrl: null },
	acl: ['tt:user'],
	visibility: 'private',
	createdAt: '2026-10-16T00:00:00Z',
	images: [],
	attachments: [],
	comments: [],
	shareOf: null,
	viewerSaved: false,
	viewerReactions: [],
	reactionCounts: { '❤️': 3 },
	tags: []
});
test('retained post snapshots exclude credentials and never acquire ownership or sync state', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		cache = new AccountPostCache(db, scope, lease);
	try {
		await cache.remember([
			{
				...post(),
				linkKey: 'secret',
				audience: { linkKey: 'secret' },
				ownerId: 'viewer',
				attachments: [
					{ id: 'file', name: 'card.png', size: 20, contentType: 'image/png', mediaKind: 'image', storageKey: 'secret', accessToken: 'secret' }
				],
				author: { ...post().author, email: 'private@example.test' },
				comments: [{ ...post('reply'), linkKey: 'nested' }],
				linkedThings: [
					{
						id: 'linked',
						mode: 'data',
						thing: { id: 'linked', thingtime: ['data'], crystal: { text: 'visible' }, linkKey: 'linked-secret', ownerId: 'viewer' }
					}
				]
			}
		]);
		const retained = await cache.get('post');
		assert.equal(JSON.stringify(retained).includes('secret'), false);
		assert.equal(JSON.stringify(retained).includes('private@example'), false);
		assert.equal(retained?.author?.id, 'other');
		assert.equal((retained as any).ownerId, undefined);
		assert.equal(retained?.linkedThings?.[0].mode, 'data');
		await db.transaction(scope, 'readonly', lease, async (tx) => {
			assert.deepEqual(await tx.list('things'), []);
			assert.deepEqual(await tx.list('thing-sync'), []);
		});
		assert.equal(await new AccountPostCache(db, { ...scope, ownerId: 'another' }, lease).get('post'), null);
		assert.equal(await new AccountPostCache(db, { ...scope, dataPlane: 'other' }, lease).get('post'), null);
		assert.throws(() => new AccountPostCache(db, { kind: 'anonymous' }, lease), /original workspace/);
	} finally {
		await db.close();
	}
});
test('bounded post pages are atomic and older reads cannot replace newer retained content', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		cache = new AccountPostCache(db, scope, lease);
	try {
		await cache.remember([post()], 20);
		await cache.remember([post()], 40);
		await cache.remember([{ ...post(), text: 'older' }], 30);
		assert.equal((await cache.get('post'))?.text, 'A retained post');
		await assert.rejects(cache.remember([post('new'), { ...post('bad'), createdAt: 'invalid' }]), /Invalid/);
		assert.equal(await cache.get('new'), null);
		await assert.rejects(cache.remember(Array(51).fill(post())), /Invalid/);
		await assert.rejects(cache.remember([{ ...post('huge'), text: 'x'.repeat(2 * 1024 * 1024) }]));
		assert.equal(await cache.get('huge'), null);
		await cache.forget('post');
		assert.equal(await cache.get('post'), null);
	} finally {
		await db.close();
	}
});
test('Saved uses only local membership, bookmarks order, scoped pagination and preserved authors', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		cache = new AccountPostCache(db, scope, lease);
	try {
		await cache.remember([post('first'), post('last'), post('unsaved')]);
		const states = ['first', 'last'].map((id, i) => ({
			id,
			revision: null,
			saved: true,
			savedAt: `2026-10-16T00:00:0${i}Z`,
			reactions: ['❤️'],
			reactionCounts: { '❤️': 4 }
		}));
		const first = await cache.saved(states, { limit: 1 });
		assert.equal(first.posts[0].id, 'last');
		assert.equal(first.posts[0].author?.id, 'other');
		assert.equal(first.posts[0].viewerSaved, true);
		assert.equal(first.posts[0].reactionCounts?.['❤️'], 4);
		assert.ok(first.nextCursor);
		const second = await cache.saved(states, { limit: 1, cursor: first.nextCursor! });
		assert.equal(second.posts[0].id, 'first');
		assert.equal(second.nextCursor, null);
		assert.deepEqual((await cache.saved(states.map((row) => ({ ...row, saved: false })))).posts, []);
		const other = new AccountPostCache(db, { ...scope, ownerId: 'other' }, lease);
		await assert.rejects(other.saved(states, { cursor: first.nextCursor! }), /workspace|filters/i);
	} finally {
		await db.close();
	}
});
test('projection and nested membership preserve content without transferring authority', () => {
	const p = accountPostProjection({ ...post(), comments: [post('child')], shareOf: post('source') });
	const states = new Map(['child', 'source'].map((id) => [id, { id, revision: null, saved: true, reactions: ['🙌'], reactionCounts: { '🙌': 1 } }]));
	const projected = overlayAccountPost(p, states);
	assert.deepEqual(projected.comments[0].viewerReactions, ['🙌']);
	assert.equal(projected.shareOf?.viewerSaved, true);
	assert.equal(projected.author?.id, 'other');
	assert.deepEqual(p.comments[0].viewerReactions, []);
});

test('known refusals prune all nested copies and fence older in-flight reads', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		cache = new AccountPostCache(db, scope, lease);
	try {
		const container = {
			...post('container'),
			comments: [post('target')],
			shareOf: post('target'),
			linkedThings: [{ id: 'target', mode: 'data', thing: { id: 'target', thingtime: ['data'], crystal: { text: 'visible' } } }]
		};
		await cache.remember([post('target'), container], 10);
		assert.equal(await cache.forget('target', 20), true);
		assert.equal(await cache.forget('target', 21), false);
		await cache.remember([post('target'), container], 15);
		assert.equal(await cache.get('target'), null);
		const retained = await cache.get('container');
		assert.deepEqual(retained?.comments, []);
		assert.equal(retained?.shareOf, null);
		assert.equal(retained?.linkedThings?.[0].thing, null);
		await cache.remember([post('target')], 30);
		assert.equal((await cache.get('target'))?.text, post().text, 'a fresh authorized read can retain the post again');
		await cache.remember([{ ...container, id: 'delayed' }], 18);
		assert.equal((await cache.get('delayed'))?.shareOf, null, 'later permission restoration cannot authorize an earlier in-flight nested read');
	} finally {
		await db.close();
	}
});
