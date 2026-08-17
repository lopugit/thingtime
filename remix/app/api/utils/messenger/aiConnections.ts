// Consent-first AI desktop ingestion. External projects become communities,
// conversations become native chats/channels, and messages remain relational
// chat-message Things. Every source id is hashed into a server-owned unique
// key, making interrupted/repeated batches safe to resume without duplicates.
import { createHash } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { MAX_MESSAGE_CHARS } from '~/schemas/registry';
import { publicExternalAiSource, type AiMessageRole, type AiSourceProvider } from './externalAi';
import { chatMemberKey, communityMemberKey, fail, newThingDoc, type Fail } from './shared';
import { updateMessengerThing, withMessengerStorageTransaction } from './storage';

const MAX_GROUPS_PER_BATCH = 80;
const MAX_CONVERSATIONS_PER_BATCH = 120;
const MAX_MESSAGES_PER_BATCH = 240;
const MAX_EXTERNAL_ID_CHARS = 512;
const MAX_IMPORTED_TEXT_CHARS = 256_000;
const MAX_CONNECTIONS_PER_USER = 8;

type AiSourceInput = {
  provider: AiSourceProvider;
  sourceId: string;
  label: string;
  connector: string;
  mode: 'local' | 'export';
};

type AiGroupInput = { id: string; name: string; kind: 'workspace' | 'project' | 'group' };
type AiConversationInput = {
  id: string;
  title: string;
  groupId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
type AiMessageInput = {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  authorName: string | null;
  text: string;
  createdAt: string | null;
};

export type PublicAiConnection = {
  id: string;
  provider: AiSourceProvider;
  sourceId: string;
  label: string;
  connectors: string[];
  mode: 'local' | 'export' | 'mixed';
  status: 'syncing' | 'connected' | 'error';
  readOnly: true;
  groups: number;
  conversations: number;
  messages: number;
  lastSyncAt: string | null;
  updatedAt: string;
};

type SyncResult =
  | Fail
  | {
      ok: true;
      connection: PublicAiConnection;
      accepted: { groups: number; conversations: number; messages: number; messageSegments: number };
    };

const bounded = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const externalKey = (ownerId: string, sourceId: string, kind: string, id: string): string =>
  createHash('sha256').update(`${ownerId}\0${sourceId}\0${kind}\0${id}`).digest('hex');

const stableShareId = (prefix: string, key: string): string => `${prefix}-${key.slice(0, 32)}`;

const safeDate = (value: unknown, fallback = new Date()): Date => {
  if (typeof value !== 'string' || !value) return fallback;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (!Number.isFinite(time) || time < Date.UTC(1990, 0, 1) || time > Date.now() + 24 * 60 * 60 * 1000) return fallback;
  return parsed;
};

const normalizeSource = (value: unknown): AiSourceInput | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const provider = raw.provider === 'chatgpt' || raw.provider === 'claude' ? raw.provider : null;
  const sourceId = bounded(raw.sourceId, 64);
  const label = bounded(raw.label, 80);
  const connector = bounded(raw.connector, 80);
  const mode = raw.mode === 'local' || raw.mode === 'export' ? raw.mode : null;
  return provider && sourceId && label && connector && mode ? { provider, sourceId, label, connector, mode } : null;
};

const normalizeGroup = (value: unknown): AiGroupInput | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = bounded(raw.id, MAX_EXTERNAL_ID_CHARS);
  const name = bounded(raw.name, 80);
  const kind = raw.kind === 'workspace' || raw.kind === 'project' || raw.kind === 'group' ? raw.kind : 'group';
  return id && name ? { id, name, kind } : null;
};

const normalizeConversation = (value: unknown): AiConversationInput | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = bounded(raw.id, MAX_EXTERNAL_ID_CHARS);
  const title = bounded(raw.title, 80) || 'Untitled chat';
  const groupId = bounded(raw.groupId, MAX_EXTERNAL_ID_CHARS) || null;
  return id
    ? {
        id,
        title,
        groupId,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
      }
    : null;
};

const normalizeMessage = (value: unknown): AiMessageInput | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = bounded(raw.id, MAX_EXTERNAL_ID_CHARS);
  const conversationId = bounded(raw.conversationId, MAX_EXTERNAL_ID_CHARS);
  const role = raw.role === 'user' || raw.role === 'assistant' || raw.role === 'system' ? raw.role : 'unknown';
  const authorName = bounded(raw.authorName, 80) || null;
  const messageText = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_IMPORTED_TEXT_CHARS) : '';
  return id && conversationId && messageText
    ? {
        id,
        conversationId,
        role,
        authorName,
        text: messageText,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null
      }
    : null;
};

