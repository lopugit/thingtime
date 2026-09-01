// The follow graph: one `follow` thing per (follower, followee) edge, unique
// via crystal.followKey (partial index). Deliberately minimal — it exists to
// power the messenger request buckets (follower vs unknown) and to be the
// graph the acl circle entries (tt:userFriends…) can plug into later.
// Follow edges are identity state shared by Messenger, profile/social reads,
// notifications, and ACL decisions. They must never follow a caller-selected
// data-plane override: a custom Mongo endpoint cannot forge or hide identity.
import { getHomeThingsCollection as getThingsCollection } from '../mongodb/collections';
import { findUserById, findUserByUsername, toPublicProfile } from '../auth/users';
import type { Fail} from './shared';
import { fail, followKey, newThingDoc } from './shared';
import {
	HOME_MESSENGER_STORAGE_OPTIONS,
	deleteMessengerThings,
	insertMessengerThing
} from './storage';

export const isFollowing = async (followerId: string, followeeId: string): Promise<boolean> => {
  if (!followerId || !followeeId || followerId === followeeId) return false;
  const things = await getThingsCollection();
  const doc = await things.findOne(
    { thingtime: 'follow', 'crystal.followKey': followKey(followerId, followeeId) } as any,
    { projection: { shareId: 1 } }
  );
  return !!doc;
};

// Which of `userIds` does `viewerId` follow — one $in query for request
// classification and profile decoration, never a per-user round trip.
export const followingSet = async (viewerId: string, userIds: string[]): Promise<Set<string>> => {
  const ids = Array.from(new Set(userIds.filter((id) => id && id !== viewerId)));
  if (!viewerId || !ids.length) return new Set();
  const things = await getThingsCollection();
  const keys = ids.map((id) => followKey(viewerId, id));
  const docs = await things
    .find({ thingtime: 'follow', 'crystal.followKey': { $in: keys } } as any, { projection: { targetId: 1 } })
    .toArray();
  return new Set(docs.map((d: any) => String(d.targetId)));
};

// Which of `candidateIds` follow `targetId` — the reverse of followingSet,
// one $in query. Used to classify group invites like DM requests.
export const followersOfSet = async (candidateIds: string[], targetId: string): Promise<Set<string>> => {
  const ids = Array.from(new Set(candidateIds.filter((id) => id && id !== targetId)));
  if (!targetId || !ids.length) return new Set();
  const things = await getThingsCollection();
  const keys = ids.map((id) => followKey(id, targetId));
  const docs = await things
    .find({ thingtime: 'follow', 'crystal.followKey': { $in: keys } } as any, { projection: { ownerId: 1 } })
    .toArray();
  return new Set(docs.map((d: any) => String(d.ownerId)));
};

export type FollowStatusResult =
  | Fail
  | { ok: true; user: ReturnType<typeof toPublicProfile>; following: boolean; followsYou: boolean; followerCount: number; followingCount: number };

const resolveTargetUser = async (input: { userId?: unknown; username?: unknown }) => {
  if (typeof input.userId === 'string' && input.userId.trim()) return findUserById(input.userId.trim());
  if (typeof input.username === 'string' && input.username.trim()) return findUserByUsername(input.username.trim());
  return null;
};

export const followStatus = async (viewerId: string, input: { userId?: unknown; username?: unknown }): Promise<FollowStatusResult> => {
  const target = await resolveTargetUser(input);
  if (!target) return fail(404, 'User not found');
  const targetId = String((target as any)._id);
  const things = await getThingsCollection();
  const [following, followsYou, followerCount, followingCount] = await Promise.all([
    isFollowing(viewerId, targetId),
    isFollowing(targetId, viewerId),
    things.countDocuments({ thingtime: 'follow', targetId } as any),
    things.countDocuments({ thingtime: 'follow', ownerId: targetId } as any)
  ]);
  return { ok: true, user: toPublicProfile(target), following, followsYou, followerCount, followingCount };
};

export type ToggleFollowResult =
  | Fail
  | { ok: true; following: boolean; created: boolean; user: ReturnType<typeof toPublicProfile> };

export const toggleFollow = async (
  viewerId: string,
  input: { userId?: unknown; username?: unknown; follow?: unknown }
): Promise<ToggleFollowResult> => {
  const target = await resolveTargetUser(input);
  if (!target) return fail(404, 'User not found');
  const targetId = String((target as any)._id);
  if (targetId === viewerId) return fail(400, 'You cannot follow yourself 🪞');
  const wantFollow = input.follow !== false;
  const things = await getThingsCollection();
  const key = followKey(viewerId, targetId);
  if (!wantFollow) {
    await deleteMessengerThings(things, { thingtime: 'follow', 'crystal.followKey': key } as any, HOME_MESSENGER_STORAGE_OPTIONS);
    return { ok: true, following: false, created: false, user: toPublicProfile(target) };
  }
  let created = false;
  try {
    await insertMessengerThing(
			things,
			newThingDoc('follow', { ownerId: viewerId, targetId, crystal: { followKey: key } }) as any,
			HOME_MESSENGER_STORAGE_OPTIONS
		);
    created = true;
  } catch (err: any) {
    // duplicate = already following (race) — toggle-on is idempotent
    if (err?.code !== 11000) throw err;
  }
  return { ok: true, following: true, created, user: toPublicProfile(target) };
};
