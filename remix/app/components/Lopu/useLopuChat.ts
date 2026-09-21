import { syncNativeLopuChatActivity } from '~/utils/lopuChatActivity';
import { getAiTasks, getAiTaskContextKey, getServerAiTasks, subscribeAiTasks } from './aiTasks.client';
import { addLopuQueueMessage, drainLopuQueue, getLopuQueue, subscribeLopuQueue } from './lopuQueueStore';
import { sendAiTaskNote, getAiTasks as queueTasks, refreshAiTasks as refreshQueueTasks } from './aiTasks.client';
// useLopuChat (design note §3.1) — the ONE React hook every Lopu surface uses
// (the /lopu page, the floating window, the Messenger pane). It is a thin
// React binding over lopuChatStore: it hands the store the viewer's API
// client, seeds the store from localCache during render (optimistic first
// paint), refetches in the background, forwards store notices to the Lopu
// toast, performs `navigate` events with the router, and keeps the viewer's
// model preference (settings.lopu.* via useLopuSettings) and the store's
// per-chat settings in step. Also exports the §3.3 context-provider builder.

import React from 'react';
import { useLopuCurrentPage } from './useLopuPages';
import { useBackgroundRefresh } from '~/hooks/useBackgroundRefresh';
import { useNavigate } from 'react-router';

