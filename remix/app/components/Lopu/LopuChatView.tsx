import React from 'react';
import { Box, Flex, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';
import { ChevronDown, Maximize2 } from 'lucide-react';

import type { ChatMessage } from '~/components/Messenger/messengerTypes';
import { useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import type { ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import { LopuComposer } from './LopuComposer';
import { LopuLivePreview } from './LopuLivePreview';
import { LopuMarkdown, StreamingCaret } from './LopuMarkdown';
import { LopuToolCallRow, LopuToolCard } from './LopuToolCard';
import { LOPU_UI, lopuChipSx, lopuEyebrowSx, lopuFocusRingSx, lopuRainbowRing, lopuReducedMotionSx } from './lopuTheme';
import {
	LIVE_PREVIEW_TOOLS,
	decorateLopuTimeline,
	describeLopuStatusLine,
	describeLopuTurnMeta,
	lopuMessageMeta,
	type LopuTimelineRow,
	type LopuTurnState
} from './lopuTurnCore';
import { useLopuChat, type LopuContextProvider } from './useLopuChat';

// The Lopu chat surface (design note §3.2, restyled per the design brief)
// shared by the /lopu page, the floating window (compact) and the Messenger
// pane (no header): a centred 760px conversation column — viewer bubbles
// right on ink, Lopu bubbles left with the 🦄 on its rainbow ring, grouped
// by author, time separators, the streaming caret on the rainbow, tool
// activity as compact rows, live previews in a clipped frame — the empty
// state with four suggestion chips, and the composer pinned below. All
// state lives in the shared store (useLopuChat) so every surface shows the
// same conversation.

export const LOPU_SUGGESTIONS = ['Build me a landing page hero', 'Make a pricing table component', 'Create an action that saves a note', 'What can you do?'];

const AVATAR = 28;
const AVATAR_COMPACT = 24;

// The unicorn on a rainbow ring — Lopu's avatar (a card disc inside a 2px ring).
export const LopuAvatar = ({ size = AVATAR, ring = 2 }: { size?: number; ring?: number }) => (
	<Box className="lopuAvatar" sx={{ ...lopuRainbowRing(size, ring), backgroundSize: 'calc(100px + 200%)', animation: LOPU_UI.rainbowAnim, ...lopuReducedMotionSx }} aria-hidden="true">
		<Flex align="center" justify="center" width="100%" height="100%" borderRadius="999px" bg={LOPU_UI.card} fontSize={`${Math.round(size * 0.5)}px`} lineHeight={1}>
			🦄
		</Flex>
	</Box>
);

// ——— header ————————————————————————————————————————————————————————————————

export const LopuChatHeader = ({ status, after, compact = false }: { status: string; after?: React.ReactNode; compact?: boolean }) => (
	<Flex className="lopuChatHeader" align="center" gap={3} px={compact ? 3 : 0} py={compact ? 2 : 3} flexShrink={0} minW={0}>
		<LopuAvatar size={compact ? 32 : 40} />
		<Box minW={0} flex={1}>
			<Text as="span" display="block" sx={lopuEyebrowSx}>
				Thingtime · your AI
			</Text>
			<Text as="h1" fontSize={compact ? '16px' : '20px'} fontWeight={700} letterSpacing="-0.01em" lineHeight="1.2" color={LOPU_UI.ink} m={0}>
				Lopu
			</Text>
			<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} isTruncated aria-live="polite">
				{status}
			</Text>
		</Box>
		{after}
	</Flex>
);

// ——— rows ——————————————————————————————————————————————————————————————————

const Separator = ({ label, compact }: { label: string; compact: boolean }) => (
	<Flex className="lopuSeparator" role="separator" aria-label={label} justify="center" pt={compact ? 2 : 3} pb={compact ? 1 : 1.5}>
		<Text as="span" fontSize="11px" fontWeight={500} color={LOPU_UI.faint} letterSpacing="0.02em">
			{label}
		</Text>
	</Flex>
);

// Lopu's bubble row (exported so voice mode's local rows are the same bubbles)
export const LopuAssistantRow = ({
	children,
	first,
	last,
	meta,
	compact,
	live,
	busy
}: {
	children: React.ReactNode;
	first: boolean;
	last: boolean;
	meta?: string | null;
	compact: boolean;
	live?: boolean;
	busy?: boolean;
}) => {
	const avatar = compact ? AVATAR_COMPACT : AVATAR;
	return (
		<Flex className="lopuRow" data-role="assistant" data-first={first ? 'true' : 'false'} align="flex-start" gap={compact ? 2 : 2.5} maxW="100%" minW={0}>
			<Box width={`${avatar}px`} flexShrink={0} pt="4px">
				{first ? <LopuAvatar size={avatar} /> : null}
			</Box>
			<Box minW={0} flex={1} maxW="min(100%, 640px)">
				<Box
					className="lopuBubble"
					bg={LOPU_UI.lopuBubble.background}
					border={LOPU_UI.lopuBubble.border}
					borderRadius={LOPU_UI.lopuBubble.borderRadius}
					borderTopLeftRadius={first ? '4px' : '18px'}
					px={compact ? 3 : 3.5}
					py={compact ? 2 : 2.5}
					minW={0}
					overflow="hidden"
					aria-live={live ? 'polite' : undefined}
					aria-atomic={live ? false : undefined}
					aria-busy={busy || undefined}
				>
					<Box display="flex" flexDirection="column" rowGap={compact ? 1.5 : 2} minW={0}>
						{children}
					</Box>
				</Box>
				{last && meta ? (
					<Text fontSize="11px" color={LOPU_UI.faint} mt={1} pl={1} isTruncated>
						{meta}
					</Text>
				) : null}
			</Box>
		</Flex>
	);
};

// The viewer's bubble row (exported for the same reason)
export const LopuUserRow = ({ text, compact }: { text: string; compact: boolean }) => (
	<Flex className="lopuRow" data-role="user" justify="flex-end" maxW="100%" minW={0}>
		<Box
			className="lopuBubble"
			bg={LOPU_UI.userBubble.background}
			color={LOPU_UI.userBubble.color}
			borderRadius={LOPU_UI.userBubble.borderRadius}
			px={compact ? 3 : 3.5}
			py={compact ? 2 : 2.5}
			maxW="min(85%, 560px)"
			minW={0}
			fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody}
			lineHeight="1.5"
			whiteSpace="pre-wrap"
			overflowWrap="anywhere"
		>
			{text}
		</Box>
	</Flex>
);

const Thinking = ({ compact }: { compact: boolean }) => (
	<Text fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} color={LOPU_UI.muted}>
		Thinking
		<Box as="span" sx={{ animation: 'tt-blink 1s steps(1) infinite', ...lopuReducedMotionSx }} aria-hidden="true">
			…
		</Box>
	</Text>
);

