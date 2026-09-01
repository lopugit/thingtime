import React from 'react';
import { Box, Flex, Input, Text } from '@chakra-ui/react';

import { DRAWER_POPUP_Z } from '../Nav/Drawer/useDrawer';
import { CARD_STYLES } from '../../theme/card';
import { blockLabel, type WebpageBlock, type WebpageContainerDirection } from './webpageBlocks';

// Right-click menu for a block (also opened by the chip's ⊞ shortcut, which
// jumps straight to the wrap drill-down). Wrap targets are the container
// blocks — the only block kind that can hold children in the block model;
// the searchable drill-down filters them, and the note says why a component
// can't be a wrapper (no children slot — yet).

const WRAP_TARGETS: Array<{ direction: WebpageContainerDirection; icon: string; label: string; hint: string }> = [
	{ direction: 'column', icon: '⬇️', label: 'Column', hint: 'stack vertically' },
	{ direction: 'row', icon: '➡️', label: 'Row', hint: 'sit side by side' },
	{ direction: 'grid', icon: '🔲', label: 'Grid', hint: 'cells in columns' }
];

const MenuRow = ({
	icon,
	label,
	hint,
	danger,
	onClick,
	testId,
	chevron
}: {
	icon: string;
	label: string;
	hint?: string;
	danger?: boolean;
	onClick: () => void;
	testId?: string;
	chevron?: boolean;
}) => (
	<Flex
		as="button"
		type="button"
		data-testid={testId}
		alignItems="center"
		columnGap={2}
		width="100%"
		textAlign="left"
		paddingX={3}
		paddingY="8px"
		borderRadius="var(--tt-radius-sm, 9px)"
		color={danger ? 'var(--tt-danger, #d6455a)' : 'var(--tt-ink, #16161a)'}
		fontSize="13px"
		cursor="pointer"
		_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
		onClick={onClick}
	>
		<Box as="span" width="18px" textAlign="center" aria-hidden>
			{icon}
		</Box>
		<Box as="span" flex="1">
			{label}
			{hint ? (
				<Box as="span" color="var(--tt-muted, #9a9aa6)" fontSize="11px" marginLeft={2}>
					{hint}
				</Box>
			) : null}
		</Box>
		{chevron ? (
			<Box as="span" color="var(--tt-muted, #9a9aa6)" aria-hidden>
				▸
			</Box>
		) : null}
	</Flex>
);

export const BlockContextMenu = ({
	block,
	x,
	y,
	wrapOnly,
	onClose,
	onWrap,
	onDuplicate,
	onDelete,
	onMove,
	onOpenRichEditor
}: {
	block: WebpageBlock;
	x: number;
	y: number;
	// opened from the chip's ⊞ — show the wrap drill-down immediately
	wrapOnly?: boolean;
	onClose: () => void;
	onWrap: (direction: WebpageContainerDirection) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onMove: (delta: -1 | 1) => void;
	onOpenRichEditor?: () => void;
}) => {
	const [wrapOpen, setWrapOpen] = React.useState(!!wrapOnly);
	const [filter, setFilter] = React.useState('');
	const menuRef = React.useRef<HTMLDivElement | null>(null);

	React.useEffect(() => {
		const onDown = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.code === 'Escape') {
				// closing the menu consumes the Escape — the canvas's deselect
				// listener checks defaultPrevented and leaves the selection alone
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener('mousedown', onDown);
		// CAPTURE phase: the canvas's own Escape-deselect listener (registered
		// earlier, bubble phase) must see this Escape already consumed
		window.addEventListener('keydown', onKey, true);
		return () => {
			window.removeEventListener('mousedown', onDown);
			window.removeEventListener('keydown', onKey, true);
		};
	}, [onClose]);

	const width = 280;
	const left = Math.max(8, Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1280) - width - 8));
	const top = Math.max(8, Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 260));
	const targets = WRAP_TARGETS.filter(
		(target) => !filter.trim() || `${target.label} ${target.hint}`.toLowerCase().includes(filter.trim().toLowerCase())
	);

	return (
		<Box
			ref={menuRef}
			className="ttBlockContextMenu"
			data-testid="block-context-menu"
			position="fixed"
			left={`${left}px`}
			top={`${top}px`}
			width={`${width}px`}
			zIndex={DRAWER_POPUP_Z + 1}
			{...CARD_STYLES}
			boxShadow="var(--tt-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.12))"
			padding={2}
			onContextMenu={(event: React.MouseEvent) => event.preventDefault()}
		>
			<Text
				color="var(--tt-muted, #9a9aa6)"
				fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
				fontSize="10px"
				fontWeight={700}
				letterSpacing="0.1em"
				textTransform="uppercase"
				paddingX={3}
				paddingY={1}
			>
				{blockLabel(block)}
			</Text>
			{!wrapOpen ? (
				<>
					{block.type === 'text' && onOpenRichEditor ? (
						<MenuRow icon="📝" label="Advanced rich editor…" testId="ctx-rich-editor" onClick={onOpenRichEditor} />
					) : null}
					{block.type !== 'native' ? (
						<MenuRow icon="⊞" label="Wrap with block" chevron testId="ctx-wrap" onClick={() => setWrapOpen(true)} />
					) : null}
					{block.type !== 'native' ? <MenuRow icon="⧉" label="Duplicate" testId="ctx-duplicate" onClick={onDuplicate} /> : null}
					<MenuRow icon="↑" label="Move up" testId="ctx-move-up" onClick={() => onMove(-1)} />
					<MenuRow icon="↓" label="Move down" testId="ctx-move-down" onClick={() => onMove(1)} />
					{block.type !== 'native' ? <MenuRow icon="🗑" label="Delete" danger testId="ctx-delete" onClick={onDelete} /> : null}
				</>
			) : (
				<>
					<Flex alignItems="center" columnGap={1} paddingX={1} paddingBottom={1}>
						{!wrapOnly ? (
							<Box
								as="button"
								type="button"
								aria-label="Back"
								fontSize="13px"
								paddingX={2}
								color="var(--tt-muted, #9a9aa6)"
								cursor="pointer"
								_hover={{ color: 'var(--tt-ink, #16161a)' }}
								onClick={() => setWrapOpen(false)}
							>
								←
							</Box>
						) : null}
						<Input
							size="sm"
							autoFocus
							placeholder="Wrap with… 🔍"
							border="1px solid"
							borderColor="var(--tt-border, #ececef)"
							borderRadius="var(--tt-radius-sm, 9px)"
							_placeholder={{ color: 'var(--tt-faint, #b6b6c0)' }}
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							data-testid="ctx-wrap-filter"
						/>
					</Flex>
					{targets.map((target) => (
						<MenuRow
							key={target.direction}
							icon={target.icon}
							label={target.label}
							hint={target.hint}
							testId={`ctx-wrap-${target.direction}`}
							onClick={() => onWrap(target.direction)}
						/>
					))}
					{!targets.length ? (
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" paddingX={3} paddingY={2}>
							no wrappers matched
						</Text>
					) : null}
					<Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" lineHeight="1.5" paddingX={3} paddingY={2}>
						Containers are the blocks that hold children — components don’t have a children slot (yet), so they can’t wrap.
					</Text>
				</>
			)}
		</Box>
	);
};
