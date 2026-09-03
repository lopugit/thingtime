// Lopu conversations — the assistant's chats, stored as messenger rows.
//
// A Lopu chat is an ordinary `chat` thing (group, exactly one member: the
// user) discriminated by crystal.externalSource { access: 'lopu', provider:
// 'lopu' }. There is no Lopu user thing: assistant turns are chat-message rows
// OWNED BY THE USER that carry a read-only externalSource with role
// 'assistant' — the deviceLiveAi mirror pattern — so every existing messenger
// read path (list, messages, reactions, receipts) renders them unchanged and
// the generic /api/v1/things paths keep refusing the kinds. Every util here
// gates on active membership (resolveChatAccess) AND the lopu discriminator,
// then writes through the accounted messenger writers. FUNDAMENTALS §3 shape:
// turns stay relational child rows; the chat carries only the bounded
// replace-on-write lastMessage preview plus a small `lopu` settings block.
//
// Settings (`crystal.lopu`): { model, effort, speed } are the conversation's
// preference, validated here against the static base catalog
// (AI_WORKFLOW_BASE_MODELS). null means "catalog default", which the reply
// route resolves through the admin defaults + provider availability
// (api/utils/ai/models.ts) on every turn. `providerId` pins one of the owner's
// own Secure Vault AI connections (design note §1.3) — null means Thingtime's
// models; the id is validated for shape here and for ownership on write.
// `turns` counts persisted assistant replies and `lastModel` remembers the
// provider-native id that answered last.
import { randomUUID } from 'node:crypto';

import { MAX_CHAT_NAME_CHARS, MAX_MESSAGE_CHARS } from '~/schemas/registry';
import { prepareAttachmentCascadeForThing } from '../attachments/attachments';
import { splitLiveMessageText } from '../devices/deviceLiveAiCore';
import { hasUserVaultProvider } from '../lopu/userVault';
import { safeVaultId } from '../lopu/userVaultCore';
import { getThingsCollection } from '../mongodb/collections';
import {
	AI_MODEL_EFFORT_LABELS,
	AI_WORKFLOW_BASE_MODELS,
	parseAiWorkflowModelOptionId,
	type AiModelEffort,
	type AiModelSpeed
} from '../settings/prConflictResolverModelWaterfallCore';
import { publicLopuMessageMeta, type PublicLopuMessageMeta } from './externalAi';
import {
	chatListEntryFor,
	chatPreviewOf,
	insertChatMember,
	listChatsById,
	projectMessages,
	resolveChatAccess,
	type ChatAccess,
	type ChatListEntry,
	type PublicChatMessage
} from './messenger';
import { messageIdForRequest, normalizedMessengerRequestId } from './messengerMediaCore';
import { boundedTrimmed, fail, newThingDoc, type Fail } from './shared';
import { deleteMessengerThing, deleteMessengerThings, insertMessengerThing, updateMessengerThing, withMessengerStorageTransaction } from './storage';

export const LOPU_CHAT_SHARE_ID_PREFIX = 'lopu-chat-';
export const DEFAULT_LOPU_CHAT_NAME = 'Lopu';
export const LOPU_CHAT_TOPIC = 'Lopu, the Thingtime assistant';
export const LOPU_ASSISTANT_LABEL = 'Lopu';
// A quota-accounted thing per conversation is already bounded by storage; the
// cap only keeps the list endpoint honest for a runaway client.
export const MAX_LOPU_CHATS_PER_USER = 500;
export const MAX_LISTED_LOPU_CHATS = 300;
export const DEFAULT_LISTED_LOPU_CHATS = 100;
// The reply request accepts up to 8000 chars; rows cap at MAX_MESSAGE_CHARS
// (4000), so a long prompt lands as two plain segments.
export const LOPU_USER_TURN_MAX_CHARS = 8000;
// One assistant reply is at most 15 segment rows; anything longer is cut.
export const LOPU_ASSISTANT_TURN_MAX_CHARS = 60_000;
export const LOPU_HISTORY_MAX_CHARS = 60_000;
export const DEFAULT_LOPU_HISTORY_TURNS = 40;
export const MAX_LOPU_HISTORY_TURNS = 200;
export const LOPU_EMPTY_REPLY_TEXT = 'Lopu went quiet for a moment — ask again in a little while.';

// The chat-level discriminator; assistant rows add role/authorName/messageId
// and flip readOnly (lopuAssistantSource). Both project through
// publicExternalAiSource as the 'lopu' access branch.
export const LOPU_CHAT_SOURCE = Object.freeze({
	access: 'lopu',
	provider: 'lopu',
	sourceId: 'lopu',
	label: LOPU_ASSISTANT_LABEL,
	connector: 'thingtime',
	readOnly: false
} as const);

