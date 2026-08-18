import React from 'react';
import { Box, Button, Flex, IconButton, Input, Text } from '@chakra-ui/react';
import { Minus, Plus } from 'lucide-react';

import { MAX_MEDIA_LAYOUT_ENTRIES, MAX_MEDIA_LAYOUT_TRACK, MEDIA_LAYOUT_SPAN_VALUES, type MediaLayoutSpan } from '~/schemas/registry';
import { mediaLayoutRows } from './PostAttachments';

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
