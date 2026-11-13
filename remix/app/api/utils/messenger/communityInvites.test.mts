import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let role: string | null = 'admin', rows: any[] = [], inserted = 0;
const collection = {
  countDocuments: () => { throw Error('Retained invite count is not an admission limit'); },
  find: () => ({ sort() { return this; }, batchSize() { return this; }, async toArray() { return rows; } })
};
const install = (path: string, namedExports: Record<string, any>) => mock.module(new URL(path, import.meta.url).href, { namedExports });
install('./subspaceMessages.ts', { ensureViewerSubspaceMessaging: async () => {} });
install('./subspaceAccess.ts', { linkedSubspaceId: () => null, messagingRole: () => 'admin', subspaceMessagingAccess: async () => null });
install('../subspaces/gate.ts', { isActiveMember: () => true, membershipOfDoc: () => null });
install('../mongodb/collections.ts', { getThingsCollection: async () => collection });
install('../mongodb/relationshipLookup.ts', { relationshipLookupFilter: async () => ({}) });
install('../things/things.ts', { resolveProfiles: async () => new Map() });
install('./externalAi.ts', { publicExternalAiSource: () => null });
install('./shared.ts', {
  boundedTrimmed: (value: any) => typeof value === 'string' ? value.trim() : null,
  communityMemberKey: () => '', communityRoleOf: async () => role,
  fail: (status: number, error: string) => ({ ok: false, status, error }),
  findThingByKind: async () => ({ shareId: 'community', ownerId: 'owner', crystal: {} }), getCommunityMemberDoc: async () => null,
  newThingDoc: (kind: string, value: any) => ({ shareId: `new-${++inserted}`, thingtime: [kind], createdAt: new Date(), ...value }),
  ROLE_RANK: { member: 0, admin: 1, owner: 2 }
});
install('./storage.ts', {
  insertMessengerThing: async (_things: any, doc: any) => { rows.push(doc); },
  updateMessengerThing: async (_things: any, filter: any, update: any) => {
    const row = rows.find(row => row.shareId === filter.shareId && row.targetId === filter.targetId);
    if (row) row.crystal.revoked = update.$set['crystal.revoked'];
    return { matchedCount: row ? 1 : 0 };
  }, deleteMessengerThing: async () => {}, updateMessengerThings: async () => {}, withMessengerStorageTransaction: async () => {}
});
const { createInvite, listInvites } = await import('./communities');

beforeEach(() => {
  role = 'admin'; inserted = 0;
  rows = Array.from({ length: 250 }, (_, index) => ({ shareId: `existing-${index}`, targetId: 'community', ownerId: 'owner', createdAt: new Date(),
    crystal: { inviteCode: `code-${index}`, revoked: false, uses: 0, maxUses: null, expiresAt: null } }));
});

test('retained relational invites have no count ceiling and owner listings do not truncate them', async () => {
  const created = await createInvite('owner', { communityId: 'community', expiresInDays: 2, maxUses: 7 });
  assert.equal(created.ok, true);
  assert.equal((created as any).invite.maxUses, 7);
  assert.ok(Date.parse((created as any).invite.expiresAt) > Date.now());
  assert.match((created as any).invite.code, /^tt-/);
  const listed = await listInvites('owner', 'community');
  assert.equal(listed.ok, true);
  assert.equal((listed as any).invites.length, 251);
});

test('removing retained-count admission preserves administrator and exact revoke checks', async () => {
  role = 'member';
  assert.equal((await createInvite('member', { communityId: 'community' }) as any).status, 403);
  assert.equal(inserted, 0);
  role = 'admin';
  assert.equal((await createInvite('owner', { communityId: 'community', revokeId: 'existing-5' })).ok, true);
  assert.equal(rows[5].crystal.revoked, true);
  assert.equal((await createInvite('owner', { communityId: 'community', revokeId: 'foreign-id' }) as any).status, 404);
});
