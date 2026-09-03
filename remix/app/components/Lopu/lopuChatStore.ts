// The Lopu chat module store (design note §3.1/§3.2): ONE state shared by the
// /lopu page and the floating window (LopuHost), read through
// useSyncExternalStore in useLopuChat. Holds the conversation list, the
// messages per chat, this session's streamed turns (tool cards outlive a
// turn's completion), the model catalog, the viewer's model/effort/speed
// settings and the in-flight streaming turn. Every network call goes through
// the bound useApi/useMessengerApi client (bindLopuApi) — the store never
// fetches on its own except the reply stream (lopuChatStream), which is the
// same code path useApi's v1.lopu.reply wraps.
//
// Optimistic-render house rule: chats, messages, models and settings seed
// from `tt-lopu-*` localCache lines during hydrate (called in render by the
// hook) and refetch in the background; nothing here ever gates a first paint.
//
// Live build (§2.5): patch / thing / tool_input_delta events are handed to
// lopuBuildBridge, which owns the mounted-draft registry, the per-tool-call
// baseline (so a final `patch` replays from the baseline — never applied
// twice) and the animation-frame coalescing. This store adds the Undo
// snapshots (what the draft showed before Lopu touched it) and the
// auto-revert when a refused/aborted patch had already painted.

import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import type { ChatMessage, ChatSummary } from '~/components/Messenger/messengerTypes';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { parsePartialJson } from '~/utils/partialJson';
import {
	applyLopuPartialComponent,
	applyLopuPartialPageOps,
	applyLopuPatchEvent,
	applyLopuThingEvent,
	describeActiveWebpageDraft,
	discardLopuPartialComponent,
	discardLopuPartialPageOps,
	getActiveWebpageDraft,
	resolveLopuDraft,
	type LopuDraftHandle
} from './lopuBuildBridge';
import { isAbortError, readNdjson, type LopuReplyBody, type LopuReplyContext } from './lopuChatStream';
import {
	buildAssistantMessages,
	buildUserMessage,
	chatTitleFromText,
	initialLopuTurn,
	isLopuTurnActive,
	isOptimisticLopuMessage,
	markLopuTurnAborted,
	markLopuTurnFailed,
	mergeMessages,
	reduceLopuTurn,
	type LopuChatEvent,
	type LopuPatchTarget,
	type LopuThingLike,
	type LopuToolActivity,
	type LopuTurnState
} from './lopuTurnCore';

// ——— wire shapes ————————————————————————————————————————————————————————————

// GET /api/v1/ai/models (design note §1.1)
export type AiModelPublic = {
	id: string;
	label: string;
	provider: 'anthropic' | 'openai';
	efforts: string[];
	speeds: string[];
	family: string;
	enabled: boolean;
	available: boolean;
	isDefault: boolean;
};

export type LopuChatSettings = { model: string | null; effort: string | null; speed: string | null };

export type LopuProvidersInfo = Partial<Record<'anthropic' | 'openai', { configured: boolean }>>;

export type LopuModelsPayload = {
	models: AiModelPublic[];
	defaults: LopuChatSettings | null;
	providers: LopuProvidersInfo | null;
};

// a Lopu conversation row — the messenger chat summary plus the chat's own
// model settings when the list projects them
export type LopuChatSummary = ChatSummary & {
	lopu?: (Partial<LopuChatSettings> & { turns?: number; lastModel?: string | null }) | null;
};

export type LopuNotice = { id: number; title: string; description?: string; status: 'success' | 'error' | 'info' };

export type LopuApiClient = {
	models: (options?: { signal?: AbortSignal }) => Promise<any>;
	chats: {
		list: (options?: { signal?: AbortSignal }) => Promise<any>;
		create: (args?: { title?: string; model?: string; effort?: string; speed?: string }) => Promise<any>;
		update: (args: { chatId: string; title?: string; model?: string; effort?: string; speed?: string }) => Promise<any>;
		delete: (args: { chatId: string }) => Promise<any>;
	};
	// the messenger's message page (GET /api/v1/chats/messages, newest first)
	messages: (args: { chatId: string; limit?: number; cursor?: string | null }) => Promise<any>;
	reply: (body: LopuReplyBody, options?: { signal?: AbortSignal }) => Promise<Response>;
};

export type LopuStoreState = {
	userId: string | null;
	hydrated: boolean;
	chats: LopuChatSummary[];
	chatsLoaded: boolean;
	chatsLoading: boolean;
	messages: Record<string, ChatMessage[]>;
	messagesLoaded: Record<string, boolean>;
	activeChatId: string | null;
	// this session's streamed turns by requestId (tool cards outlive `done`)
	turns: Record<string, LopuTurnState>;
	turnOrder: string[];
	streamingId: string | null;
	sending: boolean;
	models: AiModelPublic[];
	modelsLoaded: boolean;
	modelsLoading: boolean;
	defaults: LopuChatSettings | null;
	providers: LopuProvidersInfo | null;
	settings: LopuChatSettings;
	error: string | null;
	notices: LopuNotice[];
	navigateSeq: number;
	pendingNavigate: string | null;
	// bumps when something outside the state changes what cards show (undo)
	version: number;
};

