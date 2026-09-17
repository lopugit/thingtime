import { useLopuVisualViewport } from './useLopuVisualViewport';
import { LopuConversationList } from './LopuConversationList';
import React from 'react';
import { Box, Button, Center, Flex, Text } from '@chakra-ui/react';
import { MessagesSquare, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router';

import { PAGE_TOP_CLEARANCE, PageHeader, PageShell } from '~/components/Layout/PageShell';
import { LOPU_WINDOW_Z, useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { LopuRingAvatar } from './LopuActivityBadge';
import { describeModelChoice } from './LopuModelPicker';
import { LopuVoiceSurface, lopuVoicePhaseLabel, type LopuVoicePhase } from './LopuVoiceControls';
import { LOPU_UI } from './lopuTheme';
import { useLopuChat, type UseLopuChat } from './useLopuChat';
import { LOPU_PAGE_PATH, LOPU_VOICE_PATH, isLopuVoicePath } from './useLopuSettings';

// 🦄 The Lopu page — one calm surface with two modes:
//   /lopu, /lopu/:chatId → chat (the shared LopuChatView in a centred
//                          760px column; a 272px conversations sidebar on
//                          desktop, a conversations sheet on mobile)
//   /lopu/voice          → voice (the same column with LopuVoiceSurface:
//                          mic · interim transcript · session gear)
// The route is full-bleed (Main's FULL_BLEED_PATHS): the list scrolls inside
// its own pane under the composer, never the page; the composer sits above
// the safe area on mobile. Signed out (or a temporary visitor): a quiet state
// that says what Lopu does, with a login CTA.

export type LopuPageMode = 'chat' | 'voice';

const SIDEBAR_CACHE_KEY = 'tt-lopu-sidebar';

const readSidebarOpen = (): boolean => {
	const cached = readLocalCache<{ open?: unknown }>(SIDEBAR_CACHE_KEY);
	return cached && typeof cached === 'object' && typeof cached.open === 'boolean' ? cached.open : true;
};

// Chat | Voice — route-driven, so each mode is a real, linkable page
const ModeSwitch = ({ mode, chatHref, compact }: { mode: LopuPageMode; chatHref: string; compact?: boolean }) => {
	const entries: { id: LopuPageMode; label: string; to: string }[] = [
		{ id: 'chat', label: 'Chat', to: chatHref },
		{ id: 'voice', label: 'Voice', to: chatHref === LOPU_PAGE_PATH ? LOPU_VOICE_PATH : `${LOPU_VOICE_PATH}?chat=${encodeURIComponent(decodeURIComponent(chatHref.slice(LOPU_PAGE_PATH.length + 1)))}` }
	];
	return (
		<Flex className="lopuModeSwitch" role="group" aria-label="Lopu mode" p="2px" border={LOPU_UI.border} borderRadius="999px" bg={LOPU_UI.surfaceAlt} flexShrink={0}>
			{entries.map((entry) => {
				const selected = entry.id === mode;
				return (
					<Center
						key={entry.id}
						as={RouterLink}
						to={entry.to}
						aria-current={selected ? 'page' : undefined}
						px={compact ? 3 : 3.5}
						height={compact ? '32px' : '28px'}
						minW={compact ? '60px' : '64px'}
						borderRadius="999px"
						fontSize="13px"
						fontWeight={600}
						bg={selected ? LOPU_UI.card : 'transparent'}
						color={selected ? LOPU_UI.ink : LOPU_UI.muted}
						boxShadow={selected ? LOPU_UI.shadowCard : 'none'}
						transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
						_hover={{ color: LOPU_UI.ink }}
						_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '2px' }}
					>
						{entry.label}
					</Center>
				);
			})}
		</Flex>
	);
};

