// Communities: Slack-style workspaces. A community thing owns channels (chat
// things via targetId), sidebar sections, invites and custom emojis — all
// relational children, aggregated on read, per FUNDAMENTALS §3.
import { randomBytes } from 'node:crypto';
import { getThingsCollection } from '../mongodb/collections';
import { resolveProfiles } from '../things/things';
import { MAX_COMMUNITIES_PER_USER, MAX_COMMUNITY_DESCRIPTION_CHARS, MAX_COMMUNITY_NAME_CHARS, MAX_SECTION_NAME_CHARS } from '~/schemas/registry';
import type { ChatRole, Fail } from './shared';
import { boundedTrimmed, communityMemberKey, communityRoleOf, fail, findThingByKind, getCommunityMemberDoc, newThingDoc, ROLE_RANK } from './shared';
import { publicExternalAiSource, type PublicExternalAiSource } from './externalAi';
import {
	deleteMessengerThing,
	insertMessengerThing,
	updateMessengerThing,
	updateMessengerThings,
	withMessengerStorageTransaction
} from './storage';

export type PublicCommunity = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  myRole: ChatRole | null;
  memberCount: number;
  createdAt: string;
  externalSource: PublicExternalAiSource | null;
};

export type PublicSection = { id: string; name: string; order: number };

const toPublicCommunity = (doc: any, myRole: ChatRole | null, memberCount: number): PublicCommunity => ({
  id: doc.shareId,
  name: doc.crystal?.name || 'Community',
  description: doc.crystal?.description ?? null,
  avatarUrl: doc.crystal?.avatarUrl ?? null,
  myRole,
  memberCount,
  createdAt: new Date(doc.createdAt).toISOString(),
  externalSource: publicExternalAiSource(doc.crystal?.externalSource)
});

const toPublicSection = (doc: any): PublicSection => ({
  id: doc.shareId,
  name: doc.crystal?.name || 'Section',
  order: Number.isFinite(doc.crystal?.order) ? doc.crystal.order : 0
});

// ── membership helpers ──

const insertMember = async (communityId: string, userId: string, role: ChatRole, session?: any) => {
  const things = await getThingsCollection();
  await insertMessengerThing(
		things,
    newThingDoc('community-member', {
      ownerId: userId,
      targetId: communityId,
      crystal: { memberKey: communityMemberKey(communityId, userId), role }
		}) as any,
		session ? { session } : {}
  );
};

// Community membership is the outer wall of every channel, so losing it must
// take the channel keys too: mark the user's memberships across this
// community's channels as left (their DMs/groups are untouched).
const revokeCommunityChannelMemberships = async (communityId: string, userId: string, session?: any) => {
  const things = await getThingsCollection();
	const channels = await things
		.find(
			{ thingtime: 'chat', 'crystal.communityId': communityId } as any,
			{ projection: { shareId: 1 }, ...(session ? { session } : {}) }
		)
		.toArray();
  if (!channels.length) return;
	await updateMessengerThings(
		things,
    {
      thingtime: 'chat-member',
      ownerId: userId,
      targetId: { $in: channels.map((c: any) => c.shareId) },
      'crystal.state': { $in: ['active', 'pending'] }
    } as any,
    { $set: { 'crystal.state': 'left', updatedAt: new Date() } },
		session ? { session } : {}
  );
};

export const requireCommunityRole = async (communityId: string, userId: string, atLeast: ChatRole): Promise<{ ok: true; role: ChatRole } | Fail> => {
  const role = await communityRoleOf(communityId, userId);
  if (!role) return fail(403, 'You are not a member of this community');
  if (ROLE_RANK[role] < ROLE_RANK[atLeast]) return fail(403, 'You need a bigger hat for that (admin required)');
  return { ok: true, role };
};

// ── communities ──

export type CreateCommunityResult = Fail | { ok: true; community: PublicCommunity };

