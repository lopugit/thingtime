import { prepareAttachmentCascadeForThing } from '../attachments/attachments';
import { getThingsCollection } from '../mongodb/collections';
import { isActiveMember, membershipOfDoc } from '../subspaces/gate';
import { chatMemberKey, communityMemberKey, newThingDoc } from './shared';
import { deleteMessengerThings, insertMessengerThing, updateMessengerThing, withMessengerStorageTransaction } from './storage';
import { messagingRole, subspaceMessagingIds } from './subspaceAccess';
export { subspaceMessagingIds } from './subspaceAccess';

// Deterministic, server-owned ids and exact envelope checks make provisioning
// retryable without merging an unrelated existing community or conversation.
export const ensureSubspaceMessaging = async (subspace: any, session?: any): Promise<void> => {
  const things = await getThingsCollection();
  const ids = subspaceMessagingIds(String(subspace.shareId));
  const options = session ? { session } : {};
  const docs = [
    newThingDoc('community', { shareId: ids.communityId, ownerId: String(subspace.ownerId), targetId: String(subspace.shareId),
      crystal: { name: subspace.crystal?.name || subspace.crystal?.slug, description: subspace.crystal?.description ?? null, avatarUrl: null, subspaceId: String(subspace.shareId) } }),
    newThingDoc('chat', { shareId: ids.chatId, ownerId: String(subspace.ownerId), targetId: ids.communityId,
      crystal: { chatType: 'channel', name: 'general', topic: null, communityId: ids.communityId, sectionId: null, channelVisibility: 'public', dmKey: null, subspaceDefault: true } })
  ];
  for (const doc of docs) {
    const existing = await things.findOne({ shareId: doc.shareId } as any, options);
    if (existing) {
      if (!Array.isArray(existing.thingtime) || existing.thingtime.length !== 1 || existing.thingtime[0] !== doc.thingtime[0] ||
        existing.targetId !== doc.targetId || (doc.thingtime[0] === 'community' ? existing.crystal?.subspaceId !== subspace.shareId : existing.crystal?.subspaceDefault !== true)) {
        throw new Error('Subspace messaging identity collision');
      }
      if (String(existing.ownerId) !== String(doc.ownerId)) {
        await updateMessengerThing(things, { shareId: existing.shareId } as any, { $set: { ownerId: doc.ownerId, updatedAt: new Date() } }, options);
      }
      continue;
    }
    await insertMessengerThing(things, doc as any, options);
  }
};

export const ensureSubspaceMessagingMember = async (subspace: any, member: any, session?: any): Promise<void> => {
  if (!isActiveMember(membershipOfDoc(member))) return;
  const things = await getThingsCollection();
  const ids = subspaceMessagingIds(String(subspace.shareId));
  const userId = String(member.ownerId);
  const role = messagingRole(member.crystal?.role);
  const options = session ? { session } : {};
  const docs = [
    newThingDoc('community-member', { ownerId: userId, targetId: ids.communityId, crystal: { memberKey: communityMemberKey(ids.communityId, userId), role } }),
    newThingDoc('chat-member', { ownerId: userId, targetId: ids.chatId, crystal: { memberKey: chatMemberKey(ids.chatId, userId), role, state: 'active', requestOrigin: null, nickname: null, lastReadMessageId: null, lastReadAt: null, muted: false } })
  ];
  for (const doc of docs) {
    const existing = await things.findOne({ thingtime: doc.thingtime[0], ownerId: userId, targetId: doc.targetId } as any, options);
    if (!existing) await insertMessengerThing(things, doc as any, options);
    else if (existing.crystal?.role !== role || (doc.thingtime[0] === 'chat-member' && existing.crystal?.state !== 'active')) {
      await updateMessengerThing(things, { shareId: existing.shareId } as any, { $set: {
        'crystal.role': role, ...(doc.thingtime[0] === 'chat-member' ? { 'crystal.state': 'active' } : {}), updatedAt: new Date()
      } }, options);
    }
  }
};

