import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

// The social graph is identity: follow/friend edges always live on the home
// deployment DB regardless of any data-plane endpoint override (they gate
// notifications and the tt:userFriends acl circle — an override endpoint must
// never be able to fake or hide relationships).
import { getHomeThingsCollection as getThingsCollection, getUsersCollection } from '../mongodb/collections';
import { findUserById, findUserByUsername } from '../auth/users';
import type { PublicProfile } from '../auth/users';
import { isFollowing, toggleFollow } from '../messenger/follows';
import { relationshipUniqueKeys } from '../messenger/shared';
import { emitNotification } from '../notifications/notifications';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { effectiveProfileMediaUrl } from '~/utils/profileMediaUrl';

// Two separate relationship types (see registry.ts follow/friend schemas):
//   follow — one-way, no approval; one thing per (follower, followed), deduped
//            by crystal.followKey / the things_follow_key_unique partial index.
//   friend — mutual, request → accept; ONE thing per unordered pair keyed by
//            crystal.friendKey ('<minId>~<maxId>', things_friend_unique), so
//            crossed/duplicate requests are structurally impossible.
// Both kinds are PROTECTED: only these utils mint them.

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type FriendState = 'none' | 'pending-outgoing' | 'pending-incoming' | 'friends';
export type FriendIntent = 'request' | 'cancel' | 'accept' | 'decline' | 'unfriend';
export const FRIEND_INTENTS: FriendIntent[] = ['request', 'cancel', 'accept', 'decline', 'unfriend'];

const MAX_FOLLOWING_PER_USER = 5000;
const MAX_FRIENDS_PER_USER = 2000;
const MAX_CONNECTIONS_LIMIT = 50;
const DEFAULT_CONNECTIONS_LIMIT = 20;

const friendKeyOf = (a: string, b: string): string => [a, b].sort().join('~');

const isDuplicateKey = (err: any): boolean => err?.code === 11000;

// Resolve the OTHER user of a social action from a body/query that may carry
// either id or username. Returns the dual-era user doc (users.ts adapter
// shape) or null.
export const resolveSocialTarget = async (input: { userId?: unknown; username?: unknown }) => {
  if (typeof input.userId === 'string' && input.userId.trim()) {
    return findUserById(input.userId.trim());
  }
  if (typeof input.username === 'string' && input.username.trim()) {
    return findUserByUsername(input.username.trim());
  }
  return null;
};

// ---------------------------------------------------------------------------
// Follows

export type SetFollowResult = Fail | { ok: true; following: boolean; followerCount: number };

export const setFollow = async (
  viewer: { id: string; username?: string | null; displayName?: string | null },
  target: { _id?: any; username?: string } | null,
  follow?: unknown
): Promise<SetFollowResult> => {
  if (!target?._id) return fail(404, 'User not found');
  const targetId = String(target._id);
  if (targetId === viewer.id) return fail(400, 'You already have your own undivided attention 💅');

  const things = await getThingsCollection();
  const existing = await isFollowing(viewer.id, targetId);
  const desired = typeof follow === 'boolean' ? follow : !existing;

  if (desired && !existing) {
    const followingCount = await things.countDocuments({ thingtime: 'follow', ownerId: viewer.id } as any);
    if (followingCount >= MAX_FOLLOWING_PER_USER) {
      return fail(400, `Following limit reached (${MAX_FOLLOWING_PER_USER})`);
    }
  }

  // One canonical writer for every caller: messenger + social both persist the
  // home-pinned crystal.followKey shape. `created` identifies the unique-index
  // winner so concurrent idempotent follows cannot emit duplicate notices.
  const mutation = await toggleFollow(viewer.id, { userId: targetId, follow: desired });
  if (mutation.ok === false) return mutation;
  if (mutation.created) {
    await emitNotification({
      recipientId: targetId,
      type: 'new-follower',
      actor: { id: viewer.id, username: viewer.username, displayName: viewer.displayName },
      targetId: viewer.id
    });
  }

  const followerCount = await things.countDocuments({ thingtime: 'follow', targetId } as any);
  return { ok: true, following: mutation.following, followerCount };
};

// Newest follower ids, capped — the post fan-out audience.
export const followerIdsOf = async (userId: string, cap: number): Promise<string[]> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'follow', targetId: userId } as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(cap)
    .project({ ownerId: 1 })
    .toArray();
  return docs.map((doc: any) => String(doc.ownerId));
};