const ErrorLine = ({ message }: { message: string }) => (
	<Text role="alert" fontSize={LOPU_UI.fontSmall} color={LOPU_UI.danger} lineHeight="1.5" overflowWrap="anywhere">
		{message}
	</Text>
);

const componentsFromTurn = (turn: LopuTurnState): ComponentsByRef => {
	const out: ComponentsByRef = {};
	for (const record of turn.things) {
		const thing = record.thing;
		const isComponent = record.kind === 'component' || (Array.isArray(thing.thingtime) && thing.thingtime.includes('component'));
		if (!isComponent || !thing.crystal) continue;
		const entry = { id: thing.id, crystal: thing.crystal };
		out[thing.id] = entry;
		const key = thing.crystal.componentKey;
		if (typeof key === 'string' && key) out[key] = entry;
	}
	return out;
};

const TurnBubble = ({
	turn,
	first,
	last,
	compact,
	canUndo,
	onUndo,
	onConfirm,
	onDecline,
	confirmBusy
}: {
	turn: LopuTurnState;
	first: boolean;
	last: boolean;
	compact: boolean;
	canUndo: (toolId: string) => boolean;
	onUndo: (toolId: string) => void;
	onConfirm: (requestId: string, toolId: string) => void;
	onDecline: (requestId: string, toolId: string) => void;
	// another reply is in flight — a Confirm card waits its turn
	confirmBusy: boolean;
}) => {
	const streaming = turn.status === 'streaming';
	const componentsByRef = React.useMemo(() => componentsFromTurn(turn), [turn]);
	const segments = turn.segments;
	const lastSegment = segments[segments.length - 1];
	const waitingAfterTool = streaming && !!lastSegment && lastSegment.kind === 'tool' && turn.tools.every((tool) => tool.status === 'ok' || tool.status === 'error' || tool.status === 'confirm');
	return (
		<LopuAssistantRow first={first} last={last} meta={describeLopuTurnMeta(turn.meta)} compact={compact} live busy={streaming}>
			{segments.length === 0 && streaming ? <Thinking compact={compact} /> : null}
			{segments.map((segment, index) => {
				if (segment.kind === 'text') {
					return <LopuMarkdown key={index} text={segment.text} caret={streaming && index === segments.length - 1} compact={compact} />;
				}
				const activity = turn.tools.find((tool) => tool.id === segment.id);
				if (!activity) return null;
				return (
					<Box key={activity.id} minW={0} display="flex" flexDirection="column" rowGap={2}>
						<LopuToolCard
							activity={activity}
							canUndo={activity.name === 'patch_page' && canUndo(activity.id)}
							onUndo={onUndo}
							compact={compact}
							onConfirm={() => onConfirm(turn.requestId, activity.id)}
							onDecline={() => onDecline(turn.requestId, activity.id)}
							confirmDisabled={confirmBusy}
						/>
						{LIVE_PREVIEW_TOOLS.has(activity.name) ? <LopuLivePreview activity={activity} componentsByRef={componentsByRef} compact={compact} /> : null}
					</Box>
				);
			})}
			{waitingAfterTool ? (
				<Text fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} color={LOPU_UI.muted}>
					<StreamingCaret />
				</Text>
			) : null}
			{turn.status === 'aborted' ? (
				<Text fontSize="11px" color={LOPU_UI.faint}>
					Stopped
				</Text>
			) : null}
			{turn.status === 'error' && turn.error ? <ErrorLine message={turn.error.message} /> : null}
		</LopuAssistantRow>
	);
};

