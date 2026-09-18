import React from 'react';
import { Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { Plus } from 'lucide-react';
import { Link as RouterLink } from 'react-router';
import { LopuChatTaskRing } from './LopuTaskRing';
import type { LopuChatSummary } from './lopuChatStore';
import { LOPU_UI } from './lopuTheme';
import { lopuPlainText } from './lopuTurnCore';
import type { UseLopuChat } from './useLopuChat';

const relativeTime = (iso: string | null | undefined): string => {
	const at = iso ? Date.parse(iso) : NaN;
	if (!Number.isFinite(at)) return '';
	const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
	if (seconds < 60) return 'now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const TextAction = (props: { onClick?: () => void; title: string; children: React.ReactNode; danger?: boolean; as?: any; to?: string }) => (
	<Box
		as={props.as ?? 'button'}
		to={props.to}
		type={props.as ? undefined : 'button'}
		fontSize="11px"
		fontWeight={600}
		color={LOPU_UI.muted}
		borderRadius={LOPU_UI.radiusXs}
		px={1.5}
		py="2px"
		cursor="pointer"
		title={props.title}
		_hover={{ color: props.danger ? 'var(--tt-danger, #d64545)' : LOPU_UI.ink, background: LOPU_UI.surfaceHover }}
		_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '1px' }}
		onClick={props.onClick}
	>
		{props.children}
	</Box>
);

const ConversationRow = ({
	chat,
	selected,
	confirmDeletes,
	onSelect,
	onRename,
	onDelete,
	onArchive
}: {
	chat: LopuChatSummary;
	selected: boolean;
	confirmDeletes: boolean;
	onSelect: () => void;
	onRename: (title: string) => void;
	onDelete: () => void;
	onArchive: () => void;
}) => {
	const [editing, setEditing] = React.useState(false);
	const [title, setTitle] = React.useState(chat.name || '');
	const [confirming, setConfirming] = React.useState(false);
	const name = chat.name || 'Lopu';
	// the last line as plain text — markdown markers never show in a preview
	const preview = lopuPlainText(chat.lastMessage?.text || '');

	const commitRename = () => {
		setEditing(false);
		const next = title.trim();
		if (next && next !== chat.name) onRename(next);
		else setTitle(chat.name || '');
	};

	const requestDelete = () => {
		if (confirmDeletes) setConfirming(true);
		else onDelete();
	};

	return (
		<Box
			role="group"
			className="lopuConversationRow"
			onClick={editing ? undefined : onSelect}
			onKeyDown={(event) => {
				if (editing || event.target !== event.currentTarget) return;
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onSelect();
				}
			}}
			tabIndex={editing ? -1 : 0}
			cursor="pointer"
			borderRadius={LOPU_UI.radiusMd}
			px={3}
			py={2}
			bg={selected ? LOPU_UI.surfaceAlt : 'transparent'}
			_hover={{ bg: LOPU_UI.surfaceAlt }}
			_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '-2px' }}
			transition={`background ${LOPU_UI.transitionFast}`}
			data-selected={selected ? 'true' : 'false'}
		>
			{editing ? (
				<Input
					size="xs"
					value={title}
					autoFocus
					borderColor={LOPU_UI.borderColor}
					borderRadius={LOPU_UI.radiusSm}
					fontSize="13px"
					onChange={(event) => setTitle(event.target.value)}
					onBlur={commitRename}
					onKeyDown={(event) => {
						if (event.key === 'Enter') commitRename();
						if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							setTitle(chat.name || '');
							setEditing(false);
						}
					}}
					onClick={(event) => event.stopPropagation()}
					aria-label="Conversation name"
				/>
			) : (
				<Flex align="center" gap={2} minW={0}>
					<LopuChatTaskRing chatId={chat.id} />
					<Text fontSize="13px" fontWeight={selected ? 700 : 600} color={LOPU_UI.ink} isTruncated flex={1}>
						{name}
					</Text>
					<Text fontSize="11px" color={LOPU_UI.faint} flexShrink={0}>
						{relativeTime(chat.updatedAt)}
					</Text>
				</Flex>
			)}
			{!editing && preview ? (
				<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} isTruncated mt="1px">
					{preview}
				</Text>
			) : null}
			<Flex flexWrap="wrap" gap={0.5} mt={1} ml={-1.5} align="center" onClick={(event) => event.stopPropagation()}>
				{confirming ? (
					<>
						<Text fontSize="11px" color={LOPU_UI.muted} px={1.5}>
							Delete?
						</Text>
						<TextAction title="Delete this conversation" danger onClick={onDelete}>
							Yes, delete
						</TextAction>
						<TextAction title="Keep it" onClick={() => setConfirming(false)}>
							Keep
						</TextAction>
					</>
				) : (
					<>
						<TextAction title="Rename" onClick={() => setEditing(true)}>
							Rename
						</TextAction>
						<TextAction title={chat.lopu?.archived ? 'Restore conversation' : 'Archive conversation'} onClick={onArchive}>
							{chat.lopu?.archived ? 'Restore' : 'Archive'}
						</TextAction>
						<TextAction title="Delete" danger onClick={requestDelete}>
							Delete
						</TextAction>
						<TextAction title="Open in Messenger" as={RouterLink} to={`/messages?chat=${encodeURIComponent(chat.id)}`}>
							Messenger ↗
						</TextAction>
					</>
				)}
			</Flex>
		</Box>
	);
};

