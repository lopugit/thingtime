import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { defineNativeThingsCollection } from '../documentStore/nativeThingsCollection';
import { createNativeContentRepository } from '../documentStore/nativeContentRepository';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { nativeAudienceRows, nativeFriendIds, nativeGroupIds } from './nativeAudienceReads';
import { createNativeAccountCreationRepositories } from '../documentStore/nativeAccountCreation';
import { createNativeThingsPersistenceContext } from './persistenceContext';
import { friendIdsOf, groupIdsOf } from '../users/social';
import { loadViewerSubspaceRoles } from '../subspaces/gate';

test('SQLite audience reads preserve both friend directions, membership filters and every page after reopen', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-audiences-'));
 const path = join(directory, 'home.sqlite');
 let provider = createCollectionProvider(await openSqliteDocumentStore(path));
 const scope = { ownerId: null, homePlaneId: 'home', contentPlaneId: 'home' };
 try {
  await provider.transaction(collections => {
   defineNativeThingsCollection(collections);
   const collection = collections.collection(physicalCollectionName('things'));
   const insert = (id: string, kind: string, ownerId: string, targetId: string, crystal: Record<string, unknown>) => collection.insert(BSON.serialize({
    _id: id, shareId: id, thingtime: [kind], ownerId, targetId, crystal,
    createdAt: new Date('2026-11-12T00:00:00Z'), updatedAt: new Date('2026-11-12T00:00:00Z')
   }));
   for (let index = 0; index < 270; index++) {
    insert(`friend-${index}`, 'friend', index % 2 ? 'viewer' : `friend-${index}`, index % 2 ? `friend-${index}` : 'viewer', { status: 'accepted' });
    insert(`group-${index}`, 'group-member', 'group-owner', 'viewer', { groupId: `group-${index}` });
    insert(`role-${index}`, 'subspace-member', 'viewer', `space-${index}`, { role: 'member', status: 'active' });
   }
   insert('pending', 'friend', 'viewer', 'pending-user', { status: 'pending' });
   insert('foreign', 'friend', 'elsewhere', 'unrelated', { status: 'accepted' });
   insert('foreign-group', 'group-member', 'group-owner', 'elsewhere', { groupId: 'private-group' });
   insert('foreign-role', 'subspace-member', 'elsewhere', 'private-space', { role: 'owner' });
  });
  const verify = async () => {
   const repository = createNativeContentRepository(provider, scope);
   assert.equal((await nativeFriendIds(repository, 'viewer')).size, 270);
   assert.equal((await nativeFriendIds(repository, 'viewer')).has('pending-user'), false);
   const groups = await nativeGroupIds(repository, 'viewer');
   assert.equal(groups.size, 270); assert.equal(groups.has('private-group'), false);
   const roles = await nativeAudienceRows(repository, { kinds: ['subspace-member'], ownerId: 'viewer' });
   assert.equal(roles.length, 270); assert.equal(roles.some(row => row.targetId === 'private-space'), false);
   repository.close();
   const ownerBound = createNativeContentRepository(provider, { ...scope, ownerId: 'viewer' });
   await assert.rejects(nativeFriendIds(ownerBound, 'viewer'), /read-only home binding/);
   ownerBound.close();
   const auth = await createNativeAccountCreationRepositories(provider, 'home');
   const context = createNativeThingsPersistenceContext(provider, 'home');
   const beforeMongo = process.env.MONGODB_URI;
   process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/forbidden-native-audience-fallback';
   try {
    await auth.run(() => context.run(async () => {
     assert.equal((await friendIdsOf('viewer')).size, 270);
     assert.equal((await groupIdsOf('viewer')).size, 270);
     const roles = await loadViewerSubspaceRoles('viewer');
     assert.equal(roles.size, 270);
     assert.equal(roles.get('space-0')?.role, 'member');
     assert.equal(roles.has('private-space'), false);
    }));
   } finally {
    context.close();
    if (beforeMongo === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = beforeMongo;
   }
  };
  await verify(); await provider.close();
  provider = createCollectionProvider(await openSqliteDocumentStore(path));
  await verify();
 } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});