// Persisted rows never change while a reply streams, so they are memoised:
// each network chunk re-renders the live turn bubble, not the whole history.
const MessageBubble = React.memo(function MessageBubble({
	message,
	role,
	first,
	last,
	compact,
	modelLabels
}: {
	message: ChatMessage;
	role: 'user' | 'assistant';
	first: boolean;
	last: boolean;
	compact: boolean;
	// catalog id → label, so a persisted row reads "via GPT-5.6 Sol" like a live turn
	modelLabels: Record<string, string>;
}) {
	const meta = React.useMemo(() => lopuMessageMeta(message), [message]);
	if (message.deleted) return null;
	if (role === 'user') return <LopuUserRow text={message.text} compact={compact} />;
	const metaLine =
		meta && meta.provider
			? describeLopuTurnMeta({
					provider: meta.provider,
					label: meta.model ? (modelLabels[meta.model] ?? null) : null,
					model: meta.model,
					effort: meta.effort,
					speed: meta.speed,
					providerLabel: meta.providerLabel
				})
			: null;
	return (
		<LopuAssistantRow first={first} last={last} meta={metaLine} compact={compact}>
			{meta?.toolCalls.length ? (
				<Box display="flex" flexDirection="column" rowGap={1.5} minW={0}>
					{meta.toolCalls.map((call, index) => (
						<LopuToolCallRow key={`${call.name}-${index}`} call={call} compact={compact} />
					))}
				</Box>
			) : null}
			<LopuMarkdown text={message.text} compact={compact} />
		</LopuAssistantRow>
	);
});

// ——— states ————————————————————————————————————————————————————————————————

const SuggestionChip = ({ label, onPick, mobile }: { label: string; onPick: () => void; mobile: boolean }) => (
	<Box as="button" type="button" onClick={onPick} sx={{ ...lopuChipSx, height: `${mobile ? 36 : LOPU_UI.control}px`, background: LOPU_UI.card, fontWeight: 500, paddingInline: '14px' }}>
		{label}
	</Box>
);

