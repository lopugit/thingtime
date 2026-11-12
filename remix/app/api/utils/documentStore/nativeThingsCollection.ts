import { physicalCollectionName } from '../mongodb/collectionNames';
import type { CollectionTransaction } from './collectionContract';

/** Shared protected identities for ALL native Things, not kind-specific
 * indexes. Immutable definitions are revalidated on reopen; incompatible
 * pre-existing definitions require an explicit migration, never replacement.
 * Query acceleration and TTL policy are not provided by this definition. */
export const defineNativeThingsCollection = (transaction: CollectionTransaction): void => {
 transaction.defineCollection(physicalCollectionName('things'), { unique: [
  { name: 'share-id', path: ['shareId'], sparse: false, multikey: false },
  { name: 'unique-keys', path: ['uniqueKeys'], sparse: true, multikey: true }
 ] });
};
