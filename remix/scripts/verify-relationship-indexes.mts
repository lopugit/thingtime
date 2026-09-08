import assert from 'node:assert/strict';

// Same creation/read/migration API utils as the HTTP routes. No test-side
// collection access, direct inserts, private fixture patches or production URI.
assert.equal(process.env.TT_INDEX_TEST_ALLOW_LOCAL, '1');
assert.match(String(process.env.MONGODB_CONNECTION_STRING || ''), /^mongodb:\/\/127\.0\.0\.1:27192\/thingtime\?replicaSet=ttindex$/);

const main = async () => {
  const { createUserAccount } = await import('../app/api/utils/auth/registerUser');
  const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
  const { inspectHomeRelationshipLookups } = await import('../app/api/utils/mongodb/indexAudit');
  const { runMigration } = await import('../app/api/utils/migrations/migrations');
  const social = await import('../app/api/utils/users/social');
  const follows = await import('../app/api/utils/messenger/follows');
  const chats = await import('../app/api/utils/messenger/messenger');
  const communities = await import('../app/api/utils/messenger/communities');
  const shared = await import('../app/api/utils/messenger/shared');
  const { createThing } = await import('../app/api/utils/things/things');
  const { syncAiConnections } = await import('../app/api/utils/messenger/aiConnections');
  const ok = (result: any) => { assert.equal(result.ok, true, result.error); return result; };
  await ensureIndexes();
  const ids: string[] = [];
  for (const label of ['owner', 'friend', 'guest']) {
    const result = ok(await createUserAccount({ username: `index-${label}`, password: 'disposable-index-test-password', email: `index-${label}@example.invalid`, emailVerified: true, storageAllowanceBytes: 32 * 1024 * 1024 }));
    ids.push(String(result.user._id));
  }
  const [a, b, c] = ids;
  ok(await follows.toggleFollow(a, { userId: b, follow: true }));
  ok(await social.friendAction({ id: a }, { _id: b }, 'request'));
  ok(await social.friendAction({ id: b }, { _id: a }, 'accept'));
  const chat = ok(await chats.createChat(a, { chatType: 'dm', memberIds: [b] })).chat;
  const community = ok(await communities.createCommunity(a, { name: 'Index migration fixture' })).community;
  const invite = ok(await communities.createInvite(a, { communityId: community.id })).invite;
  // Skew the collection away from the six tested relationship families.
  for (let i = 0; i < 250; i += 5) await Promise.all(Array.from({ length: 5 }, (_, j) => createThing(a, { thingtime: ['data'], crystal: { note: `unrelated-${i + j}` } }, { id: a }).then(ok)));
  const check = async () => {
    assert.equal(await follows.isFollowing(a, b), true);
    assert.deepEqual([...await follows.followingSet(a, [b, c])], [b]);
    assert.deepEqual([...await follows.followersOfSet([a, c], b)], [a]);
    assert.ok(await shared.getChatMemberDoc(chat.id, a));
    assert.equal(await shared.getChatMemberDoc(chat.id, c), null);
    assert.ok(await shared.getCommunityMemberDoc(community.id, a));
    assert.equal((await chats.listChatsById(a, [chat.id])).length, 1);
    assert.equal((await chats.listChatsById(c, [chat.id])).length, 0);
    assert.equal(ok(await chats.createChat(a, { chatType: 'dm', memberIds: [b] })).chat.id, chat.id);
  };
  await check();
  const before = await inspectHomeRelationshipLookups();
  assert.equal(before.ready, false);
  assert.equal(before.indexCount, 59);
  ok(await runMigration('consolidate-relationship-lookup-indexes', { dryRun: true }));
  assert.equal((await inspectHomeRelationshipLookups()).ready, false);
  ok(await runMigration('consolidate-relationship-lookup-indexes', { confirm: true }));
  await check();
  ok(await communities.joinCommunityByCode(b, invite.code));
  const race = await Promise.all(Array.from({ length: 4 }, () => chats.createChat(a, { chatType: 'dm', memberIds: [c] })));
  assert.equal(new Set(race.map(result => ok(result).chat.id)).size, 1);
  const batch = { source: { provider: 'claude', sourceId: 'index-proof', label: 'Index fixture', connector: 'export', mode: 'export' }, groups: [{ id: 'g', name: 'Group', kind: 'project' }], conversations: [{ id: 'c', title: 'Imported', groupId: 'g' }], messages: [], final: true };
  ok(await syncAiConnections(a, batch));
  ok(await syncAiConnections(a, batch));
  const after = await inspectHomeRelationshipLookups();
  assert.equal(after.ready, true);
  assert.equal(after.indexCount, 54);
  for (const row of after.rows) {
    assert.equal(row.sampled, true, row.family);
    assert.equal(row.returned, 1, row.family);
    assert.ok(row.docsExamined! <= 1, row.family);
    assert.ok(row.keysExamined! <= 1, row.family);
  }
  const rerun = ok(await runMigration('consolidate-relationship-lookup-indexes', { dryRun: true }));
  assert.equal(rerun.report.matched, 0);
  console.log(JSON.stringify({ before, after, pendingAfter: rerun.report.matched, checks: 'relationship reads, batched membership/follows, unauthorized chat exclusion, invite redemption, concurrent DM dedupe, repeated AI-import upserts' }, null, 2));
};
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