export type LopuChatSettings = {
	model: string | null; // provider-native id from AI_WORKFLOW_BASE_MODELS; null = catalog default
	effort: AiModelEffort | null; // null = the model's provider-default effort
	speed: AiModelSpeed | null; // null = 'normal'
	providerId?: string | null; // one of the owner's Secure Vault provider connections; null/absent = Thingtime's models
};
export type LopuChatState = LopuChatSettings & { turns: number; lastModel: string | null };
export type LopuChatSettingsInput = { model?: unknown; effort?: unknown; speed?: unknown; providerId?: unknown };
export type LopuTurnProvider = NonNullable<PublicLopuMessageMeta['provider']>;
export type LopuAssistantTurnMeta = {
	model?: unknown;
	effort?: unknown;
	speed?: unknown;
	provider?: unknown;
	usage?: unknown;
	toolCalls?: unknown;
	stopReason?: unknown;
};
export type LopuHistoryTurn = { role: 'user' | 'assistant'; text: string };

// A Lopu conversation in the messenger list-entry shape plus its own model
// settings (`crystal.lopu`), so the client can adopt a chat's model/effort/
// speed when it is selected without a second round trip.
export type LopuChatEntry = ChatListEntry & { lopu: LopuChatState };
export type LopuChatResult = Fail | { ok: true; chat: LopuChatEntry };
export type ListLopuChatsResult = Fail | { ok: true; chats: LopuChatEntry[] };
export type GetLopuChatResult = Fail | { ok: true; chat: LopuChatEntry; myMember: ChatListEntry['myMember']; settings: LopuChatState };
export type DeleteLopuChatResult = Fail | { ok: true };
// `message` is the first (usually only) row; `messages` lists every segment.
export type LopuUserTurnResult = Fail | { ok: true; message: PublicChatMessage; messages: PublicChatMessage[]; existing?: boolean };
export type LopuAssistantTurnResult = Fail | { ok: true; messages: PublicChatMessage[]; existing?: boolean };
export type LoadLopuHistoryResult = Fail | { ok: true; history: LopuHistoryTurn[]; chars: number; truncated: boolean };

export const EMPTY_LOPU_SETTINGS: LopuChatSettings = Object.freeze({ model: null, effort: null, speed: null, providerId: null });

const EFFORT_VALUES: readonly string[] = Object.keys(AI_MODEL_EFFORT_LABELS);
const isEffort = (value: unknown): value is AiModelEffort => typeof value === 'string' && EFFORT_VALUES.includes(value);
const baseModelOf = (id: string | null) => (id ? AI_WORKFLOW_BASE_MODELS.find((entry) => entry.id === id) ?? null : null);
const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
	const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
	if (!Number.isFinite(num)) return fallback;
	return Math.min(Math.max(min, Math.floor(num)), max);
};
const chunk = <T>(items: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let offset = 0; offset < items.length; offset += size) out.push(items.slice(offset, offset + size));
	return out;
};

// ── pure parts (unit-tested without Mongo) ──

export const isLopuSource = (source: unknown): boolean =>
	!!source && typeof source === 'object' && (source as any).access === 'lopu' && (source as any).provider === 'lopu';

export const isLopuChatDoc = (chat: unknown): boolean => isLopuSource((chat as any)?.crystal?.externalSource);

export const lopuChatShareId = (): string => `${LOPU_CHAT_SHARE_ID_PREFIX}${randomUUID()}`;

// Row ids are owner-scoped hashes of the client's requestId (same rule as
// sendMessage), so a retried turn collides with itself and never with another
// user. Segment n > 0 keys off `<requestId>:<n>`; the assistant reply keys off
// `<requestId>:assistant[:<n>]`.
export const lopuUserMessageShareId = (viewerId: string, requestId: string, segmentIndex = 0): string =>
	messageIdForRequest(viewerId, segmentIndex === 0 ? requestId : `${requestId}:${segmentIndex}`);

export const lopuAssistantMessageShareId = (viewerId: string, requestId: string, segmentIndex = 0): string =>
	messageIdForRequest(viewerId, segmentIndex === 0 ? `${requestId}:assistant` : `${requestId}:assistant:${segmentIndex}`);

export const lopuAssistantSource = (requestId: string, segmentIndex: number, segmentCount: number) => ({
	...LOPU_CHAT_SOURCE,
	readOnly: true as const,
	role: 'assistant' as const,
	authorName: LOPU_ASSISTANT_LABEL,
	messageId: requestId,
	revision: 1,
	segmentIndex,
	segmentCount
});