export const splitImportedMessage = (value: string, max = MAX_MESSAGE_CHARS): string[] => {
  const chars = Array.from(value.trim());
  if (!chars.length) return [];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < chars.length) {
    let end = Math.min(offset + max, chars.length);
    if (end < chars.length) {
      const floor = offset + Math.floor(max * 0.6);
      for (let index = end - 1; index >= floor; index -= 1) {
        if (/\s/u.test(chars[index])) {
          end = index + 1;
          break;
        }
      }
    }
    const chunk = chars.slice(offset, end).join('').trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
};

const sourceProjection = (source: AiSourceInput, extra: Record<string, unknown> = {}) => ({
  provider: source.provider,
  sourceId: source.sourceId,
  label: source.label,
  connector: source.connector,
  readOnly: true,
  ...extra
});

const ensureMembership = async (kind: 'community' | 'chat', targetId: string, ownerId: string, session: any) => {
  const things = await getThingsCollection();
  const memberKind = `${kind}-member`;
  const memberKey = kind === 'community' ? communityMemberKey(targetId, ownerId) : chatMemberKey(targetId, ownerId);
  const base = newThingDoc(memberKind, {
    ownerId,
    targetId,
    crystal:
      kind === 'community'
        ? { memberKey, role: 'owner' }
        : {
            memberKey,
            role: 'owner',
            state: 'active',
            requestOrigin: null,
            nickname: null,
            lastReadMessageId: null,
            lastReadAt: null,
            muted: false
          }
  });
  const { crystal: _memberCrystal, updatedAt: _memberUpdatedAt, ...memberRoot } = base;
  await updateMessengerThing(
		things,
    { 'crystal.memberKey': memberKey } as any,
    {
      $setOnInsert: {
				...memberRoot,
				'crystal.memberKey': memberKey,
				...(kind === 'chat'
					? {
							'crystal.nickname': null,
							'crystal.lastReadMessageId': null,
							'crystal.lastReadAt': null,
							'crystal.muted': false
						}
					: {})
			},
      $set: {
        'crystal.role': 'owner',
        ...(kind === 'chat'
          ? {
              'crystal.state': 'active',
							'crystal.requestOrigin': null
            }
          : {}),
        updatedAt: new Date()
      }
    } as any,
		{ upsert: true, session }
  );
};

const ensureGroup = async (ownerId: string, source: AiSourceInput, group: AiGroupInput): Promise<any> => {
  const things = await getThingsCollection();
  const key = externalKey(ownerId, source.sourceId, 'group', group.id);
  const base = newThingDoc('community', {
    shareId: stableShareId('ai-space', key),
    ownerId,
    crystal: {
      name: group.name,
      description: `${source.label} ${group.kind}`,
      avatarUrl: null,
      externalCommunityKey: key,
      externalSource: sourceProjection(source, { groupKind: group.kind })
    }
  });
  const { crystal: _groupCrystal, updatedAt: _groupUpdatedAt, ...groupRoot } = base;
  return withMessengerStorageTransaction(async (session) => {
		await updateMessengerThing(
			things,
			{ 'crystal.externalCommunityKey': key } as any,
			{
				$setOnInsert: groupRoot,
				$set: {
					'crystal.name': group.name,
					'crystal.description': `${source.label} ${group.kind}`,
					'crystal.avatarUrl': null,
					'crystal.externalCommunityKey': key,
					'crystal.externalSource': sourceProjection(source, { groupKind: group.kind }),
					updatedAt: new Date()
				}
			} as any,
			{ upsert: true, session }
		);
		const doc = await things.findOne({ 'crystal.externalCommunityKey': key } as any, { session });
		if (!doc) throw new Error('ai_group_upsert_failed');
		await ensureMembership('community', String((doc as any).shareId), ownerId, session);
		return doc;
	});
};