// ——— caches ———————————————————————————————————————————————————————————————

export const LOPU_CACHE_PREFIX = 'tt-lopu-';
export const lopuChatsCacheKey = (userId: string) => `tt-lopu-chats-${userId}`;
export const lopuMessagesCacheKey = (chatId: string) => `tt-lopu-messages-${chatId}`;
export const lopuSettingsCacheKey = (userId: string) => `tt-lopu-settings-${userId}`;
export const LOPU_MODELS_CACHE_KEY = 'tt-lopu-models';
export const LOPU_MESSAGES_CACHE_CAP = 50;
export const LOPU_TURNS_CAP = 40;
export const LOPU_CONTEXT_BLOCKS_MAX_CHARS = 48_000;

type ChatsCache = { at: number; chats: LopuChatSummary[] };
type MessagesCache = { at: number; messages: ChatMessage[] };
type ModelsCache = { at: number } & LopuModelsPayload;

const EMPTY_SETTINGS: LopuChatSettings = { model: null, effort: null, speed: null };
const EMPTY_MESSAGES: ChatMessage[] = [];

const createInitialState = (): LopuStoreState => ({
	userId: null,
	hydrated: false,
	chats: [],
	chatsLoaded: false,
	chatsLoading: false,
	messages: {},
	messagesLoaded: {},
	activeChatId: null,
	turns: {},
	turnOrder: [],
	streamingId: null,
	sending: false,
	models: [],
	modelsLoaded: false,
	modelsLoading: false,
	defaults: null,
	providers: null,
	settings: EMPTY_SETTINGS,
	error: null,
	notices: [],
	navigateSeq: 0,
	pendingNavigate: null,
	version: 0
});

// ——— the store ————————————————————————————————————————————————————————————

const SERVER_SNAPSHOT: LopuStoreState = createInitialState();
let state: LopuStoreState = createInitialState();
const listeners = new Set<() => void>();
let client: LopuApiClient | null = null;
let controller: AbortController | null = null;
let noticeSeq = 0;
let emitScheduled = false;

const emit = () => {
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			// a broken subscriber must not stop the others
		}
	}
};

// Hydration runs during render (so the first paint reads cached state); a
// synchronous emit there would update sibling components mid-render, so those
// notifications go out on the microtask queue instead.
const scheduleEmit = () => {
	if (emitScheduled) return;
	emitScheduled = true;
	const flush = () => {
		emitScheduled = false;
		emit();
	};
	if (typeof queueMicrotask === 'function') queueMicrotask(flush);
	else Promise.resolve().then(flush);
};

const setState = (patch: Partial<LopuStoreState> | ((current: LopuStoreState) => Partial<LopuStoreState>)) => {
	const next = typeof patch === 'function' ? patch(state) : patch;
	state = { ...state, ...next };
	emit();
};

export const subscribeLopuStore = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const getLopuStoreSnapshot = (): LopuStoreState => state;
export const getLopuStoreServerSnapshot = (): LopuStoreState => SERVER_SNAPSHOT;

/** Bind the viewer's API client (called by useLopuChat on every render — cheap). */
export const bindLopuApi = (next: LopuApiClient | null) => {
	client = next;
};

const notice = (title: string, options?: { description?: string; status?: LopuNotice['status'] }) => {
	noticeSeq += 1;
	setState((current) => ({
		notices: [...current.notices, { id: noticeSeq, title, description: options?.description, status: options?.status || 'info' }]
	}));
};

/** Drain queued notices — the first mounted hook toasts them via useLopu(). */
export const takeLopuNotices = (): LopuNotice[] => {
	if (!state.notices.length) return [];
	const notices = state.notices;
	setState({ notices: [] });
	return notices;
};

/** Drain the pending `navigate` path (consumed once by whichever hook runs first). */
export const takeLopuNavigation = (): string | null => {
	if (!state.pendingNavigate) return null;
	const path = state.pendingNavigate;
	setState({ pendingNavigate: null });
	return path;
};

const errorText = (error: unknown, fallback: string): string => {
	const record = error as { error?: unknown; message?: unknown } | null;
	if (record && typeof record.error === 'string' && record.error) return record.error;
	if (record && typeof record.message === 'string' && record.message) return record.message;
	return fallback;
};

const errorStatus = (error: unknown): number | null => {
	const status = (error as { status?: unknown } | null)?.status;
	return typeof status === 'number' ? status : null;
};

const uuid = (): string =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ——— settings ————————————————————————————————————————————————————————————————

const isAvailable = (model: AiModelPublic | undefined | null): boolean => !!model && model.available !== false && model.enabled !== false;

/**
 * Clamp a settings triple to the catalog: a known, available model (else the
 * server defaults, else the first available model), an effort that model
 * offers (prefer the requested, then the default, then 'high', then the last)
 * and a speed only when offered.
 */
