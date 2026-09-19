import { thingEntityLink } from '../Thingtime/ContextMenu/thingEntityLink';
import assert from 'node:assert/strict';
import test from 'node:test';

import { aclForAudience, audienceOfAcl, sharePathForThing, audienceDescription } from './audienceCore';

test('quick audiences use the shared ACL grammar without dropping app grants', () => {
	assert.deepEqual(aclForAudience('public', ['tt:user', 'tt:hidden', 'tt:user/ada/write', 'tt:app/weather']), ['tt:all', 'tt:app/weather']);
	assert.deepEqual(aclForAudience('hidden', ['tt:all']), ['tt:hidden', 'tt:user']);
	assert.deepEqual(aclForAudience('custom'), ['tt:custom', 'tt:user']);
});

test('custom wins over its public or hidden baseline when deriving the audience', () => {
	assert.equal(audienceOfAcl(['tt:custom', 'tt:user', 'tt:all', 'tt:user/ada/write']), 'custom');
	assert.equal(audienceOfAcl(['tt:custom', 'tt:user', 'tt:hidden']), 'custom');
	assert.equal(audienceOfAcl(['tt:hidden', 'tt:user']), 'hidden');
	assert.equal(audienceOfAcl(['-tt:all', 'tt:userFriends', 'tt:user']), 'friends');
});

test('secret links use key-aware readers for every Thing kind', () => {
	const hidden = { acl: ['tt:hidden', 'tt:user'], linkKey: 'secret key' };
	assert.equal(sharePathForThing({ id: 'post-1', thingtime: ['post'], ...hidden }), '/post/post-1?key=secret%20key');
	assert.equal(sharePathForThing({ id: 'page-1', thingtime: ['webpage'], ...hidden }), '/p/page-1?key=secret%20key');
	assert.equal(sharePathForThing({ id: 'schema-1', thingtime: ['schema'], ...hidden }), '/thing/schema-1?key=secret%20key');
	assert.equal(sharePathForThing({ id: 'folder-1', thingtime: ['folder'], ...hidden }), '/thing/folder-1?key=secret%20key');
	assert.equal(sharePathForThing({ id: 'page-1', thingtime: ['webpage'], acl: ['tt:all'] }), '/p/page-1');
});

test('attachment and comment permalinks retain the inherited hidden key', () => {
  const audience = { sourceId: 'root', acl: ['tt:hidden', 'tt:user'], linkKey: 'secret key' };
  assert.equal(sharePathForThing({ id: 'media', thingtime: ['attachment'], acl: ['tt:inherit'], audience }), '/media/media?key=secret%20key');
  assert.equal(sharePathForThing({ id: 'comment', thingtime: ['comment'], acl: ['tt:inherit'], audience }), '/post/comment?key=secret%20key');
  assert.equal(sharePathForThing({ id: 'media', thingtime: ['attachment'], audience: { ...audience, acl: ['tt:group/family'], linkKey: undefined } }), '/media/media');
});

test('muted audience wording explains people, groups, and mixed link access', () => {
  assert.equal(audienceDescription(['tt:hidden', 'tt:user']), 'only people with the link');
  assert.equal(audienceDescription(['tt:custom', 'tt:user/bob/comment', 'tt:group/family', 'tt:hidden']), 'only @bob, members of the selected group, people with the link can see this post');
  assert.equal(audienceDescription(['tt:user/write']), 'only @write can see this post');
  assert.equal(audienceDescription(['tt:all'], 'media'), 'anyone can see this media');
  assert.match(audienceDescription(['tt:all', '-tt:user/bob']), /exclusions apply/);
});

test('copy-link menus preserve owner, inherited and already-presented guest keys', () => {
  const origin = 'https://thingtime.test';
  assert.equal(thingEntityLink('/media/child', origin, {audience:{linkKey:'root-secret'}}).searchParams.get('key'), 'root-secret');
  assert.equal(thingEntityLink('/media/child?key=held&sharedRoot=root', origin, undefined).searchParams.get('key'), 'held');
  assert.equal(thingEntityLink('/post/root', origin, {author:{id:'owner'},linkKey:'secret'}, 'owner').searchParams.get('key'), 'secret');
  assert.equal(thingEntityLink('/post/root', origin, {author:{id:'owner'},linkKey:'secret'}, 'other').searchParams.has('key'), false);
});

test('inherited private and friends wording refers to the parent rather than the child author', () => {
  assert.equal(audienceDescription(['tt:user'], 'media', true), 'only the parent’s owner can see this media');
  assert.equal(audienceDescription(['tt:userFriends'], 'post', true), 'only the parent’s friends circle can see this post');
});