const EmptyState = ({ onPick, compact, mobile }: { onPick: (text: string) => void; compact: boolean; mobile: boolean }) => (
	<Flex className="lopuEmpty" direction="column" align="center" justify="center" textAlign="center" flex={1} minH={compact ? '200px' : '320px'} px={4} py={6} gap={compact ? 3 : 4}>
		<LopuAvatar size={compact ? 48 : 56} ring={2} />
		<Text fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} color={LOPU_UI.muted} maxW="360px" lineHeight="1.5">
			Ask me anything, or tell me what to build — pages, components and actions, made as you.
		</Text>
		<Flex gap={2} wrap="wrap" justify="center" maxW="520px">
			{LOPU_SUGGESTIONS.map((suggestion) => (
				<SuggestionChip key={suggestion} label={suggestion} onPick={() => onPick(suggestion)} mobile={mobile} />
			))}
		</Flex>
	</Flex>
);

const SignedOutState = ({ compact }: { compact: boolean }) => (
	<Flex className="lopuSignedOut" direction="column" align="center" justify="center" textAlign="center" flex={1} minH={compact ? '200px' : '320px'} px={4} py={6} gap={4}>
		<LopuAvatar size={compact ? 48 : 56} />
		<Text fontSize={compact ? LOPU_UI.fontCompact : LOPU_UI.fontBody} color={LOPU_UI.muted} maxW="360px" lineHeight="1.5">
			Lopu builds pages, components and actions as you — sign in and it remembers every conversation.
		</Text>
		<Box
			as={RouterLink}
			to="/login"
			display="inline-flex"
			alignItems="center"
			height={`${LOPU_UI.control}px`}
			px={4}
			borderRadius={LOPU_UI.pill}
			bg={LOPU_UI.ink}
			color={LOPU_UI.card}
			fontSize={LOPU_UI.fontSmall}
			fontWeight={600}
			_hover={{ opacity: 0.9 }}
			sx={lopuFocusRingSx}
		>
			Sign in to chat with Lopu
		</Box>
	</Flex>
);

const relativeTime = (iso: string | null | undefined): string => {
	const at = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(at)) return '';
	const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(at).toLocaleDateString();
};

// ——— the view —————————————————————————————————————————————————————————————

export type LopuChatViewVariant = 'page' | 'pane' | 'window';

export type LopuChatViewProps = {
	// a specific conversation (null = fresh); undefined follows the shared store
	chatId?: string | null;
	onChatChange?: (chatId: string | null) => void;
	// 'window' = the floating chat (denser paddings, 13px body); 'pane' = the
	// Messenger pane (no header); 'page' = /lopu
	variant?: LopuChatViewVariant;
	// legacy alias for variant 'window'
	compact?: boolean;
	context?: LopuContextProvider;
	// a slim conversation switcher above the list (the floating window)
	showConversations?: boolean;
	onOpenFull?: () => void;
	applyPatches?: boolean;
	autoFocus?: boolean;
	// draw the eyebrow / title / status header (the page)
	header?: boolean;
	headerAfter?: React.ReactNode;
	// voice mode (W2): the mic control for the composer, extra settings rows,
	// and the "Listening…" status
	composerLeading?: React.ReactNode;
	settingsContent?: React.ReactNode;
	listening?: boolean;
	// rows drawn after the timeline, inside the same scrolling list (voice
	// mode's local transcript: native turns, transcribe quotes, mic errors)
	trailing?: React.ReactNode;
};