// New chat + the rows; the sidebar on desktop (its list ends above the
// site's fixed bottom-left "Edit page" chip), the sheet body on mobile
export const LopuConversationList = ({ chat, onPicked, bottomInset }: { chat: UseLopuChat; onPicked?: () => void; bottomInset?: string }) => {
	const [archived, setArchived] = React.useState(false);
	const visibleChats = chat.chats.filter((entry) => (entry.lopu?.archived === true) === archived);
	return (
		<Flex direction="column" gap={2} minH={0} minW={0} flex={1}>
			<Button
				size="sm"
				height="36px"
				variant="outline"
				leftIcon={<Plus size={14} strokeWidth={2.2} />}
				borderColor={LOPU_UI.borderColor}
				borderRadius={LOPU_UI.radiusMd}
				bg={LOPU_UI.card}
				color={LOPU_UI.ink}
				justifyContent="flex-start"
				fontWeight={600}
				fontSize="13px"
				_hover={{ bg: LOPU_UI.surfaceAlt }}
				onClick={() => {
					setArchived(false);
					chat.selectChat(null);
					onPicked?.();
				}}
				flexShrink={0}
			>
				New chat
			</Button>
			<Flex gap={1} role="group" aria-label="Conversation view" flexShrink={0}>
				{[false, true].map((value) => (
					<Button
						key={String(value)}
						size="sm"
						flex={1}
						minW={0}
						variant={archived === value ? 'solid' : 'ghost'}
						aria-pressed={archived === value}
						onClick={() => setArchived(value)}
						color={LOPU_UI.ink}
					>
						{value ? 'Archived' : 'Chats'}
					</Button>
				))}
			</Flex>
			<Box flex={1} minH={0} overflowY="auto" overflowX="hidden" mx={-1} px={1} pb={bottomInset}>
				{visibleChats.length === 0 ? (
					<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} px={3} py={2}>
						{chat.chatsLoaded ? (archived ? 'No archived conversations.' : 'No conversations yet — say hi.') : ''}
					</Text>
				) : (
					<Flex direction="column" gap="2px">
						{visibleChats.map((entry) => (
							<ConversationRow
								key={entry.id}
								chat={entry}
								selected={entry.id === chat.chatId}
								confirmDeletes={chat.preferences.confirmDeletes}
								onSelect={() => {
									chat.selectChat(entry.id);
									onPicked?.();
								}}
								onArchive={() => void chat.archiveChat(entry.id, !archived)}
								onRename={(title) => void chat.renameChat(entry.id, title)}
								onDelete={() => void chat.deleteChat(entry.id)}
							/>
						))}
					</Flex>
				)}
			</Box>
		</Flex>
	);
};
