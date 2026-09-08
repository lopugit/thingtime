import { randomUUID } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
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

export const MAX_GROUPS_PER_USER = 64;
export const MAX_GROUP_MEMBERS = 128;
export const GROUP_NAME_MAX = 60;

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
  return value.trim().slice(0, GROUP_NAME_MAX);
};

// member ids must be real users (and never the owner — they're implicit)
const sanitizeMemberIds = async (ownerId: string, value: unknown): Promise<string[] | Fail> => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return fail(400, 'memberIds must be a list of user ids');
  const wanted = [...new Set(value.filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim()))].filter(
    (id) => id !== ownerId
  );
  if (wanted.length > MAX_GROUP_MEMBERS) return fail(400, `Groups hold at most ${MAX_GROUP_MEMBERS} members`);
  if (!wanted.length) return [];
  // findUserById resolves BOTH user eras (things-era user things and legacy
  // users-collection rows) — new signups only exist as user things
  const resolved = await Promise.all(wanted.map(async (id) => ({ id, user: await findUserById(id) })));
  const missing = resolved.find((entry) => !entry.user);
  if (missing) return fail(400, `Unknown member user id: ${missing.id}`);
  return wanted;
};

const memberIdsByGroup = async (ownerId: string, groupIds: string[]): Promise<Map<string, string[]>> => {
  const map = new Map<string, string[]>();
  if (!groupIds.length) return map;
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'group-member', ownerId, 'crystal.groupId': { $in: groupIds } } as any)
    .project({ targetId: 1, crystal: 1 })
    .toArray();
  for (const doc of docs as any[]) {
    const groupId = String(doc.crystal?.groupId || '');
    if (!groupId) continue;
    const list = map.get(groupId) || [];
    list.push(String(doc.targetId));
    map.set(groupId, list);
  }
  return map;
};

const projectGroups = async (ownerId: string, docs: any[]): Promise<PublicGroup[]> => {
  const members = await memberIdsByGroup(ownerId, docs.map((doc) => String(doc.shareId)));
  const profiles = await resolveProfiles([...new Set([...members.values()].flat())]);
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
    .limit(MAX_GROUPS_PER_USER)
    .toArray();
  return { ok: true, groups: await projectGroups(ownerId, docs as any[]) };
};

const findOwnedGroup = async (ownerId: string, id: unknown): Promise<any | null> => {
  if (typeof id !== 'string' || !id.trim()) return null;
  const things = await getThingsCollection();
  return await things.findOne({ shareId: id.trim(), thingtime: 'group', ownerId } as any);
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
  const existing = await things.countDocuments({ thingtime: 'group', ownerId } as any);
  if (existing >= MAX_GROUPS_PER_USER) {
    return fail(409, `You already have ${MAX_GROUPS_PER_USER} groups — delete some first`);
  }

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
  await things.insertOne(doc as any);
  if (memberIds.length) {
    await things.insertMany(memberIds.map((userId) => memberDoc(ownerId, doc.shareId, userId, now)) as any);
  }
  return { ok: true, group: (await projectGroups(ownerId, [doc]))[0] };
};

// name and/or the WHOLE member list (replacement semantics, like tokenAcl —
// merging lists is ambiguous)
export const updateGroup = async (
  ownerId: string,
  id: unknown,
  input: { name?: unknown; memberIds?: unknown }
): Promise<Fail | { ok: true; group: PublicGroup }> => {
  const doc = await findOwnedGroup(ownerId, id);
  if (!doc) return fail(404, 'Group not found');

  const things = await getThingsCollection();
  const now = new Date();
  const patch: Record<string, any> = { updatedAt: now };
  if (input.name !== undefined) {
    const name = sanitizeName(input.name);
    if (typeof name !== 'string') return name;
    patch['crystal.name'] = name;
  }

  if (input.memberIds !== undefined) {
    const memberIds = await sanitizeMemberIds(ownerId, input.memberIds);
    if (!Array.isArray(memberIds)) return memberIds;
    const current = (await memberIdsByGroup(ownerId, [doc.shareId])).get(doc.shareId) || [];
    const wanted = new Set(memberIds);
    const have = new Set(current);
    const toRemove = current.filter((memberId) => !wanted.has(memberId));
    const toAdd = memberIds.filter((memberId) => !have.has(memberId));
    if (toRemove.length) {
      await things.deleteMany({ thingtime: 'group-member', ownerId, 'crystal.groupId': doc.shareId, targetId: { $in: toRemove } } as any);
    }
    if (toAdd.length) {
      await things.insertMany(toAdd.map((userId) => memberDoc(ownerId, doc.shareId, userId, now)) as any);
    }
  }

  await things.updateOne({ shareId: doc.shareId } as any, { $set: patch });
  const updated = await things.findOne({ shareId: doc.shareId } as any);
  return { ok: true, group: (await projectGroups(ownerId, [updated]))[0] };
};

export const deleteGroup = async (ownerId: string, id: unknown): Promise<Fail | { ok: true }> => {
  const doc = await findOwnedGroup(ownerId, id);
  if (!doc) return fail(404, 'Group not found');
  const things = await getThingsCollection();
  // member docs are not targetId-children of the group (targetId = the
  // member), so the generic cascade can't reach them — delete them here
  await things.deleteMany({ thingtime: 'group-member', ownerId, 'crystal.groupId': doc.shareId } as any);
  await things.deleteOne({ shareId: doc.shareId, thingtime: 'group', ownerId } as any);
  return { ok: true };
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
