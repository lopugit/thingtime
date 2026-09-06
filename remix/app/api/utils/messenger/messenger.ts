// Chats, membership, messages, reactions, read receipts and message requests.
//
// Shape rules (FUNDAMENTALS §3): a chat is a thing; every accumulating fact
// about it — memberships (with role/nickname/read receipt), messages,
// reactions — is its own atomic child thing linked by targetId and aggregated
// back per page in ONE query per kind. Messages are deliberately NOT posts:
// they never carry the 'post' schema id, so no feed/profile/permalink path
// can ever surface them; membership (checked here on every call) is the only
// door.
import { getThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import type { FeedAuthor} from '../things/things';
import { resolveProfiles, parseChronoCursor, chronoCursorClause } from '../things/things';
import { orderAttachmentDocsByStoredSort, toAttachmentPublicMetadata, type AttachmentPublicMetadata } from '../attachments/attachmentCore';
import {
	createReadyAttachmentMessageInsertHook,
	inspectReadyAttachmentsForMessage,
	prepareAttachmentCascadeForThing
} from '../attachments/attachments';
import { getUsersReadReceiptsMap, getUserReadReceiptsEnabled, pushUserRecentReaction, findUsersByIds } from '../auth/users';
import {
	MAX_CHAT_MEMBERS,
	MAX_CHAT_MEMBERS_PER_ADD,
	MAX_CHAT_NAME_CHARS,
	MAX_CHAT_TOPIC_CHARS,
	MAX_CHATS_PER_COMMUNITY,
	MAX_MESSAGE_CHARS,
	MAX_NICKNAME_CHARS
} from '~/schemas/registry';
import { customReactionEmojiId, isCustomReactionToken, sanitizeChatReactionToken } from '~/utils/reactionTokens';
import { getUserDisplayName } from '~/utils/userIdentity';
import { isDuplicateOnlyBulkWriteError } from './bulkWriteError';
import { matchesCommittedMessageRequest, messageIdForRequest, normalizedMessengerRequestId } from './messengerMediaCore';
import { publicExternalAiSource, publicLopuMessageMeta, type PublicExternalAiSource, type PublicLopuMessageMeta } from './externalAi';
import { followersOfSet, followingSet, isFollowing } from './follows';
import {
	deleteMessengerThings,
	insertMessengerThing,
	updateMessengerThing,
	updateMessengerThings,
	withMessengerStorageTransaction
} from './storage';
import type { ChatRole, ChatType, Fail, MemberState, RequestOrigin } from './shared';
import {
  boundedTrimmed,
  chatMemberKey,
  communityMembersAmong,
  communityRoleOf,
  countActiveChatMembers,
  dmKeyOf,
  fail,
  findThingByKind,
  getChatMemberDoc,
  listChatMemberDocs,
  newThingDoc,
  ROLE_RANK
} from './shared';

const DEFAULT_MESSAGE_LIMIT = 40;
const MAX_MESSAGE_LIMIT = 100;
const MAX_LISTED_CHATS = 300;
const MAX_REACTIONS_PER_USER_PER_MESSAGE = 20;
const MAX_REACTION_TOKENS_PER_MESSAGE = 100;
// member profiles ship inline on list rows for DMs and small groups; bigger
// rooms send counts and resolve members on open
const LIST_MEMBER_PROFILE_CAP = 25;

// Lopu conversations (api/utils/messenger/lopuChats.ts) ride the messenger
// family with this discriminator. They are first-party — the user's own
// notebook with the assistant — so unlike imported/live AI mirrors they may
// be renamed here and their rows deleted; Lopu's replies stay non-editable
// and membership stays exactly the one user.
const isLopuSource = (source: any): boolean => !!source && source.access === 'lopu' && source.provider === 'lopu';

// ── public projections ──

export type PublicChatMember = {
  userId: string;
  profile: FeedAuthor | null;
  role: ChatRole;
  nickname: string | null;
  state: MemberState;
  requestOrigin: RequestOrigin | null;
  muted: boolean;
  // read receipt — null when either side has receipts off (parity rule)
  lastReadMessageId: string | null;
  lastReadAt: string | null;
  joinedAt: string;
};

export type PublicChat = {
  id: string;
  chatType: ChatType;
  name: string | null;
  topic: string | null;
  communityId: string | null;
  sectionId: string | null;
  channelVisibility: 'public' | 'private' | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  externalSource: PublicExternalAiSource | null;
};

export type ChatListEntry = PublicChat & {
  myMember: Omit<PublicChatMember, 'profile'>;
  members: PublicChatMember[] | null;
  memberCount: number;
  unreadCount: number;
  lastMessage: MessagePreview | null;
};

export type MessagePreview = {
  id: string;
  authorId: string;
  authorName: string | null;
  text: string;
  deleted: boolean;
  systemType: string | null;
	attachmentCount: number;
  createdAt: string;
  externalSource: PublicExternalAiSource | null;
};

export type PublicChatMessage = {
  id: string;
  chatId: string;
  authorId: string;
  author: FeedAuthor | null;
  text: string;
	attachments: AttachmentPublicMetadata[];
  deleted: boolean;
  editedAt: string | null;
  threadRootId: string | null;
  replyToId: string | null;
	replyTo: { id: string; authorId: string; authorName: string | null; text: string; deleted: boolean; attachmentCount: number } | null;
  systemType: string | null;
  systemMeta: Record<string, unknown> | null;
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  threadCount: number;
  threadLastAt: string | null;
  createdAt: string;
  externalSource: PublicExternalAiSource | null;
  // Lopu turn metadata (model, provider, tool calls) — null on ordinary rows
  lopu?: PublicLopuMessageMeta | null;
};

export type CustomEmojiMap = Record<string, { name: string; image: string; animated: boolean }>;

const toPublicChat = (doc: any): PublicChat => ({
  id: doc.shareId,
  chatType: doc.crystal?.chatType,
  name: doc.crystal?.name ?? null,
  topic: doc.crystal?.topic ?? null,
  communityId: doc.crystal?.communityId ?? null,
  sectionId: doc.crystal?.sectionId ?? null,
  channelVisibility: doc.crystal?.chatType === 'channel' ? doc.crystal?.channelVisibility || 'public' : null,
  createdBy: String(doc.ownerId),
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString(),
  externalSource: publicExternalAiSource(doc.crystal?.externalSource)
});

// Read receipts respect BOTH sides' privacy setting: a member who turned
// receipts off neither shares nor sees them (their own row stays real to
// themselves so their unread state keeps working).
const toPublicMember = (
  doc: any,
  profile: FeedAuthor | null,
  opts: { viewerId: string; viewerReceipts: boolean; memberReceipts: Record<string, boolean> }
): PublicChatMember => {
  const userId = String(doc.ownerId);
  const isSelf = userId === opts.viewerId;
  const shareReceipts = isSelf || (opts.viewerReceipts && opts.memberReceipts[userId] !== false);
  return {
    userId,
    profile,
    role: (doc.crystal?.role as ChatRole) || 'member',
    nickname: doc.crystal?.nickname ?? null,
    state: (doc.crystal?.state as MemberState) || 'active',
    requestOrigin: doc.crystal?.requestOrigin ?? null,
    muted: !!doc.crystal?.muted,
    lastReadMessageId: shareReceipts ? doc.crystal?.lastReadMessageId ?? null : null,
    lastReadAt: shareReceipts ? doc.crystal?.lastReadAt ?? null : null,
    joinedAt: new Date(doc.createdAt).toISOString()
  };
};

const previewText = (crystal: any): string => {
  if (crystal?.deletedAt) return '';
  const text = typeof crystal?.text === 'string' ? crystal.text : '';
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
};

// ── membership plumbing ──

type ChatMemberFields = { role?: ChatRole; state?: MemberState; requestOrigin?: RequestOrigin | null };

export const newChatMemberDoc = (chatId: string, userId: string, fields: ChatMemberFields) =>
  newThingDoc('chat-member', {
    ownerId: userId,
    targetId: chatId,
    crystal: {
      memberKey: chatMemberKey(chatId, userId),
      role: fields.role || 'member',
      state: fields.state || 'active',
      requestOrigin: fields.requestOrigin ?? null,
      nickname: null,
      lastReadMessageId: null,
      lastReadAt: null,
      muted: false
    }
  });

export const insertChatMember = async (chatId: string, userId: string, fields: ChatMemberFields, session?: any): Promise<boolean> => {
  const things = await getThingsCollection();
  try {
    await insertMessengerThing(things, newChatMemberDoc(chatId, userId, fields) as any, session ? { session } : {});
    return true;
  } catch (err: any) {
    if (err?.code === 11000) return false;
    throw err;
  }
};

// Batch sibling of insertChatMember: ONE insertMany for a whole membership
// write instead of a round trip per id. Members carry per-id fields because a
// single batch mixes roles and states (a DM writes owner + member, a group
// writes owner + a follow-dependent active/pending mix).
//
// `ordered: false` makes the driver attempt every doc and report per-doc
// failures, so a racing duplicate on one id can never block the rest — the
// same tolerance the per-id `code === 11000` catch gives, at one round trip
// instead of up to MAX_CHAT_MEMBERS_PER_ADD (50). Promise.all over insertOne
// was no substitute: maxPoolSize is 10, so 50 concurrent inserts still drain
// as 5 sequential pool rounds.
//
// NOTE (merge of the storage-accounting work): unlike insertChatMember this
// writes the collection directly, so the rows it mints skip the accounted
// writer's size stamp and per-owner ledger delta. Chat creation therefore
// still inserts its members one accounted call at a time. Closing the gap
// needs a batch primitive alongside insertAccountedThing — until that lands,
// only addChatMembers takes this path and the reconciler picks up the drift.
const insertChatMembers = async (chatId: string, members: Array<{ userId: string; fields: ChatMemberFields }>): Promise<void> => {
  if (!members.length) return;
  const things = await getThingsCollection();
  try {
    await things.insertMany(
      members.map(({ userId, fields }) => newChatMemberDoc(chatId, userId, fields)) as any,
      { ordered: false }
    );
  } catch (err: any) {
    // A batch is benign only when every failure is an already-existing member
    // race and the driver confirms there was no simultaneous durability error.
    if (isDuplicateOnlyBulkWriteError(err)) return;
    throw err;
  }
};

const reviveMembership = async (memberDoc: any, fields: { role?: ChatRole; state?: MemberState }, session?: any) => {
  const things = await getThingsCollection();
	await updateMessengerThing(things, { shareId: memberDoc.shareId } as any, {
      $set: {
        'crystal.state': fields.state || 'active',
        ...(fields.role ? { 'crystal.role': fields.role } : {}),
        updatedAt: new Date()
      }
	}, session ? { session } : {});
};

// Bumps the chat's activity stamp and (for main-list messages) replaces its
// denormalized crystal.lastMessage preview — a single bounded field, so the
// sidebar/notification list never has to aggregate message history. This is
// the replace-on-write flavour FUNDAMENTALS §3 allows; the accumulating data
// (the messages themselves) stays relational.
export const chatPreviewOf = (message: any, attachmentCount = 0) => ({
  id: message.shareId,
  authorId: String(message.ownerId),
  text: message.crystal?.deletedAt ? '' : String(message.crystal?.text || '').slice(0, 140),
  deleted: !!message.crystal?.deletedAt,
  systemType: message.crystal?.systemType ?? null,
	attachmentCount,
  createdAt: new Date(message.createdAt).toISOString()
});

export const touchChat = async (chatId: string, lastMessage?: Record<string, unknown>, session?: any) => {
  const things = await getThingsCollection();
	await updateMessengerThing(things, { shareId: chatId, thingtime: 'chat' } as any, {
		$set: { updatedAt: new Date(), ...(lastMessage ? { 'crystal.lastMessage': lastMessage } : {}) }
	}, session ? { session } : {});
};

// System event messages keep the conversation's history honest (renames,
// membership changes) — they are ordinary chat-message things with systemType.
const insertSystemMessage = async (
	chatId: string,
	actorId: string,
	systemType: string,
	systemMeta: Record<string, unknown> = {},
	session?: any
) => {
  const things = await getThingsCollection();
  const message = newThingDoc('chat-message', {
    ownerId: actorId,
    targetId: chatId,
    crystal: {
      text: '',
      threadRootId: null,
      replyToId: null,
      editedAt: null,
      deletedAt: null,
      systemType,
      systemMeta
    }
  });
  await insertMessengerThing(things, message as any, session ? { session } : {});
  await touchChat(chatId, chatPreviewOf(message), session);
};

export type ChatAccess = { chat: any; member: any };

// Membership gate used by every chat read/write. Pending members may READ
// (message requests show the conversation); anything stronger opts in via
// requireActive.
export const resolveChatAccess = async (viewerId: string, chatId: unknown, opts: { requireActive?: boolean } = {}): Promise<ChatAccess | Fail> => {
  if (typeof chatId !== 'string' || !chatId.trim()) return fail(400, 'Chat id required');
  // The membership lookup does not need the chat document — findThingByKind
  // matches on shareId === id, so chat.shareId is just the trimmed id. Running
  // both together removes one serial round trip from the gate on every
  // messenger read and write (11 call sites, and open chats poll every 4s).
  // On the 404 path the member query is issued and discarded: one wasted
  // indexed findOne on an error path, no correctness change.
  const id = chatId.trim();
  const [chat, member] = await Promise.all([findThingByKind('chat', id), getChatMemberDoc(id, viewerId)]);
  if (!chat) return fail(404, 'Chat not found');
  const state = member?.crystal?.state;
  if (!member || state === 'left' || state === 'declined') return fail(403, 'You are not in this chat');
  if (opts.requireActive && state !== 'active') return fail(403, 'Accept the message request first');
  return { chat, member };
};

// admin = chat admin/owner, or community admin/owner for channels
const canAdministerChat = async (chat: any, member: any, viewerId: string): Promise<boolean> => {
  const role = (member?.crystal?.role as ChatRole) || 'member';
  if (ROLE_RANK[role] >= ROLE_RANK.admin) return true;
  if (chat.crystal?.chatType === 'channel' && chat.crystal?.communityId) {
    const communityRole = await communityRoleOf(chat.crystal.communityId, viewerId);
    return !!communityRole && ROLE_RANK[communityRole] >= ROLE_RANK.admin;
  }
  return false;
};

// ── create ──

export type CreateChatResult = Fail | { ok: true; chat: ChatListEntry; existing?: boolean };

export const createChat = async (
  viewerId: string,
  input: {
    chatType?: unknown;
    name?: unknown;
    topic?: unknown;
    communityId?: unknown;
    sectionId?: unknown;
    channelVisibility?: unknown;
    memberIds?: unknown;
  }
): Promise<CreateChatResult> => {
  const chatType = input.chatType === 'channel' || input.chatType === 'group' || input.chatType === 'dm' ? input.chatType : null;
  if (!chatType) return fail(400, 'chatType must be "channel", "group" or "dm"');
  const things = await getThingsCollection();
  const memberIds = Array.isArray(input.memberIds)
    ? Array.from(
				new Set((input.memberIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim()))
      ).filter((id) => id !== viewerId)
    : [];
  if (memberIds.length > MAX_CHAT_MEMBERS_PER_ADD) return fail(400, `Add at most ${MAX_CHAT_MEMBERS_PER_ADD} people at once`);
  // Everyone being added must actually exist. findUsersByIds resolves the
  // whole set in 2 queries (things-era + legacy) instead of 2 per id, so a
  // 50-person create drops from ~100 lookups to 2. It DROPS rows it cannot
  // find rather than returning nulls in place, so membership is tested
  // through the id set, not by position — and the first missing id is still
  // the one named.
  const foundIds = new Set((await findUsersByIds(memberIds)).map((user: any) => String(user._id)));
  const missing = memberIds.filter((id) => !foundIds.has(id));
  if (missing.length) return fail(404, `No such user: ${missing[0]}`);

  if (chatType === 'dm') {
    if (memberIds.length !== 1) return fail(400, 'A DM needs exactly one other person');
    const otherId = memberIds[0];
    const dmKey = dmKeyOf(viewerId, otherId);
    const existing = await things.findOne({ thingtime: 'chat', 'crystal.dmKey': dmKey } as any);
    if (existing) {
      // the initiator re-opening a DM is always active (accepting any pending
      // request they had); the OTHER side's state is never touched here
      const myMember = await getChatMemberDoc((existing as any).shareId, viewerId);
      if (myMember && myMember.crystal?.state !== 'active') await reviveMembership(myMember, { state: 'active' });
      if (!myMember) await insertChatMember((existing as any).shareId, viewerId, { role: 'member', state: 'active' });
      const entry = await chatListEntryFor(viewerId, (existing as any).shareId);
      if (entry.ok === false) return entry;
      return { ok: true, chat: entry.chat, existing: true };
    }
    // Message-request classification (FB semantics): if the recipient follows
    // the sender they know them — lands as a normal chat. Otherwise it queues
    // as a request, bucketed by whether the sender is at least a follower.
		const [recipientFollowsSender, senderFollowsRecipient] = await Promise.all([isFollowing(otherId, viewerId), isFollowing(viewerId, otherId)]);
    const chat = newThingDoc('chat', {
      ownerId: viewerId,
      crystal: { chatType, name: null, topic: null, communityId: null, sectionId: null, channelVisibility: null, dmKey }
    });
    try {
			await withMessengerStorageTransaction(async (session) => {
				await insertMessengerThing(things, chat as any, { session });
				await insertChatMember(chat.shareId, viewerId, { role: 'owner', state: 'active' }, session);
				await insertChatMember(
					chat.shareId,
					otherId,
					{
						role: 'member',
						state: recipientFollowsSender ? 'active' : 'pending',
						requestOrigin: recipientFollowsSender ? null : senderFollowsRecipient ? 'follower' : 'unknown'
					},
					session
				);
			});
    } catch (err: any) {
      if (err?.code === 11000) {
        // lost a create race — recurse once onto the winner
        return createChat(viewerId, input);
      }
      throw err;
    }
    const entry = await chatListEntryFor(viewerId, chat.shareId);
    if (entry.ok === false) return entry;
    return { ok: true, chat: entry.chat };
  }

  let name = boundedTrimmed(input.name, MAX_CHAT_NAME_CHARS);
  let communityId: string | null = null;
  let sectionId: string | null = null;
  if (chatType === 'channel') {
    if (typeof input.communityId !== 'string' || !input.communityId.trim()) return fail(400, 'Channels need a communityId');
    const community = await findThingByKind('community', input.communityId.trim());
    if (!community) return fail(404, 'Community not found');
    const myRole = await communityRoleOf(community.shareId, viewerId);
    if (!myRole) return fail(403, 'Join the community before creating channels');
    if (!name) return fail(400, 'Channels need a name');
    name = name.toLowerCase().replace(/\s+/g, '-');
    communityId = community.shareId;
    const channelCount = await things.countDocuments({ thingtime: 'chat', 'crystal.communityId': communityId } as any);
    if (channelCount >= MAX_CHATS_PER_COMMUNITY) return fail(400, 'This community has enough channels already');
    if (typeof input.sectionId === 'string' && input.sectionId.trim()) {
      const section = await things.findOne({ thingtime: 'chat-section', shareId: input.sectionId.trim(), targetId: communityId } as any);
      if (!section) return fail(404, 'Section not found in that community');
      sectionId = (section as any).shareId;
    }
    // channel invitees must already be community members — channel access
    // must never outrun the community's invite gate
    if (memberIds.length) {
      const inCommunity = await communityMembersAmong(communityId, memberIds);
      const outsider = memberIds.find((id) => !inCommunity.has(id));
      if (outsider) return fail(403, 'Everyone you add to a channel has to join the community first');
    }
  }
  const chat = newThingDoc('chat', {
    ownerId: viewerId,
    targetId: communityId,
    crystal: {
      chatType,
      name,
      topic: boundedTrimmed(input.topic, MAX_CHAT_TOPIC_CHARS),
      communityId,
      sectionId,
      channelVisibility: chatType === 'channel' ? (input.channelVisibility === 'private' ? 'private' : 'public') : null,
      dmKey: null
    }
  });
  let groupMemberships: Array<{ id: string; state: MemberState; requestOrigin: RequestOrigin | null }> = [];
  if (chatType === 'group') {
    // groups obey the same request wall as DMs: members who follow the
    // creator land active, everyone else gets a pending request (bucketed by
    // whether the creator follows them) — otherwise groups would be the
    // trivial bypass of the whole anti-harassment gate
		const [followsCreator, creatorFollows] = await Promise.all([followersOfSet(memberIds, viewerId), followingSet(viewerId, memberIds)]);
		groupMemberships = memberIds.map((id) => ({
			id,
			state: followsCreator.has(id) ? 'active' : 'pending',
			requestOrigin: followsCreator.has(id) ? null : creatorFollows.has(id) ? 'follower' : 'unknown'
		}));
  } else {
		// channels: invitees were verified as community members above
		groupMemberships = memberIds.map((id) => ({ id, state: 'active', requestOrigin: null }));
  }
	await withMessengerStorageTransaction(async (session) => {
		await insertMessengerThing(things, chat as any, { session });
		await insertChatMember(chat.shareId, viewerId, { role: 'owner', state: 'active' }, session);
		for (const membership of groupMemberships) {
			await insertChatMember(
				chat.shareId,
				membership.id,
				{ role: 'member', state: membership.state, requestOrigin: membership.requestOrigin },
				session
			);
		}
		await insertSystemMessage(chat.shareId, viewerId, 'chat-created', { name }, session);
	});
  const entry = await chatListEntryFor(viewerId, chat.shareId);
  if (entry.ok === false) return entry;
  return { ok: true, chat: entry.chat };
};

// ── list + summaries ──

type SummaryContext = {
  chatDocs: any[];
  membershipByChat: Map<string, any>;
  unreadByChat: Map<string, number>;
  lastByChat: Map<string, any>;
  memberDocsByChat: Map<string, any[]>;
  memberCountByChat: Map<string, number>;
  profiles: Map<string, FeedAuthor>;
  memberReceipts: Record<string, boolean>;
  viewerReceipts: boolean;
};

// One shot of aggregation for a set of chats the viewer belongs to: unread
// counts + newest message via a single $facet aggregate, memberships for
// DM/group rows via one $in, profiles via one resolveProfiles pass.
const buildSummaryContext = async (viewerId: string, memberships: any[]): Promise<SummaryContext> => {
  const things = await getThingsCollection();
  const chatIds = memberships.map((m: any) => String(m.targetId));
  const membershipByChat = new Map(memberships.map((m: any) => [String(m.targetId), m]));
  // Unread floor per chat: your receipt, else when you JOINED — history that
  // predates you is not unread, and the clause keeps the scan bounded to
  // recent docs on the { targetId, thingtime, createdAt } index. Newest-
  // message previews come from the chat docs' denormalized crystal.lastMessage
  // (replace-on-write via touchChat), so no aggregation ever touches message
  // history for the sidebar.
  const unreadClauses = memberships.map((m: any) => ({
    targetId: String(m.targetId),
    createdAt: { $gt: m.crystal?.lastReadAt ? new Date(m.crystal.lastReadAt) : new Date(m.createdAt) }
  }));

  // The chat docs, the unread rollup and the active-member counts are all
  // keyed off chatIds alone — none reads another's result — so they issue
  // together. Only the member ROWS below genuinely have to wait, because
  // which chats need them is derived from the chat docs' chatType.
  const [chatDocs, unreadAgg, countAgg] = await Promise.all([
    chatIds.length ? things.find({ thingtime: 'chat', shareId: { $in: chatIds } } as any).toArray() : Promise.resolve([]),
    chatIds.length
      ? things
          .aggregate([
            {
              $match: {
                thingtime: 'chat-message',
                targetId: { $in: chatIds },
                'crystal.threadRootId': null,
                // system events (joins, renames) never bold a chat — only real
                // words from other people count as unread
                ownerId: { $ne: viewerId },
                'crystal.deletedAt': null,
                'crystal.systemType': null,
                $or: unreadClauses
              }
            },
            { $group: { _id: '$targetId', count: { $sum: 1 } } }
          ])
          .toArray()
      : Promise.resolve([]),
    chatIds.length
      ? things
          .aggregate([
            { $match: { thingtime: 'chat-member', targetId: { $in: chatIds }, 'crystal.state': 'active' } },
            { $group: { _id: '$targetId', count: { $sum: 1 } } }
          ])
          .toArray()
      : Promise.resolve([])
  ]);
  const unreadByChat = new Map<string, number>(unreadAgg.map((u: any) => [String(u._id), u.count]));
  const memberCountByChat = new Map<string, number>(countAgg.map((c: any) => [String(c._id), c.count]));
  const lastByChat = new Map<string, any>(
		chatDocs.filter((c: any) => c.crystal?.lastMessage?.id).map((c: any) => [c.shareId, c.crystal.lastMessage])
  );

  // member rows ship inline for DMs and small groups (names/avatars for the
  // sidebar); channels only need counts
	const smallChatIds = chatDocs.filter((c: any) => c.crystal?.chatType !== 'channel').map((c: any) => c.shareId);
  const memberDocs = smallChatIds.length
    ? await things
        .find({ thingtime: 'chat-member', targetId: { $in: smallChatIds }, 'crystal.state': { $in: ['active', 'pending'] } } as any)
        .sort({ createdAt: 1, shareId: 1 })
        .toArray()
    : [];
  const memberDocsByChat = new Map<string, any[]>();
  for (const doc of memberDocs) {
    const key = String((doc as any).targetId);
    if (!memberDocsByChat.has(key)) memberDocsByChat.set(key, []);
    memberDocsByChat.get(key)!.push(doc);
  }

  const profileIds = new Set<string>();
  for (const doc of memberDocs) profileIds.add(String((doc as any).ownerId));
  for (const preview of lastByChat.values()) profileIds.add(String(preview.authorId));

  // Profiles and both receipt lookups all read from memberDocs and nothing
  // else, so the profile pass joins the receipt batch instead of preceding it.
  const receiptUserIds = new Set<string>(memberDocs.map((d: any) => String(d.ownerId)));
  const [profiles, viewerReceipts, memberReceipts] = await Promise.all([
    resolveProfiles(Array.from(profileIds)),
    getUserReadReceiptsEnabled(viewerId),
    getUsersReadReceiptsMap(Array.from(receiptUserIds))
  ]);

  return {
    chatDocs,
    membershipByChat,
    unreadByChat,
    lastByChat,
    memberDocsByChat,
    memberCountByChat,
    profiles,
    memberReceipts,
    viewerReceipts
  };
};

const summaryEntry = (viewerId: string, chatDoc: any, ctx: SummaryContext): ChatListEntry => {
  const chatId = chatDoc.shareId;
  const membership = ctx.membershipByChat.get(chatId);
  const memberDocs = ctx.memberDocsByChat.get(chatId) || null;
  const projectOpts = { viewerId, viewerReceipts: ctx.viewerReceipts, memberReceipts: ctx.memberReceipts };
  const members =
    memberDocs && memberDocs.length <= LIST_MEMBER_PROFILE_CAP
      ? memberDocs.map((doc: any) => toPublicMember(doc, ctx.profiles.get(String(doc.ownerId)) || null, projectOpts))
      : null;
  const preview = ctx.lastByChat.get(chatId) || null;
  const my = membership ? toPublicMember(membership, null, projectOpts) : null;
  return {
    ...toPublicChat(chatDoc),
    myMember: my
      ? {
          userId: my.userId,
          role: my.role,
          nickname: my.nickname,
          state: my.state,
          requestOrigin: my.requestOrigin,
          muted: my.muted,
          lastReadMessageId: my.lastReadMessageId,
          lastReadAt: my.lastReadAt,
          joinedAt: my.joinedAt
        }
      : (null as any),
    members,
    memberCount: ctx.memberCountByChat.get(chatId) || 0,
    unreadCount: ctx.unreadByChat.get(chatId) || 0,
    lastMessage: preview
      ? {
          id: String(preview.id),
          authorId: String(preview.authorId),
					authorName: ctx.profiles.get(String(preview.authorId)) ? getUserDisplayName(ctx.profiles.get(String(preview.authorId))!) : null,
          text: preview.deleted ? '' : String(preview.text || ''),
          deleted: !!preview.deleted,
          systemType: preview.systemType ?? null,
					attachmentCount: Number.isSafeInteger(preview.attachmentCount) ? Math.max(0, Number(preview.attachmentCount)) : 0,
          createdAt: String(preview.createdAt),
          externalSource: publicExternalAiSource(preview.externalSource)
        }
      : null
  };
};

export const chatListEntryFor = async (viewerId: string, chatId: string): Promise<Fail | { ok: true; chat: ChatListEntry }> => {
  const membership = await getChatMemberDoc(chatId, viewerId);
  if (!membership) return fail(403, 'You are not in this chat');
  const ctx = await buildSummaryContext(viewerId, [membership]);
  const chatDoc = ctx.chatDocs[0];
  if (!chatDoc) return fail(404, 'Chat not found');
  return { ok: true, chat: summaryEntry(viewerId, chatDoc, ctx) };
};

// List entries for a known set of chat ids — the same summary aggregation as
// listChats (unread, preview, membership), scoped by the viewer's ACTIVE
// memberships in those chats (one $in over the member keys). Chats the
// viewer is not an active member of are silently absent. Order is the
// caller's to decide.
export const listChatsById = async (viewerId: string, chatIds: readonly string[]): Promise<ChatListEntry[]> => {
  const ids = Array.from(new Set(chatIds.filter((id) => typeof id === 'string' && !!id.trim()))).slice(0, MAX_LISTED_CHATS);
  if (!ids.length) return [];
  const things = await getThingsCollection();
  const memberships = await things
    .find({ thingtime: 'chat-member', 'crystal.memberKey': { $in: ids.map((id) => chatMemberKey(id, viewerId)) }, 'crystal.state': 'active' } as any)
    .toArray();
  if (!memberships.length) return [];
  const ctx = await buildSummaryContext(viewerId, memberships);
  return ctx.chatDocs.map((doc: any) => summaryEntry(viewerId, doc, ctx));
};

export type ListChatsResult = Fail | { ok: true; chats: ChatListEntry[]; totalUnread: number; requestsCount: number; serverTime: string };

// The one list call both modes and the notification poller share. Pending
// memberships (message requests) are EXCLUDED from `chats` — they surface via
// listRequests — but their count rides along for the badge.
export const listChats = async (viewerId: string): Promise<ListChatsResult> => {
  const things = await getThingsCollection();
  // newest memberships first — fully served by the { thingtime, ownerId,
  // createdAt, shareId } index. (The 300 cap is a wide backstop; ordering of
  // the RETURNED list is by last activity below.)
  const memberships = await things
    .find({ thingtime: 'chat-member', ownerId: viewerId, 'crystal.state': { $in: ['active', 'pending'] } } as any)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(MAX_LISTED_CHATS)
    .toArray();
  const active = memberships.filter((m: any) => m.crystal?.state === 'active');
  const pendingCount = memberships.length - active.length;
  const ctx = await buildSummaryContext(viewerId, active);
  const chats = ctx.chatDocs
    .map((doc: any) => summaryEntry(viewerId, doc, ctx))
    .sort((a, b) => (b.lastMessage?.createdAt || b.updatedAt).localeCompare(a.lastMessage?.createdAt || a.updatedAt));
  const totalUnread = chats.reduce((sum, c) => sum + (c.myMember?.muted ? 0 : c.unreadCount), 0);
  return { ok: true, chats, totalUnread, requestsCount: pendingCount, serverTime: new Date().toISOString() };
};

export type ChatDetailResult =
  | Fail
  | { ok: true; chat: PublicChat; myMember: PublicChatMember; members: PublicChatMember[]; communityName: string | null };

export const getChatDetail = async (viewerId: string, chatId: unknown): Promise<ChatDetailResult> => {
  const access = await resolveChatAccess(viewerId, chatId);
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  const memberDocs = await listChatMemberDocs(chat.shareId);
  const profiles = await resolveProfiles(memberDocs.map((m: any) => String(m.ownerId)));
  const [viewerReceipts, memberReceipts] = await Promise.all([
    getUserReadReceiptsEnabled(viewerId),
    getUsersReadReceiptsMap(memberDocs.map((m: any) => String(m.ownerId)))
  ]);
  const opts = { viewerId, viewerReceipts, memberReceipts };
  const members = memberDocs.map((doc: any) => toPublicMember(doc, profiles.get(String(doc.ownerId)) || null, opts));
  let communityName: string | null = null;
  if (chat.crystal?.communityId) {
    const community = await findThingByKind('community', chat.crystal.communityId);
    communityName = community?.crystal?.name || null;
  }
  return {
    ok: true,
    chat: toPublicChat(chat),
    myMember: toPublicMember(member, profiles.get(viewerId) || null, opts),
    members,
    communityName
  };
};

// ── update (rename / topic / section / visibility) ──

export type UpdateChatResult = Fail | { ok: true; chat: PublicChat };

export const updateChat = async (
  viewerId: string,
  input: { id?: unknown; name?: unknown; topic?: unknown; sectionId?: unknown; channelVisibility?: unknown }
): Promise<UpdateChatResult> => {
  const access = await resolveChatAccess(viewerId, input.id, { requireActive: true });
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  if (chat.crystal?.externalSource && !isLopuSource(chat.crystal.externalSource)) {
    return fail(409, 'Imported AI chat details are read-only; resync the source to update them');
  }
  const chatType: ChatType = chat.crystal?.chatType;
  if (chatType === 'dm') return fail(400, 'DMs have no name — set a nickname instead');
  // FB-style: any member may rename a group; channels need admin
  if (chatType === 'channel' && !(await canAdministerChat(chat, member, viewerId))) {
    return fail(403, 'Only channel or community admins can change a channel');
  }
  const things = await getThingsCollection();
  const patch: Record<string, unknown> = {};
  const events: { type: string; meta: Record<string, unknown> }[] = [];
  if (input.name !== undefined) {
    let name = boundedTrimmed(input.name, MAX_CHAT_NAME_CHARS);
    if (!name) return fail(400, 'Chats need a name');
    if (chatType === 'channel') name = name.toLowerCase().replace(/\s+/g, '-');
    if (name !== chat.crystal?.name) {
      patch['crystal.name'] = name;
      events.push({ type: 'chat-renamed', meta: { value: name } });
    }
  }
  if (input.topic !== undefined) {
    const topic = boundedTrimmed(input.topic, MAX_CHAT_TOPIC_CHARS);
    if (topic !== (chat.crystal?.topic ?? null)) {
      patch['crystal.topic'] = topic;
      events.push({ type: 'topic-changed', meta: { value: topic } });
    }
  }
  if (input.sectionId !== undefined && chatType === 'channel') {
    if (input.sectionId === null || input.sectionId === '') {
      patch['crystal.sectionId'] = null;
    } else if (typeof input.sectionId === 'string') {
      const section = await things.findOne({
        thingtime: 'chat-section',
        shareId: input.sectionId.trim(),
        targetId: chat.crystal?.communityId
      } as any);
      if (!section) return fail(404, 'Section not found in this community');
      patch['crystal.sectionId'] = (section as any).shareId;
    }
  }
  if (input.channelVisibility !== undefined && chatType === 'channel') {
    if (input.channelVisibility !== 'public' && input.channelVisibility !== 'private') {
      return fail(400, 'channelVisibility must be "public" or "private"');
    }
    patch['crystal.channelVisibility'] = input.channelVisibility;
  }
  if (!Object.keys(patch).length) return fail(400, 'Nothing to update');
  await updateMessengerThing(things, { shareId: chat.shareId } as any, { $set: { ...patch, updatedAt: new Date() } });
  for (const event of events) await insertSystemMessage(chat.shareId, viewerId, event.type, event.meta);
  const fresh = await findThingByKind('chat', chat.shareId);
  return { ok: true, chat: toPublicChat(fresh) };
};

// ── membership management ──

export type ManageMembersResult = Fail | { ok: true; members: PublicChatMember[] };

const membersPayload = async (viewerId: string, chatId: string): Promise<{ ok: true; members: PublicChatMember[] }> => {
  const memberDocs = await listChatMemberDocs(chatId);
  const profiles = await resolveProfiles(memberDocs.map((m: any) => String(m.ownerId)));
  const [viewerReceipts, memberReceipts] = await Promise.all([
    getUserReadReceiptsEnabled(viewerId),
    getUsersReadReceiptsMap(memberDocs.map((m: any) => String(m.ownerId)))
  ]);
  const opts = { viewerId, viewerReceipts, memberReceipts };
  return { ok: true, members: memberDocs.map((doc: any) => toPublicMember(doc, profiles.get(String(doc.ownerId)) || null, opts)) };
};

export const manageChatMembers = async (
  viewerId: string,
  input: {
    chatId?: unknown;
    join?: unknown;
    add?: unknown;
    remove?: unknown;
    role?: unknown;
    nickname?: unknown;
    mute?: unknown;
  }
): Promise<ManageMembersResult> => {
  // join is special: the viewer is NOT yet a member, so the access gate does
  // not apply — community membership + a public channel is the door
  if (input.join === true) {
    if (typeof input.chatId !== 'string' || !input.chatId.trim()) return fail(400, 'Chat id required');
    const chat = await findThingByKind('chat', input.chatId.trim());
    if (!chat) return fail(404, 'Chat not found');
    if (chat.crystal?.chatType !== 'channel') return fail(400, 'Only channels can be joined — ask for an invite instead');
    if (chat.crystal?.channelVisibility === 'private') return fail(403, 'This channel is private — an admin has to add you');
    const communityRole = chat.crystal?.communityId ? await communityRoleOf(chat.crystal.communityId, viewerId) : null;
    if (!communityRole) return fail(403, 'Join the community first');
    const existing = await getChatMemberDoc(chat.shareId, viewerId);
    if (existing && existing.crystal?.state === 'active') {
      // already in — a friendly no-op, and no duplicate join event
      return membersPayload(viewerId, chat.shareId);
    }
    if (existing) {
      // rejoining never restores an old crown — an ex-owner comes back a member
      await reviveMembership(existing, { state: 'active', role: 'member' });
    } else {
      const activeCount = await countActiveChatMembers(chat.shareId);
      if (activeCount >= MAX_CHAT_MEMBERS) return fail(400, 'This chat is full');
      await insertChatMember(chat.shareId, viewerId, { role: 'member', state: 'active' });
    }
    await insertSystemMessage(chat.shareId, viewerId, 'member-added', { subjectId: viewerId });
    return membersPayload(viewerId, chat.shareId);
  }

  const access = await resolveChatAccess(viewerId, input.chatId, { requireActive: true });
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  const chatType: ChatType = chat.crystal?.chatType;
  const things = await getThingsCollection();

  if (Array.isArray(input.add) && input.add.length) {
    if (chatType === 'dm') return fail(400, 'DMs stay between two people — start a group instead');
    if (isLopuSource(chat.crystal?.externalSource)) return fail(400, 'Lopu conversations stay between you and Lopu');
    // groups: any member adds (FB); channels: public → any member, private → admin
    if (chatType === 'channel' && chat.crystal?.channelVisibility === 'private' && !(await canAdministerChat(chat, member, viewerId))) {
      return fail(403, 'Only admins can add people to a private channel');
    }
    const ids = Array.from(
      new Set((input.add as unknown[]).filter((id): id is string => typeof id === 'string' && !!id.trim()).map((id) => id.trim()))
    ).filter((id) => id !== viewerId);
    if (!ids.length) return fail(400, 'Nobody to add');
    if (ids.length > MAX_CHAT_MEMBERS_PER_ADD) return fail(400, `Add at most ${MAX_CHAT_MEMBERS_PER_ADD} people at once`);
    // one batched existence check, not 2 queries per id — see createChat
    const foundIds = new Set((await findUsersByIds(ids)).map((user: any) => String(user._id)));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length) return fail(404, `No such user: ${missing[0]}`);
    // channel access must never outrun the community's invite gate: everyone
    // added to a channel has to already be a community member (the same wall
    // the join branch enforces on self-joins)
    if (chatType === 'channel' && chat.crystal?.communityId) {
      const inCommunity = await communityMembersAmong(chat.crystal.communityId, ids);
      if (ids.some((id) => !inCommunity.has(id))) {
        return fail(403, 'Everyone you add to a channel has to join the community first');
      }
    }
    const activeCount = await countActiveChatMembers(chat.shareId);
    if (activeCount + ids.length > MAX_CHAT_MEMBERS) return fail(400, 'That would make this chat too big');
    // one batched pass: existing memberships in ONE query, revives in ONE
    // update, fresh members in ONE insert, one member-added event naming
    // everyone who actually (re)entered
    const existingDocs = await things
      .find({ thingtime: 'chat-member', 'crystal.memberKey': { $in: ids.map((id) => chatMemberKey(chat.shareId, id)) } } as any)
      .toArray();
    const existingByUser = new Map(existingDocs.map((doc: any) => [String(doc.ownerId), doc]));
    const toRevive = existingDocs.filter((doc: any) => doc.crystal?.state !== 'active');
    const toInsert = ids.filter((id) => !existingByUser.has(id));
    if (toRevive.length) {
			await updateMessengerThings(things, { shareId: { $in: toRevive.map((doc: any) => doc.shareId) } } as any, {
				$set: { 'crystal.state': 'active', 'crystal.role': 'member', updatedAt: new Date() }
			});
    }
    // insertChatMembers tolerates duplicate-key races across the whole batch
    await insertChatMembers(
      chat.shareId,
      toInsert.map((id) => ({ userId: id, fields: { role: 'member' as ChatRole, state: 'active' as MemberState } }))
    );
    const entered = [...toInsert, ...toRevive.map((doc: any) => String(doc.ownerId))];
    if (entered.length) {
      await insertSystemMessage(chat.shareId, viewerId, 'member-added', entered.length === 1 ? { subjectId: entered[0] } : { subjectIds: entered });
    }
    return membersPayload(viewerId, chat.shareId);
  }

  if (typeof input.remove === 'string' && input.remove.trim()) {
    if (chatType === 'dm') return fail(400, 'DMs stay between two people — decline or mute instead');
    const targetId = input.remove.trim();
    if (targetId === viewerId) return fail(400, 'Use leave to walk out gracefully');
    if (!(await canAdministerChat(chat, member, viewerId))) return fail(403, 'Only admins can remove people');
    const target = await getChatMemberDoc(chat.shareId, targetId);
    if (!target || target.crystal?.state === 'left') return fail(404, 'That user is not in this chat');
    if (target.crystal?.role === 'owner') return fail(403, 'The chat owner cannot be removed');
    await updateMessengerThing(things, { shareId: target.shareId } as any, { $set: { 'crystal.state': 'left', updatedAt: new Date() } });
    await insertSystemMessage(chat.shareId, viewerId, 'member-removed', { subjectId: targetId });
    return membersPayload(viewerId, chat.shareId);
  }

  if (input.role && typeof input.role === 'object') {
    if (chatType === 'dm') return fail(400, 'DMs have no admins — you are both just people');
    const targetId = boundedTrimmed((input.role as any).userId, 128);
    const role = (input.role as any).role;
    if (!targetId || (role !== 'admin' && role !== 'member')) return fail(400, 'role needs { userId, role: "admin" | "member" }');
    if (!(await canAdministerChat(chat, member, viewerId))) return fail(403, 'Only admins can change roles');
    const target = await getChatMemberDoc(chat.shareId, targetId);
    if (!target || target.crystal?.state !== 'active') return fail(404, 'That user is not in this chat');
    if (target.crystal?.role === 'owner') return fail(403, 'The chat owner keeps the crown');
    await updateMessengerThing(things, { shareId: target.shareId } as any, { $set: { 'crystal.role': role, updatedAt: new Date() } });
    return membersPayload(viewerId, chat.shareId);
  }

  if (input.nickname && typeof input.nickname === 'object') {
    const targetId = boundedTrimmed((input.nickname as any).userId, 128) || viewerId;
    const raw = (input.nickname as any).nickname;
    const nickname = raw === null || raw === '' ? null : boundedTrimmed(raw, MAX_NICKNAME_CHARS);
    if (raw !== null && raw !== '' && !nickname) return fail(400, 'That nickname did not survive validation');
    const target = await getChatMemberDoc(chat.shareId, targetId);
    if (!target || target.crystal?.state === 'left' || target.crystal?.state === 'declined') {
      return fail(404, 'That user is not in this chat');
    }
    await updateMessengerThing(things, { shareId: target.shareId } as any, { $set: { 'crystal.nickname': nickname, updatedAt: new Date() } });
    return membersPayload(viewerId, chat.shareId);
  }

  if (typeof input.mute === 'boolean') {
    await updateMessengerThing(things, { shareId: member.shareId } as any, { $set: { 'crystal.muted': input.mute, updatedAt: new Date() } });
    return membersPayload(viewerId, chat.shareId);
  }

  return fail(400, 'Pass join, add, remove, role, nickname or mute');
};