// Reads a stored crystal.lopu block back into the public settings shape —
// forgiving, so a row written by a newer catalog never breaks the read path.
export const lopuChatStateOf = (value: unknown): LopuChatState => {
	const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim().slice(0, 128) : null;
	const effort = isEffort(raw.effort) ? raw.effort : null;
	const speed = raw.speed === 'fast' ? 'fast' : raw.speed === 'normal' ? 'normal' : null;
	const turns = Number.isSafeInteger(raw.turns) && Number(raw.turns) >= 0 ? Number(raw.turns) : 0;
	const lastModel = typeof raw.lastModel === 'string' && raw.lastModel.trim() ? raw.lastModel.trim().slice(0, 128) : null;
	const providerId = safeVaultId(raw.providerId);
	return { model, effort, speed, providerId, turns, lastModel };
};

const withLopuState = (entry: ChatListEntry, lopu: unknown): LopuChatEntry => ({ ...entry, lopu: lopuChatStateOf(lopu) });

export type NormalizedLopuChatSettings = { ok: true; settings: LopuChatSettings; changed: boolean };

// Validates a requested { model?, effort?, speed? } against the static base
// catalog. `model` also accepts a composed option id (`claude-opus-5:high:fast`)
// whose segments become effort/speed. undefined keeps the current value; null
// or '' resets a field to "catalog default". An effort/speed the chosen model
// does not offer is a 400 when it was asked for in this call, and is clamped
// (prefer 'high', else the model's last tier; fast → normal) when it was only
// inherited from the previous settings under a model switch. Availability and
// admin enable flags are the reply route's concern (api/utils/ai/models.ts).
// `providerId` is shape-checked here (a Secure Vault record id); ownership is
// verified by the Mongo-backed writers below.
export const normalizeLopuChatSettings = (input: LopuChatSettingsInput, current: LopuChatSettings = EMPTY_LOPU_SETTINGS): Fail | NormalizedLopuChatSettings => {
	let model = current.model;
	let effort = current.effort;
	let speed = current.speed;
	let providerId = current.providerId ?? null;
	let effortExplicit = false;
	let speedExplicit = false;

	if (input.providerId !== undefined) {
		if (input.providerId === null || input.providerId === '') {
			providerId = null;
		} else {
			const id = safeVaultId(input.providerId);
			if (!id) return fail(400, 'providerId must be one of your Secure Vault provider ids');
			providerId = id;
		}
	}

	if (input.model !== undefined) {
		if (input.model === null || input.model === '') {
			model = null;
		} else if (typeof input.model !== 'string') {
			return fail(400, 'model must be a catalog model id');
		} else {
			const choice = parseAiWorkflowModelOptionId(input.model.trim());
			if (!choice) return fail(400, `Unknown model "${input.model.trim().slice(0, 64)}"`);
			model = choice.model === 'default' ? null : choice.model;
			if (choice.effort) {
				effort = choice.effort;
				effortExplicit = true;
			}
			if (choice.speed === 'fast') {
				speed = 'fast';
				speedExplicit = true;
			}
		}
	}
	if (input.effort !== undefined) {
		if (input.effort === null || input.effort === '') {
			effort = null;
		} else if (!isEffort(input.effort)) {
			return fail(400, `effort must be one of ${EFFORT_VALUES.join(', ')}`);
		} else {
			effort = input.effort;
		}
		effortExplicit = true;
	}
	if (input.speed !== undefined) {
		if (input.speed === null || input.speed === '') {
			speed = null;
		} else if (input.speed !== 'normal' && input.speed !== 'fast') {
			return fail(400, 'speed must be "normal" or "fast"');
		} else {
			speed = input.speed;
		}
		speedExplicit = true;
	}

	const base = baseModelOf(model);
	if (base) {
		if (effort && !base.efforts.includes(effort)) {
			if (effortExplicit) return fail(400, `${base.label} does not offer ${effort} effort`);
			effort = base.efforts.includes('high') ? 'high' : base.efforts[base.efforts.length - 1] ?? null;
		}
		if (speed === 'fast' && !base.speeds.includes('fast')) {
			if (speedExplicit) return fail(400, `${base.label} has no fast lane`);
			speed = null;
		}
	}

	const settings: LopuChatSettings = { model, effort, speed, providerId };
	const changed =
		settings.model !== current.model ||
		settings.effort !== current.effort ||
		settings.speed !== current.speed ||
		settings.providerId !== (current.providerId ?? null);
	return { ok: true, settings, changed };
};

