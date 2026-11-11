import React from 'react';
import { builderRect, builderDocuments } from './builderCoordinates';
import { Box, Flex, Input, Text } from '@chakra-ui/react';

import { DRAWER_POPUP_Z } from '../Nav/Drawer/useDrawer';
import { CARD_STYLES } from '../../theme/card';
import {
	componentBlockFor,
	defaultContainerBlock,
	defaultHtmlBlock,
	defaultMediaBlock,
	defaultTextBlock,
	newBlockId,
	type WebpageBlock,
 type WebpageBlockType
} from './webpageBlocks';
import type { ComponentThingLike } from './WebpageBlocksRenderer';

// The inline "+ add new block" context menu: anchored at the insert zone the
// user clicked, quick structural blocks up top, then a live component search
// over /api/v1/components/browse (the Mongo-seeded catalog + the user's own
// published components). Picking an entry hands back a ready block AND the
// component thing so the canvas renders it instantly with no refetch.

export type InsertPick = { block: WebpageBlock; component?: ComponentThingLike };

type BrowseEntry = { id: string; crystal: Record<string, any> };

const QUICK_BLOCKS: Array<{ key: string; icon: string; label: string; make: (existing: Set<string>) => WebpageBlock }> = [
	{ key: 'text', icon: '📝', label: 'Text', make: (existing) => defaultTextBlock(existing) },
	{
		key: 'heading',
		icon: '🔠',
		label: 'Heading',
		make: (existing) => ({ id: newBlockId('heading', existing), type: 'text', text: 'A lovely heading', style: 'heading' })
	},
	{
		key: 'eyebrow',
		icon: '🏷️',
		label: 'Eyebrow',
		make: (existing) => ({ id: newBlockId('eyebrow', existing), type: 'text', text: 'Thingtime · section', style: 'eyebrow' })
	},
 { key: 'input', icon: '⌨', label: 'Input', make: existing => ({ id: newBlockId('input', existing), type: 'element', tag: 'input', props: { name: 'value', placeholder: 'Enter a value' } }) },
 { key: 'button', icon: '↗', label: 'Button', make: existing => ({ id: newBlockId('button', existing), type: 'element', tag: 'button', text: 'Button', props: { type: 'button' } }) },
 { key: 'list', icon: '☷', label: 'Editable list', make: existing => ({ id: newBlockId('list', existing), type: 'collection', props: { itemsPath: 'result.items', size: 'all' }, children: [{ id: newBlockId('value', existing), type: 'element', tag: 'p', text: '{item.name}' }] }) },
 { key: 'condition', icon: '?', label: 'Condition', make: existing => ({ id: newBlockId('condition', existing), type: 'condition', condition: { arg: 'result.ready' }, children: [] }) },
 { key: 'column', icon: '⬇️', label: 'Column', make: (existing) => defaultContainerBlock(existing, 'column') },
	{ key: 'row', icon: '➡️', label: 'Row', make: (existing) => defaultContainerBlock(existing, 'row') },
	{ key: 'grid', icon: '🔲', label: 'Grid', make: (existing) => defaultContainerBlock(existing, 'grid') },
	{ key: 'media', icon: '🖼', label: 'Media', make: (existing) => defaultMediaBlock(existing) },
	{ key: 'service', icon: '🌿', label: 'Service workspace', make: existing => ({ id: newBlockId('service', existing), type: 'html', html: `<tt-service-workspace rootId="${crypto.randomUUID()}" name="Service workspace"></tt-service-workspace>` }) },
	{ key: 'html', icon: '🧬', label: 'HTML', make: (existing) => defaultHtmlBlock(existing) }
];