const ensureConversation = async (
  ownerId: string,
  source: AiSourceInput,
  conversation: AiConversationInput
): Promise<any | Fail> => {
  const things = await getThingsCollection();
  const key = externalKey(ownerId, source.sourceId, 'conversation', conversation.id);
  const createdAt = safeDate(conversation.createdAt);
  return withMessengerStorageTransaction(async (session) => {
		let communityId: string | null = null;
		if (conversation.groupId) {
			const communityKey = externalKey(ownerId, source.sourceId, 'group', conversation.groupId);
			const community = await things.findOne({ 'crystal.externalCommunityKey': communityKey } as any, { session });
			if (!community) return fail(409, 'An imported conversation arrived before its project; retry the sync batch');
			communityId = String((community as any).shareId);
		}
		const base = newThingDoc('chat', {
			shareId: stableShareId('ai-chat', key),
			ownerId,
			targetId: communityId,
			crystal: {
				chatType: communityId ? 'channel' : 'group',
				name: conversation.title,
				topic: `Imported read-only from ${source.label}. Replies stay in Thingtime.`,
				communityId,
				sectionId: null,
				channelVisibility: communityId ? 'private' : null,
				dmKey: null,
				externalConversationKey: key,
				externalSource: sourceProjection(source)
			}
		});
		base.createdAt = createdAt;
		base.updatedAt = safeDate(conversation.updatedAt, createdAt);
		const {
			crystal: _conversationCrystal,
			targetId: _conversationTargetId,
			updatedAt: _conversationUpdatedAt,
			...conversationRoot
		} = base;
		await updateMessengerThing(
			things,
			{ 'crystal.externalConversationKey': key } as any,
			{
				$setOnInsert: conversationRoot,
				$set: {
					targetId: communityId,
					'crystal.name': conversation.title,
					'crystal.topic': `Imported read-only from ${source.label}. Replies stay in Thingtime.`,
					'crystal.communityId': communityId,
					'crystal.chatType': communityId ? 'channel' : 'group',
					'crystal.channelVisibility': communityId ? 'private' : null,
					'crystal.sectionId': null,
					'crystal.dmKey': null,
					'crystal.externalConversationKey': key,
					'crystal.externalSource': sourceProjection(source),
					updatedAt: safeDate(conversation.updatedAt)
				}
			} as any,
			{ upsert: true, session }
		);
		const doc = await things.findOne({ 'crystal.externalConversationKey': key } as any, { session });
		if (!doc) throw new Error('ai_conversation_upsert_failed');
		await ensureMembership('chat', String((doc as any).shareId), ownerId, session);
		return doc;
	});
};

