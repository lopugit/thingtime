import { ensureFoundPostBrowserIdentity, FOUND_POST_BROWSER_KEY } from '../../../hooks/foundPostIdentity.client';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFoundPostStore, foundPostDigest, foundPostGrantMatches, foundPostId, foundPostReceiptMatches, foundPostViewerId } from './foundPosts';
import { canView, canViewInherited, sanitizeShareId } from './things';
import { withFoundPostBrowser, foundPostVisitIp } from './foundPostRequest';
import { isProtectedThingtime } from '~/schemas/registry';

const post: any = {
	shareId: 'secret-post',
	ownerId: 'author',
	thingtime: ['post'],
	acl: ['tt:hidden'],
	linkKey: 'synthetic-current-key',
	crystal: {}
};
const account: any = { id: 'reader', linkKeys: new Set([post.linkKey]) };
const receipt = (id = 'reader', key = post.linkKey): any => ({
	shareId: foundPostId(id, post.shareId),
	ownerId: id,
	targetId: post.shareId,
	thingtime: ['post-discovery'],
	acl: ['tt:user'],
	crystal: { authorId: 'author', linkKeyDigest: foundPostDigest(key) }
});

function storage() {
	const rows: any[] = [];
	let writes = 0;
	const collection: any = {
		findOne: async ({ shareId }: any) => rows.find((row) => row.shareId === shareId) || null,
		updateOne: async (query: any, update: any) => {
			writes++;
			let row = rows.find((row) => row.shareId === query.shareId);
			if (!row) {
				row = { ...update.$setOnInsert };
				rows.push(row);
			}
			Object.assign(row, update.$set);
		},
		find: (query: any) => ({
			toArray: async () =>
				rows.filter(
					(row) =>
						row.ownerId === query.ownerId &&
						row.thingtime.includes(query.thingtime) &&
						(!query['crystal.authorId'] || row.crystal.authorId === query['crystal.authorId']) &&
						(!query.shareId || query.shareId.$in.includes(row.shareId)) &&
						(!query.acl || row.acl.includes(query.acl))
				)
		})
	};
	return { rows, store: createFoundPostStore(async () => collection), writes: () => writes };
}

test('only valid-key visits create one protected relationship; repeated reads do not grow or rewrite it', async () => {
	const { store, rows, writes } = storage();
	for (const viewer of [
		null,
		{ id: 'reader' },
		{ ...account, pat: { jti: 'token' } },
		{ ...account, id: 'author' },
		{ ...account, linkKeys: new Set(['wrong']) }
	])
		await store.rememberFoundPost(viewer, post);
	assert.equal(writes(), 0);
	await store.rememberFoundPost(account, post, '192.0.2.7');
	await store.rememberFoundPost(account, post, '192.0.2.8');
	assert.equal(writes(), 1);
	assert.equal(rows[0].targetId, post.shareId);
	assert.equal(rows[0].crystal.ipAddress, '192.0.2.7');
	assert.equal(JSON.stringify(rows).includes(post.linkKey), false);
	assert.equal(canView(rows[0], account), false);
	assert.equal(isProtectedThingtime(['post-discovery']), true);
	assert.deepEqual(sanitizeShareId(rows[0].shareId), { ok: false, status: 400, error: 'shareId uses a reserved prefix' });
});

test('profile candidates batch revalidate rotation, ACL removal, author changes and deletion', async () => {
	const { store, rows } = storage();
	rows.push(receipt(), { ...post });
	assert.deepEqual([...(await store.loadFoundPostsForAuthor('reader', 'author'))], [[post.shareId, foundPostDigest(post.linkKey)]]);
	assert.equal((await store.loadFoundPostsForAuthor('someone-else', 'author')).size, 0);
	rows[1].linkKey = 'rotated';
	assert.equal((await store.loadFoundPostsForAuthor('reader', 'author')).size, 0);
	await store.rememberFoundPost({ ...account, linkKeys: new Set(['rotated']) }, rows[1]);
	assert.equal((await store.loadFoundPostsForAuthor('reader', 'author')).size, 1);
	rows[1].acl = ['tt:user'];
	assert.equal((await store.loadFoundPostsForAuthor('reader', 'author')).size, 0);
	rows.splice(1, 1);
	assert.equal((await store.loadFoundPostsForAuthor('reader', 'author')).size, 0);
});