// Reconcile this user's spaces on entry to Messenger. This is also a rollout
// repair path, while the registered migration provisions ALL existing spaces.
export const ensureViewerSubspaceMessaging = async (viewerId: string): Promise<void> => {
  const things = await getThingsCollection();
  const members = await things.find({ thingtime: 'subspace-member', ownerId: viewerId }).toArray();
  const active = members.filter((member: any) => isActiveMember(membershipOfDoc(member)));
  if (!active.length) return;
  const subspaces = await things.find({ thingtime: 'subspace', shareId: { $in: active.map((member: any) => String(member.targetId)) }, subspaceMediaDeleting: { $ne: true } }).toArray();
  const byId = new Map<string, any>(active.map((member: any) => [String(member.targetId), member]));
  const ids = subspaces.flatMap((subspace: any) => { const ids = subspaceMessagingIds(String(subspace.shareId)); return [ids.communityId, ids.chatId]; });
  const [containers, myRows] = await Promise.all([
    things.find({ shareId: { $in: ids }, thingtime: { $in: ['community', 'chat'] } } as any).toArray(),
    things.find({ ownerId: viewerId, targetId: { $in: ids }, thingtime: { $in: ['community-member', 'chat-member'] } } as any).toArray()
  ]);
  const existing = new Set(containers.map((doc: any) => String(doc.shareId)));
  const joined = new Set(myRows.filter((doc: any) => doc.thingtime.includes('community-member') || doc.crystal?.state === 'active').map((doc: any) => String(doc.targetId)));
  for (const subspace of subspaces) {
    const ids = subspaceMessagingIds(String(subspace.shareId));
    if (existing.has(ids.communityId) && existing.has(ids.chatId) && joined.has(ids.communityId) && joined.has(ids.chatId)) continue;
    try {
      await withMessengerStorageTransaction(async session => {
        const fresh = await things.findOne({ thingtime: 'subspace', shareId: subspace.shareId, subspaceMediaDeleting: { $ne: true } } as any, { session });
        if (!fresh) return;
        await things.updateOne({ _id: fresh._id } as any, { $set: { updatedAt: new Date() } }, { session });
        await ensureSubspaceMessaging(fresh, session);
        await ensureSubspaceMessagingMember(fresh, byId.get(String(fresh.shareId)), session);
      });
    } catch (error: any) {
      // The unique relationship key resolves concurrent Messenger entries.
      // Retry once in a fresh transaction so an aborted Mongo session is never reused.
      if (error?.code !== 11000) throw error;
      await withMessengerStorageTransaction(async session => {
        const fresh = await things.findOne({ thingtime: 'subspace', shareId: subspace.shareId, subspaceMediaDeleting: { $ne: true } } as any, { session });
        if (!fresh) return;
        await things.updateOne({ _id: fresh._id } as any, { $set: { updatedAt: new Date() } }, { session });
        await ensureSubspaceMessaging(fresh, session);
        await ensureSubspaceMessagingMember(fresh, byId.get(String(fresh.shareId)), session);
      });
    }
  }
};

// The caller has already fenced the subspace. Drain protected objects before
// their parent rows, and remove relational children in bounded accounted
// batches so retries reclaim bytes without leaking or releasing history.
export const deleteSubspaceMessaging = async (subspaceId: string) => {
  const things = await getThingsCollection();
  const { communityId } = subspaceMessagingIds(subspaceId);
  const chats = await things.find({ thingtime: 'chat', 'crystal.communityId': communityId } as any).toArray();
  for (const chat of chats) {
    for (;;) {
      const messages = await things.find({ thingtime: 'chat-message', targetId: chat.shareId } as any).limit(100).toArray();
      if (!messages.length) break;
      for (const message of messages) {
        const cleanup = await prepareAttachmentCascadeForThing({ shareId: message.shareId, ownerId: String(message.ownerId) });
        if (cleanup.ok === false) return cleanup;
      }
      const messageIds = messages.map((doc: any) => String(doc.shareId));
      await withMessengerStorageTransaction(async session => {
        await deleteMessengerThings(things, { thingtime: 'reaction', targetId: { $in: messageIds } } as any, { session });
        await deleteMessengerThings(things, { thingtime: 'chat-message', shareId: { $in: messageIds } } as any, { session });
      });
    }
    await drainMessagingRows(things, { thingtime: 'chat-member', targetId: chat.shareId });
    await drainMessagingRows(things, { thingtime: 'chat', shareId: chat.shareId });
  }
  for (;;) {
    const emojis = await things.find({ thingtime: 'custom-emoji', targetId: communityId } as any).limit(100).toArray();
    if (!emojis.length) break;
    for (const emoji of emojis) {
      const cleanup = await prepareAttachmentCascadeForThing({ shareId: emoji.shareId, ownerId: String(emoji.ownerId) });
      if (cleanup.ok === false) return cleanup;
    }
    await deleteMessengerThings(things, { thingtime: 'custom-emoji', shareId: { $in: emojis.map((doc: any) => String(doc.shareId)) } } as any);
  }
  await drainMessagingRows(things, { thingtime: { $in: ['community-member', 'community-invite', 'chat-section'] }, targetId: communityId });
  await drainMessagingRows(things, { thingtime: 'community', shareId: communityId, 'crystal.subspaceId': subspaceId });
  await drainMessagingRows(things, { thingtime: 'subspace-embed', targetId: subspaceId });
  return { ok: true as const };
};

const drainMessagingRows = async (things: any, filter: any) => {
  for (;;) {
    const docs = await things.find(filter).project({ shareId: 1 }).limit(100).toArray();
    if (!docs.length) break;
    await deleteMessengerThings(things, { $and: [filter, { shareId: { $in: docs.map((doc: any) => String(doc.shareId)) } }] } as any);
  }
};