export const LOPU_PROVIDER_NOT_IN_VAULT_ERROR = 'That AI provider is not in your Secure Vault';

// A pinned providerId must name one of the viewer's own provider connections
// (never someone else's, never a deleted one) before it is stored.
const assertOwnVaultProvider = async (viewerId: string, providerId: string | null): Promise<Fail | null> =>
	!providerId || (await hasUserVaultProvider(viewerId, providerId)) ? null : fail(400, LOPU_PROVIDER_NOT_IN_VAULT_ERROR);

export type LopuHistoryRow = {
	crystal?: {
		text?: unknown;
		deletedAt?: unknown;
		systemType?: unknown;
		externalSource?: { role?: unknown; messageId?: unknown } | null;
		lopu?: { role?: unknown; requestId?: unknown } | null;
	} | null;
};

const historyRole = (row: LopuHistoryRow): 'user' | 'assistant' =>
	row.crystal?.externalSource?.role === 'assistant' || row.crystal?.lopu?.role === 'assistant' ? 'assistant' : 'user';

const historyTurnKey = (row: LopuHistoryRow): string | null => {
	const key = row.crystal?.lopu?.requestId ?? row.crystal?.externalSource?.messageId;
	return typeof key === 'string' && key ? key : null;
};

// Folds persisted rows (oldest first) into model turns: segments of one
// persisted turn (same requestId) concatenate exactly (splitLiveMessageText
// preserves every code point), any other back-to-back same-role rows join as
// paragraphs, deleted/system rows vanish. Keeps the newest `limit` turns and
// then the newest turns that fit in `maxChars`; if even the newest turn alone
// overflows, its tail survives.
export const buildLopuHistory = (
	rowsOldestFirst: LopuHistoryRow[],
	opts: { limit?: number; maxChars?: number } = {}
): { history: LopuHistoryTurn[]; chars: number; truncated: boolean } => {
	const limit = clampInt(opts.limit, DEFAULT_LOPU_HISTORY_TURNS, 1, MAX_LOPU_HISTORY_TURNS);
	const maxChars = clampInt(opts.maxChars, LOPU_HISTORY_MAX_CHARS, 1, LOPU_HISTORY_MAX_CHARS);
	const turns: Array<{ role: 'user' | 'assistant'; text: string; key: string | null }> = [];
	for (const row of rowsOldestFirst) {
		if (!row?.crystal || row.crystal.deletedAt || row.crystal.systemType) continue;
		const text = typeof row.crystal.text === 'string' ? row.crystal.text : '';
		if (!text.trim()) continue;
		const role = historyRole(row);
		const key = historyTurnKey(row);
		const last = turns[turns.length - 1];
		if (last && last.role === role) {
			last.text += last.key && last.key === key ? text : `\n\n${text}`;
			continue;
		}
		turns.push({ role, text, key });
	}
	const kept = turns.slice(-limit);
	let truncated = kept.length < turns.length;
	let chars = 0;
	const history: LopuHistoryTurn[] = [];
	for (let index = kept.length - 1; index >= 0; index -= 1) {
		const turn = kept[index]!;
		if (chars + turn.text.length > maxChars) {
			if (!history.length) {
				const tail = turn.text.slice(-maxChars);
				history.unshift({ role: turn.role, text: tail });
				chars += tail.length;
			}
			truncated = true;
			break;
		}
		history.unshift({ role: turn.role, text: turn.text });
		chars += turn.text.length;
	}
	return { history, chars, truncated };
};

// ── gate ──

const resolveLopuChat = async (viewerId: string, chatId: unknown): Promise<ChatAccess | Fail> => {
	const access = await resolveChatAccess(viewerId, chatId, { requireActive: true });
	if ('ok' in access && access.ok === false) return access;
	const { chat } = access as ChatAccess;
	if (!isLopuChatDoc(chat)) return fail(400, 'That chat is not a Lopu conversation');
	return access as ChatAccess;
};

// Re-checks membership INSIDE the write transaction (sendMessage does the
// same): a concurrent delete must not resurrect a row into a dead chat.
const assertLopuChatLive = async (things: any, chat: any, member: any, viewerId: string, session: any): Promise<void> => {
	const [freshChat, freshMember] = await Promise.all([
		things.findOne({ shareId: chat.shareId, thingtime: 'chat' } as any, { session }),
		things.findOne({ shareId: member.shareId, thingtime: 'chat-member', ownerId: viewerId } as any, { session })
	]);
	if (!freshChat || !freshMember || freshMember.crystal?.state !== 'active') throw new Error('lopu_membership_changed');
};

