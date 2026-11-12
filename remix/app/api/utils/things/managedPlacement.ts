import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { prepareManagedPlacement, type PlacementRecord } from './managedPlacementCore';
import { lockFolderDestination } from './folderPlacement';
import { newThingMutationCapture, recordFolderPlacement } from '../timeline/recordMutation';

const defaults = {
  collection: getHomeThingsCollection,
  transaction: withHomeMongoTransaction,
  customEndpoint: isCustomMongoEndpointActive,
  now: () => new Date(),
  record: recordFolderPlacement
};

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);

/** Placement is owner-only metadata, never inferred from a shared preview. */
export const readManagedContentFolder = async (ownerId: string | undefined, id: string, deps = defaults): Promise<string | undefined> => {
  if (!ownerId || !validId(ownerId) || !validId(id) || deps.customEndpoint()) return undefined;
  const row = await (await deps.collection()).findOne({ ownerId, shareId: id,
    $or: [{ thingtime: ['theme'] }, { thingtime: ['feed-algorithm'] }]
  } as any, { projection: { folderId: 1 } }) as unknown as { folderId?: unknown } | null;
  return validId(row?.folderId) ? row.folderId : undefined;
};

/** Internal home-plane placement writer. Callers must enforce their token
 * scope before entering; this does not grant generic protected-kind edits.
 * No payload/ACL/type/object field is modified. Its bounded placement revision
 * and private Timeline head commit in the same transaction. */
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
  const capture = { ...newThingMutationCapture(ownerId), label: 'Moved Thing' };

  return deps.transaction(async session => {
    const things = await deps.collection();
    const source = await things.findOne({ shareId: id, ownerId } as any, { session }) as unknown as PlacementRecord | null;
    if (!source) throw new Error('Managed content not found');
    const now = deps.now();
    prepareManagedPlacement(source, ownerId, null, now);
    if (expected && expected.getTime() !== source.updatedAt.getTime()) {
      throw new Error('Content changed before the move; refresh and try again');
    }
    const folder = await lockFolderDestination(things, ownerId, folderId, session);
    const patch = prepareManagedPlacement(source, ownerId, folder, now);
    const moved = await things.updateOne(
      { shareId: id, ownerId, thingtime: source.thingtime, updatedAt: source.updatedAt } as any,
      { $set: patch }, { session }
    );
    if (moved.matchedCount !== 1) throw new Error('Content changed before the move');
    await deps.record(things, source, { ...source, ...patch }, capture, session);
    return { id, folderId: patch.folderId };
  });
};
