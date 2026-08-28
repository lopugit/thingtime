// Consent-first AI desktop ingestion. External projects become communities,
// conversations become native chats/channels, and messages remain relational
// chat-message Things. Every source id is hashed into a server-owned unique
// key, making interrupted/repeated batches safe to resume without duplicates.
import { createHash } from 'node:crypto';

import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter, thingUniqueKeysFilter } from '../mongodb/uniqueKeys';
import { MAX_MESSAGE_CHARS } from '~/schemas/registry';
import { publicExternalAiSource, type AiMessageRole, type AiSourceProvider } from './externalAi';
import { chatMemberKey, communityMemberKey, fail, newThingDoc, type Fail } from './shared';
import { deleteMessengerThings, updateMessengerThing, withMessengerStorageTransaction } from './storage';

const MAX_GROUPS_PER_BATCH = 80;
const MAX_CONVERSATIONS_PER_BATCH = 120;
const MAX_MESSAGES_PER_BATCH = 240;
const MAX_EXTERNAL_ID_CHARS = 512;
const MAX_IMPORTED_TEXT_CHARS = 256_000;
const MAX_CONNECTIONS_PER_USER = 8;
const MAX_IMPORTED_SEGMENTS = Math.ceil(MAX_IMPORTED_TEXT_CHARS / MAX_MESSAGE_CHARS) + 1;

type AiSourceInput = {
  provider: AiSourceProvider;
  sourceId: string;
  label: string;
  connector: string;
  mode: 'local' | 'export';
	// Server-derived identity namespace. Browser/export syncs retain sourceId;
	// device credentials add their authenticated device id so two computers
	// cannot overwrite one another's mirror merely by choosing the same source.
	keyScope: string;
	deviceId: string | null;
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
	sourceType: 'imported' | 'live';
  provider: AiSourceProvider;
  sourceId: string;
	deviceId: string | null;
	connectorId: string | null;
  label: string;
  connectors: string[];
	capabilities: string[];
	mode: 'local' | 'export' | 'mixed' | 'live';
  status: 'syncing' | 'connected' | 'error';
	readOnly: boolean;
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

const bounded = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

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
	return provider && sourceId && label && connector && mode
		? { provider, sourceId, label, connector, mode, keyScope: sourceId, deviceId: null }
		: null;
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

export const staleImportedSegmentIndexes = (activeSegments: number, maximumSegments = MAX_IMPORTED_SEGMENTS): number[] => {
	const start = Math.max(0, Math.floor(activeSegments));
	const end = Math.max(start, Math.floor(maximumSegments));
	return Array.from({ length: end - start }, (_unused, index) => start + index);
};

const sourceProjection = (source: AiSourceInput, extra: Record<string, unknown> = {}) => ({
	access: 'imported',
  provider: source.provider,
  sourceId: source.sourceId,
  label: source.label,
  connector: source.connector,
	...(source.deviceId ? { deviceId: source.deviceId } : {}),
  readOnly: true,
  ...extra
});

const sourceThings = (source: AiSourceInput) => (source.deviceId ? getHomeThingsCollection() : getThingsCollection());

const sourceStorageOptions = (source: AiSourceInput, options: Record<string, unknown> = {}) => ({
	...options,
	...(source.deviceId ? { messengerPlane: 'home' as const } : {})
});

const withSourceStorageTransaction = <T>(source: AiSourceInput, work: (session: any) => Promise<T>) =>
	withMessengerStorageTransaction(work, source.deviceId ? 'home' : 'active');

const ensureMembership = async (kind: 'community' | 'chat', targetId: string, ownerId: string, session: any, source: AiSourceInput) => {
	const things = await sourceThings(source);
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
		sourceStorageOptions(source, { upsert: true, session })
  );
};

