import React from 'react';
import { Box, Button, Flex, IconButton, Input, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Text } from '@chakra-ui/react';
import { Minus, MoveDiagonal, Plus } from 'lucide-react';

import { MAX_MEDIA_LAYOUT_ENTRIES, MAX_MEDIA_LAYOUT_TRACK, MEDIA_LAYOUT_SPAN_VALUES, type MediaLayoutSpan } from '~/schemas/registry';
import { attachmentMediaSrc } from './attachmentUiCore';
import { mediaLayoutRows, spanAspect, spanColumns, spanRows } from './PostAttachments';
import type { PublicAttachment } from './attachmentTypes';

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';
const RADIUS_SM = 'var(--tt-radius-sm, 9px)';

// Composer-side controls for the post-level crystal.mediaLayout. The composer
// owns the state; these are dumb inputs. Auto = masonry default (stored null).

export type ComposerLayoutMode = 'auto' | 'rows' | 'grid';

// "1-2-3" / "1,2,3" / "1 2 3" -> bounded int rows; null when nothing parses
export const parseLayoutPattern = (value: string): number[] | null => {
	const rows = value
		.split(/[-,.\s/]+/)
		.filter(Boolean)
		.map((entry) => Number(entry))
		.filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= MAX_MEDIA_LAYOUT_TRACK)
		.slice(0, MAX_MEDIA_LAYOUT_ENTRIES);
	return rows.length ? rows : null;
};

const MODES: { id: ComposerLayoutMode; label: string }[] = [
	{ id: 'auto', label: 'Auto 🧱' },
	{ id: 'rows', label: 'Rows 🥞' },
	{ id: 'grid', label: 'Grid 🔳' }
];

// Tiny pure-CSS preview of the rows pattern so "1-2-3" is legible at a glance.
const PatternPreview = ({ pattern, imageCount }: { pattern: number[]; imageCount: number }) => (
	<Flex flexDirection="column" rowGap="2px" width="72px" flexShrink={0} aria-hidden>
		{mediaLayoutRows(imageCount, pattern)
			.slice(0, 5)
			.map((size, rowIndex) => (
				<Flex key={rowIndex} columnGap="2px">
					{Array.from({ length: size }, (_, cell) => (
						<Box key={cell} flex="1" height="9px" borderRadius="2px" background="var(--tt-surface-alt, #e9e9ee)" border={BORDER} />
					))}
				</Flex>
			))}
	</Flex>
);

export const MediaLayoutPicker = ({
	mode,
	onMode,
	pattern,
	onPattern,
	columns,
	onColumns,
	imageCount
}: {
	mode: ComposerLayoutMode;
	onMode: (mode: ComposerLayoutMode) => void;
	pattern: string;
	onPattern: (value: string) => void;
	columns: number;
	onColumns: (columns: number) => void;
	imageCount: number;
}) => {
	const parsed = parseLayoutPattern(pattern);
	return (
		<Flex flexDirection="column" rowGap={2} border={BORDER} borderRadius="var(--tt-radius-md, 12px)" padding={2.5} background="var(--tt-surface, #fafafb)">
			<Flex alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1.5}>
				<Text fontSize="11px" fontWeight={700} letterSpacing="0.08em" color={MUTED}>
					LAYOUT
				</Text>
				<Flex columnGap={1} flexWrap="wrap" rowGap={1}>
					{MODES.map((entry) => (
						<Button
							key={entry.id}
							type="button"
							size="xs"
							borderRadius="999px"
							variant={mode === entry.id ? 'solid' : 'outline'}
							aria-pressed={mode === entry.id}
							onClick={() => onMode(entry.id)}
						>
							{entry.label}
						</Button>
					))}
				</Flex>
			</Flex>

			{mode === 'rows' && (
				<Flex alignItems="center" columnGap={2.5} flexWrap="wrap" rowGap={1.5}>
					<Input
						size="sm"
						width="130px"
						borderRadius={RADIUS_SM}
						value={pattern}
						onChange={(event) => onPattern(event.target.value)}
						placeholder="1-2-3"
						aria-label="Images per row, top to bottom (e.g. 1-2-3)"
						isInvalid={!parsed}
					/>
					{parsed ? (
						<PatternPreview pattern={parsed} imageCount={imageCount} />
					) : (
						<Text fontSize="11px" color="var(--tt-danger, #e5484d)">
							Try something like 1-2-3 🥞
						</Text>
					)}
					<Text fontSize="11px" color={MUTED}>
						images per row · extras repeat the last row
					</Text>
				</Flex>
			)}

			{mode === 'grid' && (
				<Flex alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1.5}>
					<Flex alignItems="center" columnGap={1}>
						<IconButton
							aria-label="Fewer columns"
							icon={<Minus size={13} />}
							size="xs"
							variant="outline"
							borderRadius="999px"
							isDisabled={columns <= 1}
							onClick={() => onColumns(Math.max(1, columns - 1))}
						/>
						<Text fontSize="sm" fontWeight={700} color={INK} minWidth="64px" textAlign="center" aria-live="polite">
							{columns} column{columns === 1 ? '' : 's'}
						</Text>
						<IconButton
							aria-label="More columns"
							icon={<Plus size={13} />}
							size="xs"
							variant="outline"
							borderRadius="999px"
							isDisabled={columns >= MAX_MEDIA_LAYOUT_TRACK}
							onClick={() => onColumns(Math.min(MAX_MEDIA_LAYOUT_TRACK, columns + 1))}
						/>
					</Flex>
					<Text fontSize="11px" color={MUTED}>
						tap a tile&apos;s size badge to make it wide, tall, or big ✨
					</Text>
				</Flex>
			)}
		</Flex>
	);
};

