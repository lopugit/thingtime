import { randomUUID } from 'node:crypto';

import { getThingsCollection, withMongoTransaction } from '../mongodb/collections';
import { deleteAccountedThing, deleteAccountedThings, insertAccountedThing, insertAccountedThings, updateAccountedThing } from '../storage/accountedThings';
import { findUserById } from '../auth/users';
import { friendIdsOf } from '../users/social';
import { resolveProfiles, type FeedAuthor } from '../things/things';
import { COLLECTION_SCHEMA_VERSIONS, ACL_OWNER } from '~/schemas/registry';

// Audience groups — the reusable "share with these people" lists behind the
// custom-visibility picker (acl entries tt:group/<group id>). Everything is a
// thing (FUNDAMENTALS §3):
//
//   group          one doc per group — ownerId = creator, crystal.name.
//   group-member   one doc per (group, member) — ownerId = the GROUP OWNER
//                  (their data, their storage), targetId = the MEMBER's user
//                  id, crystal.groupId = the group's shareId. Mirroring the
//                  friend-doc shape keeps every query on existing indexes:
//                  a viewer's memberships resolve by (thingtime, targetId) —
//                  exactly how friendIdsOf resolves — so NO new index is
//                  needed (the local 64-index budget stays untouched).
//
// Both kinds are PROTECTED_THINGTIME: only these utils (via /api/v1/groups)
// mint or delete them; the generic things CRUD refuses them, and deleting a
// group removes its member docs here (they are not targetId-children of the
// group — targetId carries the member — so the generic cascade never sees
// them).

const THINGS_SCHEMA_VERSION = COLLECTION_SCHEMA_VERSIONS.things;

// A processing batch is not a product limit. Memberships remain relational.
const GROUP_BATCH_SIZE = 100;

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type PublicGroup = {
  id: string;
  name: string;
  memberCount: number;
  members: FeedAuthor[];
  createdAt: string;
  updatedAt: string;
};

const sanitizeName = (value: unknown): string | Fail => {
  if (typeof value !== 'string' || !value.trim()) return fail(400, 'Groups need a name');
  return value.trim();
};

// member ids must be real users (and never the owner — they're implicit)
const sanitizeMemberIds = async (ownerId: string, value: unknown): Promise<string[] | Fail> => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fail(400, 'memberIds must be a list of user ids');
  const wanted = [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim()))].filter(
    (id) => id !== ownerId
  );
  if (!wanted.length) return [];
  // findUserById resolves BOTH user eras (things-era user things and legacy
  // users-collection rows) — new signups only exist as user things
  for (let offset = 0; offset < wanted.length; offset += GROUP_BATCH_SIZE) {
    const resolved = await Promise.all(wanted.slice(offset, offset + GROUP_BATCH_SIZE).map(async (id) => ({ id, user: await findUserById(id) })));
    const missing = resolved.find((entry) => !entry.user);
    if (missing) return fail(400, `Unknown member user id: ${missing.id}`);
  }
  return wanted;
};

// Removal must also work after an account has been deleted. Do not require a
// live user for that side of the delta, but reject malformed input explicitly.
const normalizeMemberIds = (value: unknown): string[] | Fail => {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id.trim())) return fail(400, 'removeMemberIds must be a list of user ids');
  return [...new Set(value.map((id: string) => id.trim()))];
};

const memberIdsByGroup = async (ownerId: string, groupIds: string[]): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (!groupIds.length) return map;
  const things = await getThingsCollection();
  for (let offset = 0; offset < groupIds.length; offset += GROUP_BATCH_SIZE) {
    const docs = await things
      .find({ thingtime: 'group-member', ownerId, 'crystal.groupId': { $in: groupIds.slice(offset, offset + GROUP_BATCH_SIZE) } } as any)
      .project({ targetId: 1, crystal: 1 })
      .batchSize(GROUP_BATCH_SIZE)
      .toArray();
    for (const doc of docs as any[]) {
      const groupId = String(doc.crystal?.groupId || '');
      if (!groupId) continue;
      const list = map.get(groupId) || [];
      list.push(String(doc.targetId));
      map.set(groupId, list);
    }
  }
  return map;
};

const projectGroups = async (ownerId: string, docs: any[]): Promise<PublicGroup[]> => {
  const members = await memberIdsByGroup(ownerId, docs.map((doc) => String(doc.shareId)));
  const ids = [...new Set([...members.values()].flat())];
  const profiles = new Map<string, FeedAuthor>();
  for (let offset = 0; offset < ids.length; offset += GROUP_BATCH_SIZE) {
    for (const [id, profile] of await resolveProfiles(ids.slice(offset, offset + GROUP_BATCH_SIZE))) profiles.set(id, profile);
  }
  return docs.map((doc) => {
    const ids = members.get(String(doc.shareId)) || [];
    return {
      id: String(doc.shareId),
      name: String(doc.crystal?.name || 'Group'),
      memberCount: ids.length,
      members: ids.map((id) => profiles.get(id)).filter((entry): entry is FeedAuthor => !!entry),
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString()
    };
  });
};