const ensureGroup = async (ownerId: string, source: AiSourceInput, group: AiGroupInput): Promise<any> => {
	const things = await sourceThings(source);
	const key = externalKey(ownerId, source.keyScope, 'group', group.id);
  const base = newThingDoc('community', {
    shareId: stableShareId('ai-space', key),
    ownerId,
		uniqueKeys: [thingUniqueKey('externalCommunityKey', key)],
    crystal: {
      name: group.name,
      description: `${source.label} ${group.kind}`,
      avatarUrl: null,
      externalCommunityKey: key,
      externalSource: sourceProjection(source, { groupKind: group.kind })
    }
  });
	// `uniqueKeys` rides `$setOnInsert`, never `$addToSet`: the filter is an
	// equality on that field, so MongoDB seeds the upserted document with the
	// scalar key and `$addToSet` would fail on a non-array field.
	const { crystal: _groupCrystal, updatedAt: _groupUpdatedAt, ...groupRoot } = base;
	return withSourceStorageTransaction(source, async (session) => {
		await updateMessengerThing(
			things,
			thingUniqueKeyFilter('externalCommunityKey', key) as any,
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
			sourceStorageOptions(source, { upsert: true, session })
		);
		const doc = await things.findOne(thingUniqueKeyFilter('externalCommunityKey', key) as any, { session });
		if (!doc) throw new Error('ai_group_upsert_failed');
		await ensureMembership('community', String((doc as any).shareId), ownerId, session, source);
		return doc;
	});
};

