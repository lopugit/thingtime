import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUserVaultMutationIntegrity } from './userVaultIntegrity';
const session = { inTransaction: () => true };
const group = { shareId: 'fixture-group', ownerId: 'fixture-owner', thingtime: ['data'], crystal: { systemType: 'tt.lopuUserVault', recordKind: 'group', name: 'Fixture' } };
const child = { shareId: 'fixture-child', ownerId: group.ownerId, thingtime: ['data'], crystal: { systemType: 'tt.lopuUserVault', recordKind: 'secret', groupId: group.shareId } };

test('ordinary content never triggers Vault queries', async () => {
 const things = { findOne: () => { throw new Error('Unexpected query'); } };
 await assertUserVaultMutationIntegrity(things, null, { ...group, crystal: { name: 'Ordinary data' } }, null);
 await assertUserVaultMutationIntegrity(things, { ...group, thingtime: ['post'] }, null, null);
});
test('Vault relationship checks require an active transaction', async () => {
 for (const invalid of [null, {}, { inTransaction: () => false }]) await assert.rejects(assertUserVaultMutationIntegrity({}, group, null, invalid));
});
test('deletion and conversion of a nonempty group both refuse in the content transaction', async () => {
 const queries: any[] = [];
 const things = { findOne: async (query: any, options: any) => { queries.push(query); assert.equal(options.session, session); assert.deepEqual(options.projection, { _id: 1 }); return { _id: 'child' }; } };
 for (const after of [null, { ...group, crystal: { name: 'No longer an environment' } }, { ...group, crystal: { ...group.crystal, recordKind: 'secret' } }])
  await assert.rejects(assertUserVaultMutationIntegrity(things, group, after, session), /Move or delete/);
 for (const query of queries) assert.deepEqual(query, { ownerId: group.ownerId, thingtime: 'data', 'crystal.systemType': 'tt.lopuUserVault', 'crystal.groupId': group.shareId });
});
test('empty groups may be removed and nonempty groups may be renamed', async () => {
 await assertUserVaultMutationIntegrity({ findOne: async () => null }, group, null, session);
 await assertUserVaultMutationIntegrity({ findOne: () => { throw new Error('No membership change'); } }, group, { ...group, crystal: { ...group.crystal, name: 'Renamed' } }, session);
});
test('child creation, edit and History restoration require an owned current group', async () => {
 const queries: unknown[] = [];
 for (const recordKind of ['secret', 'provider']) {
  const after = { ...child, crystal: { ...child.crystal, recordKind } };
  await assert.rejects(assertUserVaultMutationIntegrity({ findOne: async () => null }, null, after, session), /not found/);
  await assertUserVaultMutationIntegrity({ findOne: async (query: any, options: any) => {
   queries.push(query); assert.equal(options.session, session); assert.deepEqual(options.projection, { _id: 1 });
   assert.deepEqual(query, { shareId: group.shareId, ownerId: child.ownerId, thingtime: 'data', 'crystal.systemType': 'tt.lopuUserVault', 'crystal.recordKind': 'group' }); return { _id: 'group' };
  } }, child, after, session);
 }
 assert.equal(queries.length, 2);
});
test('missing, malformed and self group references cannot be added; orphaned children can be repaired or deleted', async () => {
 const noRead = { findOne: () => { throw new Error('Unexpected read'); } };
 for (const groupId of [42, {}, child.shareId, ' invalid-id ']) await assert.rejects(assertUserVaultMutationIntegrity(noRead, child, { ...child, crystal: { ...child.crystal, groupId } }, session), /not found/);
 for (const groupId of [null, '', undefined]) await assertUserVaultMutationIntegrity(noRead, child, { ...child, crystal: { ...child.crystal, groupId } }, session);
 await assertUserVaultMutationIntegrity(noRead, child, null, session);
});