const SPAN_GLYPHS: Record<MediaLayoutSpan, string> = { normal: '1×1', wide: '2×1', tall: '1×2', big: '2×2' };

// Per-tile size badge (tier 2): cycles normal -> wide -> tall -> big.
export const SpanCycleButton = ({
	name,
	span,
	onChange,
	placement
}: {
	name: string;
	span: MediaLayoutSpan;
	onChange: (span: MediaLayoutSpan) => void;
	placement?: Record<string, unknown>;
}) => {
	const next = MEDIA_LAYOUT_SPAN_VALUES[(MEDIA_LAYOUT_SPAN_VALUES.indexOf(span) + 1) % MEDIA_LAYOUT_SPAN_VALUES.length];
	return (
		<Button
			type="button"
			size="xs"
			minWidth="44px"
			height="28px"
			variant="solid"
			background="rgba(255, 255, 255, 0.9)"
			color={INK}
			borderRadius="999px"
			fontSize="10px"
			fontWeight={800}
			aria-label={`Layout size for ${name}: ${span}. Activate for ${next}.`}
			title={`Grid size: ${span} (${SPAN_GLYPHS[span]})`}
			sx={placement}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onChange(next);
			}}
		>
			{SPAN_GLYPHS[span]}
		</Button>
	);
};

// ————— Tier 3: the drag-resize canvas editor (grid mode) ————————————————————
// A live preview of the real grid. Each tile carries a corner handle: drag it
// (mouse OR touch — pointer events + touchAction none) and the tile snaps
// between the four cell sizes; a slider relayouts the column count live.
// Keyboard fallback on the handle: arrows resize, matching the drag semantics.

const spanFromCells = (cols: number, rows: number): MediaLayoutSpan =>
	cols > 1 && rows > 1 ? 'big' : cols > 1 ? 'wide' : rows > 1 ? 'tall' : 'normal';

