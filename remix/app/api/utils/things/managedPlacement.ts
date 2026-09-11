import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { prepareManagedPlacement, type PlacementRecord } from './managedPlacementCore';

const defaults = {
  collection: getHomeThingsCollection,
  transaction: withHomeMongoTransaction,
  customEndpoint: isCustomMongoEndpointActive,
  now: () => new Date()
};

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);

/** Internal home-plane placement writer. Callers must enforce their token
 * scope before entering; this does not grant generic protected-kind edits.
 * No payload/ACL/type/object field or storage-ledger entry is modified. */
export const moveManagedContent = async (
  ownerId: string, id: string, folderId: string | null,
  expectedUpdatedAt?: string, deps = defaults
): Promise<{ id: string; folderId: string | null }> => {
  if (!validId(ownerId) || !validId(id) || (folderId !== null && !validId(folderId))) {
    throw new Error('Invalid managed-content placement');
  }
  if (deps.customEndpoint()) throw new Error('Managed content must be filed in the home Thingtime library');
  const expected = expectedUpdatedAt === undefined ? undefined : new Date(expectedUpdatedAt);
  if (expected && !Number.isFinite(expected.getTime())) throw new Error('Invalid placement version');

  return deps.transaction(async session => {
    const things = await deps.collection();
    const source = await things.findOne({ shareId: id, ownerId } as any, { session }) as unknown as PlacementRecord | null;
    if (!source) throw new Error('Managed content not found');
    const folder = folderId === null ? null : await things.findOne(
      { shareId: folderId, ownerId, thingtime: ['folder'] } as any, { session }
    ) as unknown as PlacementRecord | null;
    if (folderId !== null && !folder) throw new Error('Folder not found');
    const now = deps.now();
    const patch = prepareManagedPlacement(source, ownerId, folder, now);
    if (expected && expected.getTime() !== source.updatedAt.getTime()) {
      throw new Error('Content changed before the move; refresh and try again');
    }
    if (folder) {
      // Snapshot reads alone do not conflict with concurrent folder deletion.
      // A real timestamp advance makes this transaction a folder writer too:
      // either deletion observes our placement or our retry sees no folder.
      const locked = await things.updateOne(
        { shareId: folder.shareId, ownerId, thingtime: ['folder'], updatedAt: folder.updatedAt } as any,
        { $set: { updatedAt: new Date(Math.max(now.getTime(), folder.updatedAt.getTime() + 1)) } }, { session }
      );
      if (locked.matchedCount !== 1) throw new Error('Folder changed before the move');
    }
    const moved = await things.updateOne(
      { shareId: id, ownerId, thingtime: source.thingtime, updatedAt: source.updatedAt } as any,
      { $set: patch }, { session }
    );
    if (moved.matchedCount !== 1) throw new Error('Content changed before the move');
    return { id, folderId: patch.folderId };
  });
};