export const createCommunity = async (ownerId: string, input: { name?: unknown; description?: unknown }): Promise<CreateCommunityResult> => {
  const name = boundedTrimmed(input.name, MAX_COMMUNITY_NAME_CHARS);
  if (!name) return fail(400, 'Communities need a name');
  const description = boundedTrimmed(input.description, MAX_COMMUNITY_DESCRIPTION_CHARS);
  const things = await getThingsCollection();
  const owned = await things.countDocuments({ thingtime: 'community-member', ownerId, 'crystal.role': 'owner' } as any);
  if (owned >= MAX_COMMUNITIES_PER_USER) {
    return fail(400, `You already run ${MAX_COMMUNITIES_PER_USER} communities — that is a lot of communities`);
  }
  const community = newThingDoc('community', { ownerId, crystal: { name, description, avatarUrl: null } });
	await withMessengerStorageTransaction(async (session) => {
		await insertMessengerThing(things, community as any, { session });
		await insertMember(community.shareId, ownerId, 'owner', session);
	});
  return { ok: true, community: toPublicCommunity(community, 'owner', 1) };
};

// Every community the viewer belongs to, with sections — the slack-mode
// sidebar skeleton. One membership query + one $in for communities + one $in
// for sections + one aggregate for member counts.
export const listMyCommunities = async (
  viewerId: string
): Promise<{ ok: true; communities: (PublicCommunity & { sections: PublicSection[] })[] }> => {
  const things = await getThingsCollection();
  const memberships = await things
    .find({ thingtime: 'community-member', ownerId: viewerId } as any)
    .sort({ createdAt: 1, shareId: 1 })
    .toArray();
  if (!memberships.length) return { ok: true, communities: [] };
  const communityIds = memberships.map((m: any) => String(m.targetId));
  const roleById = new Map(memberships.map((m: any) => [String(m.targetId), m.crystal?.role || 'member']));
  const [communityDocs, sectionDocs, counts] = await Promise.all([
    things.find({ thingtime: 'community', shareId: { $in: communityIds } } as any).toArray(),
    things
      .find({ thingtime: 'chat-section', targetId: { $in: communityIds } } as any)
      .sort({ 'crystal.order': 1, createdAt: 1 })
      .toArray(),
    things
      .aggregate([
        { $match: { thingtime: 'community-member', targetId: { $in: communityIds } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
      ])
      .toArray()
  ]);
	const countById = new Map<string, number>(counts.map((c: any) => [String(c._id), Number(c.count) || 0] as const));
  const sectionsById = new Map<string, PublicSection[]>();
  for (const doc of sectionDocs) {
    const key = String((doc as any).targetId);
    if (!sectionsById.has(key)) sectionsById.set(key, []);
    sectionsById.get(key)!.push(toPublicSection(doc));
  }
  const communities = communityDocs
    .map((doc: any) => ({
      ...toPublicCommunity(doc, (roleById.get(doc.shareId) as ChatRole) || null, countById.get(doc.shareId) || 0),
      sections: sectionsById.get(doc.shareId) || []
    }))
    .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt));
  return { ok: true, communities };
};

export type CommunityDetailResult =
  | Fail
  | {
      ok: true;
      community: PublicCommunity & { sections: PublicSection[] };
      members: { userId: string; profile: any; role: ChatRole; joinedAt: string }[];
      memberCount: number;
    };

const COMMUNITY_MEMBER_PAGE = 100;