const HeaderIconButton = (props: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean; size?: number }) => {
	const size = props.size ?? 32;
	return (
		<Center
			as="button"
			type="button"
			aria-label={props.label}
			title={props.label}
			aria-pressed={props.active}
			width={`${size}px`}
			height={`${size}px`}
			flexShrink={0}
			borderRadius="999px"
			border={LOPU_UI.border}
			bg={LOPU_UI.card}
			color={LOPU_UI.muted}
			cursor="pointer"
			transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
			_hover={{ bg: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
			_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '2px' }}
			sx={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
			onClick={props.onClick}
		>
			{props.children}
		</Center>
	);
};

const QuietState = () => (
	<Box maxW="640px" bg={LOPU_UI.card} border={LOPU_UI.border} borderRadius={LOPU_UI.radiusXl} p={{ base: 5, md: 7 }}>
		<Flex align="center" gap={3} mb={4}>
			<LopuRingAvatar size={44} />
			<Box>
				<Text fontSize="17px" fontWeight={700} color={LOPU_UI.ink} lineHeight="1.3">
					Meet Lopu
				</Text>
				<Text fontSize={LOPU_UI.fontBody} color={LOPU_UI.muted}>
					Thingtime&apos;s assistant — it builds things for you, as you.
				</Text>
			</Box>
		</Flex>
		<Flex direction="column" gap={2} fontSize={LOPU_UI.fontBody} color="var(--tt-text, #33333c)" lineHeight="1.6">
			{[
				'Builds webpages and sections in the builder — live, block by block, while it is still typing.',
				'Makes reusable components and declarative actions, then runs them for you.',
				'Searches and explains your things, schemas and data.',
				'Talks: a voice mode with spoken replies, and a transcribe mode that keeps private notes.',
				'Remembers every conversation in Messenger.'
			].map((line) => (
				<Flex key={line} gap={3} align="flex-start">
					<Box as="span" width="5px" height="5px" borderRadius="999px" bg={LOPU_UI.faint} mt="9px" flexShrink={0} aria-hidden />
					<Text as="span" whiteSpace="normal">
						{line}
					</Text>
				</Flex>
			))}
		</Flex>
		<Flex gap={2} wrap="wrap" mt={5}>
			<Button as={RouterLink} to="/login" size="sm" height="36px" px={4} bg={LOPU_UI.ink} color={LOPU_UI.card} borderRadius={LOPU_UI.radiusMd} _hover={{ opacity: 0.9 }}>
				Sign in to chat with Lopu
			</Button>
			<Button as={RouterLink} to="/register" size="sm" height="36px" px={4} variant="outline" borderColor={LOPU_UI.borderColor} borderRadius={LOPU_UI.radiusMd} color={LOPU_UI.ink} _hover={{ bg: LOPU_UI.surfaceAlt }}>
				Create an account
			</Button>
		</Flex>
	</Box>
);

// Mobile: conversations live in a bottom sheet
const ConversationsSheet = ({ chat, open, onClose }: { chat: UseLopuChat; open: boolean; onClose: () => void }) => {
	React.useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<>
			<Box position="fixed" inset={0} zIndex={LOPU_WINDOW_Z - 1} bg="rgba(0, 0, 0, 0.28)" onClick={onClose} />
			<Flex
				role="dialog"
				aria-modal="true"
				aria-label="Conversations"
				position="fixed"
				left={0}
				right={0}
				bottom={0}
				zIndex={LOPU_WINDOW_Z}
				height="72vh"
				sx={{ '@supports (height: 100dvh)': { height: '72dvh' } }}
				direction="column"
				bg={LOPU_UI.card}
				borderTopRadius={LOPU_UI.radiusXl}
				boxShadow={LOPU_UI.shadowFloating}
				pb="var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px))"
			>
				<Center pt={2} pb={1} flexShrink={0}>
					<Box width="36px" height="4px" borderRadius="999px" bg={LOPU_UI.borderColor} aria-hidden />
				</Center>
				<Flex align="center" px={4} py={2} flexShrink={0}>
					<Text fontSize="15px" fontWeight={700} color={LOPU_UI.ink}>
						Conversations
					</Text>
					<Box flex={1} />
					<HeaderIconButton label="Close" onClick={onClose} size={36}>
						<X size={16} strokeWidth={2} />
					</HeaderIconButton>
				</Flex>
				<Box flex={1} minH={0} px={4} pb={3} display="flex" flexDirection="column">
					<LopuConversationList chat={chat} onPicked={onClose} />
				</Box>
			</Flex>
		</>
	);
};

