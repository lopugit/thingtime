// Seeds users by calling the REAL register path (registerUser), never by
// writing to Mongo directly — so seeded users == real signups
// (see FUNDAMENTALS.md §2). Idempotent: re-running skips existing users.
// Feed seeding follows the same rule: posts, profiles, reactions, comments and
// demo algorithms all go through the exact utils the API routes call.

import { registerUser } from '~/api/utils/auth/registerUser';
import { findUserByUsername, updateUserProfile } from '~/api/utils/auth/users';
import { createAlgorithm, listAlgorithmsForUser } from '~/api/utils/algorithms/algorithms';
import { addComment, createPost, toggleReaction } from '~/api/utils/things/things';

import { getUsers, type SeedUser } from './data/users';
import {
  getAlgorithms,
  getComments,
  getFeedUsers,
  getPosts,
  getProfiles,
  getReactions
} from './data/feed';

const registerAll = async (users: SeedUser[]) => {
  let created = 0;
  let skipped = 0;

  for (const user of users) {
    const result = await registerUser(user);
    if (result.ok === true) {
      created++;
    } else if (result.status === 409) {
      // already exists (username/email taken) — idempotent re-seed
      skipped++;
    } else {
      throw new Error(`Seed failed for ${user.username}: ${result.error}`);
    }
  }

  return { created, skipped, total: users.length };
};

export const saveUsers = async () => registerAll([...(await getUsers()), ...(await getFeedUsers())]);

const userIdByUsername = async (username: string): Promise<string | null> => {
  const user = await findUserByUsername(username);
  return user ? String(user._id) : null;
};

// Profiles only apply to users with no profile content yet — re-seeding must
// never clobber edits a seeded user made through the real profile UI.
export const saveProfiles = async () => {
  let applied = 0;
  let skipped = 0;
  for (const profile of await getProfiles()) {
    const user = await findUserByUsername(profile.username);
    if (!user) continue;
    if (user.bio != null || user.avatarUrl != null || user.bannerUrl != null) {
      skipped++;
      continue;
    }
    const result = await updateUserProfile(String(user._id), {
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      bannerUrl: profile.bannerUrl
    });
    if (result.ok === false) {
      throw new Error(`Seed profile failed for ${profile.username}: ${result.error}`);
    }
    applied++;
  }
  return { applied, skipped };
};

// Posts carry fixed shareIds; createPost 409s on a duplicate, which we treat
// as an idempotent skip (matching registerUser). Reactions/comments only apply
// to posts created in THIS run so re-seeding never toggles reactions off or
// duplicates comments.
export const savePosts = async () => {
  const createdIds = new Set<string>();
  let created = 0;
  let skipped = 0;

  const posts = await getPosts();
  for (const post of posts) {
    const userId = await userIdByUsername(post.username);
    if (!userId) throw new Error(`Seed post ${post.shareId}: unknown user ${post.username}`);

    const result = await createPost(userId, {
      type: post.type,
      text: post.text,
      images: post.images,
      listing: post.listing,
      visibility: post.visibility,
      tags: post.tags,
      shareId: post.shareId,
      createdAt: new Date(Date.now() - post.ageHours * 3_600_000)
    });

    if (result.ok === true) {
      created++;
      createdIds.add(post.shareId);
    } else if (result.status === 409) {
      skipped++;
    } else {
      throw new Error(`Seed post ${post.shareId} failed: ${result.error}`);
    }
  }

  let reactions = 0;
  for (const reaction of await getReactions()) {
    if (!createdIds.has(reaction.postShareId)) continue;
    const userId = await userIdByUsername(reaction.username);
    if (!userId) continue;
    const result = await toggleReaction(userId, reaction.postShareId, reaction.emoji);
    if (result.ok === true) reactions++;
  }

  let comments = 0;
  for (const comment of await getComments()) {
    if (!createdIds.has(comment.postShareId)) continue;
    const userId = await userIdByUsername(comment.username);
    if (!userId) continue;
    const result = await addComment(userId, comment.postShareId, comment.text);
    if (result.ok === true) comments++;
  }

  return { created, skipped, total: posts.length, reactions, comments };
};

// Demo algorithms — skipped when the user already has one by the same name,
// so re-seeding never duplicates or clobbers real usage.
export const saveAlgorithms = async () => {
  let created = 0;
  let skipped = 0;

  const seeds = await getAlgorithms();
  for (const seed of seeds) {
    const userId = await userIdByUsername(seed.username);
    if (!userId) continue;

    const existing = await listAlgorithmsForUser(userId);
    if (existing.some((algorithm) => algorithm.name === seed.name)) {
      skipped++;
      continue;
    }

    const result = await createAlgorithm(userId, {
      name: seed.name,
      emoji: seed.emoji,
      events: seed.trainOnShareIds.map((thingId) => ({ thingId, signal: 'share' as const }))
    });
    if (result.ok === false) {
      throw new Error(`Seed algorithm ${seed.name} failed: ${result.error}`);
    }
    created++;
  }

  return { created, skipped, total: seeds.length };
};

export const setup = async () => {
  try {
    const users = await saveUsers();
    const profiles = await saveProfiles();
    const posts = await savePosts();
    const algorithms = await saveAlgorithms();
    return { ok: true as const, ...users, profiles, posts, algorithms };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || String(err) };
  }
};

export default setup;
