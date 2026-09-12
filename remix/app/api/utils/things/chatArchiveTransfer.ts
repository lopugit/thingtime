import { randomUUID } from 'node:crypto';
import { validateChatArchives } from '../../../utils/thingTransfer/chatArchive';
import { orderedTransferAttachments, serializeTransfer, validateTransfer, type ThingTransfer } from '../../../utils/thingTransfer/format';
import { customReactionEmojiId } from '../../../utils/reactionTokens';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { newThingDoc } from '../messenger/shared';
import { insertAccountedThing } from '../storage/accountedThings';
import { bindReadyAttachmentsToTarget } from '../attachments/attachmentStore';

const defaults = {
  collection: getHomeThingsCollection, transaction: withHomeMongoTransaction,
  insert: insertAccountedThing, bind: bindReadyAttachmentsToTarget,
  custom: isCustomMongoEndpointActive, uuid: randomUUID, now: () => new Date()
};
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const reject = (message: string): never => { throw new Error(message); };

export type ChatArchiveImportResources = {
  /** Fresh post-purpose uploads/links already prepared by the transfer service. */
  files: ReadonlyMap<string, string>;
  /** Dedicated emoji writer results, never source community/account references. */
  emojis?: ReadonlyMap<string, string>;
  folderId?: string | null;
};

/** Internal transfer writer, not a live Messenger send/import operation.
 * All rows and file bindings share one quota-accounted home transaction. There
 * are deliberately no user, membership, inbox, preview, or notification writes.
 * The HTTP adapter must enforce its token scope before calling this utility.
 */
export const createTransferChatArchive = async (
  ownerId: string, input: ThingTransfer, rootId: string, resources: ChatArchiveImportResources,
  deps = defaults
): Promise<{ rootId: string; ids: Record<string, string>; imported: number }> => {
  if (!validId(ownerId) || !validId(rootId)) reject('A signed-in archive owner is required');
  if (deps.custom()) reject('Chat archives must be imported into the home Thingtime library');
  // Own a validated snapshot across awaits and transaction retries.
  const manifest = validateTransfer(JSON.parse(serializeTransfer(validateTransfer(input))));
  const group = validateChatArchives(manifest).find(item => item.root.id === rootId);
  if (!group) return reject('Chat archive not found in this transfer');
  const folderId = resources.folderId ?? null;
  if ((folderId !== null && !validId(folderId)) || (group.root.folderId && !folderId)) reject('Resolve the archive destination folder before importing');
  const rows = [group.root, ...group.participants, ...group.messages, ...group.reactions];
  const localIds = new Set(rows.map(row => row.id));
  const sourceIds = new Set([...manifest.things, ...manifest.files, ...(manifest.links || [])].map(row => row.id));
  const attachments = orderedTransferAttachments(manifest).filter(file => localIds.has(file.targetId));
  const files = new Map(attachments.map(file => [file.id, resources.files.get(file.id)]));
  const emojiSources = new Set(group.reactions.map(row => customReactionEmojiId(String(row.crystal.emoji))).filter((id): id is string => !!id));
  const emojis = new Map([...emojiSources].map(id => [id, resources.emojis?.get(id)]));
  const ids = new Map(rows.map(row => [row.id, deps.uuid()]));
  const destinations = [...ids.values(), ...files.values(), ...emojis.values()];
  if (destinations.some(id => !validId(id) || sourceIds.has(id) || id === ownerId || id === folderId) ||
    new Set(destinations).size !== destinations.length) reject('Archive resources require distinct fresh identities');
  const mapped = (id: unknown) => ids.get(String(id)) || reject('Missing archive-local reference');
  const now = deps.now();
  if (!Number.isFinite(now.getTime())) reject('Invalid archive import time');
  const documents = rows.map(row => {
    const crystal = { ...row.crystal };
    if (row === group.root) crystal.selfParticipantId = mapped(crystal.selfParticipantId);
    if (row.thingtime[0] === 'chat-archive-participant') {
      crystal.archived = row.id !== group.self.id;
      if (row.id === group.self.id) crystal.userId = ownerId;
      if (crystal.avatarFileId !== undefined) crystal.avatarFileId = files.get(String(crystal.avatarFileId));
    }
    if (crystal.participantId !== undefined) crystal.participantId = mapped(crystal.participantId);
    for (const key of ['replyToId', 'threadRootId']) if (crystal[key] !== undefined) crystal[key] = mapped(crystal[key]);
    const emojiId = typeof crystal.emoji === 'string' ? customReactionEmojiId(crystal.emoji) : null;
    if (emojiId) crystal.emoji = `custom:${emojis.get(emojiId)}`;
    return { ...newThingDoc(row.thingtime[0], { ownerId, shareId: mapped(row.id),
      targetId: row.targetId ? mapped(row.targetId) : null, crystal }),
    archiveVersion: 1, createdAt: now, updatedAt: now,
    ...(row === group.root ? { folderId } : {}) };
  });
  return deps.transaction(async session => {
    const things = await deps.collection();
    if (folderId) {
      const folder = await things.findOne({ shareId: folderId, ownerId, thingtime: ['folder'] } as any, { session });
      if (!folder || folder.appId != null || folder.sandbox != null || folder.sandboxSpace != null || !(folder.updatedAt instanceof Date) || !Number.isFinite(folder.updatedAt.getTime())) reject('Archive destination folder not found');
      // A snapshot read alone would race with folder deletion. Advance the same
      // timestamp fence used by managed placement before inserting children.
      const lock = await things.updateOne({ shareId: folderId, ownerId, thingtime: ['folder'], updatedAt: folder.updatedAt } as any,
        { $set: { updatedAt: new Date(Math.max(now.getTime(), folder.updatedAt.getTime() + 1)) } }, { session });
      if (lock.matchedCount !== 1) reject('Archive destination folder changed');
    }
    for (const id of emojis.values()) {
      const emoji = await things.findOne({ shareId: id, ownerId, thingtime: ['custom-emoji'] } as any, { session });
      if (!emoji || emoji.appId != null || emoji.sandbox != null || emoji.sandboxSpace != null || emoji.targetId || emoji.moderation?.status === 'blocked') reject('Imported reaction emoji is unavailable');
    }
    // Recheck actual resources inside the binding transaction, not just the
    // caller's preflight. The canonical binder also fences owner/purpose/expiry.
    for (const file of attachments) {
      const upload = await things.findOne({ shareId: files.get(file.id), ownerId, thingtime: ['attachment'] } as any, { session });
      if (!upload || upload.targetId || upload.appId != null || upload.sandbox != null || upload.sandboxSpace != null || upload.moderation?.status === 'blocked' ||
        ('bytes' in file ? upload.attachmentLinked || upload.crystal?.size !== file.bytes || upload.crystal?.contentType !== file.mime
          : !upload.attachmentLinked || upload.crystal?.url !== file.url)) reject('Archive attachment does not match the transfer');
    }
    for (let index = 0; index < documents.length; index++) {
      // Accounted insertion/Mongo may stamp/mutate the object. A retry gets a
      // clean document with the same server-minted identity, never a new copy.
      const doc = structuredClone(documents[index]);
      await deps.insert(things, doc, { session, accountedPlane: 'home' });
      const bound = attachments.filter(file => file.targetId === rows[index].id).map(file => files.get(file.id)!);
      if (bound.length) await deps.bind(ownerId, bound, doc.shareId, session);
    }
    return { rootId: mapped(rootId), ids: Object.fromEntries(ids), imported: documents.length };
  });
};