export const LopuChatView = ({
	chatId,
	onChatChange,
	variant,
	compact: compactProp,
	context,
	showConversations = false,
	onOpenFull,
	applyPatches,
	autoFocus,
	header = false,
	headerAfter,
	composerLeading,
	settingsContent,
	listening = false,
	trailing
}: LopuChatViewProps) => {
	const compact = compactProp ?? variant === 'window';
	const resolvedVariant: LopuChatViewVariant = variant ?? (compact ? 'window' : 'page');
	const isMobile = useIsMobileViewport();
	const chat = useLopuChat({ chatId, context, applyPatches });
	const [draft, setDraft] = React.useState('');
	const scrollRef = React.useRef<HTMLDivElement | null>(null);
	const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
	const stickRef = React.useRef(true);

	// report conversation changes (the page mirrors them into the URL)
	const reported = React.useRef(chat.chatId);
	React.useEffect(() => {
		if (reported.current === chat.chatId) return;
		reported.current = chat.chatId;
		onChatChange?.(chat.chatId);
	}, [chat.chatId, onChatChange]);

	// stick to the bottom while the viewer is already there; a scroll-up
	// pauses following until they come back down
	const onScroll = React.useCallback(() => {
		const element = scrollRef.current;
		if (!element) return;
		stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
	}, []);
	const streamingSequence = chat.streaming?.sequence ?? -1;
	React.useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element || !stickRef.current) return;
		element.scrollTop = element.scrollHeight;
	}, [chat.timeline, streamingSequence, chat.chatId]);

	const focusInput = React.useCallback(() => {
		// after a send the caret stays in the field (a chip pick lands it there)
		const element = inputRef.current;
		if (!element || isMobile) return;
		try {
			element.focus({ preventScroll: true });
		} catch {
			element.focus();
		}
	}, [isMobile]);

	const send = React.useCallback(
		async (text: string) => {
			setDraft('');
			stickRef.current = true;
			focusInput();
			const result = await chat.send(text);
			// a turn that never reached the server hands the text back
			if (result.ok === false && result.text) setDraft((current) => current || result.text);
			focusInput();
		},
		[chat, focusInput]
	);

	const stop = React.useCallback(() => {
		chat.abort();
		focusInput();
	}, [chat, focusInput]);

	const rows = React.useMemo(() => decorateLopuTimeline(chat.timeline), [chat.timeline]);
	const streamingHere = !!chat.streaming;
	const confirmBusy = chat.sending || streamingHere;
	const onConfirm = React.useCallback(
		(requestId: string, toolId: string) => {
			stickRef.current = true;
			void chat.confirmTool(requestId, toolId);
		},
		[chat]
	);
	const activeName = chat.chat?.name || (chat.chatId ? 'Conversation' : 'New chat');
	const status = describeLopuStatusLine({
		model: chat.settings.model,
		effort: chat.settings.effort,
		speed: chat.settings.speed,
		providerId: chat.settings.providerId,
		modelLabels: chat.modelLabels,
		providerNames: chat.providerNames,
		streaming: streamingHere,
		listening
	});

	const gutter = compact ? 3 : { base: 3, md: 6 };
	const columnMaxW = compact ? '100%' : LOPU_UI.conversationMaxWidth;

	const renderRow = (row: LopuTimelineRow, index: number) => {
		const spacing = index === 0 ? 0 : row.separator ? 0 : row.first ? (compact ? 3 : 4) : compact ? 0.5 : 1;
		const key = row.item.kind === 'turn' ? `turn:${row.item.turn.requestId}` : `msg:${row.item.message.id}`;
		return (
			<React.Fragment key={key}>
				{row.separator ? <Separator label={row.separator} compact={compact} /> : null}
				<Box mt={spacing} minW={0}>
					{row.item.kind === 'turn' ? (
						<TurnBubble
							turn={row.item.turn}
							first={row.first}
							last={row.last}
							compact={compact}
							canUndo={chat.canUndoPatch}
							onUndo={chat.undoPatch}
							onConfirm={onConfirm}
							onDecline={chat.declineTool}
							confirmBusy={confirmBusy}
						/>
					) : (
						<MessageBubble message={row.item.message} role={row.role} first={row.first} last={row.last} compact={compact} modelLabels={chat.modelLabels} />
					)}
				</Box>
			</React.Fragment>
		);
	};

	return (
		<Flex className="lopuChatView" data-compact={compact ? 'true' : 'false'} data-variant={resolvedVariant} direction="column" flex={1} height="100%" minH={0} minW={0} width="100%">
			{header ? (
				<Box px={gutter} flexShrink={0}>
					<Box maxW={columnMaxW} mx="auto" width="100%">
						<LopuChatHeader status={status} after={headerAfter} compact={compact} />
					</Box>
				</Box>
			) : null}

			{showConversations ? (
				<Flex align="center" gap={2} px={compact ? 2 : 0} py={1.5} borderBottom={LOPU_UI.border} flexShrink={0} minW={0}>
					<Menu isLazy>
						<MenuButton as={Box} data-lopu-control sx={{ ...lopuChipSx, height: '26px', maxWidth: 'calc(100% - 44px)', background: 'transparent', border: '1px solid transparent', _hover: { background: LOPU_UI.surfaceHover } }} title="Switch conversation">
							<Flex as="span" align="center" gap={1.5} minW={0}>
								<Text as="span" isTruncated minW={0}>
									{activeName}
								</Text>
								<ChevronDown size={12} strokeWidth={2.2} aria-hidden style={{ flexShrink: 0, opacity: 0.7 }} />
							</Flex>
						</MenuButton>
						<MenuList fontSize={LOPU_UI.fontCompact} maxH="320px" overflowY="auto" zIndex={20} bg={LOPU_UI.card} borderColor={LOPU_UI.borderColor} borderRadius={LOPU_UI.radiusMd} boxShadow={LOPU_UI.shadowPopover} py={1}>
							<MenuItem onClick={() => chat.selectChat(null)} fontWeight={600} bg={LOPU_UI.card} _hover={{ bg: LOPU_UI.surfaceHover }} _focus={{ bg: LOPU_UI.surfaceHover }}>
								New chat
							</MenuItem>
							{chat.chats.length ? <MenuDivider borderColor={LOPU_UI.borderColor} /> : null}
							{chat.chats.slice(0, 12).map((entry) => (
								<MenuItem key={entry.id} onClick={() => chat.selectChat(entry.id)} fontWeight={entry.id === chat.chatId ? 700 : 400} bg={LOPU_UI.card} _hover={{ bg: LOPU_UI.surfaceHover }} _focus={{ bg: LOPU_UI.surfaceHover }}>
									<Text as="span" isTruncated maxW="240px">
										{entry.name || 'Lopu'}
									</Text>
									<Text as="span" fontSize="11px" color={LOPU_UI.faint} ml="auto" pl={3}>
										{relativeTime(entry.updatedAt)}
									</Text>
								</MenuItem>
							))}
						</MenuList>
					</Menu>
					<Box flex={1} />
					{onOpenFull ? (
						<Box
							as="button"
							type="button"
							data-lopu-control
							onClick={onOpenFull}
							title="Open the full Lopu page"
							aria-label="Open the full Lopu page"
							display="inline-flex"
							alignItems="center"
							justifyContent="center"
							width="28px"
							height="28px"
							borderRadius={LOPU_UI.radiusSm}
							color={LOPU_UI.muted}
							_hover={{ bg: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
							sx={lopuFocusRingSx}
						>
							<Maximize2 size={13} strokeWidth={2} aria-hidden />
						</Box>
					) : null}
				</Flex>
			) : null}

			<Box ref={scrollRef} onScroll={onScroll} role="log" aria-label="Conversation with Lopu" flex={1} minH={0} overflowY="auto" overflowX="hidden" px={gutter} py={compact ? 3 : 4} sx={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
				<Flex direction="column" maxW={columnMaxW} mx="auto" width="100%" minH="100%" minW={0}>
					{!chat.viewer.id ? (
						<SignedOutState compact={compact} />
					) : rows.length === 0 && !trailing ? (
						<EmptyState onPick={send} compact={compact} mobile={isMobile} />
					) : (
						<>
							{rows.map(renderRow)}
							{trailing}
						</>
					)}
				</Flex>
			</Box>

			<Box
				className="lopuComposerDock"
				flexShrink={0}
				px={gutter}
				pt={compact ? 1 : 2}
				pb={compact ? 2 : resolvedVariant === 'window' ? 3 : `calc(${isMobile ? '8px' : '12px'} + ${LOPU_UI.safeAreaBottom})`}
			>
				<Box maxW={compact ? '100%' : LOPU_UI.composerMaxWidth} mx="auto" width="100%">
					<LopuComposer
						value={draft}
						onChange={setDraft}
						onSend={send}
						onStop={stop}
						streaming={streamingHere || chat.sending}
						disabled={!chat.viewer.id}
						enterSends={chat.preferences.enterSends}
						models={chat.models}
						vaultProviders={chat.vaultProviders}
						vault={chat.vault}
						settings={chat.settings}
						defaults={chat.defaults}
						onSettingsChange={chat.setSettings}
						contextLabel={chat.contextLabel}
						compact={compact}
						autoFocus={autoFocus}
						inputRef={inputRef}
						composerLeading={composerLeading}
						preferences={chat.preferences}
						onPreferencesChange={chat.setPreferences}
						settingsContent={settingsContent}
					/>
				</Box>
			</Box>
		</Flex>
	);
};