const isDuplicateWrite = (error: any): boolean => error?.code === 11000 || !!error?.errorLabels?.includes?.('UnknownTransactionCommitResult');

const previewOf = (lastRow: any, fullText: string) => ({
	...chatPreviewOf(lastRow),
	text: fullText.slice(0, 140),
	...(lastRow.crystal?.externalSource ? { externalSource: lastRow.crystal.externalSource } : {})
});

const messageRow = (
	viewerId: string,
	chatId: string,
	shareId: string,
	text: string,
	createdAt: Date,
	extra: Record<string, unknown>
) => {
	const doc = newThingDoc('chat-message', {
		ownerId: viewerId,
		targetId: chatId,
		shareId,
		crystal: { text, threadRootId: null, replyToId: null, editedAt: null, deletedAt: null, systemType: null, systemMeta: null, ...extra }
	});
	doc.createdAt = createdAt;
	doc.updatedAt = createdAt;
	return doc;
};

const turnRows = async (things: any, chatId: string, requestId: string, role: 'user' | 'assistant'): Promise<any[]> =>
	things
		.find({ thingtime: 'chat-message', targetId: chatId, 'crystal.lopu.requestId': requestId, 'crystal.lopu.role': role } as any)
		.sort({ createdAt: 1, shareId: 1 })
		.toArray();

// ── chats ──

export const createLopuChat = async (
	viewerId: string,
	input: { title?: unknown; model?: unknown; effort?: unknown; speed?: unknown; providerId?: unknown } = {}
): Promise<LopuChatResult> => {
	const wantsTitle = input.title !== undefined && input.title !== null && input.title !== '';
	const title = wantsTitle ? boundedTrimmed(input.title, MAX_CHAT_NAME_CHARS) : null;
	if (wantsTitle && !title) return fail(400, 'That title did not survive validation');
	const normalized = normalizeLopuChatSettings(input);
	if (normalized.ok === false) return normalized;
	const foreignProvider = await assertOwnVaultProvider(viewerId, normalized.settings.providerId);
	if (foreignProvider) return foreignProvider;

	const things = await getThingsCollection();
	const count = await things.countDocuments({ thingtime: 'chat', ownerId: viewerId, 'crystal.externalSource.provider': 'lopu' } as any);
	if (count >= MAX_LOPU_CHATS_PER_USER) return fail(400, 'Tidy up some older Lopu conversations first');

	const chat = newThingDoc('chat', {
		shareId: lopuChatShareId(),
		ownerId: viewerId,
		targetId: null,
		crystal: {
			chatType: 'group',
			name: title || DEFAULT_LOPU_CHAT_NAME,
			topic: LOPU_CHAT_TOPIC,
			communityId: null,
			sectionId: null,
			channelVisibility: null,
			dmKey: null,
			externalSource: { ...LOPU_CHAT_SOURCE },
			lopu: { ...normalized.settings, turns: 0, lastModel: null }
		}
	});
	await withMessengerStorageTransaction(async (session) => {
		await insertMessengerThing(things, chat as any, { session });
		await insertChatMember(chat.shareId, viewerId, { role: 'owner', state: 'active' }, session);
	});
	const entry = await chatListEntryFor(viewerId, chat.shareId);
	if (entry.ok === false) return entry;
	return { ok: true, chat: withLopuState(entry.chat, chat.crystal.lopu) };
};

// Lopu chats are always owned by their one member, so the list is an owner
// query rather than a walk over every membership; the rows then take the
// same summary path as /api/v1/chats (unread, preview, membership).
export const listLopuChats = async (viewerId: string, input: { limit?: unknown } = {}): Promise<ListLopuChatsResult> => {
	const limit = clampInt(input.limit, DEFAULT_LISTED_LOPU_CHATS, 1, MAX_LISTED_LOPU_CHATS);
	const things = await getThingsCollection();
	const docs = await things
		.find({ thingtime: 'chat', ownerId: viewerId, 'crystal.externalSource.provider': 'lopu' } as any, { projection: { shareId: 1, 'crystal.lopu': 1 } })
		.sort({ updatedAt: -1, shareId: 1 })
		.limit(limit)
		.toArray();
	const stateById = new Map<string, unknown>(docs.map((doc: any) => [String(doc.shareId), doc.crystal?.lopu]));
	const entries = await listChatsById(viewerId, [...stateById.keys()]);
	const chats = entries
		.filter((entry) => isLopuSource(entry.externalSource))
		.sort((a, b) => (b.lastMessage?.createdAt || b.updatedAt).localeCompare(a.lastMessage?.createdAt || a.updatedAt))
		.map((entry) => withLopuState(entry, stateById.get(entry.id)));
	return { ok: true, chats };
};