// ---------------------------------------------------------------------------
// Friends

export type FriendActionResult = Fail | { ok: true; friendState: FriendState };

const friendStateOf = (doc: any, viewerId: string): FriendState => {
  if (!doc) return 'none';
  if (doc.crystal?.status === 'accepted') return 'friends';
  return String(doc.ownerId) === viewerId ? 'pending-outgoing' : 'pending-incoming';
};

export const friendAction = async (
  viewer: { id: string; username?: string | null; displayName?: string | null },
  target: { _id?: any; username?: string } | null,
  intent: unknown
): Promise<FriendActionResult> => {
  if (!target?._id) return fail(404, 'User not found');
  const targetId = String(target._id);
  if (targetId === viewer.id) return fail(400, 'Self-friendship is called self-care, and you already have it 🫶');
  if (typeof intent !== 'string' || !FRIEND_INTENTS.includes(intent as FriendIntent)) {
    return fail(400, `intent must be one of ${FRIEND_INTENTS.join(', ')}`);
  }

  const things = await getThingsCollection();
  const key = friendKeyOf(viewer.id, targetId);
  const existing = await things.findOne({ thingtime: 'friend', 'crystal.friendKey': key } as any);
  const now = new Date();
  const actor = { id: viewer.id, username: viewer.username, displayName: viewer.displayName };

  const accept = async (doc: any): Promise<FriendActionResult> => {
		await things.updateOne({ _id: doc._id, 'crystal.status': 'pending' } as any, { $set: { 'crystal.status': 'accepted', updatedAt: now } });
    await emitNotification({
      recipientId: String(doc.ownerId),
      type: 'friend-accepted',
      actor,
      targetId: viewer.id
    });
    return { ok: true, friendState: 'friends' };
  };

  switch (intent as FriendIntent) {
    case 'request': {
      if (existing) {
        // requesting someone who already asked YOU is an accept, not a dupe
        if (existing.crystal?.status === 'pending' && String(existing.targetId) === viewer.id) {
          return accept(existing);
        }
        return { ok: true, friendState: friendStateOf(existing, viewer.id) };
      }
      const friendCount = await things.countDocuments({
        thingtime: 'friend',
        'crystal.status': 'accepted',
        $or: [{ ownerId: viewer.id }, { targetId: viewer.id }]
      } as any);
      if (friendCount >= MAX_FRIENDS_PER_USER) {
        return fail(400, `Friend limit reached (${MAX_FRIENDS_PER_USER})`);
      }
      try {
        await things.insertOne({
          shareId: randomUUID(),
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          thingtime: ['friend'],
          crystal: { status: 'pending', friendKey: key },
          // dedupe rides the server-only uniqueKeys namespace (messenger/
          // shared.ts) — the same stamp newThingDoc applies for the other
          // relationship kinds; this writer builds its doc inline for the
          // owner-only acl, so it stamps through the shared helper directly
          uniqueKeys: relationshipUniqueKeys('friend', { friendKey: key }),
          ownerId: viewer.id,
          acl: [ACL_OWNER],
          targetId,
          tags: [],
          createdAt: now,
          updatedAt: now
        } as any);
      } catch (err: any) {
        if (!isDuplicateKey(err)) throw err;
        // raced a crossed request — re-read and report the real state
        const raced = await things.findOne({ thingtime: 'friend', 'crystal.friendKey': key } as any);
        return { ok: true, friendState: friendStateOf(raced, viewer.id) };
      }
      await emitNotification({
        recipientId: targetId,
        type: 'friend-request',
        actor,
        targetId: viewer.id
      });
      return { ok: true, friendState: 'pending-outgoing' };
    }
    case 'cancel': {
      if (existing?.crystal?.status === 'pending' && String(existing.ownerId) === viewer.id) {
        await things.deleteOne({ _id: existing._id } as any);
        return { ok: true, friendState: 'none' };
      }
      return { ok: true, friendState: friendStateOf(existing, viewer.id) };
    }
    case 'accept': {
      if (existing?.crystal?.status === 'pending' && String(existing.targetId) === viewer.id) {
        return accept(existing);
      }
      if (existing?.crystal?.status === 'accepted') return { ok: true, friendState: 'friends' };
      return fail(404, 'No pending friend request from that user');
    }
    case 'decline': {
      if (existing?.crystal?.status === 'pending' && String(existing.targetId) === viewer.id) {
        await things.deleteOne({ _id: existing._id } as any);
        return { ok: true, friendState: 'none' };
      }
      return { ok: true, friendState: friendStateOf(existing, viewer.id) };
    }
    case 'unfriend': {
      if (existing?.crystal?.status === 'accepted') {
        await things.deleteOne({ _id: existing._id } as any);
        return { ok: true, friendState: 'none' };
      }
      return { ok: true, friendState: friendStateOf(existing, viewer.id) };
    }
  }
  return fail(400, 'Unsupported intent');
};