export const reconcileLopuSettings = (
	requested: Partial<LopuChatSettings> | null | undefined,
	models: AiModelPublic[],
	defaults: LopuChatSettings | null
): LopuChatSettings => {
	if (!models.length) {
		return {
			model: requested?.model ?? defaults?.model ?? null,
			effort: requested?.effort ?? defaults?.effort ?? null,
			speed: requested?.speed ?? defaults?.speed ?? null
		};
	}
	const wanted = requested?.model ? models.find((model) => model.id === requested.model) : null;
	const fallback = defaults?.model ? models.find((model) => model.id === defaults.model) : null;
	const model = isAvailable(wanted) ? wanted : isAvailable(fallback) ? fallback : models.find(isAvailable) || null;
	if (!model) return { model: null, effort: null, speed: null };
	const efforts = Array.isArray(model.efforts) ? model.efforts : [];
	const speeds = Array.isArray(model.speeds) ? model.speeds : [];
	const effortCandidates = [requested?.effort, defaults?.effort, 'high'];
	const effort = effortCandidates.find((candidate): candidate is string => !!candidate && efforts.includes(candidate)) ?? efforts[efforts.length - 1] ?? null;
	const speedWanted = requested?.speed ?? defaults?.speed ?? 'normal';
	const speed = speeds.includes(speedWanted) ? speedWanted : speeds.includes('normal') ? 'normal' : speeds[0] ?? null;
	return { model: model.id, effort, speed };
};

const persistSettings = (userId: string | null, settings: LopuChatSettings) => {
	if (userId) writeLocalCache(lopuSettingsCacheKey(userId), settings);
};

export const setLopuSettings = (patch: Partial<LopuChatSettings>) => {
	const merged = { ...state.settings, ...patch };
	const settings = state.modelsLoaded || state.models.length ? reconcileLopuSettings(merged, state.models, state.defaults) : merged;
	if (settings.model === state.settings.model && settings.effort === state.settings.effort && settings.speed === state.settings.speed) return;
	persistSettings(state.userId, settings);
	setState({ settings });
};

// ——— hydration ————————————————————————————————————————————————————————————

/**
 * Seed the store for a viewer from localCache. Idempotent per user; safe to
 * call during render (no synchronous emit). A viewer change drops the
 * previous account's conversations and any in-flight turn.
 */
export const hydrateLopuStore = (userId: string | null): LopuStoreState => {
	if (state.hydrated && state.userId === userId) return state;
	if (state.streamingId && controller) {
		controller.abort();
		controller = null;
	}
	const chatsCache = userId ? readLocalCache<ChatsCache>(lopuChatsCacheKey(userId)) : null;
	const modelsCache = readLocalCache<ModelsCache>(LOPU_MODELS_CACHE_KEY);
	const settingsCache = userId ? readLocalCache<LopuChatSettings>(lopuSettingsCacheKey(userId)) : null;
	const models = Array.isArray(modelsCache?.models) ? modelsCache!.models : state.models;
	const defaults = modelsCache?.defaults && typeof modelsCache.defaults === 'object' ? modelsCache.defaults : state.defaults;
	const providers = modelsCache?.providers && typeof modelsCache.providers === 'object' ? modelsCache.providers : state.providers;
	state = {
		...createInitialState(),
		userId,
		hydrated: true,
		chats: Array.isArray(chatsCache?.chats) ? chatsCache!.chats : [],
		models,
		defaults,
		providers,
		settings: reconcileLopuSettings(settingsCache || defaults, models, defaults)
	};
	scheduleEmit();
	return state;
};

/** Seed a chat's messages from cache (render-safe, idempotent, no emit). */
export const seedLopuMessages = (chatId: string | null | undefined): void => {
	if (!chatId || state.messages[chatId]) return;
	const cached = readLocalCache<MessagesCache>(lopuMessagesCacheKey(chatId));
	if (!cached || !Array.isArray(cached.messages)) return;
	state = { ...state, messages: { ...state.messages, [chatId]: cached.messages } };
	scheduleEmit();
};

const writeMessagesCache = (chatId: string, messages: ChatMessage[]) => {
	writeLocalCache(lopuMessagesCacheKey(chatId), { at: Date.now(), messages: messages.slice(-LOPU_MESSAGES_CACHE_CAP) } satisfies MessagesCache);
};

const writeChatsCache = (userId: string | null, chats: LopuChatSummary[]) => {
	if (userId) writeLocalCache(lopuChatsCacheKey(userId), { at: Date.now(), chats } satisfies ChatsCache);
};

// ——— loaders ————————————————————————————————————————————————————————————————

