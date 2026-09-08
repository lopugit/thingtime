import assert from 'node:assert/strict';
import test from 'node:test';

import { aclForAudience, audienceOfAcl, sharePathForThing } from './audienceCore';

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