export const getLopuChat = async (viewerId: string, chatId: unknown): Promise<GetLopuChatResult> => {
	const access = await resolveLopuChat(viewerId, chatId);
	if ('ok' in access && access.ok === false) return access;
	const { chat } = access as ChatAccess;
	const entry = await chatListEntryFor(viewerId, chat.shareId);
	if (entry.ok === false) return entry;
	const settings = lopuChatStateOf(chat.crystal?.lopu);
	return { ok: true, chat: { ...entry.chat, lopu: settings }, myMember: entry.chat.myMember, settings };
};

// Title + model/effort/speed. No system message: a Lopu conversation is a
// private notebook, not a room that needs to be told it was renamed (the
// messenger rename path via updateChat still works and does announce).
export const updateLopuChat = async (
	viewerId: string,
	chatId: unknown,
	input: { title?: unknown; model?: unknown; effort?: unknown; speed?: unknown; providerId?: unknown } = {}
): Promise<LopuChatResult> => {
	const access = await resolveLopuChat(viewerId, chatId);
	if ('ok' in access && access.ok === false) return access;
	const { chat } = access as ChatAccess;
	const patch: Record<string, unknown> = {};
	if (input.title !== undefined) {
		const title = boundedTrimmed(input.title, MAX_CHAT_NAME_CHARS);
		if (!title) return fail(400, 'Lopu conversations need a title');
		if (title !== chat.crystal?.name) patch['crystal.name'] = title;
	}
	const current = lopuChatStateOf(chat.crystal?.lopu);
	const normalized = normalizeLopuChatSettings(input, current);
	if (normalized.ok === false) return normalized;
	if (normalized.changed) {
		if (normalized.settings.providerId !== current.providerId) {
			const foreignProvider = await assertOwnVaultProvider(viewerId, normalized.settings.providerId);
			if (foreignProvider) return foreignProvider;
		}
		patch['crystal.lopu.model'] = normalized.settings.model;
		patch['crystal.lopu.effort'] = normalized.settings.effort;
		patch['crystal.lopu.speed'] = normalized.settings.speed;
		patch['crystal.lopu.providerId'] = normalized.settings.providerId;
	}
	if (!Object.keys(patch).length) return fail(400, 'Nothing to update');
	const things = await getThingsCollection();
	await updateMessengerThing(things, { shareId: chat.shareId, thingtime: 'chat' } as any, { $set: { ...patch, updatedAt: new Date() } });
	const entry = await chatListEntryFor(viewerId, chat.shareId);
	if (entry.ok === false) return entry;
	return { ok: true, chat: withLopuState(entry.chat, { ...(chat.crystal?.lopu || {}), ...(normalized.changed ? normalized.settings : {}) }) };
};

// Owner only. Chat + membership + every message (+ their reactions) go in one
// accounted transaction, so quota and rows move together. Attachments bound
// to user rows (sent through /chats/messages) release their objects first,
// exactly like deleteMessage.
export const deleteLopuChat = async (viewerId: string, chatId: unknown): Promise<DeleteLopuChatResult> => {
	const access = await resolveLopuChat(viewerId, chatId);
	if ('ok' in access && access.ok === false) return access;
	const { chat, member } = access as ChatAccess;
	if (String(chat.ownerId) !== viewerId || member.crystal?.role !== 'owner') {
		return fail(403, 'Only the owner can delete a Lopu conversation');
	}
	const things = await getThingsCollection();
	const messageDocs = await things
		.find({ thingtime: 'chat-message', targetId: chat.shareId } as any, { projection: { shareId: 1, ownerId: 1 } })
		.toArray();
	const messageIds = messageDocs.map((doc: any) => String(doc.shareId));
	if (messageIds.length) {
		const attached = new Set<string>();
		for (const ids of chunk(messageIds, 500)) {
			const docs = await things
				.find({ thingtime: 'attachment', targetId: { $in: ids }, attachmentPurpose: 'message' } as any, { projection: { targetId: 1 } })
				.toArray();
			for (const doc of docs as any[]) attached.add(String(doc.targetId));
		}
		for (const doc of messageDocs as any[]) {
			if (!attached.has(String(doc.shareId))) continue;
			const cleanup = await prepareAttachmentCascadeForThing({ shareId: String(doc.shareId), ownerId: String(doc.ownerId) });
			if (cleanup.ok === false) return fail(cleanup.status, cleanup.error);
		}
	}
	await withMessengerStorageTransaction(async (session) => {
		for (const ids of chunk(messageIds, 500)) {
			await deleteMessengerThings(things, { thingtime: 'reaction', targetId: { $in: ids } } as any, { session });
		}
		await deleteMessengerThings(things, { thingtime: 'chat-message', targetId: chat.shareId } as any, { session });
		await deleteMessengerThings(things, { thingtime: 'chat-member', targetId: chat.shareId } as any, { session });
		await deleteMessengerThing(things, { thingtime: 'chat', shareId: chat.shareId } as any, { session });
	});
	return { ok: true };
};