export const loadLopuModels = async (): Promise<void> => {
	if (!client || state.modelsLoading) return;
	setState({ modelsLoading: true });
	try {
		const response = await client.models();
		const models: AiModelPublic[] = Array.isArray(response?.models) ? response.models : [];
		const defaults: LopuChatSettings | null = response?.defaults && typeof response.defaults === 'object' ? response.defaults : null;
		const providers: LopuProvidersInfo | null = response?.providers && typeof response.providers === 'object' ? response.providers : null;
		writeLocalCache(LOPU_MODELS_CACHE_KEY, { at: Date.now(), models, defaults, providers } satisfies ModelsCache);
		const settings = reconcileLopuSettings(state.settings, models, defaults);
		persistSettings(state.userId, settings);
		setState({ models, defaults, providers, modelsLoaded: true, modelsLoading: false, settings });
	} catch {
		setState({ modelsLoading: false, modelsLoaded: true });
	}
};

export const loadLopuChats = async (): Promise<void> => {
	if (!client || !state.userId || state.chatsLoading) return;
	const userId = state.userId;
	setState({ chatsLoading: true });
	try {
		const response = await client.chats.list();
		if (state.userId !== userId) return;
		const chats: LopuChatSummary[] = Array.isArray(response?.chats) ? response.chats : [];
		writeChatsCache(userId, chats);
		setState({ chats, chatsLoaded: true, chatsLoading: false });
	} catch (error) {
		if (state.userId !== userId) return;
		setState({ chatsLoading: false, chatsLoaded: true, error: errorText(error, 'Could not load your conversations') });
	}
};

const messagesLoading = new Set<string>();

export const loadLopuMessages = async (chatId: string): Promise<void> => {
	if (!client || !chatId || messagesLoading.has(chatId)) return;
	messagesLoading.add(chatId);
	try {
		const response = await client.messages({ chatId, limit: LOPU_MESSAGES_CACHE_CAP });
		const rows: ChatMessage[] = Array.isArray(response?.messages) ? response.messages : [];
		// the API pages newest-first; the timeline reads oldest-first. The
		// server's rows replace any optimistic Lopu rows (their ids differ).
		const incoming = rows.slice().reverse();
		const merged = mergeMessages((state.messages[chatId] || []).filter((message) => !isOptimisticLopuMessage(message)), incoming);
		writeMessagesCache(chatId, merged);
		setState((current) => ({
			messages: { ...current.messages, [chatId]: merged },
			messagesLoaded: { ...current.messagesLoaded, [chatId]: true }
		}));
	} catch (error) {
		const status = errorStatus(error);
		if ((status === 403 || status === 404) && state.activeChatId === chatId) {
			setState((current) => ({
				activeChatId: null,
				chats: current.chats.filter((chat) => chat.id !== chatId),
				messagesLoaded: { ...current.messagesLoaded, [chatId]: true }
			}));
			notice('That conversation is gone', { description: 'Starting a fresh one.', status: 'info' });
		} else {
			setState((current) => ({ messagesLoaded: { ...current.messagesLoaded, [chatId]: true } }));
		}
	} finally {
		messagesLoading.delete(chatId);
	}
};

// ——— selection ————————————————————————————————————————————————————————————

const settingsFromChat = (chat: LopuChatSummary | undefined): Partial<LopuChatSettings> | null => {
	const raw = (chat as { lopu?: unknown; settings?: unknown } | undefined)?.lopu ?? (chat as { settings?: unknown } | undefined)?.settings;
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Record<string, unknown>;
	const out: Partial<LopuChatSettings> = {};
	if (typeof record.model === 'string') out.model = record.model;
	if (typeof record.effort === 'string') out.effort = record.effort;
	if (typeof record.speed === 'string') out.speed = record.speed;
	return Object.keys(out).length ? out : null;
};

/**
 * Make a conversation current (null = a fresh, not-yet-created one). Adopts
 * the chat's own model settings when it carries them. Render-safe when
 * `silent` (the page primes the route param before its first paint).
 */
export const selectLopuChat = (chatId: string | null, options?: { silent?: boolean }): void => {
	if (state.activeChatId === chatId) return;
	seedLopuMessages(chatId);
	const chat = chatId ? state.chats.find((entry) => entry.id === chatId) : undefined;
	const fromChat = settingsFromChat(chat);
	const settings = fromChat ? reconcileLopuSettings({ ...state.settings, ...fromChat }, state.models, state.defaults) : state.settings;
	const next = { activeChatId: chatId, settings };
	if (options?.silent) {
		state = { ...state, ...next };
		scheduleEmit();
		return;
	}
	setState(next);
};

// ——— conversation CRUD ————————————————————————————————————————————————————

export const createLopuChat = async (args?: { title?: string }): Promise<{ ok: boolean; chat?: LopuChatSummary; error?: string }> => {
	if (!client) return { ok: false, error: 'Lopu is not connected yet' };
	try {
		const response = await client.chats.create({
			...(args?.title ? { title: args.title } : {}),
			...(state.settings.model ? { model: state.settings.model } : {}),
			...(state.settings.effort ? { effort: state.settings.effort } : {}),
			...(state.settings.speed ? { speed: state.settings.speed } : {})
		});
		const chat: LopuChatSummary | null = response?.chat && typeof response.chat === 'object' ? response.chat : null;
		if (!chat) return { ok: false, error: errorText(response, 'Could not start a chat') };
		setState((current) => {
			const chats = [chat, ...current.chats.filter((entry) => entry.id !== chat.id)];
			writeChatsCache(current.userId, chats);
			return { chats, activeChatId: chat.id };
		});
		return { ok: true, chat };
	} catch (error) {
		const message = errorText(error, 'Could not start a chat');
		notice(message, { status: 'error' });
		return { ok: false, error: message };
	}
};