export const getCommunityDetail = async (viewerId: string, communityId: unknown): Promise<CommunityDetailResult> => {
  if (typeof communityId !== 'string' || !communityId.trim()) return fail(400, 'Community id required');
  const community = await findThingByKind('community', communityId.trim());
  if (!community) return fail(404, 'Community not found');
  const myRole = await communityRoleOf(community.shareId, viewerId);
  if (!myRole) return fail(403, 'You are not a member of this community');
  const things = await getThingsCollection();
  const [memberDocs, memberCount, sectionDocs] = await Promise.all([
    things
      .find({ thingtime: 'community-member', targetId: community.shareId } as any)
      .sort({ createdAt: 1, shareId: 1 })
      .limit(COMMUNITY_MEMBER_PAGE)
      .toArray(),
    things.countDocuments({ thingtime: 'community-member', targetId: community.shareId } as any),
    things
      .find({ thingtime: 'chat-section', targetId: community.shareId } as any)
      .sort({ 'crystal.order': 1, createdAt: 1 })
      .toArray()
  ]);
  const profiles = await resolveProfiles(memberDocs.map((m: any) => String(m.ownerId)));
  const members = memberDocs.map((m: any) => ({
    userId: String(m.ownerId),
    profile: profiles.get(String(m.ownerId)) || null,
    role: (m.crystal?.role as ChatRole) || 'member',
    joinedAt: new Date(m.createdAt).toISOString()
  }));
  return {
    ok: true,
    community: { ...toPublicCommunity(community, myRole, memberCount), sections: sectionDocs.map(toPublicSection) },
    members,
    memberCount
  };
};

export type UpdateCommunityResult = Fail | { ok: true; community: PublicCommunity };

export const updateCommunity = async (
  viewerId: string,
  input: { id?: unknown; name?: unknown; description?: unknown }
): Promise<UpdateCommunityResult> => {
  if (typeof input.id !== 'string' || !input.id.trim()) return fail(400, 'Community id required');
  const community = await findThingByKind('community', input.id.trim());
  if (!community) return fail(404, 'Community not found');
  if (community.crystal?.externalSource) return fail(409, 'Imported AI space details are read-only; resync the source to update them');
  const gate = await requireCommunityRole(community.shareId, viewerId, 'admin');
  if (gate.ok === false) return gate;
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = boundedTrimmed(input.name, MAX_COMMUNITY_NAME_CHARS);
    if (!name) return fail(400, 'Communities need a name');
    patch['crystal.name'] = name;
  }
  if (input.description !== undefined) {
    patch['crystal.description'] = boundedTrimmed(input.description, MAX_COMMUNITY_DESCRIPTION_CHARS);
  }
  if (!Object.keys(patch).length) return fail(400, 'Nothing to update');
  const things = await getThingsCollection();
  await updateMessengerThing(things, { shareId: community.shareId } as any, { $set: { ...patch, updatedAt: new Date() } });
  const fresh = await findThingByKind('community', community.shareId);
  const memberCount = await things.countDocuments({ thingtime: 'community-member', targetId: community.shareId } as any);
  return { ok: true, community: toPublicCommunity(fresh, gate.role, memberCount) };
};

// Role changes + removals. Owners outrank admins; the owner can never be
// demoted or removed (transfer is a future feature, documented not guessed).
export type CommunityMembersResult = Fail | { ok: true };

export const manageCommunityMember = async (
  viewerId: string,
  input: { communityId?: unknown; userId?: unknown; role?: unknown; remove?: unknown }
): Promise<CommunityMembersResult> => {
  if (typeof input.communityId !== 'string' || !input.communityId.trim()) return fail(400, 'Community id required');
  if (typeof input.userId !== 'string' || !input.userId.trim()) return fail(400, 'User id required');
	const targetUserId = input.userId.trim();
  const community = await findThingByKind('community', input.communityId.trim());
  if (!community) return fail(404, 'Community not found');
  const gate = await requireCommunityRole(community.shareId, viewerId, 'admin');
  if (gate.ok === false) return gate;
  const targetDoc = await getCommunityMemberDoc(community.shareId, targetUserId);
  if (!targetDoc) return fail(404, 'That user is not a member');
  const targetRole = (targetDoc.crystal?.role as ChatRole) || 'member';
  if (targetRole === 'owner') return fail(403, 'The community owner cannot be changed or removed');
  const things = await getThingsCollection();
  if (input.remove === true) {
		await withMessengerStorageTransaction(async (session) => {
			await deleteMessengerThing(things, { shareId: targetDoc.shareId } as any, { session });
			await revokeCommunityChannelMemberships(community.shareId, targetUserId, session);
		});
    return { ok: true };
  }
  if (input.role === 'admin' || input.role === 'member') {
    await updateMessengerThing(things, { shareId: targetDoc.shareId } as any, { $set: { 'crystal.role': input.role, updatedAt: new Date() } });
    return { ok: true };
  }
  return fail(400, 'Pass role: "admin" | "member" or remove: true');
};

