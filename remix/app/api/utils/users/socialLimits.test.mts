import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let following = false;
let friend: any = null;
let notifications = 0;
let rows: any[] = [];
const collection = {
  countDocuments: async () => 10001,
  findOne: async () => friend,
  insertOne: async (doc: any) => { friend = { ...doc, _id: 'relationship' }; },
  find: () => {
    const cursor = { project: () => cursor, batchSize: () => cursor, toArray: async () => rows };
    return cursor;
  }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: { getHomeThingsCollection: async () => collection, getUsersCollection: async () => collection }
});
mock.module(new URL('../auth/users.ts', import.meta.url).href, {
  namedExports: { findUserById: async () => null, findUserByUsername: async () => null }
});
mock.module(new URL('../messenger/follows.ts', import.meta.url).href, {
  namedExports: {
    isFollowing: async () => following,
    toggleFollow: async (_viewer: string, input: { follow: boolean }) => {
      const created = !following && input.follow;
      following = input.follow;
      return { ok: true, following, created };
    }
  }
});
mock.module(new URL('../mongodb/relationshipLookup.ts', import.meta.url).href, {
  namedExports: { relationshipLookupFilter: async () => ({}) }
});
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, {
  namedExports: { emitNotification: async () => { notifications += 1; } }
});
const { setFollow, friendAction, friendIdsOf, groupIdsOf } = await import('./social.ts');
beforeEach(() => { following = false; friend = null; notifications = 0; rows = []; });

test('large relational social graphs accept another follow or friendship without duplicate notices', async () => {
  const viewer = { id: 'viewer', username: 'viewer' }, target = { _id: 'target', username: 'target' };
  assert.deepEqual(await setFollow(viewer, target, true), { ok: true, following: true, followerCount: 10001 });
  assert.equal((await setFollow(viewer, target, true)).ok, true);
  assert.equal(notifications, 1);
  assert.deepEqual(await friendAction(viewer, target, 'request'), { ok: true, friendState: 'pending-outgoing' });
  assert.equal(friend.ownerId, 'viewer');
  assert.equal(friend.targetId, 'target');
  assert.deepEqual(await friendAction(viewer, target, 'request'), { ok: true, friendState: 'pending-outgoing' });
  assert.equal(notifications, 2);
  assert.equal((await setFollow(viewer, { _id: 'viewer' }, true)).ok, false);
  assert.equal((await friendAction(viewer, target, 'invented')).ok, false);
});

test('authorization preload preserves memberships beyond the former 2000 boundary', async () => {
  rows = Array.from({ length: 2105 }, (_, i) => ({ ownerId: 'viewer', targetId: `friend-${i}`, crystal: { groupId: `group-${i}` } }));
  const friends = await friendIdsOf('viewer'), groups = await groupIdsOf('viewer');
  assert.equal(friends.size, 2105);
  assert.equal(groups.size, 2105);
  assert(friends.has('friend-2104'));
  assert(groups.has('group-2104'));
});