import { useMessengerApi } from '~/components/Messenger/useMessengerApi';
import type { ChatMessage } from '~/components/Messenger/messengerTypes';
import { useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { getWebpageDraftsVersion, subscribeWebpageDrafts } from './lopuBuildBridge';
import {
	resumeLopuChat,
	abortLopuTurn,
	archiveLopuChat,
	recoverLopuBackgroundTasks,
	activeDraftLabel,
	bindLopuApi,
	canUndoLopuPatch,
	confirmLopuTool,
	createLopuChat,
	declineLopuTool,
	deleteLopuChat,
	describeActiveDraft,
	getLopuStoreServerSnapshot,
	getLopuStoreSnapshot,
	hydrateLopuStore,
	loadLopuChats,
	loadLopuMessages,
	loadLopuModels,
	renameLopuChat,
	selectLopuChat,
	selectLopuChatSummary,
	selectLopuMessages,
	selectLopuModelLabels,
	selectLopuProviderNames,
	selectLopuTurnsForChat,
	sendLopuMessage,
	setLopuSettings,
	subscribeLopuStore,
	takeLopuNavigation,
	takeLopuNotices,
	undoLopuPatch,
	type AiModelPublic,
	type LopuChatDefaults,
	type LopuChatSettings,
	type LopuChatSummary,
	type LopuVaultInfo,
	type LopuVaultProvider,
	type SendLopuResult
} from './lopuChatStore';
import type { LopuReplyContext } from './lopuChatStream';
import { buildLopuTimeline, type LopuTimelineItem, type LopuTurnState } from './lopuTurnCore';
import { useLopu } from './useLopu';
import { useLopuAccount, type UseLopuAccount } from './useLopuAccount';
import { useLopuSettings } from './useLopuSettings';

// ——— §3.3 context provider ————————————————————————————————————————————————

export type LopuContext = LopuReplyContext;
export type LopuContextProvider = () => LopuContext;

/**
 * Build the reply request's `context`: the route, the active builder draft
 * (id/source/keys/updatedAt/live blocks ≤ 48KB) from the live-build bridge,
 * the selected block and the viewport. Pure apart from reading the bridge.
 */
export const buildLopuContext = (base?: Partial<LopuContext>, attachCurrentPage = true): LopuContext => {
	const draft = attachCurrentPage ? describeActiveDraft() : null;
	return {
		...(attachCurrentPage && base?.route ? { route: base.route } : {}),
		...(base?.pages?.length ? { pages: base.pages } : {}),
		...(draft ? { page: draft.page } : {}),
		...(attachCurrentPage && base?.selectedBlockId ? { selectedBlockId: base.selectedBlockId } : {}),
		...(base?.viewport ? { viewport: base.viewport } : {})
	};
};

/** A provider that captures static bits now and reads the live draft on every send. */
export const createLopuContextProvider = (base?: Partial<LopuContext>): LopuContextProvider => () => buildLopuContext(base);

/** The default provider: current route + viewport, the active draft read live. */
export const useLopuContextProvider = (extra?: { selectedBlockId?: string | null }): LopuContextProvider => {
	const currentPage = useLopuCurrentPage();
	const { settings } = useLopuSettings();
	const isMobile = useIsMobileViewport();
	const route = currentPage && currentPage.url.length <= 300 ? currentPage.url : undefined;
	const attach = settings.attachCurrentPage && !!currentPage;
	const selectedBlockId = extra?.selectedBlockId ?? null;
	return React.useCallback(
		() => buildLopuContext({ route, pages: attach && currentPage ? [currentPage] : [], viewport: isMobile ? 'mobile' : 'desktop', ...(selectedBlockId ? { selectedBlockId } : {}) }, attach),
		[route, isMobile, selectedBlockId, attach, currentPage]
	);
};

// re-render when builder drafts mount/unmount so the context chip tracks them
const serverDraftsVersion = () => 0;
export const useActiveDraftLabel = (): string | null => {
	React.useSyncExternalStore(subscribeWebpageDrafts, getWebpageDraftsVersion, serverDraftsVersion);
	return activeDraftLabel();
};

// ——— the hook ————————————————————————————————————————————————————————————

export type UseLopuChatOptions = {
	// a specific conversation to show (null = a fresh one); undefined follows
	// the shared store's current conversation (the floating window)
	chatId?: string | null;
	context?: LopuContextProvider;
	// override settings.lopu.applyPatches for this surface
	applyPatches?: boolean;
};

export type LopuViewer = { id: string | null; signedIn: boolean; temporary: boolean; admin: boolean };

export type UseLopuChat = {
 queue: ReturnType<typeof getLopuQueue>;
 enqueue: (text: string, attachments?: { attachmentIds?: string[]; attachments?: ChatMessage['attachments']; thingIds?: string[] }) => void;
 sendNote: (text: string, noteId: string) => Promise<any>;
	viewer: LopuViewer;
	chats: LopuChatSummary[];
	chatsLoaded: boolean;
	chat: LopuChatSummary | null;
	chatId: string | null;
	messages: ReturnType<typeof selectLopuMessages>;
	turns: LopuTurnState[];
	timeline: LopuTimelineItem[];
	streaming: LopuTurnState | null;
	sending: boolean;
	send: (text: string, overrides?: Partial<LopuChatSettings>, attachments?: { attachmentIds?: string[]; attachments?: ChatMessage['attachments']; thingIds?: string[]; onAccepted?: () => void }) => Promise<SendLopuResult>;
	resume: (requestId: string) => Promise<SendLopuResult>;
	abort: () => void;
	selectChat: (chatId: string | null) => void;
	createChat: (args?: { title?: string }) => ReturnType<typeof createLopuChat>;
	archiveChat: typeof archiveLopuChat;
	deleteChat: (chatId: string) => ReturnType<typeof deleteLopuChat>;
	renameChat: (chatId: string, title: string) => ReturnType<typeof renameLopuChat>;
	models: AiModelPublic[];
	modelsLoading: boolean;
	modelsLoaded: boolean;
	defaults: LopuChatDefaults | null;
	// the viewer's own Secure Vault providers (metadata only) + vault status
	vaultProviders: LopuVaultProvider[];
	vault: LopuVaultInfo | null;
	// { model, effort, speed, providerId } — providerId (a vault provider) wins
	settings: LopuChatSettings;
	setSettings: (patch: Partial<LopuChatSettings>) => void;
	// id → label / name lookups for status lines
	modelLabels: Record<string, string>;
	providerNames: Record<string, string>;
	preferences: { applyPatches: boolean; enterSends: boolean; confirmDeletes: boolean };
	setPreferences: (patch: Partial<{ applyPatches: boolean; enterSends: boolean; confirmDeletes: boolean }>) => void;
	contextLabel: string | null;
	undoPatch: (toolId: string) => boolean;
	canUndoPatch: (toolId: string) => boolean;
	// a tool card's Confirm / Cancel (design note §2.4): confirm sends the
	// grant back as a new turn, decline retires the card locally
	confirmTool: (requestId: string, toolId: string) => Promise<SendLopuResult>;
	declineTool: (requestId: string, toolId: string) => void;
	// the viewer's Lopu account + access rules (verified flag, credits) —
	// `account.access.locked` is what every surface draws LopuLockedState on
	account: UseLopuAccount;
	// the composer's current choice thinks with the viewer's own provider
	// (Thingtime credits are not used for that turn)
	byo: boolean;
	error: string | null;
};

export const useLopuChat = (options: UseLopuChatOptions = {}): UseLopuChat => {
	const user = useCurrentUser();
	const userId = user?.id ?? null;
	const api = useApi();
	const messenger = useMessengerApi();
	const lopu = useLopu();
	const navigate = useNavigate();
	const { settings: prefs, setModelChoice, setEnterSends, setApplyPatches, setConfirmDeletes, setManagement } = useLopuSettings();
	const defaultContext = useLopuContextProvider();
	const contextProvider = options.context ?? defaultContext;
	const activeLabel = useActiveDraftLabel();
	const contextLabel = prefs.attachCurrentPage ? activeLabel : null;

	// the store's client: useApi's Lopu family + the messenger's message page
	bindLopuApi({
		models: api.v1.ai.models,
		chats: api.v1.lopu.chats,
		messages: messenger.messages,
		reply: api.v1.lopu.reply
	});

	// Seed during render (idempotent, no synchronous emit) so the very first
	// paint shows the cached conversations/messages — never a spinner over
	// known state. A route-provided chat id is primed the same way.
	const requestedChatId = options.chatId;
	React.useMemo(() => {
		hydrateLopuStore(userId);
		if (requestedChatId !== undefined) selectLopuChat(requestedChatId, { silent: true });
	}, [userId, requestedChatId]);

	const snapshot = React.useSyncExternalStore(subscribeLopuStore, getLopuStoreSnapshot, getLopuStoreServerSnapshot);
	const activeChatId = snapshot.activeChatId;
 const tasks = React.useSyncExternalStore(subscribeAiTasks, getAiTasks, getServerAiTasks);
 React.useEffect(() => {
  const sync = () => {
   const active = new Map<string, { chatId: string; status: 'running' | 'retrying'; management: 'server' | 'client' }>();
   for (const task of getAiTasks()) if (task.chatId && !active.has(task.chatId) && (task.status === 'running' || task.workflowStatus === 'running')) active.set(task.chatId, { chatId: task.chatId, status: task.status === 'running' ? 'running' : 'retrying', management: task.management || 'client' });
   for (const chatId of snapshot.recoveryChatIds) if (!active.has(chatId)) active.set(chatId, { chatId, status: 'retrying', management: 'client' });
   syncNativeLopuChatActivity({ ownerId: userId, contextKey: getAiTaskContextKey(), chats: [...active.values()] });
  };
  sync(); window.addEventListener('thingtime:native-bridge-ready', sync); document.addEventListener('visibilitychange', sync);
  return () => { window.removeEventListener('thingtime:native-bridge-ready', sync); document.removeEventListener('visibilitychange', sync); };
 }, [tasks, userId, snapshot.recoveryChatIds]);

	// the viewer's account / access rules ride along with every surface; a
	// pinned vault provider makes the turn BYO (the gate lets it through when
	// the admin allows unverified BYO, and the chip reads "your provider")
	const byo = !!snapshot.settings.providerId;
	const account = useLopuAccount({ byo });

	useBackgroundRefresh(userId ? `lopu-tasks:${userId}` : null, recoverLopuBackgroundTasks, 3000);
	useBackgroundRefresh(userId ? `lopu-chats:${userId}` : null, () => loadLopuChats({ quiet: true }));
	useBackgroundRefresh(userId && activeChatId ? `lopu-messages:${userId}:${activeChatId}` : null,
		() => activeChatId ? loadLopuMessages(activeChatId) : undefined, 5000);

	React.useEffect(() => {
		if (userId) void loadLopuModels();
	}, [userId]);

	const loadedForChat = activeChatId ? snapshot.messagesLoaded[activeChatId] : true;
	React.useEffect(() => {
		if (!userId || !activeChatId || loadedForChat) return;
		void loadLopuMessages(activeChatId);
	}, [userId, activeChatId, loadedForChat]);

	// the viewer's preference (settings.lopu.*) feeds the store; a chat's own
	// settings can still override it while that chat is selected
	React.useEffect(() => {
		const patch: Partial<LopuChatSettings> = { management: prefs.management };
		if (prefs.model) patch.model = prefs.model;
		if (prefs.effort) patch.effort = prefs.effort;
		if (prefs.speed) patch.speed = prefs.speed;
		if (Object.keys(patch).length) setLopuSettings(patch);
	}, [prefs.model, prefs.effort, prefs.speed, prefs.management]);

	// notices → the Lopu toast (the first mounted hook drains them)
	const noticeCount = snapshot.notices.length;
	React.useEffect(() => {
		if (!noticeCount) return;
		for (const entry of takeLopuNotices()) {
			lopu({ title: entry.title, description: entry.description, status: entry.status });
		}
	}, [noticeCount, lopu]);

	// `navigate` tool events → the router (consumed once)
	const navigateSeq = snapshot.navigateSeq;
	React.useEffect(() => {
		if (!navigateSeq) return;
		const path = takeLopuNavigation();
		if (path) navigate(path);
	}, [navigateSeq, navigate]);

	const applyPatches = options.applyPatches ?? prefs.applyPatches;
	const send = React.useCallback(
		(text: string, overrides?: Partial<LopuChatSettings>, attachments?: { attachmentIds?: string[]; attachments?: ChatMessage['attachments']; thingIds?: string[]; onAccepted?: () => void }) =>
			sendLopuMessage(text, {
				...attachments,
				...(overrides ? { settings: overrides } : {}),
				context: contextProvider(),
				applyPatches
			}),
		[contextProvider, applyPatches]
	);

 const queue = React.useSyncExternalStore(subscribeLopuQueue, getLopuQueue, getLopuQueue);
 const enqueue = React.useCallback((text: string, attachments: any = {}) => {
  if (!activeChatId) throw new Error('Wait for the conversation to start before queuing a message.');
  addLopuQueueMessage(activeChatId, text, { ...attachments, settings: { ...snapshot.settings }, context: contextProvider(), applyPatches });
 }, [activeChatId, snapshot.settings, contextProvider, applyPatches]);
 const noteTargets = React.useRef(new Map<string, { owner: string | null; chatId: string | null; taskId: string }>());
 const sendNote = React.useCallback(async (text: string, noteId: string) => {
  await refreshQueueTasks();
  const owner = snapshot.userId;
  if (getLopuStoreSnapshot().userId !== owner) throw new Error('The account changed before the note was sent.');
  const existing = noteTargets.current.get(noteId);
  const task = existing?.owner === owner && existing?.chatId === activeChatId ? { id: existing.taskId } : queueTasks().find(task => task.chatId === activeChatId && task.path === '/api/v1/lopu/chats/reply');
  if (!task) throw new Error('Wait for the current task to connect before sending a note.');
  noteTargets.current.set(noteId, { owner, chatId: activeChatId, taskId: task.id });
  const result = await sendAiTaskNote(task.id, noteId, text);
  if (activeChatId && getLopuStoreSnapshot().userId === owner) await loadLopuMessages(activeChatId);
  noteTargets.current.delete(noteId);
  return result;
 }, [activeChatId, snapshot.userId]);
 React.useEffect(() => {
  if (queue.paused || queue.busy || !queue.items.length) return;
  let cancelled = false;
  const tick = async () => {
   try {
    await refreshQueueTasks();
    for (const target of new Set(queue.items.map(item => item.chatId))) {
     if (cancelled) return;
     if (queueTasks().some(task => task.chatId === target && (task.status === 'running' || task.workflowStatus === 'running'))) continue;
     const live = getLopuStoreSnapshot();
     if (Object.values(live.turns).some(turn => turn.chatId === target && turn.status === 'streaming')) continue;
     await drainLopuQueue(target, sendLopuMessage);
    }
   } catch { /* Preserve queue while task status is unavailable. */ }
  };
  void tick(); const timer = setInterval(() => void tick(), 2000);
  return () => { cancelled = true; clearInterval(timer); };
 }, [queue, snapshot.sending]);

	const confirmTool = React.useCallback(
		(requestId: string, toolId: string) => confirmLopuTool(requestId, toolId, { context: contextProvider(), applyPatches }),
		[contextProvider, applyPatches]
	);

	const setSettings = React.useCallback(
		(patch: Partial<LopuChatSettings>) => {
			setLopuSettings(patch);
   if (patch.management) setManagement(patch.management);
			// the catalog choice is also the viewer's preference (settings.lopu.*);
			// a provider-only change is per chat and leaves the preference alone
			if (!('model' in patch || 'effort' in patch || 'speed' in patch)) return;
			const next = getLopuStoreSnapshot().settings;
			setModelChoice({ model: next.model, effort: next.effort, speed: next.speed === 'fast' || next.speed === 'normal' ? next.speed : null });
		},
		[setModelChoice, setManagement]
	);

	const setPreferences = React.useCallback(
		(patch: Partial<{ applyPatches: boolean; enterSends: boolean; confirmDeletes: boolean }>) => {
			if (typeof patch.enterSends === 'boolean') setEnterSends(patch.enterSends);
			if (typeof patch.applyPatches === 'boolean') setApplyPatches(patch.applyPatches);
			if (typeof patch.confirmDeletes === 'boolean') setConfirmDeletes(patch.confirmDeletes);
		},
		[setEnterSends, setApplyPatches, setConfirmDeletes]
	);

	const selectChat = React.useCallback((chatId: string | null) => selectLopuChat(chatId), []);

	const chat = React.useMemo(() => selectLopuChatSummary(snapshot, activeChatId), [snapshot, activeChatId]);
	const messages = React.useMemo(() => selectLopuMessages(snapshot, activeChatId), [snapshot, activeChatId]);
	const turns = React.useMemo(() => selectLopuTurnsForChat(snapshot, activeChatId), [snapshot, activeChatId]);
	const timeline = React.useMemo(() => buildLopuTimeline(messages, turns, userId || ''), [messages, turns, userId]);
	const modelLabels = React.useMemo(() => selectLopuModelLabels(snapshot), [snapshot]);
	const providerNames = React.useMemo(() => selectLopuProviderNames(snapshot), [snapshot]);
	const streaming = Object.values(snapshot.turns).find(turn => turn.chatId === activeChatId && turn.status === 'streaming') ?? null;

	return {
		viewer: { id: userId, signedIn: !!user && !user.temporary, temporary: !!user?.temporary, admin: user?.isAdmin === true },
		chats: snapshot.chats,
		chatsLoaded: snapshot.chatsLoaded,
		chat,
		chatId: activeChatId,
		messages,
		turns,
		timeline,
		streaming,
		sending: !!streaming || (!!activeChatId && snapshot.recoveryChatIds.includes(activeChatId)) || tasks.some(task => task.chatId === activeChatId && (task.status === 'running' || task.workflowStatus === 'running')),
		send, enqueue, sendNote, queue,
		resume: requestId => activeChatId ? resumeLopuChat(activeChatId, requestId) : Promise.resolve({ ok: false, error: 'Select a conversation first.', text: '' }),
		abort: abortLopuTurn,
		selectChat,
		createChat: createLopuChat,
		deleteChat: deleteLopuChat,
		archiveChat: archiveLopuChat,
		renameChat: renameLopuChat,
		models: snapshot.models,
		modelsLoading: snapshot.modelsLoading,
		modelsLoaded: snapshot.modelsLoaded,
		defaults: snapshot.defaults,
		vaultProviders: snapshot.vaultProviders,
		vault: snapshot.vault,
		settings: snapshot.settings,
		setSettings,
		modelLabels,
		providerNames,
		preferences: { applyPatches, enterSends: prefs.enterSends, confirmDeletes: prefs.confirmDeletes },
		setPreferences,
		contextLabel,
		undoPatch: undoLopuPatch,
		canUndoPatch: canUndoLopuPatch,
		confirmTool,
		declineTool: declineLopuTool,
		account,
		byo,
		error: snapshot.error
	};
};