export const BlockInsertMenu = (props: {
	allowedBlockTypes?: readonly WebpageBlockType[];
	anchor: HTMLElement;
	/** Host-document click point for a context command on a large/scaled block. */
	anchorPoint?: { x: number; y: number };
	existingIds: Set<string>;
	onPick: (pick: InsertPick) => void;
	onClose: () => void;
}) => {
	const { anchor, anchorPoint, existingIds, onPick, onClose, allowedBlockTypes } = props;
 const allowed = (type: WebpageBlockType) => !allowedBlockTypes || allowedBlockTypes.includes(type);
	const [query, setQuery] = React.useState('');
	const [entries, setEntries] = React.useState<BrowseEntry[]>([]);
	const [searching, setSearching] = React.useState(false);
	const menuRef = React.useRef<HTMLDivElement | null>(null);
	const inputRef = React.useRef<HTMLInputElement | null>(null);

	// Small screens get a bottom sheet (Squarespace-style) — a popover anchored
	// to a cramped zone is exactly what made mobile taps miserable. Desktop
	// keeps the anchored popover: open whichever way has more room, never grow
	// past the viewport.
	const sheet = typeof window !== 'undefined' && window.innerWidth < 640;
	const rect = anchorPoint ? {
		left: Math.max(8, Math.min(anchorPoint.x, window.innerWidth - 8)),
		top: Math.max(8, Math.min(anchorPoint.y, window.innerHeight - 8)),
		bottom: Math.max(8, Math.min(anchorPoint.y, window.innerHeight - 8)), width: 0
	} : builderRect(anchor);
	const width = 300;
	const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
	const spaceBelow = window.innerHeight - rect.bottom - 12;
	const spaceAbove = rect.top - 12;
	const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
	const maxHeight = Math.max(180, Math.min(380, openUp ? spaceAbove : spaceBelow));
	const top = openUp ? undefined : rect.bottom + 6;
	const bottom = openUp ? window.innerHeight - rect.top + 6 : undefined;

	React.useEffect(() => {
		// autofocus would pop the mobile keyboard over the bottom sheet —
		// desktop only
		if (!sheet) inputRef.current?.focus();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time layout choice
	}, []);

	React.useEffect(() => {
		const onDown = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
		};
		const onKey = (event: KeyboardEvent) => {
			// CAPTURE + preventDefault: this Escape closes the MENU only — the
			// canvas's bubble-phase deselect listener must not also fire (same
			// listener-order trap the context menu hit)
			if (event.code === 'Escape') {
				event.preventDefault();
				onClose();
			}
		};
		const documents = builderDocuments();
		for (const doc of documents) doc.addEventListener('mousedown', onDown);
		for (const doc of documents) doc.addEventListener('keydown', onKey, true);
		return () => {
			for (const doc of documents) doc.removeEventListener('mousedown', onDown);
			for (const doc of documents) doc.removeEventListener('keydown', onKey, true);
		};
	}, [onClose]);

	// debounced component search — empty query shows the newest catalog page
	React.useEffect(() => {
		if (allowedBlockTypes && !allowedBlockTypes.includes('component')) { setEntries([]); setSearching(false); return; }
		let cancelled = false;
		setSearching(true);
		const timer = setTimeout(async () => {
			try {
				const params = new URLSearchParams({ limit: '10' });
				if (query.trim()) params.set('q', query.trim());
				const response = await fetch(`/api/v1/components/browse?${params}`, { credentials: 'include' });
				const data = await response.json();
				if (!cancelled) setEntries(data?.ok ? data.components || [] : []);
			} catch {
				if (!cancelled) setEntries([]);
			} finally {
				if (!cancelled) setSearching(false);
			}
		}, 220);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, allowedBlockTypes]);

	return (
		<>
		{sheet ? (
			<Box
				position="fixed"
				top={0}
				left={0}
				right={0}
				bottom={0}
				zIndex={DRAWER_POPUP_Z - 1}
				background="rgba(22, 22, 26, 0.35)"
				onClick={onClose}
				onTouchStart={onClose}
			/>
		) : null}
		<Box
			ref={menuRef}
			className="ttBlockInsertMenu"
			data-testid="block-insert-menu"
			position="fixed"
			left={sheet ? 0 : `${left}px`}
			right={sheet ? 0 : undefined}
			top={!sheet && top !== undefined ? `${top}px` : undefined}
			bottom={sheet ? 0 : bottom !== undefined ? `${bottom}px` : undefined}
			width={sheet ? 'auto' : `${width}px`}
			maxHeight={sheet ? 'min(70vh, 520px)' : `${maxHeight}px`}
			overflowY="auto"
			zIndex={DRAWER_POPUP_Z}
			{...CARD_STYLES}
			borderRadius={sheet ? 'var(--tt-radius-xl, 20px) var(--tt-radius-xl, 20px) 0 0' : CARD_STYLES.borderRadius}
			boxShadow="var(--tt-shadow-popover, 0 12px 32px rgba(0, 0, 0, 0.12))"
			padding={sheet ? 4 : 3}
			paddingBottom={sheet ? 'calc(var(--thingtime-safe-area-bottom, 0px) + 20px)' : 3}
			sx={{ WebkitTapHighlightColor: 'transparent' }}
		>
			{sheet ? (
				<Box width="44px" height="5px" borderRadius="999px" background="var(--tt-border, #ececef)" marginX="auto" marginBottom={3} />
			) : null}
			<Flex flexWrap="wrap" gap={1.5} marginBottom={2}>
				{QUICK_BLOCKS.filter(quick => allowed(({ heading:'text', eyebrow:'text', column:'container', row:'container', grid:'container', input:'element', button:'element', list:'collection', service:'html' } as Record<string, WebpageBlockType>)[quick.key] || quick.key as WebpageBlockType)).map((quick) => (
					<Flex
						key={quick.key}
						as="button"
						data-testid={`insert-quick-${quick.key}`}
						alignItems="center"
						columnGap="6px"
						fontFamily="var(--tt-font-mono, ui-monospace, monospace)"
						fontSize={sheet ? '13px' : '11px'}
						fontWeight={600}
						paddingX={sheet ? '13px' : '9px'}
						paddingY={sheet ? '10px' : '6px'}
						borderRadius="var(--tt-radius-pill, 999px)"
						border="1px solid"
						borderColor="var(--tt-border, #ececef)"
						background="var(--tt-surface, #fafafb)"
						color="var(--tt-ink, #16161a)"
						cursor="pointer"
						_hover={{ borderColor: 'var(--tt-accent, hotpink)', color: 'var(--tt-accent, hotpink)' }}
						onClick={() => onPick({ block: quick.make(existingIds) })}
					>
						<span aria-hidden>{quick.icon}</span> {quick.label}
					</Flex>
				))}
			</Flex>
			{allowed('component') && <Input
				ref={inputRef}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search components… 🧩"
				size="sm"
				border="1px solid"
				borderColor="var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-sm, 9px)"
				marginBottom={2}
			/>}
			{searching && !entries.length ? (
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px" paddingY={2}>
					searching…
				</Text>
			) : null}
			{allowed('component') && !searching && !entries.length ? (
				<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px" paddingY={2}>
					no components matched
				</Text>
			) : null}
			<Flex flexDirection="column">
				{entries.map((entry) => {
					const ref = typeof entry.crystal?.componentKey === 'string' && entry.crystal.componentKey ? entry.crystal.componentKey : entry.id;
					return (
						<Flex
							key={entry.id}
							as="button"
							data-testid={`insert-component-${ref}`}
							alignItems="baseline"
							justifyContent="space-between"
							columnGap={2}
							textAlign="left"
							width="100%"
							paddingX={sheet ? 3 : 2}
							paddingY={sheet ? '13px' : '7px'}
							borderRadius="var(--tt-radius-sm, 9px)"
							cursor="pointer"
							_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
							onClick={() => onPick({ block: componentBlockFor(ref, existingIds), component: entry })}
						>
							<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={600} noOfLines={1}>
								{entry.crystal?.name || ref}
							</Text>
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="10px" flexShrink={0}>
								{entry.crystal?.library || 'custom'}
							</Text>
						</Flex>
					);
				})}
			</Flex>
		</Box>
		</>
	);
};