const upsertMessages = async (
  ownerId: string,
  source: AiSourceInput,
  messages: AiMessageInput[]
): Promise<{ accepted: number; segments: number }> => {
  if (!messages.length) return { accepted: 0, segments: 0 };
  const things = await getThingsCollection();
  const conversationIds = Array.from(new Set(messages.map((message) => message.conversationId)));
  const conversationKeys = conversationIds.map((id) => externalKey(ownerId, source.sourceId, 'conversation', id));
  const chats = await things
    .find({ 'crystal.externalConversationKey': { $in: conversationKeys } } as any, {
      projection: { shareId: 1, 'crystal.externalConversationKey': 1 }
    })
    .toArray();
  const chatByKey = new Map<string, string>(
    chats.map((chat: any) => [String(chat.crystal?.externalConversationKey), String(chat.shareId)] as [string, string])
  );
  const missing = conversationIds.find(
    (id) => !chatByKey.has(externalKey(ownerId, source.sourceId, 'conversation', id))
  );
  if (missing) throw Object.assign(new Error('ai_conversation_missing'), { status: 409 });

  const operations: any[] = [];
  for (const message of messages) {
    const chatId = chatByKey.get(externalKey(ownerId, source.sourceId, 'conversation', message.conversationId))!;
    const parts = splitImportedMessage(message.text);
    parts.forEach((part, segmentIndex) => {
      const segmentId = `${message.id}:${segmentIndex}`;
      const key = externalKey(ownerId, source.sourceId, 'message', `${message.conversationId}:${segmentId}`);
      const createdAt = safeDate(message.createdAt);
      const externalSource = sourceProjection(source, {
        role: message.role,
        authorName: message.authorName || (message.role === 'assistant' ? source.label : null),
        segmentIndex,
        segmentCount: parts.length
      });
      const base = newThingDoc('chat-message', {
        shareId: stableShareId('ai-message', key),
        ownerId,
        targetId: chatId,
        crystal: {}
      });
      base.createdAt = createdAt;
      base.updatedAt = createdAt;
      const { crystal: _ignoredCrystal, targetId: _messageTargetId, updatedAt: _messageUpdatedAt, ...root } = base;
      operations.push({
        updateOne: {
          filter: { 'crystal.externalMessageKey': key },
          update: {
            $setOnInsert: root,
            $set: {
              targetId: chatId,
              'crystal.text': part,
              'crystal.threadRootId': null,
              'crystal.replyToId': null,
              'crystal.editedAt': null,
              'crystal.deletedAt': null,
              'crystal.systemType': null,
              'crystal.systemMeta': null,
              'crystal.externalMessageKey': key,
              'crystal.externalSource': externalSource,
              updatedAt: createdAt
            }
          },
          upsert: true
        }
      });
    });
  }
  const operationChunks: any[][] = [];
  for (let offset = 0; offset < operations.length; offset += 50) operationChunks.push(operations.slice(offset, offset + 50));
  for (const chunk of operationChunks) {
		await withMessengerStorageTransaction(async (session) => {
			for (const operation of chunk) {
				await updateMessengerThing(
					things,
					operation.updateOne.filter,
					operation.updateOne.update,
					{ upsert: true, session }
				);
			}
		});
	}

  const chatIds = Array.from(new Set(chats.map((chat: any) => String(chat.shareId))));
  const newest = await things
    .find({ thingtime: 'chat-message', targetId: { $in: chatIds }, 'crystal.threadRootId': null } as any)
    .sort({ createdAt: -1, shareId: 1 })
    .toArray();
  const newestByChat = new Map<string, any>();
  for (const message of newest as any[]) {
    const chatId = String(message.targetId);
    if (!newestByChat.has(chatId)) newestByChat.set(chatId, message);
  }
  if (newestByChat.size) {
		await withMessengerStorageTransaction(async (session) => {
			for (const [chatId, message] of newestByChat.entries()) {
				await updateMessengerThing(
					things,
					{ shareId: chatId, thingtime: 'chat' },
					{
						$set: {
							updatedAt: new Date(),
							'crystal.lastMessage': {
								id: message.shareId,
								authorId: String(message.ownerId),
								text: String(message.crystal?.text || '').slice(0, 140),
								deleted: false,
								systemType: null,
								attachmentCount: 0,
								externalSource: message.crystal?.externalSource || null,
								createdAt: new Date(message.createdAt).toISOString()
							}
						}
					},
					{ session }
				);
			}
		});
  }

  return { accepted: messages.length, segments: operations.length };
};

const connectionProjection = (doc: any): PublicAiConnection => {
  const mode = doc.crystal?.mode === 'local' || doc.crystal?.mode === 'export' ? doc.crystal.mode : 'mixed';
  return {
    id: String(doc.shareId),
    provider: doc.crystal?.provider === 'claude' ? 'claude' : 'chatgpt',
    sourceId: String(doc.crystal?.sourceId || ''),
    label: String(doc.crystal?.label || 'AI app'),
    connectors: Array.isArray(doc.crystal?.connectors)
      ? doc.crystal.connectors.filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 8)
      : [],
    mode,
    status: doc.crystal?.status === 'syncing' || doc.crystal?.status === 'error' ? doc.crystal.status : 'connected',
    readOnly: true,
    groups: Number(doc.crystal?.groups) || 0,
    conversations: Number(doc.crystal?.conversations) || 0,
    messages: Number(doc.crystal?.messages) || 0,
    lastSyncAt: doc.crystal?.lastSyncAt ? new Date(doc.crystal.lastSyncAt).toISOString() : null,
    updatedAt: new Date(doc.updatedAt).toISOString()
  };
};

export const listAiConnections = async (ownerId: string): Promise<{ ok: true; connections: PublicAiConnection[] }> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: 'ai-connection', ownerId } as any)
    .sort({ updatedAt: -1, shareId: 1 })
    .limit(MAX_CONNECTIONS_PER_USER)
    .toArray();
  return { ok: true, connections: docs.map(connectionProjection) };
};