// ── turns ──

// The user's side of a turn: plain rows owned by the user (no externalSource,
// so they stay editable/deletable through the messenger endpoints). Idempotent
// per requestId: an exact retry answers the committed rows, a different text
// under the same id is a 409 — the sendMessage rule.
export const persistLopuUserTurn = async (
	viewerId: string,
	input: { chatId?: unknown; requestId?: unknown; text?: unknown }
): Promise<LopuUserTurnResult> => {
	const access = await resolveLopuChat(viewerId, input.chatId);
	if ('ok' in access && access.ok === false) return access;
	const { chat, member } = access as ChatAccess;
	const requestId = normalizedMessengerRequestId(input.requestId);
	if (!requestId) return fail(400, 'Invalid message request id');
	const text = typeof input.text === 'string' ? input.text.trim() : '';
	if (!text) return fail(400, 'Say something first');
	if (Array.from(text).length > LOPU_USER_TURN_MAX_CHARS) return fail(400, `Messages to Lopu cap at ${LOPU_USER_TURN_MAX_CHARS} characters`);

	const parts = splitLiveMessageText(text, MAX_MESSAGE_CHARS);
	const base = new Date();
	const rows = parts.map((part, index) =>
		messageRow(viewerId, chat.shareId, lopuUserMessageShareId(viewerId, requestId, index), part, new Date(base.getTime() + index), {
			lopu: { role: 'user', requestId, segmentIndex: index, segmentCount: parts.length }
		})
	);
	const things = await getThingsCollection();
	const last = rows[rows.length - 1]!;
	try {
		await withMessengerStorageTransaction(async (session) => {
			await assertLopuChatLive(things, chat, member, viewerId, session);
			for (const row of rows) await insertMessengerThing(things, row as any, { session });
			await updateMessengerThing(
				things,
				{ shareId: member.shareId, thingtime: 'chat-member', ownerId: viewerId } as any,
				{ $set: { 'crystal.lastReadMessageId': last.shareId, 'crystal.lastReadAt': last.createdAt.toISOString(), updatedAt: new Date() } },
				{ session }
			);
			await updateMessengerThing(
				things,
				{ shareId: chat.shareId, thingtime: 'chat' } as any,
				{ $set: { updatedAt: new Date(), 'crystal.lastMessage': previewOf(last, text) } },
				{ session }
			);
		});
	} catch (error: any) {
		if (isDuplicateWrite(error)) {
			const existing = await turnRows(things, chat.shareId, requestId, 'user');
			const first = existing[0];
			const exact =
				!!first &&
				String(first.ownerId) === viewerId &&
				!first.crystal?.deletedAt &&
				existing.map((doc: any) => String(doc.crystal?.text || '')).join('') === text;
			if (!exact) return fail(409, 'That message request id is already in use');
			const projected = await projectMessages(viewerId, chat.shareId, existing, { withThreadCounts: false });
			return { ok: true, message: projected.messages[0]!, messages: projected.messages, existing: true };
		}
		if (error?.message === 'lopu_membership_changed') return fail(409, 'This Lopu conversation changed — try again');
		throw error;
	}
	const projected = await projectMessages(viewerId, chat.shareId, rows, { withThreadCounts: false });
	return { ok: true, message: projected.messages[0]!, messages: projected.messages };
};