export const renameLopuChat = async (chatId: string, title: string): Promise<{ ok: boolean; error?: string }> => {
	if (!client) return { ok: false, error: 'Lopu is not connected yet' };
	const trimmed = title.trim().slice(0, 120);
	if (!trimmed) return { ok: false, error: 'A name is required' };
	const previous = state.chats;
	setState((current) => {
		const chats = current.chats.map((chat) => (chat.id === chatId ? { ...chat, name: trimmed } : chat));
		writeChatsCache(current.userId, chats);
		return { chats };
	});
	try {
		const response = await client.chats.update({ chatId, title: trimmed });
		const chat: LopuChatSummary | null = response?.chat && typeof response.chat === 'object' ? response.chat : null;
		if (chat) {
			setState((current) => {
				const chats = current.chats.map((entry) => (entry.id === chatId ? { ...entry, ...chat } : entry));
				writeChatsCache(current.userId, chats);
				return { chats };
			});
		}
		return { ok: true };
	} catch (error) {
		setState((current) => ({ chats: current.userId ? previous : current.chats }));
		const message = errorText(error, 'Could not rename the chat');
		notice(message, { status: 'error' });
		return { ok: false, error: message };
	}
};

export const deleteLopuChat = async (chatId: string): Promise<{ ok: boolean; error?: string }> => {
	if (!client) return { ok: false, error: 'Lopu is not connected yet' };
	if (state.streamingId && state.turns[state.streamingId]?.chatId === chatId) abortLopuTurn();
	const previous = state;
	setState((current) => {
		const chats = current.chats.filter((chat) => chat.id !== chatId);
		writeChatsCache(current.userId, chats);
		const messages = { ...current.messages };
		delete messages[chatId];
		return { chats, messages, activeChatId: current.activeChatId === chatId ? null : current.activeChatId };
	});
	try {
		await client.chats.delete({ chatId });
		writeLocalCache(lopuMessagesCacheKey(chatId), { at: Date.now(), messages: [] } satisfies MessagesCache);
		return { ok: true };
	} catch (error) {
		setState({ chats: previous.chats, messages: previous.messages, activeChatId: previous.activeChatId });
		const message = errorText(error, 'Could not delete the chat');
		notice(message, { status: 'error' });
		return { ok: false, error: message };
	}
};

// ——— live-build bridge (design note §2.5) ————————————————————————————————

/** The active editable draft's display name for the composer's context chip (cheap — no block walk). */
export const activeDraftLabel = (): string | null => {
	try {
		const draft = getActiveWebpageDraft();
		if (!draft) return null;
		return (typeof draft.name === 'string' && draft.name) || draft.pageKey || draft.siteRoute || 'this page';
	} catch {
		return null;
	}
};

/** The active builder draft as the reply request's `context.page` (+ a label for the chip). */
export const describeActiveDraft = (): { page: NonNullable<LopuReplyContext['page']> & { name?: string }; label: string } | null => {
	let draft: LopuDraftHandle | null = null;
	let page: ReturnType<typeof describeActiveWebpageDraft> = null;
	try {
		draft = getActiveWebpageDraft();
		page = describeActiveWebpageDraft();
	} catch {
		return null;
	}
	if (!draft || !page) return null;
	const label = (typeof draft.name === 'string' && draft.name) || page.pageKey || page.siteRoute || 'this page';
	// the reply body caps context.page.blocks at 48KB — past that the server
	// resolves the page by id instead of the live draft
	let blocks: WebpageBlock[] | undefined = page.blocks;
	try {
		if (blocks && JSON.stringify(blocks).length > LOPU_CONTEXT_BLOCKS_MAX_CHARS) blocks = undefined;
	} catch {
		blocks = undefined;
	}
	const { blocks: _blocks, ...rest } = page;
	return { page: { ...rest, name: label, ...(blocks ? { blocks } : {}) }, label };
};

// Undo: what the draft showed before Lopu's first paint for a tool call.
// Keyed by tool call id, pinned to the page the paint landed on.
const undoSnapshots = new Map<string, { draft: LopuDraftHandle; pageId: string | null; before: WebpageBlock[] }>();
// tool call id → the component ref an update_component stream is rebuilding
const streamingComponentRefs = new Map<string, string>();