export const leaveCommunity = async (viewerId: string, communityId: unknown): Promise<CommunityMembersResult> => {
  if (typeof communityId !== 'string' || !communityId.trim()) return fail(400, 'Community id required');
  const doc = await getCommunityMemberDoc(communityId.trim(), viewerId);
  if (!doc) return fail(404, 'You are not a member of this community');
  if (doc.crystal?.role === 'owner') return fail(400, 'Owners cannot leave their community (yet) — it would be a ghost ship');
  const things = await getThingsCollection();
	await withMessengerStorageTransaction(async (session) => {
		await deleteMessengerThing(things, { shareId: doc.shareId } as any, { session });
		await revokeCommunityChannelMemberships(communityId.trim(), viewerId, session);
	});
  return { ok: true };
};

// ── invites ──

export type PublicInvite = {
  id: string;
  code: string;
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revoked: boolean;
  createdBy: string;
  createdAt: string;
};

const toPublicInvite = (doc: any): PublicInvite => ({
  id: doc.shareId,
  code: doc.crystal?.inviteCode,
  uses: doc.crystal?.uses || 0,
  maxUses: doc.crystal?.maxUses ?? null,
  expiresAt: doc.crystal?.expiresAt ?? null,
  revoked: !!doc.crystal?.revoked,
  createdBy: String(doc.ownerId),
  createdAt: new Date(doc.createdAt).toISOString()
});

const MAX_INVITE_DAYS = 90;
const MAX_LIVE_INVITES_PER_COMMUNITY = 50;

export type CreateInviteResult = Fail | { ok: true; invite: PublicInvite };

export const createInvite = async (
  viewerId: string,
  input: { communityId?: unknown; expiresInDays?: unknown; maxUses?: unknown; revokeId?: unknown }
): Promise<CreateInviteResult | CommunityMembersResult> => {
  if (typeof input.communityId !== 'string' || !input.communityId.trim()) return fail(400, 'Community id required');
  const community = await findThingByKind('community', input.communityId.trim());
  if (!community) return fail(404, 'Community not found');
  const gate = await requireCommunityRole(community.shareId, viewerId, 'admin');
  if (gate.ok === false) return gate;
  const things = await getThingsCollection();
  if (typeof input.revokeId === 'string' && input.revokeId.trim()) {
		const res = await updateMessengerThing(things, { shareId: input.revokeId.trim(), thingtime: 'community-invite', targetId: community.shareId } as any, {
			$set: { 'crystal.revoked': true, updatedAt: new Date() }
		});
    if (!res.matchedCount) return fail(404, 'Invite not found');
    return { ok: true };
  }
  const live = await things.countDocuments({
    thingtime: 'community-invite',
    targetId: community.shareId,
    'crystal.revoked': { $ne: true }
  } as any);
  if (live >= MAX_LIVE_INVITES_PER_COMMUNITY) return fail(400, 'Too many live invites — revoke some first');
  const days = Number(input.expiresInDays);
  const expiresAt =
		Number.isFinite(days) && days > 0 ? new Date(Date.now() + Math.min(days, MAX_INVITE_DAYS) * 24 * 60 * 60 * 1000).toISOString() : null;
  const maxUsesNum = Number(input.maxUses);
  const maxUses = Number.isFinite(maxUsesNum) && maxUsesNum > 0 ? Math.min(Math.floor(maxUsesNum), 10_000) : null;
  const invite = newThingDoc('community-invite', {
    ownerId: viewerId,
    targetId: community.shareId,
    crystal: {
      inviteCode: `tt-${randomBytes(9).toString('base64url')}`,
      uses: 0,
      maxUses,
      expiresAt,
      revoked: false
    }
  });
  await insertMessengerThing(things, invite as any);
  return { ok: true, invite: toPublicInvite(invite) };
};

