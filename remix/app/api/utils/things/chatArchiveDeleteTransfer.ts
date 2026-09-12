import { CHAT_ARCHIVE_KINDS } from '../../../utils/thingTransfer/chatArchive';
import { TRANSFER_LIMITS } from '../../../utils/thingTransfer/format';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { deleteAccountedThings } from '../storage/accountedThings';
import { prepareAttachmentCascadeForThing } from '../attachments/attachments';

const defaults = {
  collection: getHomeThingsCollection, transaction: withHomeMongoTransaction,
  remove: deleteAccountedThings, prepare: prepareAttachmentCascadeForThing,
  custom: isCustomMongoEndpointActive, now: () => new Date()
};
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const reject = (message: string): never => { throw new Error(message); };

/** Owner-only archive deletion / import compensation. Object deletion is not a
 * Mongo transaction: retain every historical row and a durable deleting root
 * until the canonical S3 cascade has completed. A retry drains remaining files,
 * then refunds/removes the relational rows atomically. Never delete live chats,
 * users, emoji definitions, memberships, or source records through this path.
 */
export const removeTransferChatArchive = async (ownerId: string, rootId: string, deps = defaults) => {
  if (!validId(ownerId) || !validId(rootId)) reject('Invalid archive deletion request');
  if (deps.custom()) reject('Chat archives belong to the home Thingtime library');
  const scope = { ownerId, archiveRootId: rootId, archiveVersion: 1 };
  const rootFilter = { ...scope, shareId: rootId, thingtime: ['chat-archive'] };
  const readRows = async (things: any, session: any): Promise<any[]> => {
    const rows = await things.find(scope, { session }).limit(TRANSFER_LIMITS.things + 1).toArray();
    if (rows.length > TRANSFER_LIMITS.things || rows.some((row: any) => !validId(row.shareId) || row.ownerId !== ownerId ||
      row.archiveRootId !== rootId || row.archiveVersion !== 1 || !Array.isArray(row.thingtime) || row.thingtime.length !== 1 ||
      !(CHAT_ARCHIVE_KINDS as readonly string[]).includes(row.thingtime[0]) || row.appId != null || row.sandbox != null || row.sandboxSpace != null) ||
      new Set(rows.map((row: any) => row.shareId)).size !== rows.length) reject('Archive deletion invariant failed');
    return rows;
  };
  const claimed = await deps.transaction(async session => {
    const things = await deps.collection();
    const root = await things.findOne(rootFilter as any, { session });
    const rows = await readRows(things, session);
    if (!root) {
      if (rows.length) reject('Archive root is missing; retain its history for recovery');
      return [];
    }
    if (!rows.some(row => row.shareId === rootId) || rows.filter(row => row.thingtime[0] === 'chat-archive').length !== 1 ||
      !(root.updatedAt instanceof Date) || !Number.isFinite(root.updatedAt.getTime())) reject('Archive root is invalid');
    // This server-only envelope flag does not change billable payload bytes.
    // Readers/exporters must hide deleting roots; no archive append API exists.
    const now = deps.now();
    if (!Number.isFinite(now.getTime())) reject('Invalid archive deletion time');
    const locked = await things.updateOne({ ...rootFilter, updatedAt: root.updatedAt } as any,
      { $set: { archiveDeleting: true, updatedAt: new Date(Math.max(now.getTime(), root.updatedAt.getTime() + 1)) } }, { session });
    if (locked.matchedCount !== 1) reject('Archive changed before deletion');
    return rows;
  });
  if (!claimed.length) return { ok: true as const, deleted: 0 };
  // Child-first object cleanup. Do not compensate by destroying relational
  // rows if one cleanup is deferred, rejected, or has an ambiguous outcome.
  const depth = (row: any) => row.thingtime[0] === 'chat-archive-reaction' ? 2 : row.shareId === rootId ? 0 : 1;
  for (const row of [...claimed].sort((a, b) => depth(b) - depth(a))) {
    const prepared = await deps.prepare({ shareId: row.shareId, ownerId });
    if (!prepared.ok) throw prepared;
  }
  return deps.transaction(async session => {
    const things = await deps.collection();
    const root = await things.findOne(rootFilter as any, { session });
    const rows = await readRows(things, session);
    if (!root && !rows.length) return { ok: true as const, deleted: 0 }; // Another deletion completed.
    const ids = new Set(claimed.map(row => row.shareId));
    if (!root?.archiveDeleting || rows.length !== ids.size || rows.some(row => !ids.has(row.shareId))) reject('Archive changed during cleanup');
    // Check all children, not just this owner's files. A leftover or unexpected
    // child retains its parent instead of silently becoming an orphan.
    const remaining = await things.findOne({ shareId: { $nin: [...ids] },
      $or: [{ targetId: { $in: [...ids] } }, { parentId: { $in: [...ids] } }]
    } as any, { session, projection: { _id: 1 } });
    if (remaining) reject('Archive still has children; retry cleanup before removing history');
    const removed = await deps.remove(things, { ...scope, shareId: { $in: [...ids] } }, { session, accountedPlane: 'home' });
    if (removed.deletedCount !== ids.size) reject('Archive changed while deleting history');
    return { ok: true as const, deleted: removed.deletedCount as number };
  });
};