const ensureConversation = async (ownerId: string, source: AiSourceInput, conversation: AiConversationInput): Promise<any | Fail> => {
	const things = await sourceThings(source);
	const key = externalKey(ownerId, source.keyScope, 'conversation', conversation.id);
  const createdAt = safeDate(conversation.createdAt);
	return withSourceStorageTransaction(source, async (session) => {
		let communityId: string | null = null;
		if (conversation.groupId) {
			const communityKey = externalKey(ownerId, source.keyScope, 'group', conversation.groupId);
			const community = await things.findOne(thingUniqueKeyFilter('externalCommunityKey', communityKey) as any, { session });
			if (!community) return fail(409, 'An imported conversation arrived before its project; retry the sync batch');
			communityId = String((community as any).shareId);
		}
		const base = newThingDoc('chat', {
			shareId: stableShareId('ai-chat', key),
			ownerId,
			targetId: communityId,
			uniqueKeys: [thingUniqueKey('externalConversationKey', key)],
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
			thingUniqueKeyFilter('externalConversationKey', key) as any,
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
			sourceStorageOptions(source, { upsert: true, session })
		);
		const doc = await things.findOne(thingUniqueKeyFilter('externalConversationKey', key) as any, { session });
		if (!doc) throw new Error('ai_conversation_upsert_failed');
		await ensureMembership('chat', String((doc as any).shareId), ownerId, session, source);
		return doc;
	});
};

const upsertMessages = async (
  ownerId: string,
  source: AiSourceInput,
  messages: AiMessageInput[]
): Promise<{ accepted: number; segments: number }> => {
  if (!messages.length) return { accepted: 0, segments: 0 };
	const things = await sourceThings(source);
  const conversationIds = Array.from(new Set(messages.map((message) => message.conversationId)));
	const conversationKeys = conversationIds.map((id) => externalKey(ownerId, source.keyScope, 'conversation', id));
  const chats = await things
    .find(thingUniqueKeysFilter('externalConversationKey', conversationKeys) as any, {
      projection: { shareId: 1, 'crystal.externalConversationKey': 1 }
    })
    .toArray();
  const chatByKey = new Map<string, string>(
    chats.map((chat: any) => [String(chat.crystal?.externalConversationKey), String(chat.shareId)] as [string, string])
  );
	const missing = conversationIds.find((id) => !chatByKey.has(externalKey(ownerId, source.keyScope, 'conversation', id)));
  if (missing) throw Object.assign(new Error('ai_conversation_missing'), { status: 409 });

  const operations: any[] = [];
	const staleSegmentKeys: string[] = [];
  for (const message of messages) {
		const chatId = chatByKey.get(externalKey(ownerId, source.keyScope, 'conversation', message.conversationId))!;
    const parts = splitImportedMessage(message.text);
    parts.forEach((part, segmentIndex) => {
      const segmentId = `${message.id}:${segmentIndex}`;
			const key = externalKey(ownerId, source.keyScope, 'message', `${message.conversationId}:${segmentId}`);
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
				uniqueKeys: [thingUniqueKey('externalMessageKey', key)],
        crystal: {}
      });
      base.createdAt = createdAt;
      base.updatedAt = createdAt;
			const {
				crystal: _ignoredCrystal,
				targetId: _messageTargetId,
				updatedAt: _messageUpdatedAt,
				...root
			} = base;
      operations.push({
        updateOne: {
          filter: thingUniqueKeyFilter('externalMessageKey', key),
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
		for (const segmentIndex of staleImportedSegmentIndexes(parts.length)) {
			const segmentId = `${message.id}:${segmentIndex}`;
			staleSegmentKeys.push(externalKey(ownerId, source.keyScope, 'message', `${message.conversationId}:${segmentId}`));
		}
  }
  const operationChunks: any[][] = [];
  for (let offset = 0; offset < operations.length; offset += 50) operationChunks.push(operations.slice(offset, offset + 50));
  for (const chunk of operationChunks) {
		await withSourceStorageTransaction(source, async (session) => {
			for (const operation of chunk) {
				await updateMessengerThing(
					things,
					operation.updateOne.filter,
					operation.updateOne.update,
					sourceStorageOptions(source, { upsert: true, session })
				);
			}
		});
	}
	// A provider message can be edited shorter while retaining its external id.
	// Remove now-impossible trailing segments through the same exact-accounting
	// transaction helper; otherwise retries remain duplicate-free but leak stale
	// text and quota bytes forever.
	for (let offset = 0; offset < staleSegmentKeys.length; offset += 500) {
		const keys = staleSegmentKeys.slice(offset, offset + 500);
		await deleteMessengerThings(things, thingUniqueKeysFilter('externalMessageKey', keys) as any, sourceStorageOptions(source));
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
		await withSourceStorageTransaction(source, async (session) => {
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
					sourceStorageOptions(source, { session })
				);
			}
		});
  }

  return { accepted: messages.length, segments: operations.length };
};

const connectionProjection = (doc: any): PublicAiConnection => {
	const sourceType = doc.crystal?.sourceType === 'live' ? 'live' : 'imported';
	const mode = doc.crystal?.mode === 'local' || doc.crystal?.mode === 'export' || doc.crystal?.mode === 'live' ? doc.crystal.mode : 'mixed';
  return {
    id: String(doc.shareId),
		sourceType,
    provider: doc.crystal?.provider === 'claude' ? 'claude' : 'chatgpt',
    sourceId: String(doc.crystal?.sourceId || ''),
		deviceId: typeof doc.crystal?.deviceId === 'string' ? doc.crystal.deviceId : null,
		connectorId: typeof doc.crystal?.connectorId === 'string' ? doc.crystal.connectorId : null,
    label: String(doc.crystal?.label || 'AI app'),
    connectors: Array.isArray(doc.crystal?.connectors)
      ? doc.crystal.connectors.filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 8)
      : [],
		capabilities: Array.isArray(doc.crystal?.capabilities)
			? doc.crystal.capabilities.filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 64)
			: [],
    mode,
    status: doc.crystal?.status === 'syncing' || doc.crystal?.status === 'error' ? doc.crystal.status : 'connected',
		readOnly: sourceType !== 'live',
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

export type AiSyncContext = { deviceId?: string };

export const syncAiConnections = async (ownerId: string, input: unknown, context: AiSyncContext = {}): Promise<SyncResult> => {
  if (!input || typeof input !== 'object') return fail(400, 'A sync batch is required');
  const raw = input as Record<string, unknown>;
	const normalizedSource = normalizeSource(raw.source);
	if (!normalizedSource) return fail(400, 'The AI source descriptor is invalid');
	const deviceId = typeof context.deviceId === 'string' && context.deviceId.trim() ? context.deviceId.trim().slice(0, 160) : null;
	const source: AiSourceInput = {
		...normalizedSource,
		deviceId,
		keyScope: deviceId ? `${normalizedSource.sourceId}\0device:${deviceId}\0connector:${normalizedSource.connector}` : normalizedSource.sourceId
	};
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

	const things = await sourceThings(source);
	const connectionKey = externalKey(ownerId, source.keyScope, 'connection', source.sourceId);
  const existingCount = await things.countDocuments({ thingtime: 'ai-connection', ownerId } as any);
  const existing = await things.findOne(thingUniqueKeyFilter('aiConnectionKey', connectionKey) as any);
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
		uniqueKeys: [thingUniqueKey('aiConnectionKey', connectionKey)],
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
    thingUniqueKeyFilter('aiConnectionKey', connectionKey) as any,
    {
      $setOnInsert: root,
      $set: {
        'crystal.aiConnectionKey': connectionKey,
				'crystal.sourceType': 'imported',
        'crystal.provider': source.provider,
        'crystal.sourceId': source.sourceId,
				'crystal.deviceId': source.deviceId,
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
		sourceStorageOptions(source, { upsert: true })
  );
  const connection = await things.findOne(thingUniqueKeyFilter('aiConnectionKey', connectionKey) as any);
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