export type ListInvitesResult = Fail | { ok: true; invites: PublicInvite[] };

export const listInvites = async (viewerId: string, communityId: unknown): Promise<ListInvitesResult> => {
  if (typeof communityId !== 'string' || !communityId.trim()) return fail(400, 'Community id required');
  const community = await findThingByKind('community', communityId.trim());
  if (!community) return fail(404, 'Community not found');
  const gate = await requireCommunityRole(community.shareId, viewerId, 'admin');
  if (gate.ok === false) return gate;
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'community-invite', targetId: community.shareId } as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(100)
    .toArray();
  return { ok: true, invites: docs.map(toPublicInvite) };
};

// Redemption is atomic: the uses increment carries the guards in its filter,
// so two racing redeems of a one-use code can't both land.
export type JoinCommunityResult = Fail | { ok: true; community: PublicCommunity };

export const joinCommunityByCode = async (viewerId: string, code: unknown): Promise<JoinCommunityResult> => {
  const trimmed = boundedTrimmed(code, 100);
  if (!trimmed) return fail(400, 'Invite code required');
  const things = await getThingsCollection();
  const invite = await things.findOne({ thingtime: 'community-invite', 'crystal.inviteCode': trimmed } as any);
  if (!invite) return fail(404, 'Invalid invite code');
  const crystal = (invite as any).crystal || {};
  if (crystal.revoked) return fail(410, 'This invite was revoked');
  if (crystal.expiresAt && new Date(crystal.expiresAt).getTime() < Date.now()) return fail(410, 'This invite expired');
  const community = await findThingByKind('community', String((invite as any).targetId));
  if (!community) return fail(404, 'That community no longer exists');
  const existingRole = await communityRoleOf(community.shareId, viewerId);
  if (existingRole) {
    const memberCount = await things.countDocuments({ thingtime: 'community-member', targetId: community.shareId } as any);
    return { ok: true, community: toPublicCommunity(community, existingRole, memberCount) };
  }
	try {
		const joined = await withMessengerStorageTransaction(async (session) => {
			const currentInvite = await things.findOne(
				{ shareId: (invite as any).shareId, thingtime: 'community-invite' } as any,
				{ session }
			);
			if (!currentInvite || (currentInvite as any).crystal?.revoked) return fail(410, 'This invite was revoked');
			const currentCrystal = (currentInvite as any).crystal || {};
			if (currentCrystal.expiresAt && new Date(currentCrystal.expiresAt).getTime() < Date.now()) {
				return fail(410, 'This invite expired');
			}
			const existing = await things.findOne(
				{ thingtime: 'community-member', ownerId: viewerId, targetId: community.shareId } as any,
				{ session }
			);
			if (existing) return { ok: true as const };

			const guard: any = { shareId: (currentInvite as any).shareId, 'crystal.revoked': { $ne: true } };
			if (currentCrystal.maxUses) guard['crystal.uses'] = { $lt: currentCrystal.maxUses };
			const bump = await updateMessengerThing(
				things,
				guard,
				{ $inc: { 'crystal.uses': 1 }, $set: { updatedAt: new Date() } },
				{ session }
			);
			if (!bump.matchedCount) return fail(410, 'This invite has been used up');
			await insertMember(community.shareId, viewerId, 'member', session);
			return { ok: true as const };
		});
		if (joined.ok === false) return joined;
	} catch (err: any) {
		// Two redemptions by the same account can race on the unique member key.
		// The losing transaction is fully rolled back (including invite uses), so
		// an already-present membership is the idempotent success case.
		if (err?.code !== 11000 || !(await communityRoleOf(community.shareId, viewerId))) throw err;
	}
  const memberCount = await things.countDocuments({ thingtime: 'community-member', targetId: community.shareId } as any);
  return { ok: true, community: toPublicCommunity(community, 'member', memberCount) };
};

