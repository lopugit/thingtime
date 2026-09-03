import React from 'react';
import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';

import { PAGE_TOP_CLEARANCE, PageHeader, PageShell } from '~/components/Layout/PageShell';
import { useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';
import { LopuAvatar, LopuChatView } from './LopuChatView';
import type { LopuChatSummary } from './lopuChatStore';
import { useLopuChat } from './useLopuChat';

// /lopu and /lopu/:chatId (design note §3.2): the full-page Lopu — the
// canonical page scaffold (PageShell 1100 + PageHeader), a conversations
// column (new chat, rename, delete, open in Messenger) and the shared
// LopuChatView. The route is full-bleed (Main's FULL_BLEED_PATHS): the chat
// list scrolls inside its own pane under the composer, never the page.
// Signed out (or a temporary visitor): a quiet state that says what Lopu
// does, with a login CTA.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';

const relativeTime = (iso: string | null | undefined): string => {
	const at = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(at)) return '';
	const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(at).toLocaleDateString();
};

const ConversationRow = ({
	chat,
	selected,
	onSelect,
	onRename,
	onDelete
}: {
	chat: LopuChatSummary;
	selected: boolean;
	onSelect: () => void;
	onRename: (title: string) => void;
	onDelete: () => void;
}) => {
	const [editing, setEditing] = React.useState(false);
	const [title, setTitle] = React.useState(chat.name || '');
	const [confirming, setConfirming] = React.useState(false);
	const name = chat.name || 'Lopu';
	const preview = chat.lastMessage?.text || '';

	const commitRename = () => {
		setEditing(false);
		const next = title.trim();
		if (next && next !== chat.name) onRename(next);
		else setTitle(chat.name || '');
	};

	return (
		<Box
			role="group"
			onClick={editing ? undefined : onSelect}
			cursor="pointer"
			borderRadius="12px"
			px={3}
			py={2}
			bg={selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
			border="1px solid"
			borderColor={selected ? 'var(--tt-border, #ececef)' : 'transparent'}
			_hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
			transition="background 120ms"
			data-selected={selected ? 'true' : 'false'}
		>
			{editing ? (
				<Input
					size="xs"
					value={title}
					autoFocus
					onChange={(event) => setTitle(event.target.value)}
					onBlur={commitRename}
					onKeyDown={(event) => {
						if (event.key === 'Enter') commitRename();
						if (event.key === 'Escape') {
							setTitle(chat.name || '');
							setEditing(false);
						}
					}}
					onClick={(event) => event.stopPropagation()}
					aria-label="Conversation name"
				/>
			) : (
				<Flex align="baseline" gap={2} minW={0}>
					<Text fontSize="sm" fontWeight={selected ? 700 : 600} color={INK} isTruncated flex={1}>
						{name}
					</Text>
					<Text fontSize="10px" color={MUTED} flexShrink={0}>
						{relativeTime(chat.updatedAt)}
					</Text>
				</Flex>
			)}
			{!editing && preview ? (
				<Text fontSize="xs" color={MUTED} isTruncated mt="1px">
					{preview}
				</Text>
			) : null}
			<Flex gap={1} mt={1} opacity={selected || confirming ? 1 : 0} _groupHover={{ opacity: 1 }} transition="opacity 120ms" onClick={(event) => event.stopPropagation()}>
				{confirming ? (
					<>
						<Text fontSize="10px" color={MUTED} alignSelf="center">
							Delete this conversation?
						</Text>
						<Button size="xs" height="20px" px={2} colorScheme="red" variant="solid" onClick={onDelete}>
							Delete
						</Button>
						<Button size="xs" height="20px" px={2} variant="ghost" onClick={() => setConfirming(false)}>
							Keep
						</Button>
					</>
				) : (
					<>
						<Button size="xs" height="20px" px={2} variant="ghost" fontWeight={500} color={MUTED} onClick={() => setEditing(true)} title="Rename">
							Rename
						</Button>
						<Button size="xs" height="20px" px={2} variant="ghost" fontWeight={500} color={MUTED} onClick={() => setConfirming(true)} title="Delete">
							Delete
						</Button>
						<Button
							as={RouterLink}
							to={`/messages?chat=${encodeURIComponent(chat.id)}`}
							size="xs"
							height="20px"
							px={2}
							variant="ghost"
							fontWeight={500}
							color={MUTED}
							title="Open in Messenger"
						>
							Messenger ↗
						</Button>
					</>
				)}
			</Flex>
		</Box>
	);
};

const QuietState = () => (
	<Box {...CARD_STYLES} p={{ base: 5, md: 8 }} maxW="720px">
		<Flex align="center" gap={3} mb={3}>
			<LopuAvatar size={44} />
			<Box>
				<Text fontSize="lg" fontWeight={800} color={INK}>
					Meet Lopu, Thingtime&apos;s AI
				</Text>
				<Text fontSize="sm" color={MUTED}>
					A whimsical unicorn who builds things for you — as you.
				</Text>
			</Box>
		</Flex>
		<Box as="ul" pl="1.2em" color="var(--tt-text, #33333c)" fontSize="sm" lineHeight="1.7" mb={4} whiteSpace="normal">
			<li>Builds webpages and sections in the builder — live, block by block, while she is still typing.</li>
			<li>Makes reusable components and declarative actions, then runs them for you.</li>
			<li>Searches and explains your things, schemas and data.</li>
			<li>Remembers every conversation in Messenger.</li>
		</Box>
		<Flex gap={2} wrap="wrap">
			<Button as={RouterLink} to="/login" size="sm" bg="var(--tt-accent, #7c6cff)" color="var(--tt-accent-contrast, #ffffff)" _hover={{ opacity: 0.92 }}>
				Sign in to chat with Lopu
			</Button>
			<Button as={RouterLink} to="/register" size="sm" variant="outline" borderColor="var(--tt-border, #ececef)">
				Create an account
			</Button>
		</Flex>
	</Box>
);

export const LopuPage = () => {
	const { chatId: routeChatId } = useParams();
	const navigate = useNavigate();
	const user = useCurrentUser();
	const isMobile = useIsMobileViewport();
	const signedIn = !!user && !user.temporary;
	const chat = useLopuChat({ chatId: routeChatId ?? undefined });
	const createChat = chat.createChat;
	const creatingChatRef = React.useRef(false);

	const startNewChat = React.useCallback(async () => {
		if (creatingChatRef.current) return;
		creatingChatRef.current = true;
		const chatId = `lopu-chat-${crypto.randomUUID()}`;
		navigate(`/lopu/${encodeURIComponent(chatId)}`, { replace: true });
		try {
			const result = await createChat({ chatId });
			if (result.ok && result.chat?.id && result.chat.id !== chatId) navigate(`/lopu/${encodeURIComponent(result.chat.id)}`, { replace: true });
		} finally {
			creatingChatRef.current = false;
		}
	}, [createChat, navigate]);

	React.useEffect(() => {
		if (!signedIn || routeChatId !== undefined) return;
		void startNewChat();
	}, [routeChatId, signedIn, startNewChat]);

	const onChatChange = React.useCallback(
		(chatId: string | null) => {
			navigate(chatId ? `/lopu/${encodeURIComponent(chatId)}` : '/lopu', { replace: true });
		},
		[navigate]
	);

	if (!signedIn) {
		return (
			<PageShell width={1100}>
				<PageHeader eyebrow="Thingtime · your AI" title="Lopu 🦄" subtitle="Your assistant for building with Thingtime." />
				<QuietState />
			</PageShell>
		);
	}

	const conversations = (
		<Flex direction="column" gap={1} minH={0}>
			<Button
				size="sm"
				variant="outline"
				borderColor="var(--tt-border, #ececef)"
				bg="var(--tt-card, #ffffff)"
				justifyContent="flex-start"
				fontWeight={600}
				onClick={() => void startNewChat()}
				flexShrink={0}
			>
				＋ New chat
			</Button>
			<Box flex={1} minH={0} overflowY="auto" pr={1} mt={1}>
				{chat.chats.length === 0 ? (
					<Text fontSize="xs" color={MUTED} px={3} py={2}>
						{chat.chatsLoaded ? 'No conversations yet — say hi.' : ''}
					</Text>
				) : (
					<Flex direction="column" gap="2px">
						{chat.chats.map((entry) => (
							<ConversationRow
								key={entry.id}
								chat={entry}
								selected={entry.id === chat.chatId}
								onSelect={() => chat.selectChat(entry.id)}
								onRename={(title) => void chat.renameChat(entry.id, title)}
								onDelete={() => void chat.deleteChat(entry.id)}
							/>
						))}
					</Flex>
				)}
			</Box>
		</Flex>
	);

	return (
		<PageShell
			width={1100}
			columnProps={{
				pb: { base: 2, md: 4 },
				height: `calc(100dvh - ${PAGE_TOP_CLEARANCE})`,
				minHeight: 0,
				rowGap: { base: 2, md: 3 }
			}}
		>
			{isMobile ? (
				<Flex align="center" gap={2} pt={2} flexShrink={0}>
					<LopuAvatar size={26} />
					<Text fontSize="md" fontWeight={800} color={INK}>
						Lopu
					</Text>
					<Box flex={1} />
					<Button size="xs" variant="ghost" onClick={() => void startNewChat()}>
						＋ New
					</Button>
				</Flex>
			) : (
				<Box flexShrink={0}>
					<PageHeader
						eyebrow="Thingtime · your AI"
						title="Lopu 🦄"
						after={
							<Button as={RouterLink} to="/messages" size="xs" variant="ghost" color={MUTED}>
								All conversations ↗
							</Button>
						}
					/>
				</Box>
			)}
			{isMobile ? (
				<Flex gap={1.5} overflowX="auto" flexShrink={0} pb={1} sx={{ scrollbarWidth: 'none' }}>
					{chat.chats.slice(0, 20).map((entry) => (
						<Button
							key={entry.id}
							size="xs"
							height="26px"
							px={3}
							borderRadius="999px"
							flexShrink={0}
							variant={entry.id === chat.chatId ? 'solid' : 'outline'}
							bg={entry.id === chat.chatId ? 'var(--tt-accent, #7c6cff)' : 'var(--tt-card, #ffffff)'}
							color={entry.id === chat.chatId ? 'var(--tt-accent-contrast, #ffffff)' : INK}
							borderColor="var(--tt-border, #ececef)"
							onClick={() => chat.selectChat(entry.id)}
							maxW="180px"
						>
							<Text as="span" isTruncated>
								{entry.name || 'Lopu'}
							</Text>
						</Button>
					))}
				</Flex>
			) : null}
			<Flex flex={1} minH={0} gap={4}>
				{isMobile ? null : (
					<Box width="260px" flexShrink={0} minH={0} display="flex" flexDirection="column">
						{conversations}
					</Box>
				)}
				<Box flex={1} minH={0} minW={0} {...CARD_STYLES} p={{ base: 1, md: 2 }} display="flex" flexDirection="column">
					<LopuChatView chatId={routeChatId ?? undefined} onChatChange={onChatChange} autoFocus={!isMobile} />
				</Box>
			</Flex>
		</PageShell>
	);
};