export type LeaveChatResult = Fail | { ok: true };

export const leaveChat = async (viewerId: string, chatId: unknown): Promise<LeaveChatResult> => {
  const access = await resolveChatAccess(viewerId, chatId);
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  if (chat.crystal?.chatType === 'dm') return fail(400, 'DMs cannot be left — mute or decline instead');
  if (isLopuSource(chat.crystal?.externalSource)) return fail(400, 'Delete the Lopu conversation instead — it is only you in here');
  const things = await getThingsCollection();
  await updateMessengerThing(things, { shareId: member.shareId } as any, { $set: { 'crystal.state': 'left', updatedAt: new Date() } });
  await insertSystemMessage(chat.shareId, viewerId, 'member-left', { subjectId: viewerId });
  // an owner walking out hands the chat to the earliest surviving admin, else
  // the earliest member — a chat with people in it always has an owner
  if (member.crystal?.role === 'owner') {
    const survivors = await listChatMemberDocs(chat.shareId);
    const activeSurvivors = survivors.filter((m: any) => m.crystal?.state === 'active');
		const heir = activeSurvivors.find((m: any) => m.crystal?.role === 'admin') || activeSurvivors[0] || null;
    if (heir) {
      await updateMessengerThing(things, { shareId: heir.shareId } as any, { $set: { 'crystal.role': 'owner', updatedAt: new Date() } });
    }
  }
  return { ok: true };
};

