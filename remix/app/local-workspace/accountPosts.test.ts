import { createQuotaFactory } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase } from './storage';
import { AccountPostCache, accountPostProjection, accountPostAudienceContext, overlayAccountPost } from './accountPosts';
import { AccountThingSync } from './accountSync';
import { localPostProjection } from './posts';
import { thingAudienceDisplay } from '../components/Sharing/audienceCore';
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
test('owned content preserves matching retained subspace display context without borrowing a different destination', async () => {
  const factory = new IDBFactory(), db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
  const cache = new AccountPostCache(db, scope, lease);
  const subspace = { id: 'private-space', slug: 'private', name: 'Private', access: 'private', viewerRole: 'member' };
  try {
    await cache.remember([{ ...post(), acl: ['tt:all'], subspace }]);
    const retained = await new AccountPostCache(db, scope, lease).get('post');
    const context = accountPostAudienceContext({ subspaceId: 'private-space' }, retained);
    assert.deepEqual(context.subspace, subspace);
    assert.equal(thingAudienceDisplay({ ...post(), acl: ['tt:all'], ...context }).description, 'private subspace members only');
    const changedDestination = accountPostAudienceContext({ subspaceId: 'another-space' }, retained);
    assert.equal(changedDestination.subspace, null);
    assert.equal(thingAudienceDisplay({ ...post(), acl: ['tt:all'], ...changedDestination }).description, 'subspace access details unavailable on this device');
    assert.equal(accountPostAudienceContext({ subspaceId: 'private-space' }).subspaceContextMissing, true);
    assert.equal(accountPostAudienceContext({}, retained).subspace, null);
  } finally { await db.close(); }
});
test('retained post snapshots exclude credentials and never acquire ownership or sync state', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange),
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
	const factory = createQuotaFactory({ bytes: 1024 * 1024 });
	const db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange),
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
		factory.capacity.bytes = 4 * 1024 * 1024;
		await cache.remember([{ ...post('huge'), text: 'x'.repeat(2 * 1024 * 1024) }]);
		assert.equal((await cache.get('huge'))?.text, 'x'.repeat(2 * 1024 * 1024));
		await cache.forget('post');
		assert.equal(await cache.get('post'), null);
	} finally {
		await db.close();
	}
});
test('Saved uses only local membership, bookmarks order, scoped pagination and preserved authors', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange),
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
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange),
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


test('canonical comment-only projections retain their exact kind and target without becoming generic posts', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), cache = new AccountPostCache(db, scope, lease);
 try {
  const comment = { ...post('comment'), thingtime: ['comment'], targetId: 'data-parent' };
  await cache.remember([comment],10);
  assert.deepEqual((await cache.get('comment'))?.thingtime,['comment']);
  assert.equal((await cache.get('comment') as any).targetId,'data-parent');
  await cache.forget('data-parent',20); assert.equal(await cache.get('comment'),null);
  await cache.remember([{...comment,id:'late'}],19); assert.equal(await cache.get('late'),null);
 } finally { await db.close(); }
});

test('late feed refusals fence captured roots and nested reads while preserving pending authored work', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), cache = new AccountPostCache(db, scope, lease);
 const sync = new AccountThingSync(db, scope, lease);
 try {
  await cache.remember([post('target'), { ...post('container'), comments: [post('target')], shareOf: post('target'),
   linkedThings: [{ id: 'target', mode: 'data', thing: { id: 'target', thingtime: ['data'], crystal: { text: 'Private' } } }] }], 10);
  const captured = await cache.snapshot();
  await cache.forget('target', 20);
  const fenced = await cache.fenceRead(captured, 15);
  assert.deepEqual(fenced.map(row => row.id), ['container']);
  assert.deepEqual(fenced[0].comments, []); assert.equal(fenced[0].shareOf, null); assert.equal(fenced[0].linkedThings?.[0].thing, null);
  assert.equal(captured.find(row => row.id === 'container')!.comments.length, 1, 'fencing does not mutate another pending read');
  await cache.remember([post('target')], 30);
  assert.deepEqual(await cache.fenceRead([accountPostProjection(post('target'))], 15), [], 'later restored access cannot authorize a captured older read');
  assert.equal((await cache.fenceRead(await cache.snapshot(), 31)).some(row => row.id === 'target'), true);
  const own = await sync.things.savePost({ shareId: 'authored', thingtime: ['post'], crystal: { type: 'text', text: 'Authored offline' } });
  await cache.remember([{ ...post(own.id), author: { ...post().author, id: scope.ownerId } }], 35);
  await cache.forget(own.id, 40);
  const authored = { ...accountPostProjection(post(own.id)), author: { ...post().author, id: scope.ownerId }, localWorkspace: true };
  assert.equal((await cache.fenceRead([authored], 36)).length, 1);
  const displayOnly: typeof authored = { ...authored, localWorkspace: false };
  assert.deepEqual(await cache.fenceRead([displayOnly], 36), [], 'cached display data alone cannot assert local authorship');
  await sync.remove([own.id]);
  assert.deepEqual(await cache.fenceRead([authored], 36), [], 'authored deletion is not retained work');
 } finally { await db.close(); }
});

for (const synced of [false, true]) test(`a captured ${synced ? 'synced' : 'pending'} owned-only feed post cannot return after deletion without a read-cache watermark`, async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), cache = new AccountPostCache(db, scope, lease);
 const sync = new AccountThingSync(db, scope, lease);
 try {
  const row = synced
   ? await sync.remember({ id: 'synced-owned', thingtime: ['post'], crystal: { type: 'text', text: 'Owned before deletion' },
    createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', revision: 1,
    author: { id: scope.ownerId }, acl: ['tt:user'], visibility: 'private' })
   : await sync.things.savePost({ shareId: 'pending-owned', thingtime: ['post'], crystal: { type: 'text', text: 'Owned before deletion' } });
  assert.ok(row);
  const startedAt = Date.now();
  const captured = { ...localPostProjection(row, [row], scope.ownerId), localOnly: false, localWorkspace: true };
  assert.equal((await cache.fenceRead([captured], startedAt)).length, 1, 'live authored content stays readable');
  assert.deepEqual(await cache.snapshot(), [], 'this post has never had a retained server projection');
  await sync.remove([row.id]);
  assert.equal(await sync.view(row.id), null);
  assert.equal(await db.transaction(scope, 'readonly', lease, tx => tx.get('account-post-projections', row.id)), undefined,
   'deletion without cached references needs no read-cache watermark');
  assert.deepEqual(await cache.fenceRead([captured], startedAt), [], 'filtering/ranking must not resurrect a deleted captured root');
 } finally { await db.close(); }
});
