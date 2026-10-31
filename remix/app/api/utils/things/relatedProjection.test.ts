import assert from 'node:assert/strict';
import test from 'node:test';

import { canView, withThingLink, canViewInherited, resolvePublicAudiences, layeredPostCommentCounts, RELATED_CHILD_PROJECTION, viewerOf, visibleRelatedModerationClause, type ThingDoc } from './things.ts';

test('related child projection preserves rich comment media layouts', () => {
  assert.equal(RELATED_CHILD_PROJECTION['crystal.mediaLayout'], 1);
  assert.equal(RELATED_CHILD_PROJECTION['crystal.richText'], 1);
});

test('related projections keep a pending comment visible to its owner', () => {
	assert.deepEqual(visibleRelatedModerationClause('owner-1'), {
		$or: [
			{ 'moderation.status': { $nin: ['blocked', 'pending'] } },
			{ ownerId: 'owner-1', 'moderation.status': 'pending' }
		]
	});
});

test('related projections hide pending comments from anonymous viewers', () => {
	assert.deepEqual(visibleRelatedModerationClause(null), {
		'moderation.status': { $nin: ['blocked', 'pending'] }
	});
});

test('post comment count layers separate direct comments, replies, and loaded rows', () => {
	assert.deepEqual(layeredPostCommentCounts(3, 8, 2), {
		direct: 3,
		replies: 5,
		total: 8,
		loaded: 2
	});
});

test('post comment count layers never report a negative reply count', () => {
	assert.equal(layeredPostCommentCounts(2, 1, 1).replies, 0);
});

test('an owner can recover an orphaned attachment permalink, but nobody else can', async () => {
	const attachment = {
		shareId: 'att-orphaned-image',
		ownerId: 'owner-1',
		thingtime: ['attachment'],
		acl: ['tt:inherit'],
		targetId: 'deleted-post',
		crystal: { name: 'recoverable.png', contentType: 'image/png', size: 1, mediaKind: 'image' },
		createdAt: new Date(),
		updatedAt: new Date()
	} as ThingDoc;
	const missingTarget = async () => null;

	assert.equal(await canViewInherited(attachment, viewerOf({ id: 'owner-1', username: 'owner' }), missingTarget), true);
	assert.equal(await canViewInherited(attachment, viewerOf({ id: 'other-1', username: 'other' }), missingTarget), false);
	assert.equal(
		await canViewInherited(attachment, viewerOf({ id: 'owner-1', username: 'owner' }, { jti: 'pat-1', visibility: 'private' }), missingTarget),
		false
	);
});

const inheritanceFixture = (acl: string[]) => {
  const root = { shareId: 'root', ownerId: 'author', thingtime: ['post'], acl, linkKey: 'parent-secret' } as ThingDoc;
  const comment = { shareId: 'comment', ownerId: 'commenter', thingtime: ['post', 'comment'], acl: ['tt:inherit'], targetId: 'root' } as ThingDoc;
  const media = { shareId: 'media', ownerId: 'commenter', thingtime: ['attachment'], acl: ['tt:inherit'], targetId: 'comment' } as ThingDoc;
  const reply = { shareId: 'reply', ownerId: 'reply-author', thingtime: ['post', 'comment'], acl: ['tt:inherit'], targetId: 'media' } as ThingDoc;
  const nestedMedia = { ...media, shareId: 'nested-media', targetId: 'reply', ownerId: 'reply-author' };
  const docs = [root, comment, media, reply, nestedMedia];
  return { root, comment, docs, lookup: async (id: string) => docs.find(doc => doc.shareId === id) || null };
};

test('nested comments and media follow the same hidden key and mixed audience as their root', async () => {
  const { docs, lookup } = inheritanceFixture(['tt:custom', 'tt:user', 'tt:hidden', 'tt:group/family', 'tt:user/friend']);
  for (const doc of docs.slice(1)) {
    assert.equal(await canViewInherited(doc, { id: null, linkKeys: new Set(['parent-secret']) } as any, lookup), true);
    assert.equal(await canViewInherited(doc, { id: 'member', groupIds: new Set(['family']) } as any, lookup), true);
    assert.equal(await canViewInherited(doc, { id: 'direct', username: 'friend' } as any, lookup), true);
    assert.equal(await canViewInherited(doc, null, lookup), false);
    assert.equal(await canViewInherited(doc, { id: null, linkKeys: new Set(['wrong']) } as any, lookup), false);
  }
});