export const listGroups = async (ownerId: string): Promise<{ ok: true; groups: PublicGroup[] }> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'group', ownerId } as any)
    .sort({ createdAt: -1 })
    .batchSize(GROUP_BATCH_SIZE)
    .toArray();
  return { ok: true, groups: await projectGroups(ownerId, docs as any[]) };
};

const memberDoc = (ownerId: string, groupId: string, userId: string, now: Date) => ({
  shareId: randomUUID(),
  schemaVersion: THINGS_SCHEMA_VERSION,
  thingtime: ['group-member'],
  crystal: { groupId },
  extended: null,
  ownerId,
  targetId: userId,
  acl: [ACL_OWNER],
  tags: [],
  createdAt: now,
  updatedAt: now
});

export const createGroup = async (
  ownerId: string,
  input: { name?: unknown; memberIds?: unknown }
): Promise<Fail | { ok: true; group: PublicGroup }> => {
  const name = sanitizeName(input.name);
  if (typeof name !== 'string') return name;
  const memberIds = await sanitizeMemberIds(ownerId, input.memberIds);
  if (!Array.isArray(memberIds)) return memberIds;

  const things = await getThingsCollection();

  const now = new Date();
  const doc = {
    shareId: randomUUID(),
    schemaVersion: THINGS_SCHEMA_VERSION,
    thingtime: ['group'],
    crystal: { name },
    extended: null,
    ownerId,
    targetId: null,
    acl: [ACL_OWNER],
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  await withMongoTransaction(async (session) => {
    await insertAccountedThing(things, doc as any, { session });
    for (let offset = 0; offset < memberIds.length; offset += GROUP_BATCH_SIZE) {
      await insertAccountedThings(things, memberIds.slice(offset, offset + GROUP_BATCH_SIZE).map((userId) => memberDoc(ownerId, doc.shareId, userId, now)) as any, { session });
    }
  });
  return { ok: true, group: (await projectGroups(ownerId, [doc]))[0] };
};

// The legacy memberIds field replaces the whole list. Delta fields below are
// additive, idempotent and independently batchable by clients. Every group
// mutation writes its root in the same transaction as its member rows, so
// concurrent changes to the same group conflict and the driver retries from
// a fresh snapshot. A delete cannot race a late add into orphaned membership.
export const updateGroup = async (
  ownerId: string,
  id: unknown,
  input: { name?: unknown; memberIds?: unknown; addMemberIds?: unknown; removeMemberIds?: unknown }
): Promise<Fail | { ok: true; group: PublicGroup } | { ok: true; membership: { id: string; memberCount: number } }> => {
  if (typeof id !== 'string' || !id.trim()) return fail(404, 'Group not found');
  const things = await getThingsCollection();
  const groupId = id.trim();
  // Do not disclose member validation details for another owner's group.
  if (!await things.findOne({ shareId: groupId, thingtime: 'group', ownerId } as any)) return fail(404, 'Group not found');
  if (input.memberIds !== undefined && (input.addMemberIds !== undefined || input.removeMemberIds !== undefined)) {
    return fail(400, 'Choose memberIds replacement or member deltas');
  }
  const replacement = input.memberIds === undefined ? undefined : await sanitizeMemberIds(ownerId, input.memberIds);
  if (replacement !== undefined && !Array.isArray(replacement)) return replacement;
  const replacementIds = replacement as string[] | undefined;
  const additions = input.addMemberIds === undefined ? [] : await sanitizeMemberIds(ownerId, input.addMemberIds);
  if (!Array.isArray(additions)) return additions;
  const removals = input.removeMemberIds === undefined ? [] : normalizeMemberIds(input.removeMemberIds);
  if (!Array.isArray(removals)) return removals;
  if (additions.some((id) => removals.includes(id))) return fail(400, 'A member cannot be added and removed together');
  const now = new Date();
  const patch: Record<string, any> = { updatedAt: now };
  if (input.name !== undefined) {
    const name = sanitizeName(input.name);
    if (typeof name !== 'string') return name;
    patch['crystal.name'] = name;
  }

  const outcome = await withMongoTransaction(async (session) => {
    const rootFilter = { shareId: groupId, thingtime: 'group', ownerId } as any;
    const rootUpdate = await updateAccountedThing(things, rootFilter, { $set: patch }, { session });
    if (!rootUpdate.matchedCount) return fail(404, 'Group not found');
    const updated = await things.findOne(rootFilter, { session });
    if (!updated) return fail(404, 'Group not found');
    let toRemove = removals, toAdd = additions;
    if (replacementIds !== undefined) {
      const currentDocs = await things.find({ thingtime: 'group-member', ownerId, 'crystal.groupId': groupId } as any, { session })
        .project({ targetId: 1 }).batchSize(GROUP_BATCH_SIZE).toArray();
      const current = new Set<string>(currentDocs.map((row: any) => String(row.targetId)));
      const wanted = new Set(replacementIds);
      toRemove = [...current].filter((memberId) => !wanted.has(memberId));
      toAdd = replacementIds.filter((memberId) => !current.has(memberId));
    } else if (additions.length) {
      const existing = await things.find({ thingtime: 'group-member', ownerId, 'crystal.groupId': groupId, targetId: { $in: additions } } as any, { session })
        .project({ targetId: 1 }).batchSize(GROUP_BATCH_SIZE).toArray();
      const have = new Set(existing.map((row: any) => String(row.targetId)));
      toAdd = additions.filter((memberId) => !have.has(memberId));
    }
    if (toRemove.length) {
      for (let offset = 0; offset < toRemove.length; offset += GROUP_BATCH_SIZE) {
        await deleteAccountedThings(things, { thingtime: 'group-member', ownerId, 'crystal.groupId': groupId, targetId: { $in: toRemove.slice(offset, offset + GROUP_BATCH_SIZE) } } as any, { session });
      }
    }
    if (toAdd.length) {
      for (let offset = 0; offset < toAdd.length; offset += GROUP_BATCH_SIZE) {
        await insertAccountedThings(things, toAdd.slice(offset, offset + GROUP_BATCH_SIZE).map((userId) => memberDoc(ownerId, groupId, userId, now)) as any, { session });
      }
    }
    return { ok: true as const, doc: updated };
  });
  if (outcome.ok === false) return fail(outcome.status, outcome.error);
  if (input.addMemberIds !== undefined || input.removeMemberIds !== undefined) {
    const memberCount = await things.countDocuments({ thingtime: 'group-member', ownerId, 'crystal.groupId': groupId } as any);
    return { ok: true, membership: { id: groupId, memberCount } };
  }
  return { ok: true, group: (await projectGroups(ownerId, [outcome.doc]))[0] };
};

export const deleteGroup = async (ownerId: string, id: unknown): Promise<Fail | { ok: true }> => {
  if (typeof id !== 'string' || !id.trim()) return fail(404, 'Group not found');
  const things = await getThingsCollection();
  return withMongoTransaction(async (session) => {
    const groupId = id.trim();
    const removed = await deleteAccountedThing(things, { shareId: groupId, thingtime: 'group', ownerId } as any, { session });
    if (!removed.deletedCount) return fail(404, 'Group not found');
    // targetId carries the member, so the generic group cascade cannot see these.
    await deleteAccountedThings(things, { thingtime: 'group-member', ownerId, 'crystal.groupId': groupId } as any, { session });
    return { ok: true };
  });
};

// The viewer-membership preload (groupIdsOf) lives in users/social.ts beside
// friendIdsOf — things.ts imports it from there, keeping this module free of
// an import cycle (this file imports resolveProfiles FROM things.ts).
export { groupIdsOf } from '../users/social';

// One call feeding the custom-audience picker: the caller's friends,
// connections (people they follow), recently-interacted users (owners of
// things they recently engaged with), and their groups.
export const audienceSources = async (
  userId: string
): Promise<{ ok: true; friends: FeedAuthor[]; connections: FeedAuthor[]; recents: FeedAuthor[]; groups: PublicGroup[] }> => {
  const things = await getThingsCollection();

  const [friendIds, followDocs, engagementDocs, groups] = await Promise.all([
    friendIdsOf(userId),
    things
      .find({ thingtime: 'follow', ownerId: userId } as any)
      .sort({ createdAt: -1 })
      .limit(100)
      .project({ targetId: 1 })
      .toArray(),
    things
      .find({ thingtime: { $in: ['comment', 'reaction', 'save', 'share'] }, ownerId: userId } as any)
      .sort({ createdAt: -1 })
      .limit(100)
      .project({ targetId: 1 })
      .toArray(),
    listGroups(userId)
  ]);

  const followingIds = [...new Set((followDocs as any[]).map((doc) => String(doc.targetId)).filter(Boolean))];

  // recents: resolve the things I engaged with, take their owners
  const engagedTargetIds = [...new Set((engagementDocs as any[]).map((doc) => String(doc.targetId)).filter(Boolean))].slice(0, 100);
  const targets = engagedTargetIds.length
    ? await things
        .find({ shareId: { $in: engagedTargetIds } } as any)
        .project({ ownerId: 1 })
        .toArray()
    : [];
  const recentIds = [...new Set((targets as any[]).map((doc) => String(doc.ownerId)))].filter((id) => id && id !== userId).slice(0, 30);

  const profiles = await resolveProfiles([...new Set([...friendIds, ...followingIds, ...recentIds])]);
  const pick = (ids: Iterable<string>): FeedAuthor[] =>
    [...ids].map((id) => profiles.get(id)).filter((entry): entry is FeedAuthor => !!entry);

  return {
    ok: true,
    friends: pick(friendIds),
    connections: pick(followingIds),
    recents: pick(recentIds),
    groups: groups.groups
  };
};