// ── sections ──

export type SectionsResult = Fail | { ok: true; sections: PublicSection[] };

export const manageSections = async (
  viewerId: string,
  input: { communityId?: unknown; create?: unknown; rename?: unknown; remove?: unknown; reorder?: unknown }
): Promise<SectionsResult> => {
  if (typeof input.communityId !== 'string' || !input.communityId.trim()) return fail(400, 'Community id required');
  const community = await findThingByKind('community', input.communityId.trim());
  if (!community) return fail(404, 'Community not found');
  const gate = await requireCommunityRole(community.shareId, viewerId, 'admin');
  if (gate.ok === false) return gate;
  const things = await getThingsCollection();
  if (input.create && typeof input.create === 'object') {
    const name = boundedTrimmed((input.create as any).name, MAX_SECTION_NAME_CHARS);
    if (!name) return fail(400, 'Sections need a name');
    const count = await things.countDocuments({ thingtime: 'chat-section', targetId: community.shareId } as any);
    if (count >= 50) return fail(400, 'That is enough sections');
		await insertMessengerThing(
			things,
			newThingDoc('chat-section', { ownerId: viewerId, targetId: community.shareId, crystal: { name, order: count } }) as any
		);
  } else if (input.rename && typeof input.rename === 'object') {
    const id = boundedTrimmed((input.rename as any).id, 128);
    const name = boundedTrimmed((input.rename as any).name, MAX_SECTION_NAME_CHARS);
    if (!id || !name) return fail(400, 'Renaming a section needs { id, name }');
		const res = await updateMessengerThing(things, { shareId: id, thingtime: 'chat-section', targetId: community.shareId } as any, {
			$set: { 'crystal.name': name, updatedAt: new Date() }
		});
    if (!res.matchedCount) return fail(404, 'Section not found');
  } else if (typeof input.remove === 'string' && input.remove.trim()) {
    const removed = await things.findOne({ shareId: input.remove.trim(), thingtime: 'chat-section', targetId: community.shareId } as any);
    if (!removed) return fail(404, 'Section not found');
		await withMessengerStorageTransaction(async (session) => {
			await deleteMessengerThing(things, { shareId: (removed as any).shareId } as any, { session });
			// Un-file the section's channels rather than orphaning their pointer.
			await updateMessengerThings(
				things,
				{ thingtime: 'chat', 'crystal.communityId': community.shareId, 'crystal.sectionId': (removed as any).shareId } as any,
				{ $set: { 'crystal.sectionId': null, updatedAt: new Date() } },
				{ session }
			);
		});
  } else if (Array.isArray(input.reorder)) {
    const ids = (input.reorder as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 100);
    if (ids.length) {
			await withMessengerStorageTransaction(async (session) => {
				for (const [index, id] of ids.entries()) {
					await updateMessengerThing(
						things,
						{ shareId: id, thingtime: 'chat-section', targetId: community.shareId } as any,
						{ $set: { 'crystal.order': index, updatedAt: new Date() } },
						{ session }
					);
				}
			});
    }
  } else {
    return fail(400, 'Pass create: {name} | rename: {id,name} | remove: id | reorder: [ids]');
  }
  const sections = await things
    .find({ thingtime: 'chat-section', targetId: community.shareId } as any)
    .sort({ 'crystal.order': 1, createdAt: 1 })
    .toArray();
  return { ok: true, sections: sections.map(toPublicSection) };
};