export const syncAiConnections = async (ownerId: string, input: unknown): Promise<SyncResult> => {
  if (!input || typeof input !== 'object') return fail(400, 'A sync batch is required');
  const raw = input as Record<string, unknown>;
  const source = normalizeSource(raw.source);
  if (!source) return fail(400, 'The AI source descriptor is invalid');
  const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
  const conversationsRaw = Array.isArray(raw.conversations) ? raw.conversations : [];
  const messagesRaw = Array.isArray(raw.messages) ? raw.messages : [];
  if (groupsRaw.length > MAX_GROUPS_PER_BATCH) return fail(400, `Send at most ${MAX_GROUPS_PER_BATCH} projects per batch`);
  if (conversationsRaw.length > MAX_CONVERSATIONS_PER_BATCH) {
    return fail(400, `Send at most ${MAX_CONVERSATIONS_PER_BATCH} conversations per batch`);
  }
  if (messagesRaw.length > MAX_MESSAGES_PER_BATCH) return fail(400, `Send at most ${MAX_MESSAGES_PER_BATCH} messages per batch`);
  const groups = groupsRaw.map(normalizeGroup);
  const conversations = conversationsRaw.map(normalizeConversation);
  const messages = messagesRaw.map(normalizeMessage);
  if (groups.some((entry) => !entry) || conversations.some((entry) => !entry) || messages.some((entry) => !entry)) {
    return fail(400, 'One or more AI records are invalid or empty');
  }
  const final = raw.final === true;
  const totalsRaw = raw.totals && typeof raw.totals === 'object' ? (raw.totals as Record<string, unknown>) : {};
  const totals = {
    groups: Math.max(0, Math.floor(Number(totalsRaw.groups) || 0)),
    conversations: Math.max(0, Math.floor(Number(totalsRaw.conversations) || 0)),
    messages: Math.max(0, Math.floor(Number(totalsRaw.messages) || 0))
  };

  const things = await getThingsCollection();
  const connectionKey = externalKey(ownerId, source.sourceId, 'connection', source.sourceId);
  const existingCount = await things.countDocuments({ thingtime: 'ai-connection', ownerId } as any);
  const existing = await things.findOne({ 'crystal.aiConnectionKey': connectionKey } as any);
  if (!existing && existingCount >= MAX_CONNECTIONS_PER_USER) return fail(400, 'This account already has enough AI app connections');

  for (const group of groups as AiGroupInput[]) await ensureGroup(ownerId, source, group);
  for (const conversation of conversations as AiConversationInput[]) {
    const result = await ensureConversation(ownerId, source, conversation);
    if ('ok' in result && result.ok === false) return result;
  }
  let messageResult: { accepted: number; segments: number };
  try {
    messageResult = await upsertMessages(ownerId, source, messages as AiMessageInput[]);
  } catch (error: any) {
    if (error?.status === 409 || error?.message === 'ai_conversation_missing') {
      return fail(409, 'An imported message arrived before its conversation; retry the sync batch');
    }
    throw error;
  }

  const now = new Date();
  const base = newThingDoc('ai-connection', {
    shareId: stableShareId('ai-connection', connectionKey),
    ownerId,
    crystal: {}
  });
  const priorModes = new Set<string>([existing?.crystal?.mode, source.mode].filter(Boolean));
  const mode = priorModes.size > 1 ? 'mixed' : source.mode;
  const connectors = Array.from(
    new Set([...(Array.isArray(existing?.crystal?.connectors) ? existing.crystal.connectors : []), source.connector])
  ).slice(0, 8);
  const { crystal: _ignoredCrystal, updatedAt: _connectionUpdatedAt, ...root } = base;
  await updateMessengerThing(
		things,
    { 'crystal.aiConnectionKey': connectionKey } as any,
    {
      $setOnInsert: root,
      $set: {
        'crystal.aiConnectionKey': connectionKey,
        'crystal.provider': source.provider,
        'crystal.sourceId': source.sourceId,
        'crystal.label': source.label,
        'crystal.connectors': connectors,
        'crystal.mode': mode,
        'crystal.status': final ? 'connected' : 'syncing',
        'crystal.readOnly': true,
        ...(final
          ? {
              'crystal.groups': totals.groups,
              'crystal.conversations': totals.conversations,
              'crystal.messages': totals.messages,
              'crystal.lastSyncAt': now
            }
          : {}),
        updatedAt: now
      }
    },
    { upsert: true }
  );
  const connection = await things.findOne({ 'crystal.aiConnectionKey': connectionKey } as any);
  if (!connection) throw new Error('ai_connection_upsert_failed');
  return {
    ok: true,
    connection: connectionProjection(connection),
    accepted: {
      groups: groups.length,
      conversations: conversations.length,
      messages: messageResult.accepted,
      messageSegments: messageResult.segments
    }
  };
};

export const externalSourceForPublicProjection = publicExternalAiSource;