export const LopuPage = (props: { mode?: LopuPageMode }) => {
	const visualViewport = useLopuVisualViewport();
	const { chatId: routeChatId } = useParams();
	const { pathname, search } = useLocation();
	const navigate = useNavigate();
	const user = useCurrentUser();
	const isMobile = useIsMobileViewport();
	const mode: LopuPageMode = props.mode ?? (isLopuVoicePath(pathname) ? 'voice' : 'chat');
	const signedIn = !!user && !user.temporary;
	// voice follows the store's current conversation (no chat id in its URL)
	const chatId = mode === 'voice' ? (new URLSearchParams(search).get('chat') || undefined) : (routeChatId ?? undefined);
	const chat = useLopuChat({ chatId });

	const [sidebarOpen, setSidebarOpen] = React.useState(readSidebarOpen);
	const [sheetOpen, setSheetOpen] = React.useState(false);
	const [voicePhase, setVoicePhase] = React.useState<LopuVoicePhase>('idle');

	const toggleSidebar = React.useCallback(() => {
		setSidebarOpen((current) => {
			writeLocalCache(SIDEBAR_CACHE_KEY, { open: !current });
			return !current;
		});
	}, []);

	const closeSheet = React.useCallback(() => setSheetOpen(false), []);

	// the chat mode mirrors the conversation into the URL; voice keeps its own
	const onChatChange = React.useCallback(
		(nextChatId: string | null) => {
			const next = mode === 'voice'
				? `${LOPU_VOICE_PATH}${nextChatId ? `?chat=${encodeURIComponent(nextChatId)}` : ''}`
				: nextChatId ? `${LOPU_PAGE_PATH}/${encodeURIComponent(nextChatId)}` : LOPU_PAGE_PATH;
			navigate(next, { replace: true });
		},
		[mode, navigate]
	);

	// leaving voice mode drops its phase from the status line
	React.useEffect(() => {
		if (mode !== 'voice') setVoicePhase('idle');
	}, [mode]);

	const chatHref = chat.chatId ? `${LOPU_PAGE_PATH}/${encodeURIComponent(chat.chatId)}` : LOPU_PAGE_PATH;
	const modelLine = describeModelChoice(chat.models, chat.settings);
	// a locked account (verified-credits design note §4): the column shows
	// LopuLockedState (LopuChatView / LopuVoiceSurface draw it) and the status
	// line says why; the conversations sidebar stays — history is the user's
	const locked = signedIn && chat.account.access.locked;
	const status = locked
		? 'Invite-only — waiting for an admin to verify you'
		: mode === 'voice' && voicePhase !== 'idle'
			? lopuVoicePhaseLabel(voicePhase)
			: mode === 'voice'
				? `${modelLine} · voice`
				: modelLine;

	if (!signedIn) {
		return (
			<PageShell width={1100}>
				<PageHeader
					eyebrow="Thingtime · your AI"
					variant="ink"
					title={
						<Flex as="span" align="center" gap={3}>
							<LopuRingAvatar size={36} />
							<Box as="span">Lopu</Box>
						</Flex>
					}
					subtitle="Your assistant for building with Thingtime."
				/>
				<QuietState />
			</PageShell>
		);
	}

	const column = (
		<Box
			className="lopuConversationColumn"
			data-mode={mode}
			flex={1}
			minH={0}
			minW={0}
			width="100%"
			maxW={isMobile ? '100%' : LOPU_UI.conversationMaxWidth}
			mx="auto"
			display="flex"
			flexDirection="column"
			bg={isMobile ? 'transparent' : LOPU_UI.card}
			border={isMobile ? 'none' : LOPU_UI.border}
			borderRadius={isMobile ? 0 : LOPU_UI.radiusXl}
			px={isMobile ? 0 : 4}
			py={isMobile ? 0 : 3}
		>
			<LopuVoiceSurface voiceMode={mode === 'voice'} chatId={chatId} onChatChange={onChatChange} onPhaseChange={setVoicePhase} />
		</Box>
	);

	if (isMobile) {
		return (
			<PageShell
				width={1100}
				columnProps={{
					px: 3,
					pb: visualViewport?.keyboardOpen ? '8px' : 'calc(var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 8px)',
					height: `calc(${visualViewport ? `${visualViewport.height}px` : '100dvh'} - ${PAGE_TOP_CLEARANCE})`,
					minHeight: 0,
					rowGap: 0
				}}
			>
				<Flex align="center" gap={2.5} py={2} minH="52px" flexShrink={0}>
					<LopuRingAvatar size={30} />
					<Box minW={0} flex={1}>
						<Text fontSize="15px" fontWeight={700} color={LOPU_UI.ink} lineHeight="1.2">
							Lopu
						</Text>
						<Text fontSize="11px" color={LOPU_UI.muted} noOfLines={1} lineHeight="1.3">
							{status}
						</Text>
					</Box>
					<ModeSwitch mode={mode} chatHref={chatHref} compact />
					<HeaderIconButton label="Conversations" onClick={() => setSheetOpen(true)} size={36}>
						<MessagesSquare size={16} strokeWidth={2} />
					</HeaderIconButton>
				</Flex>
				{column}
				<ConversationsSheet chat={chat} open={sheetOpen} onClose={closeSheet} />
			</PageShell>
		);
	}

	return (
		<PageShell
			width={1100}
			columnProps={{
				pb: 4,
				height: `calc(100dvh - ${PAGE_TOP_CLEARANCE})`,
				minHeight: 0,
				rowGap: 4
			}}
		>
			<Box flexShrink={0}>
				<PageHeader
					eyebrow="Thingtime · your AI"
					variant="ink"
					title={
						<Flex as="span" align="center" gap={3}>
							<LopuRingAvatar size={36} />
							<Box as="span">Lopu</Box>
						</Flex>
					}
					subtitle={status}
					after={
						<Flex align="center" gap={2} pb={1}>
							<ModeSwitch mode={mode} chatHref={chatHref} />
							<HeaderIconButton label={sidebarOpen ? 'Hide conversations' : 'Show conversations'} onClick={toggleSidebar} active={sidebarOpen}>
								{sidebarOpen ? <PanelLeftClose size={15} strokeWidth={2} /> : <PanelLeftOpen size={15} strokeWidth={2} />}
							</HeaderIconButton>
						</Flex>
					}
				/>
			</Box>
			<Flex flex={1} minH={0} gap={6}>
				{sidebarOpen ? (
					<Flex className="lopuConversationsSidebar" direction="column" width={LOPU_UI.sidebarWidth} flexShrink={0} minH={0}>
						<Text sx={LOPU_UI.eyebrow} px={3} mb={2}>
							Conversations
						</Text>
						<LopuConversationList chat={chat} bottomInset="56px" />
					</Flex>
				) : null}
				<Flex flex={1} minW={0} minH={0} justify="center">
					{column}
				</Flex>
			</Flex>
		</PageShell>
	);
};
