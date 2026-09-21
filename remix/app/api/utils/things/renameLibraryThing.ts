import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { applyUserStorageDelta } from '../storage/userStorage';
import { currentContentStorageSizeBytes, StorageMutationError, thingStorageSizeBytes } from '../storage/storageCore';

const defaults = { collection: getHomeThingsCollection, transaction: withHomeMongoTransaction,
  custom: isCustomMongoEndpointActive, storageDelta: applyUserStorageDelta, now: () => new Date() };

// Display metadata for protected personal-library Things. This deliberately
// preserves emoji shortcodes, theme tokens, algorithm weights and archived
// historical names/children. It grants no generic managed-content mutation.
export async function renameLibraryThing(input: {
  actorKind: string; accountKind: string; ownerId: string; sameOrigin: boolean;
  id: unknown; title: unknown; expectedUpdatedAt?: unknown;
}, deps = defaults): Promise<{ ok: true; id: string; title: string; updatedAt: string } | { ok: false; status: number; error: string }> {
  const fail = (status: number, error: string) => ({ ok: false as const, status, error });
  if (input.actorKind !== 'user' || input.accountKind !== 'user' || !input.sameOrigin || deps.custom()) return fail(403, 'Rename requires your home Thingtime library');
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.id) || !input.ownerId ||
    typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120) return fail(400, 'Choose a title of 1–120 characters');
  const title = input.title.trim(), id = input.id;
  const expected = input.expectedUpdatedAt === undefined ? undefined : typeof input.expectedUpdatedAt === 'string' ? new Date(input.expectedUpdatedAt) : new Date(NaN);
  if (expected && !Number.isFinite(expected.getTime())) return fail(400, 'Invalid rename version');
  try {
    return await deps.transaction(async session => {
      const things = await deps.collection();
      const before = await things.findOne({ shareId: id, ownerId: input.ownerId } as any, { session }) as any;
      if (!before || before.ownerId !== input.ownerId || before.thingtime?.length !== 1 ||
        !['theme', 'feed-algorithm', 'custom-emoji', 'chat-archive'].includes(before.thingtime[0]) ||
        before.appId != null || before.sandbox != null || before.sandboxSpace != null || before.targetId != null ||
        (before.thingtime[0] === 'chat-archive' && (before.archiveVersion !== 1 || before.archiveRootId !== id || (before.archiveDeleting !== undefined && before.archiveDeleting !== false)))) return fail(404, 'Library Thing not found');
      const previousTime = new Date(before.updatedAt);
      if (!Number.isFinite(previousTime.getTime()) || (expected && expected.getTime() !== previousTime.getTime())) return fail(409, 'Thing changed; refresh before renaming');
      const previousSize = currentContentStorageSizeBytes(before);
      if (previousSize === null) return fail(409, 'Thing storage needs reconciliation before renaming');
      const crystal = { ...before.crystal, title };
      const sizeBytes = thingStorageSizeBytes({ ...before, crystal });
      const delta = sizeBytes - previousSize;
      if (delta) await deps.storageDelta(input.ownerId, delta, session);
      const updatedAt = new Date(Math.max(deps.now().getTime(), previousTime.getTime() + 1));
      const result = await things.updateOne({ _id: before._id, shareId: id, ownerId: input.ownerId,
        thingtime: before.thingtime, updatedAt: before.updatedAt, sizeBytes: before.sizeBytes,
        storageClass: before.storageClass, storageAccountingVersion: before.storageAccountingVersion } as any,
        { $set: { 'crystal.title': title, sizeBytes, updatedAt } }, { session });
      if (result.matchedCount !== 1) throw new StorageMutationError(409, 'storage_conflict', 'Thing changed; refresh before renaming');
      return { ok: true as const, id, title, updatedAt: updatedAt.toISOString() };
    });
  } catch (error) {
    return error instanceof StorageMutationError ? fail(error.status, error.message) : fail(503, 'Could not rename this Thing; try again');
  }
}