export const MediaLayoutCanvas = ({
	attachments,
	columns,
	onColumns,
	spans,
	onSpanChange,
	disabled
}: {
	attachments: PublicAttachment[];
	columns: number;
	onColumns: (columns: number) => void;
	spans: Record<string, MediaLayoutSpan>;
	onSpanChange: (id: string, span: MediaLayoutSpan) => void;
	disabled?: boolean;
}) => {
	const gridColumns = Math.max(1, Math.min(columns, attachments.length, MAX_MEDIA_LAYOUT_TRACK));
	// live drag preview: the candidate span tracks the pointer between snaps
	const [dragPreview, setDragPreview] = React.useState<{ id: string; span: MediaLayoutSpan } | null>(null);
	const dragRef = React.useRef<{
		id: string;
		pointerId: number;
		startX: number;
		startY: number;
		cellSize: number;
		startSpan: MediaLayoutSpan;
	} | null>(null);

	const spanOf = (id: string): MediaLayoutSpan => (dragPreview?.id === id ? dragPreview.span : spans[id] || 'normal');

	const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, attachment: PublicAttachment) => {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		const tile = (event.currentTarget as HTMLElement).closest('[data-layout-tile]') as HTMLElement | null;
		if (!tile) return;
		const startSpan = spans[attachment.id] || 'normal';
		// one grid cell ≈ tile width divided by the columns it currently spans
		const cellSize = Math.max(40, tile.getBoundingClientRect().width / spanColumns(startSpan, gridColumns));
		dragRef.current = { id: attachment.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, cellSize, startSpan };
		event.currentTarget.setPointerCapture(event.pointerId);
		// preventDefault above suppresses the native focus, so take it by hand —
		// otherwise arrow-key resizing is dead until the handle is tabbed to
		event.currentTarget.focus({ preventScroll: true });
		setDragPreview({ id: attachment.id, span: startSpan });
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		const startCols = spanColumns(drag.startSpan, gridColumns);
		const startRows = spanRows(drag.startSpan);
		// snap threshold: moving ~45% of a cell toward a direction toggles it
		const step = drag.cellSize * 0.45;
		const cols = Math.max(1, Math.min(2, startCols + (dx > step ? 1 : dx < -step ? -1 : 0)));
		const rows = Math.max(1, Math.min(2, startRows + (dy > step ? 1 : dy < -step ? -1 : 0)));
		const candidate = spanFromCells(gridColumns > 1 ? cols : 1, rows);
		setDragPreview((current) => (current?.id === drag.id && current.span === candidate ? current : { id: drag.id, span: candidate }));
	};

	const handlePointerEnd = (event: React.PointerEvent<HTMLButtonElement>, attachment: PublicAttachment) => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		dragRef.current = null;
		setDragPreview((current) => {
			if (current && current.id === attachment.id && current.span !== drag.startSpan) onSpanChange(attachment.id, current.span);
			return null;
		});
	};

	const handleKeyResize = (event: React.KeyboardEvent<HTMLButtonElement>, attachment: PublicAttachment) => {
		if (disabled) return;
		const span = spans[attachment.id] || 'normal';
		let cols = spanColumns(span, gridColumns);
		let rows = spanRows(span);
		if (event.key === 'ArrowRight') cols = 2;
		else if (event.key === 'ArrowLeft') cols = 1;
		else if (event.key === 'ArrowDown') rows = 2;
		else if (event.key === 'ArrowUp') rows = 1;
		else return;
		event.preventDefault();
		event.stopPropagation();
		onSpanChange(attachment.id, spanFromCells(gridColumns > 1 ? cols : 1, rows));
	};

	return (
		<Flex flexDirection="column" rowGap={2} border={BORDER} borderRadius="var(--tt-radius-md, 12px)" padding={2.5} background="var(--tt-surface, #fafafb)">
			<Flex alignItems="center" columnGap={3} flexWrap="wrap" rowGap={1.5}>
				<Text fontSize="11px" fontWeight={700} letterSpacing="0.08em" color={MUTED}>
					GRID CANVAS
				</Text>
				<Flex alignItems="center" columnGap={2} flex="1" minWidth="140px" maxWidth="240px">
					<Slider
						aria-label="Grid columns"
						min={1}
						max={MAX_MEDIA_LAYOUT_TRACK}
						step={1}
						value={columns}
						onChange={onColumns}
						isDisabled={disabled}
					>
						<SliderTrack>
							<SliderFilledTrack />
						</SliderTrack>
						<SliderThumb boxSize={4} />
					</Slider>
					<Text fontSize="11px" fontWeight={700} color={INK} width="18px" textAlign="center" aria-live="polite">
						{columns}
					</Text>
				</Flex>
				<Text fontSize="11px" color={MUTED}>
					drag a tile&apos;s ⤡ corner to resize ✨
				</Text>
			</Flex>
			<Box display="grid" gridTemplateColumns={`repeat(${gridColumns}, minmax(0, 1fr))`} gap="6px" sx={{ gridAutoFlow: 'dense' }}>
				{attachments.map((attachment) => {
					const span = spanOf(attachment.id);
					return (
						<Box
							key={attachment.id}
							data-layout-tile
							position="relative"
							borderRadius="var(--tt-radius-md, 12px)"
							overflow="hidden"
							minWidth={0}
							gridColumn={`span ${spanColumns(span, gridColumns)}`}
							gridRow={`span ${spanRows(span)}`}
							aspectRatio={spanAspect(span, gridColumns)}
							outline={dragPreview?.id === attachment.id ? '2px solid var(--tt-link, #2f8fd6)' : 'none'}
							transition="outline-color 80ms ease"
						>
							<Box
								as="img"
								src={attachmentMediaSrc(attachment)}
								alt={attachment.title || attachment.name}
								loading="lazy"
								referrerPolicy="no-referrer"
								position="absolute"
								inset={0}
								width="100%"
								height="100%"
								objectFit="cover"
								background="var(--tt-surface-alt, #e9e9ee)"
								draggable={false}
							/>
							<IconButton
								aria-label={`Resize ${attachment.name} on the grid — currently ${span}. Drag, or use arrow keys: right wider, left narrower, down taller, up shorter.`}
								title="Drag to resize"
								icon={<MoveDiagonal size={13} />}
								size="xs"
								variant="solid"
								background="rgba(255, 255, 255, 0.92)"
								color={INK}
								borderRadius="999px"
								position="absolute"
								bottom={1}
								right={1}
								minWidth="34px"
								height="34px"
								cursor={dragPreview?.id === attachment.id ? 'grabbing' : 'grab'}
								isDisabled={disabled}
								sx={{ touchAction: 'none' }}
								onPointerDown={(event) => handlePointerDown(event, attachment)}
								onPointerMove={handlePointerMove}
								onPointerUp={(event) => handlePointerEnd(event, attachment)}
								onPointerCancel={(event) => handlePointerEnd(event, attachment)}
								onKeyDown={(event) => handleKeyResize(event, attachment)}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
								}}
							/>
						</Box>
					);
				})}
			</Box>
		</Flex>
	);
};