const snapshotForUndo = (toolId: string, target: LopuPatchTarget | undefined, pageId?: string | null) => {
	if (undoSnapshots.has(toolId)) return;
	let draft: LopuDraftHandle | null = null;
	try {
		draft = resolveLopuDraft(target ?? 'active', pageId).draft;
	} catch {
		draft = null;
	}
	if (!draft || !Array.isArray(draft.blocks)) return;
	undoSnapshots.set(toolId, { draft, pageId: draft.id ?? null, before: draft.blocks });
	if (undoSnapshots.size > LOPU_TURNS_CAP) undoSnapshots.delete(undoSnapshots.keys().next().value as string);
};

const draftStillMounted = (draft: LopuDraftHandle): boolean => {
	try {
		return getActiveWebpageDraft() === draft || resolveLopuDraft(draft.id ? { id: draft.id } : 'active', draft.id).draft === draft;
	} catch {
		return false;
	}
};

/** True while the draft a patch landed on is still mounted (so Undo can restore it). */
export const canUndoLopuPatch = (toolId: string): boolean => {
	const snapshot = undoSnapshots.get(toolId);
	if (!snapshot) return false;
	return draftStillMounted(snapshot.draft) && (snapshot.draft.id ?? null) === snapshot.pageId;
};

export const undoLopuPatch = (toolId: string): boolean => {
	if (!canUndoLopuPatch(toolId)) return false;
	const snapshot = undoSnapshots.get(toolId)!;
	try {
		discardLopuPartialPageOps(toolId, { revert: false });
		snapshot.draft.setBlocks(snapshot.before);
	} catch {
		return false;
	}
	undoSnapshots.delete(toolId);
	// bump so cards re-evaluate canUndo
	setState((current) => ({ version: current.version + 1 }));
	return true;
};

const safeParsePartial = (text: string): { value: unknown; complete: boolean } | null => {
	if (!text) return null;
	try {
		const parsed = parsePartialJson(text);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
};

const normalizeTarget = (target: unknown): LopuPatchTarget => {
	if (target && typeof target === 'object' && typeof (target as { id?: unknown }).id === 'string') return { id: (target as { id: string }).id };
	return 'active';
};

// §2.5: while patch_page streams, ops whose JSON has already closed inside the
// partial array land on the draft one by one — the page grows block by block
const applyStreamingPatchOps = (activity: LopuToolActivity) => {
	const parsed = safeParsePartial(activity.partialInput);
	const value = parsed?.value as { target?: unknown; ops?: unknown } | null;
	if (!parsed || !value || typeof value !== 'object' || !Array.isArray(value.ops)) return;
	const target = normalizeTarget(value.target);
	snapshotForUndo(activity.id, target);
	try {
		applyLopuPartialPageOps(value.ops, { id: activity.id, target, complete: parsed.complete });
	} catch {
		// the bridge is defensive; a throw here must never kill the stream
	}
};

// §2.5: update_component on a component that is on the active page rebuilds
// visibly token by token (the bridge coalesces to one paint per frame)
const pushStreamingComponentRender = (activity: LopuToolActivity) => {
	const parsed = safeParsePartial(activity.partialInput);
	const value = parsed?.value as { id?: unknown; render?: unknown } | null;
	if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.render === undefined || value.render === null) return;
	streamingComponentRefs.set(activity.id, value.id);
	try {
		applyLopuPartialComponent(value.id, value.render);
	} catch {
		// ditto
	}
};

// A tool call that never completed (refused, aborted): put the page back.
const discardToolPaint = (toolId: string) => {
	try {
		discardLopuPartialPageOps(toolId, { revert: true });
	} catch {
		// ignore
	}
	const ref = streamingComponentRefs.get(toolId);
	if (ref) {
		streamingComponentRefs.delete(toolId);
		try {
			discardLopuPartialComponent(ref);
		} catch {
			// ignore
		}
	}
	undoSnapshots.delete(toolId);
};

const safeApplyThing = (thing: LopuThingLike) => {
	try {
		applyLopuThingEvent(thing as any);
	} catch {
		// ditto
	}
};

// ——— the streamed turn ————————————————————————————————————————————————————

const rememberTurn = (turn: LopuTurnState) => {
	setState((current) => {
		const turns = { ...current.turns, [turn.requestId]: turn };
		let turnOrder = current.turnOrder.includes(turn.requestId) ? current.turnOrder : [...current.turnOrder, turn.requestId];
		while (turnOrder.length > LOPU_TURNS_CAP) {
			const oldest = turnOrder[0];
			if (oldest === current.streamingId) break;
			turnOrder = turnOrder.slice(1);
			delete turns[oldest];
		}
		return { turns, turnOrder };
	});
};

const forgetTurn = (requestId: string) => {
	setState((current) => {
		const turns = { ...current.turns };
		delete turns[requestId];
		return { turns, turnOrder: current.turnOrder.filter((id) => id !== requestId), streamingId: current.streamingId === requestId ? null : current.streamingId };
	});
};

