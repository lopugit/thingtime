// Subspace membership is authoritative. Messenger rows hold preferences and
// receipts only; a stale community/chat membership can never restore access.
import { membershipOfDoc, isActiveMember } from '../subspaces/gate';
import { thingUniqueKeyFilter } from '../mongodb/uniqueKeys';

export const subspaceMessagingIds = (id: string) => ({
  communityId: `subspace-space-${id}`,
  chatId: `subspace-general-${id}`
});
export const linkedSubspaceId = (community: any): string | null =>
  typeof community?.crystal?.subspaceId === 'string' && community.crystal.subspaceId ? community.crystal.subspaceId : null;
export const messagingRole = (role: unknown): 'owner' | 'admin' | 'member' => role === 'owner' ? 'owner' : role === 'moderator' ? 'admin' : 'member';

export const subspaceMessagingAccess = async (things: any, community: any, userId: string, session?: any) => {
  const id = linkedSubspaceId(community);
  if (!id) return null;
  const options = session ? { session } : {};
  const [subspace, member] = await Promise.all([
    things.findOne({ thingtime: 'subspace', shareId: id }, options),
    things.findOne({ thingtime: 'subspace-member', ownerId: userId, targetId: id,
      ...thingUniqueKeyFilter('subspaceMemberKey', `${id}:${userId}`) }, options)
  ]);
  const membership = member ? membershipOfDoc(member) : null;
  if (!subspace || subspace.subspaceMediaDeleting === true || !isActiveMember(membership)) return { allowed: false as const };
  return { allowed: true as const, subspace, member, role: messagingRole(membership!.role) };
};

// Batch gate before previews, unread counters or membership metadata are
// projected. Reads exact memberships for the requested subspaces, without the
// bounded viewer-role snapshot whose misses may omit a ban.
export const filterSubspaceMessagingChats = async (things: any, chats: any[], userId: string): Promise<any[]> => {
  const communityIds = [...new Set(chats.map(chat => chat.crystal?.communityId).filter(Boolean))];
  if (!communityIds.length) return chats;
  const communities = await things.find({ thingtime: 'community', shareId: { $in: communityIds } }).toArray();
  const byId = new Map<string, any>(communities.map((doc: any) => [String(doc.shareId), doc]));
  const subspaceIds = [...new Set(communities.map((doc: any) => linkedSubspaceId(doc)).filter(Boolean))];
  const allowed = new Set<string>();
  const roles = new Map<string, 'owner' | 'admin' | 'member'>();
  if (subspaceIds.length) {
    const [subspaces, memberships] = await Promise.all([
      things.find({ thingtime: 'subspace', shareId: { $in: subspaceIds }, subspaceMediaDeleting: { $ne: true } }).toArray(),
      things.find({ thingtime: 'subspace-member', ownerId: userId, targetId: { $in: subspaceIds } }).toArray()
    ]);
    const live = new Set(subspaces.map((doc: any) => String(doc.shareId)));
    for (const doc of memberships) if (live.has(String(doc.targetId)) && isActiveMember(membershipOfDoc(doc))) {
      allowed.add(String(doc.targetId));
      roles.set(String(doc.targetId), messagingRole(doc.crystal?.role));
    }
  }
  return chats.filter(chat => {
    const communityId = chat.crystal?.communityId;
    if (!communityId) return true;
    const community = byId.get(communityId);
    if (!community) return false;
    const subspaceId = linkedSubspaceId(community);
    if (subspaceId && allowed.has(subspaceId)) { chat.subspaceViewerRole = roles.get(subspaceId); chat.subspaceId = subspaceId; }
    return !subspaceId || allowed.has(subspaceId);
  });
};

export const currentSubspaceChatMembers = async (things: any, chat: any, members: any[]): Promise<any[]> => {
  if (!chat) return [];
  if (!chat.crystal?.communityId) return members;
  const community = await things.findOne({ thingtime: 'community', shareId: chat.crystal.communityId });
  const id = linkedSubspaceId(community);
  if (!id) return members;
  const roster = await things.find({ thingtime: 'subspace-member', targetId: id, ownerId: { $in: members.map(doc => String(doc.ownerId)) } }).toArray();
  const active = new Map<string, any>(roster.filter((doc: any) => isActiveMember(membershipOfDoc(doc))).map((doc: any) => [String(doc.ownerId), doc]));
  return members.filter(doc => active.has(String(doc.ownerId))).map(doc => ({ ...doc, crystal: { ...doc.crystal, role: messagingRole(active.get(String(doc.ownerId)).crystal?.role) } }));
};

export const activeSubspaceMemberCounts = async (things: any, ids: string[]): Promise<Map<string, number>> => {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const rows = await things.aggregate([
    { $match: { thingtime: 'subspace-member', targetId: { $in: wanted }, 'crystal.left': { $ne: true }, 'crystal.pending': { $ne: true },
      $or: [{ 'crystal.banned': { $ne: true } }, { 'crystal.banUntil': { $ne: null, $lte: new Date() } }] } },
    { $group: { _id: '$targetId', count: { $sum: 1 } } }
  ]).toArray();
  return new Map(rows.map((row: any) => [String(row._id), Number(row.count) || 0]));
};
