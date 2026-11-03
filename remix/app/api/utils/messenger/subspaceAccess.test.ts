import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterSubspaceMessagingChats, subspaceMessagingAccess, subspaceMessagingIds } from './subspaceAccess';

const community = { shareId: 'space', crystal: { subspaceId: 's1' } };
const row = (crystal: any = {}) => ({ targetId: 's1', ownerId: 'reader', crystal: { role: 'member', ...crystal } });

test('linked messages access follows active subspace membership, temporary bans and live parent lifecycle', async () => {
  let subspace: any = { shareId: 's1' };
  let member: any = row();
  const things = { findOne: async (filter: any) => filter.thingtime === 'subspace' ? subspace : member };
  assert.equal((await subspaceMessagingAccess(things, community, 'reader'))?.allowed, true);
  for (const crystal of [{ pending: true }, { left: true }, { banned: true }, { banned: true, banUntil: new Date(Date.now() + 60_000) }]) {
    member = row(crystal);
    assert.equal((await subspaceMessagingAccess(things, community, 'reader'))?.allowed, false);
  }
  member = row({ banned: true, banUntil: new Date(Date.now() - 60_000), role: 'moderator' });
  const expired = await subspaceMessagingAccess(things, community, 'reader');
  assert.equal(expired?.allowed, true);
  if (expired?.allowed) assert.equal(expired.role, 'admin');
  subspace = null;
  assert.equal((await subspaceMessagingAccess(things, community, 'reader'))?.allowed, false);
  subspace = { shareId: 's1', subspaceMediaDeleting: true };
  assert.equal((await subspaceMessagingAccess(things, community, 'reader'))?.allowed, false);
  subspace = { shareId: 's1' }; member = null;
  assert.equal((await subspaceMessagingAccess(things, community, 'reader'))?.allowed, false);
});

test('summary gate hides revoked subspace previews while retaining unrelated DMs and ordinary spaces', async () => {
  const chats = [
    { shareId: 'dm', crystal: {} },
    { shareId: 'general', crystal: { communityId: 'space', lastMessage: { text: 'private message' } } },
    { shareId: 'ordinary', crystal: { communityId: 'other' } },
    { shareId: 'orphan', crystal: { communityId: 'deleted-space' } }
  ];
  let memberships = [row({ banned: true })];
  const things = { find: (filter: any) => ({ toArray: async () => filter.thingtime === 'community' ? [community, { shareId: 'other', crystal: {} }] : filter.thingtime === 'subspace' ? [{ shareId: 's1' }] : memberships }) };
  assert.deepEqual((await filterSubspaceMessagingChats(things, chats, 'reader')).map(doc => doc.shareId), ['dm', 'ordinary']);
  memberships = [row()];
  assert.deepEqual((await filterSubspaceMessagingChats(things, chats, 'reader')).map(doc => doc.shareId), ['dm', 'general', 'ordinary']);
  assert.deepEqual(subspaceMessagingIds('s1'), { communityId: 'subspace-space-s1', chatId: 'subspace-general-s1' });
});
