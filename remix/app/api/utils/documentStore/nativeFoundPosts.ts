import { BSON } from 'mongodb';
import { registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { assertNativeFoundPostScope, type NativeFoundPostRepository } from '../things/foundPostRepository';
import { FOUND_POST_KIND, foundPostDigest, foundPostReceiptMatches, foundPostVisitDocument } from '../things/foundPosts';
import { getBoundThingsPersistence } from '../things/persistenceContext';
import { nativeAudienceRows } from '../things/nativeAudienceReads';
import { canView, type ThingDoc, type Viewer } from '../things/things';
import { encodeCollectionDocument } from './collectionProvider';
import { defineNativeThingsCollection } from './nativeThingsCollection';
import type { CollectionProvider, CollectionTransaction } from './collectionContract';

/** Discovery is control metadata: preserve anonymous browser identities and do
 * not require, debit or manufacture a content allowance. The receipt and current
 * hidden-link generation are checked atomically in the selected HOME provider. */
export async function createNativeFoundPostRepository(provider: CollectionProvider, homePlaneId: string): Promise<NativeFoundPostRepository> {
 if (!homePlaneId || homePlaneId.includes('\0')) throw new Error('Invalid discovery home binding');
 await provider.transaction(defineNativeThingsCollection);
 const namespace = physicalCollectionName('things');
 let repository: NativeFoundPostRepository;
 const exact = (collections: CollectionTransaction, shareId: string): ThingDoc | null => {
  const rows = collections.collection(namespace).find({ filter: { op: 'eq', path: ['shareId'], value: shareId }, limit: 2 }).documents;
  if (rows.length > 1) throw new Error('Ambiguous discovery identity');
  return rows.length ? BSON.deserialize(rows[0]) as ThingDoc : null;
 };
 repository = Object.freeze({ homePlaneId,
  async remember(viewer: Viewer, post: ThingDoc, ipAddress?: string) {
   assertNativeFoundPostScope(repository);
   if (!foundPostVisitDocument(viewer, post, ipAddress)) return;
   await provider.transaction(collections => {
    assertNativeFoundPostScope(repository);
    const currentPost = exact(collections, post.shareId);
    // A stale caller cannot stamp a retired generation, different author or
    // private/blocked current row. Only the canonical permalink proof counts.
    if (!currentPost || currentPost.ownerId !== post.ownerId || currentPost.linkKey !== post.linkKey || !canView(currentPost, viewer)) return;
    const document = foundPostVisitDocument(viewer, currentPost, ipAddress);
    if (!document) return;
    const current = exact(collections, document.shareId);
    if (foundPostReceiptMatches(current, currentPost, document.ownerId)) return;
    const collection = collections.collection(namespace);
    if (current) {
     if (current.ownerId !== document.ownerId || current.targetId !== document.targetId || current.thingtime?.length !== 1 || current.thingtime[0] !== FOUND_POST_KIND)
      throw new Error('Discovery receipt identity collision');
     const changed = collection.updateOne({ op: 'eq', path: ['_id'], value: current._id }, [
      { op: 'set', path: ['crystal'], value: document.crystal }, { op: 'set', path: ['updatedAt'], value: document.updatedAt }
     ]);
     if (!changed.matched) throw new Error('Discovery receipt changed');
    } else collection.insert(encodeCollectionDocument(document, 'shareId'));
    assertNativeFoundPostScope(repository);
   });
  },
  async loadForAuthor(viewerId: string, authorId: string) {
   assertNativeFoundPostScope(repository);
   const reads = getBoundThingsPersistence(null)!;
   const receipts = await nativeAudienceRows(reads, { ownerId: viewerId, kinds: [FOUND_POST_KIND] });
   const byTarget = new Map(receipts.filter(row => row.crystal?.authorId === authorId && typeof row.targetId === 'string').map(row => [row.targetId, row]));
   const posts = await reads.readBatch([...byTarget.keys()]);
   assertNativeFoundPostScope(repository);
   return new Map(posts.filter(post => post.ownerId === authorId && foundPostReceiptMatches(byTarget.get(post.shareId) as ThingDoc, post as ThingDoc, viewerId))
    .map(post => [post.shareId, foundPostDigest(post.linkKey)]));
  }
 });
 registerHomeRepositoryProvider(repository, provider);
 return repository;
}