const upsertChatSummary = (chatId: string, turn: LopuTurnState, assistantRows: ChatMessage[]) => {
	setState((current) => {
		const existing = current.chats.find((chat) => chat.id === chatId);
		const now = new Date().toISOString();
		const preview = assistantRows[assistantRows.length - 1];
		const lastMessage = preview
			? {
					id: preview.id,
					authorId: preview.authorId,
					authorName: 'Lopu',
					text: preview.text.slice(0, 160),
					deleted: false,
					systemType: null,
					attachmentCount: 0,
					createdAt: preview.createdAt,
					externalSource: preview.externalSource ?? null
			  }
			: existing?.lastMessage ?? null;
		const base: LopuChatSummary = existing ?? {
			id: chatId,
			chatType: 'group',
			name: chatTitleFromText(turn.userText),
			topic: 'Lopu, the Thingtime assistant',
			communityId: null,
			sectionId: null,
			channelVisibility: null,
			createdBy: current.userId || '',
			createdAt: now,
			updatedAt: now,
			myMember: null,
			members: null,
			memberCount: 1,
			unreadCount: 0,
			lastMessage: null,
			externalSource: { access: 'lopu', provider: 'lopu', sourceId: 'lopu', label: 'Lopu', connector: 'thingtime', readOnly: false } as unknown as ChatSummary['externalSource']
		};
		const updated: LopuChatSummary = {
			...base,
			updatedAt: now,
			lastMessage,
			lopu: { ...(base.lopu || {}), ...(turn.meta ? { model: turn.meta.model, effort: turn.meta.effort, speed: turn.meta.speed, lastModel: turn.meta.model } : {}) }
		};
		const chats = [updated, ...current.chats.filter((chat) => chat.id !== chatId)];
		writeChatsCache(current.userId, chats);
		return { chats };
	});
};

const appendMessages = (chatId: string, rows: ChatMessage[]) => {
	if (!rows.length) return;
	setState((current) => {
		const merged = mergeMessages(current.messages[chatId] || [], rows);
		writeMessagesCache(chatId, merged);
		return { messages: { ...current.messages, [chatId]: merged } };
	});
};

export type SendLopuOptions = {
	settings?: Partial<LopuChatSettings>;
	context?: LopuReplyContext;
	// apply Lopu's builder patches to the mounted draft live (settings.lopu.applyPatches)
	applyPatches?: boolean;
};

export type SendLopuResult = { ok: true; requestId: string; chatId: string | null } | { ok: false; error: string; text: string };

/**
 * Send one turn: stream the reply, fold every event into the turn state,
 * bridge patches/things to the builder, and commit the persisted rows when
 * `done` lands. Resolves after the stream ends (or fails).
 */
