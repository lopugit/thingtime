// Seeds users by calling the REAL register path (registerUser), never by
// writing to Mongo directly — so seeded users == real signups
// (see FUNDAMENTALS.md §2). Idempotent: re-running skips existing users.
// Feed seeding follows the same rule: posts, profiles, reactions, comments and
// demo algorithms all go through the exact utils the API routes call.
//
// Serverless-friendly: every stage takes an optional wall-clock deadline and
// hands back partial progress (halted: true) when it hits it, so a Vercel
// populate invocation that can't finish inside its function budget still
// commits what it managed — repeated idempotent calls converge. Stages can
// also be selected individually (options.stages) so a converged environment
// can re-run just one stage without re-walking the others.

import { registerUser } from '~/api/utils/auth/registerUser';
import { findUserByUsername, updateUserProfile } from '~/api/utils/auth/users';
import { createAlgorithm, listAlgorithmsForUser } from '~/api/utils/algorithms/algorithms';
import { addComment, createPost, createThing, toggleReaction } from '~/api/utils/things/things';

import { getUsers, type SeedUser } from './data/users';
import {
  getAlgorithms,
  getComments,
  getFeedUsers,
  getPosts,
  getProfiles,
  getReactions
} from './data/feed';
import { getSampleSchemas } from './data/schemas';

const FOREVER = Number.POSITIVE_INFINITY;

const registerAll = async (users: SeedUser[], deadlineAt = FOREVER) => {
  let created = 0;
  let skipped = 0;
  let halted = false;

  for (const user of users) {
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
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

  return { created, skipped, total: users.length, halted };
};

export const saveUsers = async (deadlineAt = FOREVER) =>
  registerAll([...(await getUsers()), ...(await getFeedUsers())], deadlineAt);

const userIdByUsername = async (username: string): Promise<string | null> => {
  const user = await findUserByUsername(username);
  return user ? String(user._id) : null;
};

// Profiles only apply to users with no profile content yet — re-seeding must
// never clobber edits a seeded user made through the real profile UI.
export const saveProfiles = async (deadlineAt = FOREVER) => {
  let applied = 0;
  let skipped = 0;
  let halted = false;
  for (const profile of await getProfiles()) {
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
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
  return { applied, skipped, halted };
};

// Posts carry fixed shareIds; createPost 409s on a duplicate, which we treat
// as an idempotent skip (matching registerUser). Reactions/comments only apply
// to posts created in THIS run so re-seeding never toggles reactions off or
// duplicates comments.
export const savePosts = async (deadlineAt = FOREVER) => {
  const createdIds = new Set<string>();
  let created = 0;
  let skipped = 0;
  let halted = false;

  const posts = await getPosts();
  for (const post of posts) {
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
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
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
    if (!createdIds.has(reaction.postShareId)) continue;
    const userId = await userIdByUsername(reaction.username);
    if (!userId) continue;
    const result = await toggleReaction(userId, reaction.postShareId, reaction.emoji);
    if (result.ok === true) reactions++;
  }

  let comments = 0;
  for (const comment of await getComments()) {
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
    if (!createdIds.has(comment.postShareId)) continue;
    const userId = await userIdByUsername(comment.username);
    if (!userId) continue;
    const result = await addComment(userId, comment.postShareId, comment.text);
    if (result.ok === true) comments++;
  }

  return { created, skipped, total: posts.length, reactions, comments, halted };
};

// Demo algorithms — skipped when the user already has one by the same name,
// so re-seeding never duplicates or clobbers real usage.
export const saveAlgorithms = async (deadlineAt = FOREVER) => {
  let created = 0;
  let skipped = 0;
  let halted = false;

  const seeds = await getAlgorithms();
  for (const seed of seeds) {
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
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

  return { created, skipped, total: seeds.length, halted };
};

// Sample schema things ride fixed shareIds (sample-schema-<slug>) through the
// real createThing path — a duplicate 409s into an idempotent skip, matching
// the post fixtures. Several carry `extended` sidecars and serialised `render`
// components, so the seeded DB exercises both pipelines end-to-end.
export const saveSchemas = async (deadlineAt = FOREVER) => {
  let created = 0;
  let skipped = 0;
  let halted = false;

  const seeds = await getSampleSchemas();
  for (const seed of seeds) {
    if (Date.now() >= deadlineAt) {
      halted = true;
      break;
    }
    const userId = await userIdByUsername(seed.owner);
    if (!userId) throw new Error(`Seed schema ${seed.slug}: unknown user ${seed.owner}`);

    const crystal: Record<string, unknown> = {
      name: seed.name,
      description: seed.description,
      fields: seed.fields
    };
    if (seed.render) crystal.render = seed.render;

    const result = await createThing(userId, {
      thingtime: ['schema'],
      crystal,
      acl: ['tt:all'],
      tags: seed.tags || [],
      extended: seed.extended,
      shareId: `sample-schema-${seed.slug}`,
      createdAt: seed.ageHours ? new Date(Date.now() - seed.ageHours * 3_600_000) : undefined
    });

    if (result.ok === true) {
      created++;
    } else if (result.status === 409) {
      skipped++;
    } else {
      throw new Error(`Seed schema ${seed.slug} failed: ${result.error}`);
    }
  }

  return { created, skipped, total: seeds.length, halted };
};

export const SETUP_STAGES = ['users', 'profiles', 'posts', 'algorithms', 'schemas'] as const;
export type SetupStage = (typeof SETUP_STAGES)[number];

export type SetupOptions = {
  // wall-clock deadline (ms epoch): stages hand back partial progress when
  // they hit it, so serverless invocations converge across repeated calls
  deadlineAt?: number;
  // run only these stages (default: all, in order)
  stages?: SetupStage[];
};

export const setup = async (options: SetupOptions = {}) => {
  const deadlineAt = options.deadlineAt ?? FOREVER;
  const wants = (stage: SetupStage) => !options.stages || options.stages.includes(stage);
  const overBudget = () => Date.now() >= deadlineAt;
  try {
    let halted = false;
    const users = wants('users') && !overBudget() ? await saveUsers(deadlineAt) : null;
    halted = halted || !!users?.halted;
    const profiles = wants('profiles') && !overBudget() ? await saveProfiles(deadlineAt) : null;
    halted = halted || !!profiles?.halted;
    const posts = wants('posts') && !overBudget() ? await savePosts(deadlineAt) : null;
    halted = halted || !!posts?.halted;
    const algorithms = wants('algorithms') && !overBudget() ? await saveAlgorithms(deadlineAt) : null;
    halted = halted || !!algorithms?.halted;
    const schemas = wants('schemas') && !overBudget() ? await saveSchemas(deadlineAt) : null;
    halted = halted || !!schemas?.halted;
    // complete means every REQUESTED stage ran to its end this invocation —
    // a stage skipped for budget (null while wanted) also counts as halted
    const skippedForBudget = SETUP_STAGES.some(
      (stage) =>
        wants(stage) &&
        ((stage === 'users' && !users) ||
          (stage === 'profiles' && !profiles) ||
          (stage === 'posts' && !posts) ||
          (stage === 'algorithms' && !algorithms) ||
          (stage === 'schemas' && !schemas))
    );
    return {
      ok: true as const,
      complete: !halted && !skippedForBudget,
      ...(users || {}),
      profiles,
      posts,
      algorithms,
      schemas
    };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || String(err) };
  }
};

export default setup;
