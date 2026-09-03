import React from 'react';
import { Box, Button, Flex, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';

import type { ChatMessage } from '~/components/Messenger/messengerTypes';
import { RAINBOW } from '~/theme/rainbow';
import type { ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import { LopuComposer } from './LopuComposer';
import { LopuLivePreview } from './LopuLivePreview';
import { LopuMarkdown, StreamingCaret } from './LopuMarkdown';
import { LopuToolCard } from './LopuToolCard';
import { effortLabel } from './LopuModelPicker';
import { LIVE_PREVIEW_TOOLS, type LopuTurnState } from './lopuTurnCore';
import { useLopuChat, type LopuContextProvider } from './useLopuChat';

// The Lopu chat surface (design note §3.2) shared by the /lopu page, the
// floating window and the Messenger pane: the message list (viewer bubbles
// right, Lopu bubbles left with the 🦄 avatar and a rainbow accent), this
// session's streamed turns as rich bubbles (markdown prose interleaved with
// tool cards + live previews, a blinking caret while streaming), the empty
// state with suggestion chips, and the composer. All state lives in the
// shared store (useLopuChat) so every surface shows the same conversation.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';

export const LOPU_SUGGESTIONS = ['Build me a landing page hero', 'Make a pricing table component', 'Create an action that saves a note', 'What can you do?'];

const PROVIDER_NAMES: Record<string, string> = { claude: 'Claude', openai: 'ChatGPT', test: 'the test script', fallback: "Lopu's little book 📖" };

export const LopuAvatar = ({ size = 28 }: { size?: number }) => (
	<Box
		className="lopuAvatar"
		width={`${size}px`}
		height={`${size}px`}
		flexShrink={0}
		borderRadius="full"
		background={RAINBOW}
		backgroundSize="calc(100px + 200%)"
		display="flex"
		alignItems="center"
		justifyContent="center"
		fontSize={`${Math.round(size * 0.55)}px`}
		lineHeight={1}
		boxShadow="0 1px 2px rgba(0,0,0,0.12)"
		sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
		aria-hidden="true"
	>
		🦄
	</Box>
);

const LopuRow = ({ children, showAvatar, meta }: { children: React.ReactNode; showAvatar: boolean; meta?: React.ReactNode }) => (
	<Flex className="lopuRow" data-role="assistant" align="flex-start" gap={2} maxW="100%">
		<Box width="28px" flexShrink={0} pt="2px">
			{showAvatar ? <LopuAvatar /> : null}
		</Box>
		<Box minW={0} flex={1} maxW="min(100%, 720px)">
			<Box
				position="relative"
				bg="var(--tt-card, #ffffff)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="16px"
				borderTopLeftRadius={showAvatar ? '6px' : '16px'}
				boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
				px={3.5}
				py={2.5}
				minW={0}
				overflow="hidden"
				_before={{
					content: '""',
					position: 'absolute',
					left: 0,
					top: 0,
					bottom: 0,
					width: '3px',
					background: RAINBOW,
					backgroundSize: 'calc(100px + 200%)',
					animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
				}}
			>
				<Box display="flex" flexDirection="column" rowGap={2} minW={0}>
					{children}
				</Box>
			</Box>
			{meta ? (
				<Text fontSize="10px" color={MUTED} mt={1} pl={1}>
					{meta}
				</Text>
			) : null}
		</Box>
	</Flex>
);

const UserRow = ({ text }: { text: string }) => (
	<Flex className="lopuRow" data-role="user" justify="flex-end" maxW="100%">
		<Box
			bg="var(--tt-accent, #7c6cff)"
			color="var(--tt-accent-contrast, #ffffff)"
			borderRadius="16px"
			borderBottomRightRadius="6px"
			px={3.5}
			py={2}
			maxW="min(85%, 640px)"
			minW={0}
			fontSize="sm"
			lineHeight="1.55"
			whiteSpace="pre-wrap"
			overflowWrap="anywhere"
		>
			{text}
		</Box>
	</Flex>
);

const Thinking = () => (
	<Text fontSize="sm" color={MUTED} fontStyle="italic">
		Lopu is thinking
		<Box as="span" sx={{ animation: 'tt-blink 1s steps(1) infinite' }} aria-hidden="true">
			…
		</Box>
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

const turnMeta = (turn: LopuTurnState): string | null => {
	if (!turn.meta) return null;
	const provider = PROVIDER_NAMES[turn.meta.provider] || turn.meta.provider;
	if (turn.meta.provider === 'fallback') return `from ${provider}`;
	const bits = [turn.meta.label || turn.meta.model || provider];
	if (turn.meta.effort) bits.push(effortLabel(turn.meta.effort));
	if (turn.meta.speed === 'fast') bits.push('fast ⚡');
	return `via ${bits.join(' · ')}`;
};

const TurnBubble = ({
	turn,
	showAvatar,
	canUndo,
	onUndo
}: {
	turn: LopuTurnState;
	showAvatar: boolean;
	canUndo: (toolId: string) => boolean;
	onUndo: (toolId: string) => void;
}) => {
	const streaming = turn.status === 'streaming';
	const componentsByRef = React.useMemo(() => componentsFromTurn(turn), [turn]);
	const segments = turn.segments;
	const last = segments[segments.length - 1];
	const waitingAfterTool = streaming && !!last && last.kind === 'tool' && turn.tools.every((tool) => tool.status === 'ok' || tool.status === 'error');
	return (
		<LopuRow showAvatar={showAvatar} meta={turnMeta(turn)}>
			{segments.length === 0 && streaming ? <Thinking /> : null}
			{segments.map((segment, index) => {
				if (segment.kind === 'text') {
					return <LopuMarkdown key={index} text={segment.text} caret={streaming && index === segments.length - 1} />;
				}
				const activity = turn.tools.find((tool) => tool.id === segment.id);
				if (!activity) return null;
				return (
					<Box key={activity.id} minW={0}>
						<LopuToolCard activity={activity} canUndo={activity.name === 'patch_page' && canUndo(activity.id)} onUndo={onUndo} />
						{LIVE_PREVIEW_TOOLS.has(activity.name) ? <LopuLivePreview activity={activity} componentsByRef={componentsByRef} /> : null}
					</Box>
				);
			})}
			{waitingAfterTool ? (
				<Text fontSize="sm" color={MUTED}>
					<StreamingCaret />
				</Text>
			) : null}
			{turn.status === 'aborted' ? (
				<Text fontSize="xs" color={MUTED} fontStyle="italic">
					(stopped)
				</Text>
			) : null}
			{turn.status === 'error' && turn.error ? (
				<Text fontSize="xs" color="var(--tt-danger, #d64545)">
					🌧️ {turn.error.message}
				</Text>
			) : null}
		</LopuRow>
	);
};

const MessageBubble = ({ message, role, showAvatar }: { message: ChatMessage; role: 'user' | 'assistant'; showAvatar: boolean }) => {
	if (message.deleted) return null;
	if (role === 'user') return <UserRow text={message.text} />;
	return (
		<LopuRow showAvatar={showAvatar}>
			<LopuMarkdown text={message.text} />
		</LopuRow>
	);
};

const EmptyState = ({ onPick, compact, onOpenFull }: { onPick: (text: string) => void; compact: boolean; onOpenFull?: () => void }) => (
	<Flex direction="column" align="center" justify="center" textAlign="center" flex={1} minH={compact ? '200px' : '320px'} px={4} py={6} gap={3}>
		<LopuAvatar size={compact ? 44 : 56} />
		<Box>
			<Text fontSize={compact ? 'md' : 'lg'} fontWeight={800} color={INK}>
				Hi, I&apos;m Lopu 🦄
			</Text>
			<Text fontSize="sm" color={MUTED} maxW="420px" mt={1}>
				Ask me anything about Thingtime, or tell me what to build — pages, components, sections and actions, made as you, live on the page.
			</Text>
		</Box>
		<Flex gap={2} wrap="wrap" justify="center" maxW="520px">
			{LOPU_SUGGESTIONS.map((suggestion) => (
				<Button
					key={suggestion}
					size="xs"
					variant="outline"
					height="28px"
					px={3}
					borderRadius="999px"
					borderColor="var(--tt-border, #ececef)"
					bg="var(--tt-card, #ffffff)"
					color={INK}
					fontWeight={500}
					onClick={() => onPick(suggestion)}
					_hover={{ borderColor: 'var(--tt-accent, #7c6cff)', color: 'var(--tt-accent, #7c6cff)' }}
				>
					{suggestion}
				</Button>
			))}
		</Flex>
		{compact && onOpenFull ? (
			<Button size="xs" variant="link" color={MUTED} onClick={onOpenFull}>
				⤢ Open the full page
			</Button>
		) : null}
	</Flex>
);

const SignedOutState = ({ compact }: { compact: boolean }) => (
	<Flex direction="column" align="center" justify="center" textAlign="center" flex={1} minH={compact ? '200px' : '320px'} px={4} py={6} gap={3}>
		<LopuAvatar size={compact ? 44 : 56} />
		<Text fontSize="sm" color={MUTED} maxW="380px">
			Lopu builds pages, components and actions as you — sign in and she remembers every conversation.
		</Text>
		<Button as={RouterLink} to="/login" size="sm" bg="var(--tt-accent, #7c6cff)" color="var(--tt-accent-contrast, #ffffff)" _hover={{ opacity: 0.92 }}>
			Sign in to chat with Lopu
		</Button>
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

export type LopuChatViewProps = {
	// a specific conversation (null = fresh); undefined follows the shared store
	chatId?: string | null;
	onChatChange?: (chatId: string | null) => void;
	compact?: boolean;
	context?: LopuContextProvider;
	// a slim conversation switcher above the list (the floating window)
	showConversations?: boolean;
	onOpenFull?: () => void;
	applyPatches?: boolean;
	autoFocus?: boolean;
};

export const LopuChatView = ({ chatId, onChatChange, compact = false, context, showConversations = false, onOpenFull, applyPatches, autoFocus }: LopuChatViewProps) => {
	const chat = useLopuChat({ chatId, context, applyPatches });
	const [draft, setDraft] = React.useState('');
	const scrollRef = React.useRef<HTMLDivElement | null>(null);
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

	const send = React.useCallback(
		async (text: string) => {
			setDraft('');
			stickRef.current = true;
			const result = await chat.send(text);
			// a turn that never reached the server hands the text back
			if (result.ok === false && result.text) setDraft((current) => current || result.text);
		},
		[chat]
	);

	const items = chat.timeline;
	const streamingHere = !!chat.streaming;
	const activeName = chat.chat?.name || (chat.chatId ? 'Conversation' : 'New chat');

	return (
		<Flex className="lopuChatView" data-compact={compact ? 'true' : 'false'} direction="column" flex={1} height="100%" minH={0} minW={0} width="100%">
			{showConversations ? (
				<Flex align="center" gap={2} px={compact ? 2 : 0} py={1.5} borderBottom="1px solid var(--tt-border, #ececef)" flexShrink={0}>
					<Menu isLazy>
						<MenuButton as={Button} size="xs" variant="ghost" height="26px" px={2} fontWeight={600} color={INK} maxW="calc(100% - 40px)">
							<Text as="span" isTruncated>
								💬 {activeName} ▾
							</Text>
						</MenuButton>
						<MenuList fontSize="sm" maxH="320px" overflowY="auto" zIndex={20}>
							<MenuItem onClick={() => chat.selectChat(null)}>＋ New chat</MenuItem>
							{chat.chats.length ? <MenuDivider /> : null}
							{chat.chats.slice(0, 12).map((entry) => (
								<MenuItem key={entry.id} onClick={() => chat.selectChat(entry.id)} fontWeight={entry.id === chat.chatId ? 700 : 400}>
									<Text as="span" isTruncated maxW="240px">
										{entry.name || 'Lopu'}
									</Text>
									<Text as="span" fontSize="10px" color={MUTED} ml="auto" pl={3}>
										{relativeTime(entry.updatedAt)}
									</Text>
								</MenuItem>
							))}
						</MenuList>
					</Menu>
					<Box flex={1} />
					{onOpenFull ? (
						<Button size="xs" variant="ghost" height="26px" px={2} onClick={onOpenFull} title="Open the full Lopu page" aria-label="Open the full Lopu page">
							⤢
						</Button>
					) : null}
				</Flex>
			) : null}

			<Box ref={scrollRef} onScroll={onScroll} flex={1} minH={0} overflowY="auto" overflowX="hidden" px={compact ? 2 : 1} py={3} display="flex" flexDirection="column" rowGap={3}>
				{!chat.viewer.id ? (
					<SignedOutState compact={compact} />
				) : items.length === 0 ? (
					<EmptyState onPick={send} compact={compact} onOpenFull={onOpenFull} />
				) : (
					items.map((item, index) => {
						const previous = items[index - 1];
						const previousIsLopu = !!previous && (previous.kind === 'turn' || previous.role === 'assistant');
						if (item.kind === 'turn') {
							return <TurnBubble key={item.turn.requestId} turn={item.turn} showAvatar={!previousIsLopu} canUndo={chat.canUndoPatch} onUndo={chat.undoPatch} />;
						}
						return <MessageBubble key={item.message.id} message={item.message} role={item.role} showAvatar={item.role === 'assistant' && !previousIsLopu} />;
					})
				)}
			</Box>

			<Box flexShrink={0} px={compact ? 2 : 0} pb={compact ? 2 : 0} pt={1}>
				<LopuComposer
					value={draft}
					onChange={setDraft}
					onSend={send}
					onStop={chat.abort}
					streaming={streamingHere || chat.sending}
					disabled={!chat.viewer.id}
					enterSends={chat.preferences.enterSends}
					models={chat.models}
					settings={chat.settings}
					defaults={chat.defaults}
					onSettingsChange={chat.setSettings}
					contextLabel={chat.contextLabel}
					compact={compact}
					autoFocus={autoFocus}
				/>
			</Box>
		</Flex>
	);
};
