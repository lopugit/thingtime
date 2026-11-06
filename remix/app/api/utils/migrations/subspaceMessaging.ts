import { getThingsCollection } from '../mongodb/collections';
import { ensureSubspaceMessaging } from '../messenger/subspaceMessages';
import { subspaceMessagingIds } from '../messenger/subspaceAccess';
import { updateMessengerThing, withMessengerStorageTransaction } from '../messenger/storage';
import type { Migration, MigrationReport } from './migrations';

const PENDING_BATCH = 200;

export const countPendingSubspaceMessaging = async (things: any): Promise<number> => {
  const cursor = things.find({ thingtime: 'subspace', subspaceMediaDeleting: { $ne: true } }, { projection: { shareId: 1 } }).batchSize(PENDING_BATCH);
  let batch: string[] = [];
  let pending = 0;
  const inspectBatch = async () => {
    if (!batch.length) return;
    const ids = batch.flatMap(id => { const ids = subspaceMessagingIds(id); return [ids.communityId, ids.chatId]; });
    const containers = await things.find({ shareId: { $in: ids }, thingtime: { $in: ['community', 'chat'] } },
      { projection: { shareId: 1, thingtime: 1, targetId: 1, 'crystal.subspaceId': 1, 'crystal.subspaceDefault': 1, 'crystal.communityId': 1 } }).toArray();
    const byId = new Map<string, any>(containers.map((doc: any) => [String(doc.shareId), doc]));
    for (const id of batch) {
      const ids = subspaceMessagingIds(id);
      const community = byId.get(ids.communityId);
      const chat = byId.get(ids.chatId);
      if (community?.thingtime?.length !== 1 || community.thingtime[0] !== 'community' || community.targetId !== id || community.crystal?.subspaceId !== id ||
        chat?.thingtime?.length !== 1 || chat.thingtime[0] !== 'chat' || chat.targetId !== ids.communityId || chat.crystal?.communityId !== ids.communityId || chat.crystal?.subspaceDefault !== true) pending++;
    }
    batch = [];
  };
  try {
    for await (const subspace of cursor) {
      batch.push(String(subspace.shareId));
      if (batch.length === PENDING_BATCH) await inspectBatch();
    }
    await inspectBatch();
    return pending;
  } finally { await cursor.close(); }
};

type ProvisionDependencies = {
  transaction: typeof withMessengerStorageTransaction;
  update: typeof updateMessengerThing;
  ensure: typeof ensureSubspaceMessaging;
};
export const provisionSubspaceMessagingMigration = async (
  things: any, id: string,
  dependencies: ProvisionDependencies = { transaction: withMessengerStorageTransaction, update: updateMessengerThing, ensure: ensureSubspaceMessaging }
): Promise<boolean> => dependencies.transaction(async session => {
  const fresh = await things.findOne({ thingtime: 'subspace', shareId: id, subspaceMediaDeleting: { $ne: true } }, { session });
  if (!fresh) return false;
  // A monotonic, accounted parent write serializes this backfill with the
  // deletion fence and ownership transfer. A read-only snapshot could insert
  // children after deletion had already swept them, leaving billed orphans.
  const fenced = await dependencies.update(things, { _id: fresh._id, thingtime: 'subspace', subspaceMediaDeleting: { $ne: true } },
    { $inc: { subspaceMessagingRevision: 1 }, $set: { updatedAt: new Date() } }, { session });
  if (!fenced.matchedCount) return false;
  await dependencies.ensure(fresh, session);
  return true;
});

export const subspaceMessagingMigration: Migration = {
  id: 'subspace-messaging-spaces', collection: 'things', fromVersion: 2, toVersion: 2,
  title: 'Subspace message spaces',
  description: 'Provision a stable Messenger space and general channel for every existing subspace, preserving subspace membership as the only authority.',
  pending: async () => countPendingSubspaceMessaging(await getThingsCollection()),
  run: async ({ dryRun, assertLease }) => {
    const things = await getThingsCollection();
    const report: MigrationReport = { dryRun, matched: 0, migrated: 0, created: 0, skipped: 0, notes: [] };
    for await (const subspace of things.find({ thingtime: 'subspace', subspaceMediaDeleting: { $ne: true } } as any)) {
      await assertLease?.();
      report.matched++;
      if (dryRun) { report.skipped++; continue; }
      const provision = () => provisionSubspaceMessagingMigration(things, String(subspace.shareId));
      try { if (await provision()) report.migrated++; }
      catch (error: any) { if (error?.code !== 11000) throw error; if (await provision()) report.migrated++; }
      // Memberships are deliberately lazy: a member's first Messenger entry
      // reconciles their preferences. No O(subspaces × members) fan-out and no
      // copied authority; every read still checks the live subspace gate.
    }
    report.notes.push('All live subspaces scanned. Active members receive their own general-channel preferences on first Messenger entry. Removed subspaces remain inaccessible through the authoritative parent gate.');
    return report;
  }
};