export const sendLopuMessage = async (text: string, options: SendLopuOptions = {}): Promise<SendLopuResult> => {
	const trimmed = (text || '').trim();
	if (!trimmed) return { ok: false, error: 'Say something first', text };
	if (!client) return { ok: false, error: 'Lopu is not connected yet', text };
	if (!state.userId) {
		notice('Sign in to chat with Lopu 🦄', { status: 'info' });
		return { ok: false, error: 'Sign in to chat with Lopu', text };
	}
	if (state.streamingId && isLopuTurnActive(state.turns[state.streamingId])) {
		notice('Lopu is still replying — stop her first or wait a moment ✨', { status: 'info' });
		return { ok: false, error: 'Lopu is still replying', text };
	}

	const userId = state.userId;
	const requestId = uuid();
	const chatId = state.activeChatId;
	const settings = reconcileLopuSettings({ ...state.settings, ...(options.settings || {}) }, state.models, state.defaults);
	if (options.settings && Object.keys(options.settings).length) {
		persistSettings(userId, settings);
		setState({ settings });
	}
	const applyPatches = options.applyPatches !== false;

	let turn = initialLopuTurn({ requestId, chatId, userText: trimmed });
	const abort = new AbortController();
	controller = abort;
	rememberTurn(turn);
	setState({ streamingId: requestId, sending: true, error: null });

	const commit = (next: LopuTurnState) => {
		turn = next;
		// a viewer change mid-stream (logout/switch) must not leak this turn
		// into the next account's store
		if (state.userId !== userId) return;
		setState((current) => ({ turns: { ...current.turns, [requestId]: next } }));
	};

	const onEvent = (event: LopuChatEvent) => {
		const before = turn;
		const next = reduceLopuTurn(before, event);
		if (next === before) return;
		commit(next);
		switch (event.type) {
			case 'meta': {
				const id = next.chatId;
				if (!id) break;
				if (state.activeChatId !== id && (state.activeChatId === chatId || state.activeChatId === null)) {
					setState({ activeChatId: id });
				}
				appendMessages(id, [buildUserMessage(next, userId, id)]);
				if (!state.chats.some((chat) => chat.id === id)) upsertChatSummary(id, next, []);
				break;
			}
			case 'tool_input_delta': {
				if (!applyPatches) break;
				const activity = next.tools.find((tool) => tool.id === event.id);
				if (!activity) break;
				if (activity.name === 'patch_page') applyStreamingPatchOps(activity);
				else if (activity.name === 'update_component') pushStreamingComponentRender(activity);
				break;
			}
			case 'tool_result': {
				// a refused tool call whose paint already landed is rolled back;
				// a successful one forgets its partial-component bookkeeping (the
				// final `thing` event swapped the saved version in)
				if (!event.ok) discardToolPaint(event.id);
				else streamingComponentRefs.delete(event.id);
				break;
			}
			case 'patch': {
				if (!applyPatches) break;
				const target = event.target ?? 'active';
				snapshotForUndo(event.id, target, event.pageId);
				try {
					applyLopuPatchEvent({ type: 'patch', id: event.id, target, ops: event.ops, pageId: event.pageId ?? null, persisted: event.persisted === true });
				} catch {
					// never let a bridge throw kill the stream
				}
				break;
			}
			case 'thing': {
				if (event.thing && typeof event.thing === 'object') safeApplyThing(event.thing as LopuThingLike);
				break;
			}
			case 'navigate': {
				if (next.navigate) setState((current) => ({ pendingNavigate: next.navigate, navigateSeq: current.navigateSeq + 1 }));
				break;
			}
			case 'error': {
				notice(event.message || 'Lopu hit a snag', { status: 'error', description: event.retryable ? 'You can try again.' : undefined });
				break;
			}
			default:
				break;
		}
	};

	const body: LopuReplyBody = {
		...(chatId ? { chatId } : {}),
		text: trimmed,
		requestId,
		...(settings.model ? { model: settings.model } : {}),
		...(settings.effort ? { effort: settings.effort } : {}),
		...(settings.speed ? { speed: settings.speed } : {}),
		...(options.context ? { context: options.context } : {})
	};

	let failure: string | null = null;
	try {
		const response = await client.reply(body, { signal: abort.signal });
		await readNdjson(response, onEvent, abort.signal);
		if (turn.status === 'streaming') commit(markLopuTurnFailed(turn, 'Lopu got cut off before finishing', true));
	} catch (error) {
		if (isAbortError(error) || abort.signal.aborted) {
			commit(markLopuTurnAborted(turn));
		} else {
			failure = errorText(error, 'Lopu is daydreaming… try again 🔮');
			commit(markLopuTurnFailed(turn, failure, true));
		}
	} finally {
		if (controller === abort) controller = null;
	}

	// paints from tool calls that never finished go back to how the page was
	for (const tool of turn.tools) if (tool.status === 'error' && !tool.result) discardToolPaint(tool.id);

	if (state.userId !== userId) return { ok: false, error: 'The account changed while Lopu was replying', text: trimmed };

	const finalChatId = turn.chatId;
	if (!turn.meta || !finalChatId) {
		// nothing persisted server-side that we know of — drop the turn, hand
		// the text back to the composer, and say why
		forgetTurn(requestId);
		setState({ sending: false, streamingId: null, error: failure });
		if (failure) notice(failure, { status: 'error' });
		return { ok: false, error: failure || 'Lopu did not reply', text: trimmed };
	}

	const assistantRows = buildAssistantMessages(turn, userId);
	appendMessages(finalChatId, assistantRows);
	upsertChatSummary(finalChatId, turn, assistantRows);
	setState({ sending: false, streamingId: null, error: failure });
	if (failure) notice(failure, { status: 'error' });
	// reconcile with the server's view in the background: a chat this turn
	// created gets its server title/settings; a cut-off turn gets whatever
	// the server managed to persist (the turn bubble absorbs those rows)
	if (!chatId) void loadLopuChats();
	if (!turn.messages.length) void loadLopuMessages(finalChatId);
	return { ok: true, requestId, chatId: finalChatId };
};

/** Stop the in-flight reply (what streamed so far is kept). */
export const abortLopuTurn = (): void => {
	if (controller) controller.abort();
};

// ——— selectors ———————————————————————————————————————————————————————————

export const selectLopuStreaming = (snapshot: LopuStoreState): LopuTurnState | null =>
	snapshot.streamingId ? snapshot.turns[snapshot.streamingId] ?? null : null;

export const selectLopuTurnsForChat = (snapshot: LopuStoreState, chatId: string | null): LopuTurnState[] =>
	snapshot.turnOrder.map((id) => snapshot.turns[id]).filter((turn): turn is LopuTurnState => !!turn && turn.chatId === chatId);

export const selectLopuChatSummary = (snapshot: LopuStoreState, chatId: string | null): LopuChatSummary | null =>
	chatId ? snapshot.chats.find((chat) => chat.id === chatId) ?? null : null;

export const selectLopuMessages = (snapshot: LopuStoreState, chatId: string | null): ChatMessage[] =>
	chatId ? snapshot.messages[chatId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES;

/** Test/HMR hook: reset the module state (never called by the app). */
export const resetLopuStoreForTests = () => {
	if (controller) controller.abort();
	controller = null;
	client = null;
	undoSnapshots.clear();
	streamingComponentRefs.clear();
	state = createInitialState();
	emit();
};