test('receipts cannot be replayed across viewers, targets, kinds or key generations', () => {
	assert.equal(foundPostReceiptMatches(receipt(), post, 'reader'), true);
	for (const bad of [
		{ ...receipt(), ownerId: 'other' },
		{ ...receipt(), targetId: 'other' },
		{ ...receipt(), thingtime: ['save'] },
		receipt('other'),
		receipt('reader', 'retired')
	])
		assert.equal(foundPostReceiptMatches(bad, post, 'reader'), false);
	assert.equal(foundPostGrantMatches({ ...post, thingtime: ['data'] }, foundPostDigest(post.linkKey)), false);
});

test('collected media inherits current post access but cannot bypass moderation or token fences', async () => {
	const media: any = { shareId: 'video', ownerId: 'author', targetId: post.shareId, thingtime: ['attachment'], acl: ['tt:inherit'], crystal: {} };
	const rows = [post, receipt()];
	const lookup = async (id: string) => rows.find((row) => row.shareId === id) || null;
	assert.equal(await canViewInherited(media, { id: 'reader' }, lookup), true);
	assert.equal(await canViewInherited(media, null, lookup), false);
	assert.equal(await canViewInherited(media, { id: 'other' }, lookup), false);
	assert.equal(
		await canViewInherited(media, { id: 'reader', pat: { tokenId: 'token', onlyCreatedThings: false, visibility: 'all' } }, lookup),
		false
	);
	rows[0] = { ...post, linkKey: 'rotated' };
	assert.equal(await canViewInherited(media, { id: 'reader' }, lookup), false);
	rows[0] = { ...post, acl: ['tt:user'] };
	assert.equal(await canViewInherited(media, { id: 'reader' }, lookup), false);
});

test('anonymous browser identity is secret-backed and cannot replace an account or a scoped token', async () => {
	const request = new Request('https://thingtime.com/api/v1/things', {
		headers: { Cookie: `__Host-tt_found_browser=${'a'.repeat(64)}`, 'x-vercel-forwarded-for': '192.0.2.7' }
	});
	const anonymous = withFoundPostBrowser(null, request)!;
	assert.equal(anonymous.id, '');
	assert.match(anonymous.anonymousId!, /^anonymous-[a-f0-9]{64}$/);
	assert.equal(withFoundPostBrowser(account, request), account);
	assert.equal(withFoundPostBrowser(null, request, false), null);
	assert.equal(withFoundPostBrowser(null, new Request(request.url, { headers: { Cookie: '__Host-tt_found_browser=guessable' } })), null);
	assert.equal(
		withFoundPostBrowser(
			null,
			new Request(request.url, { headers: { Authorization: 'Bearer invalid', Cookie: `__Host-tt_found_browser=${'a'.repeat(64)}` } })
		),
		null
	);
	assert.equal(foundPostVisitIp(request), '192.0.2.7');
	assert.equal(foundPostVisitIp(new Request(request.url)), undefined);
	const { store, rows } = storage();
	await store.rememberFoundPost({ ...anonymous, linkKeys: new Set([post.linkKey]) }, post, '192.0.2.7');
	assert.equal(rows[0].crystal.anonymousId, anonymous.anonymousId);
	assert.equal(foundPostReceiptMatches(rows[0], post, foundPostViewerId(anonymous)!), true);
	assert.equal(canView(post, { ...anonymous, foundPosts: new Map([[post.shareId, foundPostDigest(post.linkKey)]]) }), true);
	assert.equal(canView(post, null), false);
});


test('browser collection proof survives reloads and uses a secure host-only cookie', () => {
 const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
 const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
 const saved = new Map<string, string>();
 const doc = { cookie: '' };
 try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) }, crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  ensureFoundPostBrowserIdentity();
  const original = saved.get(FOUND_POST_BROWSER_KEY)!;
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.match(doc.cookie, /^__Host-tt_found_browser=/);
  assert.match(doc.cookie, /; Secure$/);
  assert.match(doc.cookie, /; Path=\/;/);
  assert.equal(doc.cookie.includes('Domain='), false);
  doc.cookie = '';
  ensureFoundPostBrowserIdentity();
  assert.equal(saved.get(FOUND_POST_BROWSER_KEY), original);
  assert.ok(doc.cookie.includes(original));
 } finally {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
 }
});
