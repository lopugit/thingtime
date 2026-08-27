// Shared plumbing for the messenger family (chats, communities, emojis,
// follows). Everything here is a thing in `things` (FUNDAMENTALS §3):
// messenger docs are private, quota-accounted user content (acl ["tt:user"])
// whose real visibility is chat/community MEMBERSHIP, enforced by these utils
// on every read and write — the generic /api/v1/things paths refuse the kinds
// outright (no crystal sanitizers), so nothing here is reachable or forgeable
// around us.
import { randomUUID } from 'node:crypto';
import type { Binary } from 'mongodb';
import { getThingsCollection } from '../mongodb/collections';
import { thingUniqueKey } from '../mongodb/uniqueKeys';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

export type Fail = { ok: false; status: number; error: string };
export const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type ChatType = 'channel' | 'group' | 'dm';
export type ChatRole = 'owner' | 'admin' | 'member';
export type MemberState = 'active' | 'pending' | 'left' | 'declined';
export type RequestOrigin = 'follower' | 'unknown';

export const ROLE_RANK: Record<ChatRole, number> = { member: 0, admin: 1, owner: 2 };

// Pair keys for relationship dedupe + lookups: one membership per
// (container, user), one DM per pair, one follow per pair.
export const chatMemberKey = (chatId: string, userId: string) => `${chatId}:${userId}`;
export const communityMemberKey = (communityId: string, userId: string) => `${communityId}:${userId}`;
export const followKey = (followerId: string, followeeId: string) => `${followerId}:${followeeId}`;
export const dmKeyOf = (a: string, b: string) => [a, b].sort().join(':');
export const emojiScopeKey = (scope: string, name: string) => `${scope}:${name}`;

// Structural dedupe rides the server-only root uniqueKeys namespace (the
// sparse unique multikey index in collections.ts that already holds
// username/email/schema/waitlist slots) — NOT kind-blind crystal-path unique
// indexes: crystal paths are user-writable in free-form data things (the
// squat class — see KIND-BLIND HISTORY in collections.ts), root
// fields are not reachable by any user input. One map keyed by kind, stamped
// inside newThingDoc so no writer can forget; the friend writer (users/
// social.ts) and the backfill migration stamp through the same helper.
// Entries are `<crystalField>:<key>` — prefixes disjoint from the existing
// username:/email:/schema:/waitlist-email: namespaces. BinData for the same
// reason as user keys: plain strings would tokenize into the $** text index.
// The chat entry covers DMs only — group/channel chats carry dmKey null and
// skip the stamp (relationshipUniqueKeys returns undefined for them).
// passkey-app-link joined the family after the fact: it shipped (PR #323)
// while this migration was in flight and briefly carried its own kind-blind
// crystal.linkKey unique index — the exact squat class retired here — so its
// dedupe now rides the same root namespace, and auth/passkeys.ts stamps
// through this helper even though it builds its doc outside newThingDoc.
export const RELATIONSHIP_UNIQUE_CRYSTAL_KEYS: Readonly<Record<string, string>> = {
	follow: 'followKey',
	'chat-member': 'memberKey',
	'community-member': 'memberKey',
	chat: 'dmKey',
	'community-invite': 'inviteCode',
	'custom-emoji': 'emojiKey',
	friend: 'friendKey',
	vote: 'voteKey',
	'passkey-app-link': 'linkKey'
};

export const relationshipUniqueKeys = (kind: string, crystal: Record<string, unknown> | null | undefined): Binary[] | undefined => {
	const field = RELATIONSHIP_UNIQUE_CRYSTAL_KEYS[kind];
	const value = field ? crystal?.[field] : undefined;
	return typeof value === 'string' && value ? [thingUniqueKey(field, value)] : undefined;
};

export const newThingDoc = (
  kind: string,
  fields: {
		ownerId: string;
		targetId?: string | null;
		crystal: Record<string, unknown>;
		shareId?: string;
		uniqueKeys?: Binary[];
	}
) => {
  const now = new Date();
  const uniqueKeys = [...(relationshipUniqueKeys(kind, fields.crystal) || []), ...(fields.uniqueKeys || [])];
  return {
    shareId: fields.shareId || randomUUID(),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: [kind],
    crystal: fields.crystal,
    ...(uniqueKeys.length ? { uniqueKeys } : {}),
    extended: null,
    ownerId: fields.ownerId,
    acl: ['tt:user'],
    targetId: fields.targetId ?? null,
    tags: [],
    createdAt: now,
    updatedAt: now
  };
};

export const findThingByKind = async (kind: string, shareId: string): Promise<any | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const things = await getThingsCollection();
  return things.findOne({ shareId: shareId.trim(), thingtime: kind } as any);
};

// ── membership lookups (all single indexed queries via crystal.memberKey) ──

export const getChatMemberDoc = async (chatId: string, userId: string): Promise<any | null> => {
  const things = await getThingsCollection();
  return things.findOne({ thingtime: 'chat-member', 'crystal.memberKey': chatMemberKey(chatId, userId) } as any);
};

export const getCommunityMemberDoc = async (communityId: string, userId: string): Promise<any | null> => {
  const things = await getThingsCollection();
  return things.findOne({
    thingtime: 'community-member',
    'crystal.memberKey': communityMemberKey(communityId, userId)
  } as any);
};

export const communityRoleOf = async (communityId: string, userId: string): Promise<ChatRole | null> => {
  const doc = await getCommunityMemberDoc(communityId, userId);
  const role = doc?.crystal?.role;
  return role === 'owner' || role === 'admin' || role === 'member' ? role : null;
};

// Which of `userIds` are members of the community — ONE $in over the unique
// member keys. Channel adds/invites gate on this so channel access can never
// outrun community membership.
export const communityMembersAmong = async (communityId: string, userIds: string[]): Promise<Set<string>> => {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const things = await getThingsCollection();
  const docs = await things
    .find(
      { thingtime: 'community-member', 'crystal.memberKey': { $in: ids.map((id) => communityMemberKey(communityId, id)) } } as any,
      { projection: { ownerId: 1 } }
    )
    .toArray();
  return new Set(docs.map((d: any) => String(d.ownerId)));
};

// All memberships of one chat, one query. Includes pending members (they are
// part of the conversation's shape — the UI labels them), excludes left and
// declined ones.
export const listChatMemberDocs = async (chatId: string): Promise<any[]> => {
  const things = await getThingsCollection();
  return things
    .find({ thingtime: 'chat-member', targetId: chatId, 'crystal.state': { $in: ['active', 'pending'] } } as any)
    .sort({ createdAt: 1, shareId: 1 })
    .toArray();
};

export const countActiveChatMembers = async (chatId: string): Promise<number> => {
  const things = await getThingsCollection();
  return things.countDocuments({ thingtime: 'chat-member', targetId: chatId, 'crystal.state': 'active' } as any);
};

// The one string helper every crystal writer shares.
export const boundedTrimmed = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

export const isDuplicateKeyError = (err: any, keyField?: string): boolean => {
  if (err?.code !== 11000) return false;
  if (!keyField) return true;
  return !!err?.keyPattern?.[keyField];
};