test('inherited projection retains the exact root ACL and exposes only an already-held key', async () => {
  const { docs, root, lookup } = inheritanceFixture(['tt:custom', 'tt:user', 'tt:hidden', 'tt:group/family', '-tt:user/blocked']);
  for (const viewer of [{ id: 'author' }, { id: null, linkKeys: new Set(['parent-secret']) }]) {
    const projected = await resolvePublicAudiences(docs, viewer as any, lookup);
    for (const doc of docs) assert.deepEqual(projected.get(doc.shareId), { sourceId: 'root', acl: root.acl, linkKey: 'parent-secret' });
  }
  for (const viewer of [{ id: 'commenter' }, { id: 'member', groupIds: new Set(['family']) }, null]) {
    const projected = await resolvePublicAudiences(docs, viewer as any, lookup);
    assert.equal(projected.get('nested-media')?.linkKey, undefined);
  }
  root.acl = ['tt:group/family'];
  const projected = await resolvePublicAudiences(docs, { id: 'author' } as any, lookup);
  assert.deepEqual(projected.get('nested-media'), { sourceId: 'root', acl: root.acl });
  assert.equal(await canViewInherited(docs[4], { id: null, linkKeys: new Set(['parent-secret']) } as any, lookup), false);
});

test('an intervening blocked or pending comment also hides its media descendants', async () => {
  const { docs, comment, lookup } = inheritanceFixture(['tt:all']);
  (comment as any).moderation = { status: 'blocked' } as any;
  assert.equal(await canViewInherited(docs[4], null, lookup), false);
  (comment as any).moderation = { status: 'pending' } as any;
  assert.equal(await canViewInherited(docs[4], null, lookup), false);
  assert.equal(await canViewInherited(docs[4], { id: 'commenter' } as any, lookup), true);
});

test('cycles and deleted parents disclose no inherited audience or key', async () => {
  const { docs, comment, lookup } = inheritanceFixture(['tt:hidden']);
  comment.targetId = 'media';
  assert.equal(await canViewInherited(docs[4], null, lookup), false);
  const projected = await resolvePublicAudiences([docs[4]], { id: 'author' } as any, lookup);
  assert.deepEqual(projected.get('nested-media'), { sourceId: 'nested-media', acl: ['tt:user'] });
});


test('canonical links open unlisted roots and arbitrary inherited children for fresh anonymous viewers', async () => {
  const { root, docs, lookup } = inheritanceFixture(['tt:custom', 'tt:hidden', 'tt:user/invited']);
  for (const doc of docs) {
    const anonymous = withThingLink(null, doc.shareId);
    assert.equal(await canViewInherited(doc, anonymous, lookup), true, doc.shareId);
    assert.equal(canView({ ...root, shareId: 'unrelated' }, anonymous), false, 'an exact link never grants unrelated hidden Things');
  }
  assert.equal(canView(root, null), false, 'plain listing evaluation stays unlisted');
  assert.equal(await canViewInherited(root, withThingLink(null, 'unrelated'), lookup), false);
  root.acl = ['tt:custom', 'tt:group/family'];
  assert.equal(await canViewInherited(docs[4], withThingLink(null, docs[4].shareId), lookup), false, 'group-only remains restricted');
  assert.equal(await canViewInherited(docs[4], withThingLink({ id: 'member', groupIds: new Set(['family']) }, docs[4].shareId), lookup), true);
  root.acl = ['tt:user'];
  assert.equal(await canViewInherited(docs[4], withThingLink(null, docs[4].shareId), lookup), false, 'removing the link audience revokes old URLs');
});

test('canonical link grants cannot bypass token scopes, moderation, missing parents or cycles', async () => {
  const { root, docs, lookup } = inheritanceFixture(['tt:hidden']);
  const target = docs[4];
  const guest = withThingLink(null, target.shareId);
  assert.equal(await canViewInherited(target, withThingLink({ id: 'author', pat: { tokenId: 'test', onlyCreatedThings: false, visibility: 'public' } }, target.shareId), lookup), false);
  (docs[1] as any).moderation = { status: 'blocked' } as any;
  assert.equal(await canViewInherited(target, guest, lookup), false);
  (docs[1] as any).moderation = { status: 'pending' } as any;
  assert.equal(await canViewInherited(target, guest, lookup), false);
  delete (docs[1] as any).moderation;
  docs[1].targetId = 'missing';
  assert.equal(await canViewInherited(target, guest, lookup), false);
  docs[1].targetId = target.shareId;
  assert.equal(await canViewInherited(target, guest, lookup), false);
  assert.equal(canView({ ...root, thingtime: ['post-discovery'] }, withThingLink(null, root.shareId)), false);
});

test('a non-post Thing discussion and every reply inherit live visibility without a duplicate root', async () => {
  const { root, docs, lookup } = inheritanceFixture(['tt:user']);
  root.thingtime = ['data'];
  for (const doc of docs) assert.equal(await canViewInherited(doc, withThingLink(null, doc.shareId), lookup), false);
  root.acl = ['tt:all'];
  for (const doc of docs) assert.equal(await canViewInherited(doc, null, lookup), true);
  root.acl = ['tt:group/team'];
  for (const doc of docs) {
    assert.equal(await canViewInherited(doc, { id: 'member', groupIds: new Set(['team']) }, lookup), true);
    assert.equal(await canViewInherited(doc, { id: 'outsider' }, lookup), false);
  }
  root.acl = ['tt:user'];
  for (const doc of docs) assert.equal(await canViewInherited(doc, { id: 'member', groupIds: new Set(['team']) }, lookup), false);
});