// Accepted-friend ids of one user (both directions of the pair doc). Powers
// the tt:userFriends acl circle (AclViewer.friendIds) and post fan-out.
export const friendIdsOf = async (userId: string): Promise<Set<string>> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({
      thingtime: 'friend',
      'crystal.status': 'accepted',
      $or: [{ ownerId: userId }, { targetId: userId }]
    } as any)
    .project({ ownerId: 1, targetId: 1 })
    .toArray();
  const ids = new Set<string>();
  for (const doc of docs as any[]) {
    const other = String(doc.ownerId) === userId ? String(doc.targetId) : String(doc.ownerId);
    if (other && other !== userId) ids.add(other);
  }
  return ids;
};

// The viewer's audience-group memberships — the preload behind tt:group/<id>
// acl entries (AclViewer.groupIds), shaped exactly like friendIdsOf: member
// docs carry targetId = the MEMBER's user id (api/utils/groups), so one query
// on the existing (thingtime, targetId) access pattern answers.
export const groupIdsOf = async (userId: string): Promise<Set<string>> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'group-member', targetId: userId } as any)
    .project({ crystal: 1 })
    .limit(2000)
    .toArray();
  const ids = new Set<string>();
  for (const doc of docs as any[]) {
    const groupId = String((doc as any).crystal?.groupId || '');
    if (groupId) ids.add(groupId);
  }
  return ids;
};

// ---------------------------------------------------------------------------
// Read side: counts, viewer state, lists

export type RelationshipSummary = {
  ok: true;
  userId: string;
  counts: { followers: number; following: number; friends: number };
  viewer: {
    following: boolean;
    followedBy: boolean;
    friendState: FriendState;
    // pending requests the viewer received (shown as a badge on their own profile)
    incomingRequests?: number;
  } | null;
};

export const relationshipSummary = async (viewerId: string | null, target: { _id?: any } | null): Promise<Fail | RelationshipSummary> => {
  if (!target?._id) return fail(404, 'User not found');
  const userId = String(target._id);
  const things = await getThingsCollection();

  const [followers, following, friends] = await Promise.all([
    things.countDocuments({ thingtime: 'follow', targetId: userId } as any),
    things.countDocuments({ thingtime: 'follow', ownerId: userId } as any),
    things.countDocuments({
      thingtime: 'friend',
      'crystal.status': 'accepted',
      $or: [{ ownerId: userId }, { targetId: userId }]
    } as any)
  ]);

  let viewer: RelationshipSummary['viewer'] = null;
  if (viewerId) {
    if (viewerId === userId) {
      const incomingRequests = await things.countDocuments({
        thingtime: 'friend',
        'crystal.status': 'pending',
        targetId: viewerId
      } as any);
      viewer = { following: false, followedBy: false, friendState: 'none', incomingRequests };
    } else {
      const [followDoc, followedByDoc, friendDoc] = await Promise.all([
        things.findOne({ thingtime: 'follow', ownerId: viewerId, targetId: userId } as any, { projection: { _id: 1 } }),
        things.findOne({ thingtime: 'follow', ownerId: userId, targetId: viewerId } as any, { projection: { _id: 1 } }),
        things.findOne({ thingtime: 'friend', 'crystal.friendKey': friendKeyOf(viewerId, userId) } as any)
      ]);
      viewer = {
        following: !!followDoc,
        followedBy: !!followedByDoc,
        friendState: friendStateOf(friendDoc, viewerId)
      };
    }
  }

  return { ok: true, userId, counts: { followers, following, friends }, viewer };
};