// ── messages ──

export const projectMessages = async (
  viewerId: string,
  chatId: string,
  docs: any[],
  opts: { withThreadCounts: boolean }
): Promise<{ messages: PublicChatMessage[]; customEmojis: CustomEmojiMap }> => {
  const things = await getThingsCollection();
  const ids = docs.map((d: any) => d.shareId);
	const replyToIds = Array.from(new Set(docs.map((d: any) => d.crystal?.replyToId).filter((id: any): id is string => typeof id === 'string')));

	const [reactionDocs, threadAgg, replyDocs, attachmentDocs] = await Promise.all([
    ids.length
      ? things
          .find({ thingtime: 'reaction', targetId: { $in: ids } } as any, {
            projection: { targetId: 1, ownerId: 1, 'crystal.emoji': 1 }
          })
          .toArray()
      : [],
    opts.withThreadCounts && ids.length
      ? things
          .aggregate([
            { $match: { thingtime: 'chat-message', 'crystal.threadRootId': { $in: ids } } },
            { $group: { _id: '$crystal.threadRootId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } }
          ])
          .toArray()
      : [],
		replyToIds.length ? things.find({ thingtime: 'chat-message', shareId: { $in: replyToIds }, targetId: chatId } as any).toArray() : [],
		ids.length || replyToIds.length
			? things
					.find(
						{
							thingtime: 'attachment',
							targetId: { $in: Array.from(new Set([...ids, ...replyToIds])) },
							attachmentState: 'ready',
							attachmentPurpose: 'message'
						} as any,
						{ projection: { shareId: 1, targetId: 1, ownerId: 1, attachmentSortIndex: 1, crystal: 1, moderation: 1, createdAt: 1 } }
					)
					.sort({ createdAt: 1, shareId: 1 })
					.toArray()
      : []
  ]);

	const messageOwnerById = new Map<string, string>();
	for (const doc of [...docs, ...replyDocs] as any[]) {
		if (typeof doc?.shareId === 'string' && doc?.ownerId !== undefined) {
			messageOwnerById.set(doc.shareId, String(doc.ownerId));
		}
	}
	const attachmentsByMessage = new Map<string, AttachmentPublicMetadata[]>();
	// stamped display order wins; legacy unstamped docs keep createdAt order
	for (const doc of orderAttachmentDocsByStoredSort(attachmentDocs as any[])) {
		const targetId = typeof doc.targetId === 'string' ? doc.targetId : '';
		const attachment = toAttachmentPublicMetadata(doc.shareId, doc.crystal, doc.moderation);
		if (!targetId || !attachment || String(doc.ownerId) !== messageOwnerById.get(targetId)) continue;
		const current = attachmentsByMessage.get(targetId) || [];
		current.push(attachment);
		attachmentsByMessage.set(targetId, current);
	}

  const reactionCountsById = new Map<string, Record<string, number>>();
  const viewerReactionsById = new Map<string, string[]>();
  const customEmojiIds = new Set<string>();
  for (const doc of reactionDocs) {
    const targetId = String((doc as any).targetId);
    const token = (doc as any).crystal?.emoji;
    if (typeof token !== 'string') continue;
    if (isCustomReactionToken(token)) {
      const emojiId = customReactionEmojiId(token);
      if (emojiId) customEmojiIds.add(emojiId);
    }
    const counts = reactionCountsById.get(targetId) || {};
    counts[token] = (counts[token] || 0) + 1;
    reactionCountsById.set(targetId, counts);
    if (String((doc as any).ownerId) === viewerId) {
      const mine = viewerReactionsById.get(targetId) || [];
      mine.push(token);
      viewerReactionsById.set(targetId, mine);
    }
  }

  const threadById = new Map<string, { count: number; lastAt: Date }>(
    (threadAgg as any[]).map((t: any) => [String(t._id), { count: t.count, lastAt: t.lastAt }])
  );
  const replyById = new Map<string, any>((replyDocs as any[]).map((d: any) => [d.shareId, d]));

  const authorIds = new Set<string>(docs.map((d: any) => String(d.ownerId)));
  for (const doc of replyDocs as any[]) authorIds.add(String(doc.ownerId));
  const profiles = await resolveProfiles(Array.from(authorIds));

  // referenced custom emojis ship as { name, animated } ONLY — images are up
  // to ~512KB each and these payloads are polled every few seconds, so
  // clients resolve images once via GET /api/v1/emojis?ids= and cache them
  const emojiDocs = customEmojiIds.size
    ? await things
        .find({ thingtime: 'custom-emoji', shareId: { $in: Array.from(customEmojiIds) } } as any, {
          projection: { shareId: 1, 'crystal.name': 1, 'crystal.animated': 1 }
        })
        .toArray()
    : [];
  const customEmojis: CustomEmojiMap = {};
  for (const doc of emojiDocs) {
    customEmojis[(doc as any).shareId] = {
      name: (doc as any).crystal?.name || 'emoji',
      image: '',
      animated: !!(doc as any).crystal?.animated
    };
  }

  const messages = docs.map((doc: any): PublicChatMessage => {
    const deleted = !!doc.crystal?.deletedAt;
    const reply = doc.crystal?.replyToId ? replyById.get(doc.crystal.replyToId) || null : null;
    const replyAuthor = reply ? profiles.get(String(reply.ownerId)) || null : null;
    const thread = threadById.get(doc.shareId);
    return {
      id: doc.shareId,
      chatId,
      authorId: String(doc.ownerId),
      author: profiles.get(String(doc.ownerId)) || null,
      text: deleted ? '' : doc.crystal?.text || '',
			attachments: deleted ? [] : attachmentsByMessage.get(doc.shareId) || [],
      deleted,
      editedAt: doc.crystal?.editedAt ?? null,
      threadRootId: doc.crystal?.threadRootId ?? null,
      replyToId: doc.crystal?.replyToId ?? null,
      replyTo: reply
        ? {
            id: reply.shareId,
            authorId: String(reply.ownerId),
            authorName: replyAuthor ? getUserDisplayName(replyAuthor) : null,
            text: previewText(reply.crystal),
						deleted: !!reply.crystal?.deletedAt,
						attachmentCount: reply.crystal?.deletedAt ? 0 : (attachmentsByMessage.get(reply.shareId) || []).length
          }
        : null,
      systemType: doc.crystal?.systemType ?? null,
      systemMeta: doc.crystal?.systemMeta ?? null,
      reactionCounts: reactionCountsById.get(doc.shareId) || {},
      viewerReactions: viewerReactionsById.get(doc.shareId) || [],
      threadCount: thread?.count || 0,
      threadLastAt: thread?.lastAt ? new Date(thread.lastAt).toISOString() : null,
      createdAt: new Date(doc.createdAt).toISOString(),
      externalSource: publicExternalAiSource(doc.crystal?.externalSource),
      lopu: publicLopuMessageMeta(doc.crystal?.lopu)
    };
  });

  return { messages, customEmojis };
};

export type ListMessagesResult =
  | Fail
  | {
      ok: true;
      messages: PublicChatMessage[];
      customEmojis: CustomEmojiMap;
      nextCursor: string | null;
      threadRoot: PublicChatMessage | null;
      members: PublicChatMember[];
      chat: PublicChat;
      myMember: Omit<PublicChatMember, 'profile'>;
    };

export const listMessages = async (
  viewerId: string,
  input: { chatId?: unknown; cursor?: unknown; limit?: unknown; threadRootId?: unknown }
): Promise<ListMessagesResult> => {
  const access = await resolveChatAccess(viewerId, input.chatId);
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  const things = await getThingsCollection();
  // Number(null) === 0, so an omitted query param must fall through to the
  // default instead of clamping to a one-message page
  const limitNum = typeof input.limit === 'number' || (typeof input.limit === 'string' && input.limit.trim()) ? Number(input.limit) : NaN;
  const limit = Number.isFinite(limitNum) ? Math.min(Math.max(1, Math.floor(limitNum)), MAX_MESSAGE_LIMIT) : DEFAULT_MESSAGE_LIMIT;
  const cursor = parseChronoCursor(typeof input.cursor === 'string' ? input.cursor : null);

  const threadRootId = typeof input.threadRootId === 'string' && input.threadRootId.trim() ? input.threadRootId.trim() : null;
  let threadRootDoc: any = null;
  const match: any = { thingtime: 'chat-message', targetId: chat.shareId };
  if (threadRootId) {
    threadRootDoc = await things.findOne({ thingtime: 'chat-message', shareId: threadRootId, targetId: chat.shareId } as any);
    if (!threadRootDoc) return fail(404, 'Thread not found');
    match['crystal.threadRootId'] = threadRootId;
  } else {
    match['crystal.threadRootId'] = null;
  }
  if (cursor) Object.assign(match, chronoCursorClause(cursor));

  const docs = await things
    .find(match)
    .sort({ createdAt: -1, shareId: 1 })
    .limit(limit + 1)
    .toArray();
  const page = docs.slice(0, limit);
  const nextCursor =
		docs.length > limit && page.length ? `${new Date(page[page.length - 1].createdAt).getTime()}_${page[page.length - 1].shareId}` : null;

  const projected = await projectMessages(viewerId, chat.shareId, threadRootDoc ? [threadRootDoc, ...page] : page, {
    withThreadCounts: !threadRootId
  });
  let threadRoot: PublicChatMessage | null = null;
  let messages = projected.messages;
  if (threadRootDoc) {
    threadRoot = messages[0];
    messages = messages.slice(1);
  }

  const memberDocs = await listChatMemberDocs(chat.shareId);
  const memberIds = memberDocs.map((m: any) => String(m.ownerId));
  const profiles = await resolveProfiles(memberIds);
	const [viewerReceipts, memberReceipts] = await Promise.all([getUserReadReceiptsEnabled(viewerId), getUsersReadReceiptsMap(memberIds)]);
  const opts = { viewerId, viewerReceipts, memberReceipts };
  const members = memberDocs.map((doc: any) => toPublicMember(doc, profiles.get(String(doc.ownerId)) || null, opts));
  const my = toPublicMember(member, null, opts);

  return {
    ok: true,
    messages,
    customEmojis: projected.customEmojis,
    nextCursor,
    threadRoot,
    members,
    chat: toPublicChat(chat),
    myMember: {
      userId: my.userId,
      role: my.role,
      nickname: my.nickname,
      state: my.state,
      requestOrigin: my.requestOrigin,
      muted: my.muted,
      lastReadMessageId: my.lastReadMessageId,
      lastReadAt: my.lastReadAt,
      joinedAt: my.joinedAt
    }
  };
};

export type SendMessageResult = Fail | { ok: true; message: PublicChatMessage; customEmojis: CustomEmojiMap };

export const sendMessage = async (
  viewerId: string,
	input: {
		chatId?: unknown;
		text?: unknown;
		threadRootId?: unknown;
		replyToId?: unknown;
		requestId?: unknown;
		attachmentIds?: unknown;
	}
): Promise<SendMessageResult> => {
  const access = await resolveChatAccess(viewerId, input.chatId);
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length > MAX_MESSAGE_CHARS) return fail(400, `Messages cap at ${MAX_MESSAGE_CHARS} characters`);

	const requestId = input.requestId === undefined ? null : normalizedMessengerRequestId(input.requestId);
	if (input.requestId !== undefined && !requestId) return fail(400, 'Invalid message request id');
	const expectedMessageId = requestId ? messageIdForRequest(viewerId, requestId) : undefined;

	const rawAttachmentIds = input.attachmentIds === undefined ? [] : input.attachmentIds;
	if (!Array.isArray(rawAttachmentIds)) return fail(400, 'attachmentIds must be a list');
	if (rawAttachmentIds.length && !requestId) {
		return fail(400, 'Attachment messages require a stable request id');
	}
	const inspected = rawAttachmentIds.length
		? await inspectReadyAttachmentsForMessage(viewerId, rawAttachmentIds, expectedMessageId)
		: ({ ok: true, hasAny: false, hasVisual: false, attachments: [] } as const);
	if (inspected.ok === false) return inspected;
	const attachmentIds = rawAttachmentIds as string[];
	if (!text && !inspected.hasAny) return fail(400, 'Add a message or an attachment');

  const things = await getThingsCollection();

  let threadRootId: string | null = null;
  if (typeof input.threadRootId === 'string' && input.threadRootId.trim()) {
    const root = await things.findOne({ thingtime: 'chat-message', shareId: input.threadRootId.trim(), targetId: chat.shareId } as any);
    if (!root) return fail(404, 'Thread root not found in this chat');
    // threads stay one level deep (Slack semantics): replying to a reply
    // files under the same root
    threadRootId = (root as any).crystal?.threadRootId || (root as any).shareId;
  }
  let replyToId: string | null = null;
  if (typeof input.replyToId === 'string' && input.replyToId.trim()) {
    const target = await things.findOne({ thingtime: 'chat-message', shareId: input.replyToId.trim(), targetId: chat.shareId } as any);
    if (!target) return fail(404, 'That message is not in this chat');
    replyToId = (target as any).shareId;
  }

  const message = newThingDoc('chat-message', {
    ownerId: viewerId,
    targetId: chat.shareId,
		crystal: { text, threadRootId, replyToId, editedAt: null, deletedAt: null, systemType: null, systemMeta: null },
		...(expectedMessageId ? { shareId: expectedMessageId } : {})
  });

	const reconcileExisting = async (): Promise<SendMessageResult | null> => {
		const existing = await things.findOne({ shareId: message.shareId, thingtime: 'chat-message' } as any);
		if (!existing) return null;
		const docs = await things
			.find(
				{
					thingtime: 'attachment',
					targetId: message.shareId,
					attachmentState: 'ready',
					attachmentPurpose: 'message'
				} as any,
				{ projection: { shareId: 1 } }
			)
			.toArray();
		const exact = matchesCommittedMessageRequest(
			existing as any,
			{
				ownerId: viewerId,
				chatId: String(chat.shareId),
				text,
				threadRootId,
				replyToId,
				attachmentIds
			},
			docs.map((doc: any) => String(doc.shareId))
		);
		if (!exact) return fail(409, 'That message request id is already in use');
		const projected = await projectMessages(viewerId, chat.shareId, [existing], { withThreadCounts: false });
		return { ok: true, message: projected.messages[0], customEmojis: projected.customEmojis };
	};

	try {
		const bindAttachments = attachmentIds.length ? createReadyAttachmentMessageInsertHook(attachmentIds) : null;
		const transact = attachmentIds.length ? withHomeMongoTransaction : withMessengerStorageTransaction;
		await transact(async (session) => {
			const [freshChat, freshMember] = await Promise.all([
				things.findOne({ shareId: chat.shareId, thingtime: 'chat' } as any, { session }),
				things.findOne({ shareId: member.shareId, thingtime: 'chat-member', ownerId: viewerId } as any, { session })
			]);
			const memberState = (freshMember as any)?.crystal?.state;
			if (!freshChat || !freshMember || memberState === 'left' || memberState === 'declined') {
				throw new Error('message_membership_changed');
			}
			await insertMessengerThing(things, message as any, { session });
			if (bindAttachments) await bindAttachments(message as any, session);
			await updateMessengerThing(
				things,
				{ shareId: member.shareId, thingtime: 'chat-member', ownerId: viewerId } as any,
				{
					$set: {
						...(memberState === 'pending' ? { 'crystal.state': 'active' } : {}),
						'crystal.lastReadMessageId': message.shareId,
						'crystal.lastReadAt': message.createdAt.toISOString(),
						updatedAt: new Date()
					}
				},
				{ session }
			);
			await updateMessengerThing(
				things,
				{ shareId: chat.shareId, thingtime: 'chat' } as any,
				{
					$set: {
						updatedAt: new Date(),
						...(threadRootId ? {} : { 'crystal.lastMessage': chatPreviewOf(message, attachmentIds.length) })
					}
				},
				{ session }
			);
		});
	} catch (error: any) {
		if (requestId && (error?.code === 11000 || error?.errorLabels?.includes?.('UnknownTransactionCommitResult'))) {
			const reconciled = await reconcileExisting();
			if (reconciled) return reconciled;
		}
		if (error?.message === 'message_membership_changed') return fail(409, 'Chat membership changed — try again');
		throw error;
	}
  const projected = await projectMessages(viewerId, chat.shareId, [message], { withThreadCounts: false });
  return { ok: true, message: projected.messages[0], customEmojis: projected.customEmojis };
};

export type EditMessageResult = Fail | { ok: true; message: PublicChatMessage };

export const editMessage = async (viewerId: string, input: { id?: unknown; text?: unknown }): Promise<EditMessageResult> => {
  if (typeof input.id !== 'string' || !input.id.trim()) return fail(400, 'Message id required');
  const message = await findThingByKind('chat-message', input.id.trim());
  if (!message) return fail(404, 'Message not found');
  const access = await resolveChatAccess(viewerId, String(message.targetId), { requireActive: true });
  if ('ok' in access && access.ok === false) return access;
  if (String(message.ownerId) !== viewerId) return fail(403, 'Only the author can edit a message');
  if (isLopuSource(message.crystal?.externalSource)) return fail(409, "Lopu's replies cannot be edited — ask again instead");
  if (message.crystal?.externalSource) return fail(409, 'Imported AI messages are read-only; add a Thingtime reply instead');
  if (message.crystal?.deletedAt) return fail(400, 'Deleted messages stay deleted');
  if (message.crystal?.systemType) return fail(400, 'System messages write themselves');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
	if (!text) {
		const attachmentCount = await (
			await getThingsCollection()
		).countDocuments({ thingtime: 'attachment', targetId: message.shareId, attachmentState: 'ready', attachmentPurpose: 'message' } as any);
		if (!attachmentCount) return fail(400, 'Add a message or an attachment');
	}
  if (text.length > MAX_MESSAGE_CHARS) return fail(400, `Messages cap at ${MAX_MESSAGE_CHARS} characters`);
  const things = await getThingsCollection();
	await updateMessengerThing(things, { shareId: message.shareId } as any, {
		$set: { 'crystal.text': text, 'crystal.editedAt': new Date().toISOString(), updatedAt: new Date() }
	});
  const fresh = await findThingByKind('chat-message', message.shareId);
  // keep the sidebar honest when the edited message is the preview'd one
	await updateMessengerThing(things, { shareId: message.targetId, thingtime: 'chat', 'crystal.lastMessage.id': message.shareId } as any, {
		$set: { 'crystal.lastMessage.text': text.slice(0, 140) }
	});
  const projected = await projectMessages(viewerId, String(message.targetId), [fresh], { withThreadCounts: false });
  return { ok: true, message: projected.messages[0] };
};

export type DeleteMessageResult = Fail | { ok: true };

export const deleteMessage = async (viewerId: string, input: { id?: unknown }): Promise<DeleteMessageResult> => {
  if (typeof input.id !== 'string' || !input.id.trim()) return fail(400, 'Message id required');
  const message = await findThingByKind('chat-message', input.id.trim());
  if (!message) return fail(404, 'Message not found');
  const access = await resolveChatAccess(viewerId, String(message.targetId), { requireActive: true });
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  if (message.crystal?.externalSource && !isLopuSource(message.crystal.externalSource)) {
    return fail(409, 'Imported AI messages are read-only; manage them from AI connections');
  }
  const mine = String(message.ownerId) === viewerId;
  if (!mine && !(await canAdministerChat(chat, member, viewerId))) {
    return fail(403, 'Only the author or an admin can delete a message');
  }
	const attachmentCleanup = await prepareAttachmentCascadeForThing({
		shareId: String(message.shareId),
		ownerId: String(message.ownerId)
	});
	if (attachmentCleanup.ok === false) return fail(attachmentCleanup.status, attachmentCleanup.error);
  const things = await getThingsCollection();
  // soft delete: the row stays (thread shape, "message deleted" placeholder),
  // the words go, and its reactions go with them
	await withMessengerStorageTransaction(async (session) => {
		await updateMessengerThing(
			things,
			{ shareId: message.shareId } as any,
			{ $set: { 'crystal.text': '', 'crystal.deletedAt': new Date().toISOString(), updatedAt: new Date() } },
			{ session, allowUncertainStorageRewrite: true }
		);
		await deleteMessengerThings(things, { thingtime: 'reaction', targetId: message.shareId } as any, { session });
		// The sidebar preview follows the deletion instead of echoing deleted words.
		await updateMessengerThing(
			things,
			{ shareId: message.targetId, thingtime: 'chat', 'crystal.lastMessage.id': message.shareId } as any,
			{ $set: { 'crystal.lastMessage.text': '', 'crystal.lastMessage.deleted': true, 'crystal.lastMessage.attachmentCount': 0 } },
			{ session, allowUncertainStorageRewrite: true }
		);
	});
  return { ok: true };
};

// ── reactions ──

export type ChatReactionResult = Fail | { ok: true; reactionCounts: Record<string, number>; viewerReactions: string[]; customEmojis: CustomEmojiMap };

export const toggleChatReaction = async (viewerId: string, input: { messageId?: unknown; emoji?: unknown }): Promise<ChatReactionResult> => {
  if (typeof input.messageId !== 'string' || !input.messageId.trim()) return fail(400, 'Message id required');
  const message = await findThingByKind('chat-message', input.messageId.trim());
  if (!message) return fail(404, 'Message not found');
  if (message.crystal?.deletedAt) return fail(400, 'That message is deleted');
  const access = await resolveChatAccess(viewerId, String(message.targetId), { requireActive: true });
  if ('ok' in access && access.ok === false) return access;
  const { chat } = access as ChatAccess;
  const token = sanitizeChatReactionToken(input.emoji);
  if (!token) return fail(400, 'That is not a reaction Lopu recognises');

  const things = await getThingsCollection();
  if (isCustomReactionToken(token)) {
    const emojiId = customReactionEmojiId(token)!;
    const emoji = await findThingByKind('custom-emoji', emojiId);
    if (!emoji) return fail(404, 'That custom emoji no longer exists');
    // usable emojis: this chat's community set, or your own personal set
    const communityId = chat.crystal?.communityId || null;
    const isCommunityEmoji = !!emoji.targetId && emoji.targetId === communityId;
    const isPersonalEmoji = !emoji.targetId && String(emoji.ownerId) === viewerId;
    if (!isCommunityEmoji && !isPersonalEmoji) return fail(403, 'That emoji belongs to another space');
  }

  const existing = await things.findOne({
    thingtime: 'reaction',
    targetId: message.shareId,
    ownerId: viewerId,
    'crystal.emoji': token
  } as any);
  if (existing) {
    await deleteMessengerThings(things, { thingtime: 'reaction', targetId: message.shareId, ownerId: viewerId, 'crystal.emoji': token } as any);
  } else {
    const tokens = await things
      .find({ thingtime: 'reaction', targetId: message.shareId } as any, { projection: { ownerId: 1, 'crystal.emoji': 1 } })
      .toArray();
    const myCount = tokens.filter((t: any) => String(t.ownerId) === viewerId).length;
    if (myCount >= MAX_REACTIONS_PER_USER_PER_MESSAGE) return fail(400, 'You have reacted plenty to this one');
    const distinct = new Set(tokens.map((t: any) => t.crystal?.emoji));
    if (!distinct.has(token) && distinct.size >= MAX_REACTION_TOKENS_PER_MESSAGE) {
      return fail(400, 'This message has enough different reactions');
    }
    try {
      const reaction = newThingDoc('reaction', {
        ownerId: viewerId,
        targetId: message.shareId,
        crystal: { emoji: token }
      });
      (reaction as any).acl = ['tt:inherit'];
      await insertMessengerThing(things, reaction as any);
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // race duplicate = already reacted
    }
    // unicode recents feed the shared picker; custom tokens stay messenger-local
    if (!isCustomReactionToken(token)) {
      pushUserRecentReaction(viewerId, token).catch(() => {});
    }
  }
  const projected = await projectMessages(viewerId, String(message.targetId), [message], { withThreadCounts: false });
  return {
    ok: true,
    reactionCounts: projected.messages[0].reactionCounts,
    viewerReactions: projected.messages[0].viewerReactions,
    customEmojis: projected.customEmojis
  };
};

// ── read receipts ──

export type MarkReadResult = Fail | { ok: true; lastReadMessageId: string | null; lastReadAt: string | null };

export const markChatRead = async (viewerId: string, input: { chatId?: unknown; messageId?: unknown }): Promise<MarkReadResult> => {
  // pending members read requests without leaving a receipt — "seen" would
  // leak to the sender before the recipient ever accepted
  const access = await resolveChatAccess(viewerId, input.chatId, { requireActive: true });
  if ('ok' in access && access.ok === false) return access;
  const { chat, member } = access as ChatAccess;
  if (typeof input.messageId !== 'string' || !input.messageId.trim()) return fail(400, 'Message id required');
  const things = await getThingsCollection();
  const message = await things.findOne({ thingtime: 'chat-message', shareId: input.messageId.trim(), targetId: chat.shareId } as any);
  if (!message) return fail(404, 'That message is not in this chat');
  const messageAt = new Date((message as any).createdAt).toISOString();
  const current = member.crystal?.lastReadAt || null;
  // forward-only high-water mark: reading an old message never rewinds it
  if (current && messageAt <= current) {
    return { ok: true, lastReadMessageId: member.crystal?.lastReadMessageId ?? null, lastReadAt: current };
  }
	await updateMessengerThing(things, { shareId: member.shareId } as any, {
		$set: { 'crystal.lastReadMessageId': (message as any).shareId, 'crystal.lastReadAt': messageAt, updatedAt: new Date() }
	});
  return { ok: true, lastReadMessageId: (message as any).shareId, lastReadAt: messageAt };
};

// ── message requests ──

export type RequestsResult = Fail | { ok: true; requests: { follower: ChatListEntry[]; unknown: ChatListEntry[] } };

export const listRequests = async (viewerId: string): Promise<RequestsResult> => {
  const things = await getThingsCollection();
  const pending = await things
    .find({ thingtime: 'chat-member', ownerId: viewerId, 'crystal.state': 'pending' } as any)
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  const ctx = await buildSummaryContext(viewerId, pending);
  const entries = ctx.chatDocs.map((doc: any) => summaryEntry(viewerId, doc, ctx));
  const byChatOrigin = new Map(pending.map((m: any) => [String(m.targetId), m.crystal?.requestOrigin || 'unknown']));
  const follower = entries.filter((e) => byChatOrigin.get(e.id) === 'follower');
  const unknown = entries.filter((e) => byChatOrigin.get(e.id) !== 'follower');
  return { ok: true, requests: { follower, unknown } };
};

export type RespondRequestResult = Fail | { ok: true; state: MemberState };

export const respondToRequest = async (viewerId: string, input: { chatId?: unknown; accept?: unknown }): Promise<RespondRequestResult> => {
  if (typeof input.chatId !== 'string' || !input.chatId.trim()) return fail(400, 'Chat id required');
  const member = await getChatMemberDoc(input.chatId.trim(), viewerId);
  if (!member || member.crystal?.state !== 'pending') return fail(404, 'No pending request for this chat');
  const state: MemberState = input.accept === true ? 'active' : 'declined';
  const things = await getThingsCollection();
  await updateMessengerThing(things, { shareId: member.shareId } as any, { $set: { 'crystal.state': state, updatedAt: new Date() } });
  return { ok: true, state };
};
