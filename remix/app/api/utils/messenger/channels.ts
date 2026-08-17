// The channel directory of one community: everything the viewer is in plus
// every public channel they could join (private channels stay invisible to
// non-members — existence is part of the secret).
import { getThingsCollection } from '../mongodb/collections';
import type { Fail} from './shared';
import { communityRoleOf, fail, findThingByKind } from './shared';

export type CommunityChannel = {
  id: string;
  name: string | null;
  topic: string | null;
  sectionId: string | null;
  channelVisibility: 'public' | 'private';
  memberCount: number;
  joined: boolean;
  createdAt: string;
};

export type ListChannelsResult = Fail | { ok: true; channels: CommunityChannel[] };

export const listCommunityChannels = async (viewerId: string, communityId: unknown): Promise<ListChannelsResult> => {
  if (typeof communityId !== 'string' || !communityId.trim()) return fail(400, 'Community id required');
  const community = await findThingByKind('community', communityId.trim());
  if (!community) return fail(404, 'Community not found');
  const role = await communityRoleOf(community.shareId, viewerId);
  if (!role) return fail(403, 'You are not a member of this community');
  const things = await getThingsCollection();
  const channelDocs = await things
    .find({ thingtime: 'chat', 'crystal.communityId': community.shareId } as any)
    .sort({ createdAt: 1, shareId: 1 })
    .limit(500)
    .toArray();
  const channelIds = channelDocs.map((c: any) => c.shareId);
  const [myMemberships, counts] = await Promise.all([
    channelIds.length
      ? things
          .find({ thingtime: 'chat-member', ownerId: viewerId, targetId: { $in: channelIds }, 'crystal.state': 'active' } as any, {
            projection: { targetId: 1 }
          })
          .toArray()
      : [],
    channelIds.length
      ? things
          .aggregate([
            { $match: { thingtime: 'chat-member', targetId: { $in: channelIds }, 'crystal.state': 'active' } },
            { $group: { _id: '$targetId', count: { $sum: 1 } } }
          ])
          .toArray()
      : []
  ]);
  const joined = new Set(myMemberships.map((m: any) => String(m.targetId)));
	const countById = new Map<string, number>(counts.map((c: any) => [String(c._id), Number(c.count) || 0] as const));
  const channels = channelDocs
    .filter((doc: any) => joined.has(doc.shareId) || (doc.crystal?.channelVisibility || 'public') === 'public')
		.map(
			(doc: any): CommunityChannel => ({
      id: doc.shareId,
      name: doc.crystal?.name ?? null,
      topic: doc.crystal?.topic ?? null,
      sectionId: doc.crystal?.sectionId ?? null,
      channelVisibility: doc.crystal?.channelVisibility === 'private' ? 'private' : 'public',
      memberCount: countById.get(doc.shareId) || 0,
      joined: joined.has(doc.shareId),
      createdAt: new Date(doc.createdAt).toISOString()
			})
		);
  return { ok: true, channels };
};