// Lopu's side of a turn: rows owned by the user carrying the read-only
// assistant externalSource (+ per-turn metadata under crystal.lopu — model,
// provider, usage, tool calls — sanitised through publicLopuMessageMeta, tool
// calls on the first segment only). Also advances the member's read receipt
// past the reply (the user's own conversation never bolds), rewrites the
// chat's lastMessage preview and bumps crystal.lopu.turns / lastModel.
export const persistLopuAssistantTurn = async (
	viewerId: string,
	input: { chatId?: unknown; requestId?: unknown; text?: unknown; lopu?: LopuAssistantTurnMeta | null }
): Promise<LopuAssistantTurnResult> => {
	const access = await resolveLopuChat(viewerId, input.chatId);
	if ('ok' in access && access.ok === false) return access;
	const { chat, member } = access as ChatAccess;
	const requestId = normalizedMessengerRequestId(input.requestId);
	if (!requestId) return fail(400, 'Invalid message request id');
	const rawText = typeof input.text === 'string' ? input.text.trim() : '';
	const text = (Array.from(rawText).slice(0, LOPU_ASSISTANT_TURN_MAX_CHARS).join('') || LOPU_EMPTY_REPLY_TEXT).trim();
	const meta = input.lopu && typeof input.lopu === 'object' ? input.lopu : {};

	const parts = splitLiveMessageText(text, MAX_MESSAGE_CHARS);
	const base = new Date();
	const rows = parts.map((part, index) => {
		const lopu = publicLopuMessageMeta({
			...meta,
			role: 'assistant',
			requestId,
			segmentIndex: index,
			segmentCount: parts.length,
			...(index === 0 ? {} : { toolCalls: undefined, usage: undefined })
		});
		return messageRow(viewerId, chat.shareId, lopuAssistantMessageShareId(viewerId, requestId, index), part, new Date(base.getTime() + index), {
			externalSource: lopuAssistantSource(requestId, index, parts.length),
			lopu
		});
	});
	const model = typeof meta.model === 'string' && meta.model.trim() ? meta.model.trim().slice(0, 128) : null;
	const things = await getThingsCollection();
	const last = rows[rows.length - 1]!;
	try {
		await withMessengerStorageTransaction(async (session) => {
			await assertLopuChatLive(things, chat, member, viewerId, session);
			for (const row of rows) await insertMessengerThing(things, row as any, { session });
			await updateMessengerThing(
				things,
				{ shareId: member.shareId, thingtime: 'chat-member', ownerId: viewerId } as any,
				{ $set: { 'crystal.lastReadMessageId': last.shareId, 'crystal.lastReadAt': last.createdAt.toISOString(), updatedAt: new Date() } },
				{ session }
			);
			await updateMessengerThing(
				things,
				{ shareId: chat.shareId, thingtime: 'chat' } as any,
				{
					$set: { updatedAt: new Date(), 'crystal.lastMessage': previewOf(last, text), 'crystal.lopu.lastModel': model },
					$inc: { 'crystal.lopu.turns': 1 }
				},
				{ session }
			);
		});
	} catch (error: any) {
		if (isDuplicateWrite(error)) {
			const existing = await turnRows(things, chat.shareId, requestId, 'assistant');
			if (!existing.length || String(existing[0].ownerId) !== viewerId) return fail(409, 'That reply was already recorded under another request id');
			const projected = await projectMessages(viewerId, chat.shareId, existing, { withThreadCounts: false });
			return { ok: true, messages: projected.messages, existing: true };
		}
		if (error?.message === 'lopu_membership_changed') return fail(409, 'This Lopu conversation changed — try again');
		throw error;
	}
	const projected = await projectMessages(viewerId, chat.shareId, rows, { withThreadCounts: false });
	return { ok: true, messages: projected.messages };
};

// The transcript the model sees: the newest `limit` turns, oldest first,
// capped at LOPU_HISTORY_MAX_CHARS. Reads the main list only (threads and
// system rows never reach the model).
export const loadLopuHistory = async (viewerId: string, chatId: unknown, opts: { limit?: unknown } = {}): Promise<LoadLopuHistoryResult> => {
	const access = await resolveLopuChat(viewerId, chatId);
	if ('ok' in access && access.ok === false) return access;
	const { chat } = access as ChatAccess;
	const limit = clampInt(opts.limit, DEFAULT_LOPU_HISTORY_TURNS, 1, MAX_LOPU_HISTORY_TURNS);
	const things = await getThingsCollection();
	// a turn is at most 2 user + 15 assistant rows, and the char cap ends
	// the fold long before 8 rows per turn could matter — bounded either way
	const rows = await things
		.find(
			{ thingtime: 'chat-message', targetId: chat.shareId, 'crystal.threadRootId': null, 'crystal.deletedAt': null, 'crystal.systemType': null } as any,
			{ projection: { crystal: 1, createdAt: 1, shareId: 1, ownerId: 1 } }
		)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(Math.min(limit * 8, 400))
		.toArray();
	const folded = buildLopuHistory([...(rows as LopuHistoryRow[])].reverse(), { limit, maxChars: LOPU_HISTORY_MAX_CHARS });
	return { ok: true, ...folded };
};
