// useLopuChat (design note §3.1) — the ONE React hook every Lopu surface uses
// (the /lopu page, the floating window, the Messenger pane). It is a thin
// React binding over lopuChatStore: it hands the store the viewer's API
// client, seeds the store from localCache during render (optimistic first
// paint), refetches in the background, forwards store notices to the Lopu
// toast, performs `navigate` events with the router, and keeps the viewer's
// model preference (settings.lopu.* via useLopuSettings) and the store's
// per-chat settings in step. Also exports the §3.3 context-provider builder.

import React from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useMessengerApi } from '~/components/Messenger/useMessengerApi';
import { useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { getWebpageDraftsVersion, subscribeWebpageDrafts } from './lopuBuildBridge';
import {
	abortLopuTurn,
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
	selectLopuStreaming,
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
import { useLopuSettings } from './useLopuSettings';

// ——— §3.3 context provider ————————————————————————————————————————————————

export type LopuContext = LopuReplyContext;
export type LopuContextProvider = () => LopuContext;

/**
 * Build the reply request's `context`: the route, the active builder draft
 * (id/source/keys/updatedAt/live blocks ≤ 48KB) from the live-build bridge,
 * the selected block and the viewport. Pure apart from reading the bridge.
 */
export const buildLopuContext = (base?: Partial<LopuContext>): LopuContext => {
	const draft = describeActiveDraft();
	return {
		...(base?.route ? { route: base.route } : {}),
		...(draft ? { page: draft.page } : {}),
		...(base?.selectedBlockId ? { selectedBlockId: base.selectedBlockId } : {}),
		...(base?.viewport ? { viewport: base.viewport } : {})
	};
};

/** A provider that captures static bits now and reads the live draft on every send. */
export const createLopuContextProvider = (base?: Partial<LopuContext>): LopuContextProvider => () => buildLopuContext(base);

/** The default provider: current route + viewport, the active draft read live. */
export const useLopuContextProvider = (extra?: { selectedBlockId?: string | null }): LopuContextProvider => {
	const { pathname, search } = useLocation();
	const isMobile = useIsMobileViewport();
	const route = `${pathname}${search}`;
	const selectedBlockId = extra?.selectedBlockId ?? null;
	return React.useCallback(
		() => buildLopuContext({ route, viewport: isMobile ? 'mobile' : 'desktop', ...(selectedBlockId ? { selectedBlockId } : {}) }),
		[route, isMobile, selectedBlockId]
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

export type LopuViewer = { id: string | null; signedIn: boolean; temporary: boolean };

export type UseLopuChat = {
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
	send: (text: string, overrides?: Partial<LopuChatSettings>) => Promise<SendLopuResult>;
	abort: () => void;
	selectChat: (chatId: string | null) => void;
	createChat: (args?: { title?: string }) => ReturnType<typeof createLopuChat>;
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
	error: string | null;
};

export const useLopuChat = (options: UseLopuChatOptions = {}): UseLopuChat => {
	const user = useCurrentUser();
	const userId = user?.id ?? null;
	const api = useApi();
	const messenger = useMessengerApi();
	const lopu = useLopu();
	const navigate = useNavigate();
	const { settings: prefs, setModelChoice, setEnterSends, setApplyPatches, setConfirmDeletes } = useLopuSettings();
	const defaultContext = useLopuContextProvider();
	const contextProvider = options.context ?? defaultContext;
	const contextLabel = useActiveDraftLabel();

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

	// background refetches
	React.useEffect(() => {
		if (!userId) return;
		void loadLopuChats();
		void loadLopuModels();
	}, [userId]);

	const loadedForChat = activeChatId ? snapshot.messagesLoaded[activeChatId] : true;
	React.useEffect(() => {
		if (!userId || !activeChatId || loadedForChat) return;
		void loadLopuMessages(activeChatId);
	}, [userId, activeChatId, loadedForChat]);

	// the viewer's preference (settings.lopu.*) feeds the store; a chat's own
	// settings can still override it while that chat is selected
	React.useEffect(() => {
		const patch: Partial<LopuChatSettings> = {};
		if (prefs.model) patch.model = prefs.model;
		if (prefs.effort) patch.effort = prefs.effort;
		if (prefs.speed) patch.speed = prefs.speed;
		if (Object.keys(patch).length) setLopuSettings(patch);
	}, [prefs.model, prefs.effort, prefs.speed]);

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
		(text: string, overrides?: Partial<LopuChatSettings>) =>
			sendLopuMessage(text, {
				...(overrides ? { settings: overrides } : {}),
				context: contextProvider(),
				applyPatches
			}),
		[contextProvider, applyPatches]
	);

	const confirmTool = React.useCallback(
		(requestId: string, toolId: string) => confirmLopuTool(requestId, toolId, { context: contextProvider(), applyPatches }),
		[contextProvider, applyPatches]
	);

	const setSettings = React.useCallback(
		(patch: Partial<LopuChatSettings>) => {
			setLopuSettings(patch);
			// the catalog choice is also the viewer's preference (settings.lopu.*);
			// a provider-only change is per chat and leaves the preference alone
			if (!('model' in patch || 'effort' in patch || 'speed' in patch)) return;
			const next = getLopuStoreSnapshot().settings;
			setModelChoice({ model: next.model, effort: next.effort, speed: next.speed === 'fast' || next.speed === 'normal' ? next.speed : null });
		},
		[setModelChoice]
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
	const streamingAny = selectLopuStreaming(snapshot);
	const streaming = streamingAny && streamingAny.chatId === activeChatId ? streamingAny : null;

	return {
		viewer: { id: userId, signedIn: !!user && !user.temporary, temporary: !!user?.temporary },
		chats: snapshot.chats,
		chatsLoaded: snapshot.chatsLoaded,
		chat,
		chatId: activeChatId,
		messages,
		turns,
		timeline,
		streaming,
		sending: snapshot.sending,
		send,
		abort: abortLopuTurn,
		selectChat,
		createChat: createLopuChat,
		deleteChat: deleteLopuChat,
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
		error: snapshot.error
	};
};