// Batch dual-era public-profile loader (order preserved by the caller).
const loadPublicProfiles = async (ids: string[]): Promise<Map<string, PublicProfile>> => {
  const unique = [...new Set(ids)].filter(Boolean);
  const map = new Map<string, PublicProfile>();
  if (!unique.length) return map;
  const things = await getThingsCollection();
  const objectIds = unique.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const [userThings, legacyUsers] = await Promise.all([
    things
      .find({ thingtime: 'user', shareId: { $in: unique } } as any)
			.project({ shareId: 1, crystal: 1, avatarAttachmentId: 1, bannerAttachmentId: 1, createdAt: 1 })
      .toArray(),
    objectIds.length
			? (
					await getUsersCollection()
			  )
          .find({ _id: { $in: objectIds } })
					.project({
						username: 1,
						displayName: 1,
						bio: 1,
						avatarUrl: 1,
						bannerUrl: 1,
						avatarAttachmentId: 1,
						bannerAttachmentId: 1,
						createdAt: 1
					})
          .toArray()
      : Promise.resolve([])
  ]);
  for (const doc of legacyUsers as any[]) {
    map.set(String(doc._id), {
      id: String(doc._id),
      username: doc.username,
      displayName: doc.displayName ?? null,
      bio: typeof doc.bio === 'string' ? doc.bio : null,
			avatarUrl: effectiveProfileMediaUrl(doc, 'avatar'),
			bannerUrl: effectiveProfileMediaUrl(doc, 'banner'),
      createdAt: new Date(doc.createdAt).toISOString()
    });
  }
  for (const doc of userThings as any[]) {
    map.set(String(doc.shareId), {
      id: String(doc.shareId),
      username: doc.crystal?.username,
      displayName: doc.crystal?.displayName ?? null,
      bio: typeof doc.crystal?.bio === 'string' ? doc.crystal.bio : null,
			avatarUrl: effectiveProfileMediaUrl(doc, 'avatar'),
			bannerUrl: effectiveProfileMediaUrl(doc, 'banner'),
      createdAt: new Date(doc.createdAt).toISOString()
    });
  }
  return map;
};

export type ConnectionsType = 'followers' | 'following' | 'friends' | 'requests';

export type ConnectionsResult = Fail | { ok: true; users: PublicProfile[]; nextBefore: string | null };

// Public connection lists (followers/following/friends are public, matching
// the public counts). 'requests' (pending incoming) is viewer-private.
export const listConnections = async (
  viewerId: string | null,
  target: { _id?: any } | null,
  type: unknown,
  options: { limit?: unknown; before?: unknown } = {}
): Promise<ConnectionsResult> => {
  if (!target?._id) return fail(404, 'User not found');
  const userId = String(target._id);
  if (type !== 'followers' && type !== 'following' && type !== 'friends' && type !== 'requests') {
    return fail(400, 'type must be followers, following, friends, or requests');
  }
  if (type === 'requests' && viewerId !== userId) {
    return fail(403, 'Only you can see your pending friend requests');
  }

  const limitRaw = Number(options.limit);
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), MAX_CONNECTIONS_LIMIT) : DEFAULT_CONNECTIONS_LIMIT;
	const before = typeof options.before === 'string' && !Number.isNaN(Date.parse(options.before)) ? new Date(options.before) : null;

  const filter: Record<string, any> =
    type === 'followers'
      ? { thingtime: 'follow', targetId: userId }
      : type === 'following'
        ? { thingtime: 'follow', ownerId: userId }
        : type === 'requests'
          ? { thingtime: 'friend', 'crystal.status': 'pending', targetId: userId }
          : { thingtime: 'friend', 'crystal.status': 'accepted', $or: [{ ownerId: userId }, { targetId: userId }] };
  if (before) filter.createdAt = { $lt: before };

  const things = await getThingsCollection();
  const docs = await things
    .find(filter as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(limit)
    .project({ ownerId: 1, targetId: 1, createdAt: 1 })
    .toArray();

  const otherIdOf = (doc: any): string =>
    type === 'followers' || type === 'requests'
      ? String(doc.ownerId)
      : type === 'following'
        ? String(doc.targetId)
        : String(doc.ownerId) === userId
          ? String(doc.targetId)
          : String(doc.ownerId);

  const profiles = await loadPublicProfiles((docs as any[]).map(otherIdOf));
	const users = (docs as any[]).map((doc) => profiles.get(otherIdOf(doc))).filter((profile): profile is PublicProfile => !!profile);
	const nextBefore = docs.length === limit ? new Date((docs as any[])[docs.length - 1].createdAt).toISOString() : null;
  return { ok: true, users, nextBefore };
};
