import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { followStatus, isFollowing, toggleFollow } from '~/api/utils/messenger/follows';
import { emitNotification } from '~/api/utils/notifications/notifications';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { resolveSocialTarget } from '~/api/utils/users/social';

// GET /api/v1/users/follow?username= | ?userId= — follow relationship between
// the caller and that user (following / followsYou) plus their counts.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const result = await followStatus(user.id, {
    username: params.get('username') || undefined,
    userId: params.get('userId') || undefined
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/users/follow — { userId | username, follow? } — follow or
// unfollow another user (one-way, no approval). Omitting `follow` toggles;
// passing it makes the call idempotent. Edges are minted through the messenger
// follow graph (crystal.followKey) so DM request bucketing and the social read
// endpoints (/users/relationships, /users/connections — both filter on
// ownerId/targetId only) all see the same edge shape; a genuinely NEW follow
// emits a new-follower notification, and following someone routes their future
// DMs straight to your inbox instead of message requests.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limit = await enforceRateLimit(request, 'users.follow', `user:${user.id}`);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'You’re following very enthusiastically — take a breather 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, 16 * 1024);
  const target = await resolveSocialTarget({ userId: body?.userId, username: body?.username });
  if (!target?._id) {
    return json({ ok: false, error: 'User not found' }, { status: 404 });
  }
  const targetId = String(target._id);
  if (targetId === user.id) {
    return json({ ok: false, error: 'You already have your own undivided attention 💅' }, { status: 400 });
  }

  // Prior state drives both the omitted-`follow` toggle and notification
  // dedup — an idempotent re-follow must never re-notify the followed user.
  const wasFollowing = await isFollowing(user.id, targetId);
  const follow = typeof body?.follow === 'boolean' ? body.follow : !wasFollowing;
  const result = await toggleFollow(user.id, { userId: targetId, follow });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  if (follow && !wasFollowing) {
    await emitNotification({
      recipientId: targetId,
      type: 'new-follower',
      actor: { id: user.id, username: user.username, displayName: user.displayName },
      targetId: user.id
    });
  }

  // Re-read after the write so the response carries honest post-toggle counts
  // (the profile UI reconciles its optimistic followerCount from this).
  const status = await followStatus(user.id, { userId: targetId });
  if (status.ok === false) {
    return json({ ok: true, following: result.following, user: result.user });
  }
  return json({
    ok: true,
    following: status.following,
    followsYou: status.followsYou,
    followerCount: status.followerCount,
    followingCount: status.followingCount,
    user: status.user
  });
};
