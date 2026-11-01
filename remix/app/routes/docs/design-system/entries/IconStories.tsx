import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';

import { Icon } from '~/components/Icon/Icon';
import { LUCIDE_FOR_EMOJI, LUCIDE_ICONS } from '~/theme/icons';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Icons entry. The real <Icon/> follows the viewer's
// active icon language (theme → general.iconStyle), while the "forced" twins
// draw straight from LUCIDE_ICONS so both languages stay visible side by side
// whatever the current setting is. No fetches — icons are pure data + glyphs.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const GroupLabel = (props: { children: React.ReactNode }) => (
	<Text
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.14em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
		marginBottom="8px"
	>
		{props.children}
	</Text>
);

// Draw a Lucide twin directly from the curated palette, bypassing the theme
// switch — the same { Icon, color } def the real <Icon/> resolves in lucide
// mode (including its ×1.15 optical-size compensation).
const LucideByName = (props: { name?: string; px?: number }) => {
	const def = props.name ? LUCIDE_ICONS[props.name] : undefined;

	if (!def) {
		return (
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-faint, #b6b6c0)">
				—
			</Text>
		);
	}

	return <def.Icon size={props.px ?? 18} color={def.color} strokeWidth={2} />;
};

const CELL = { width: '30px', justifyContent: 'center' } as const;

const TwinHeaderRow = () => (
	<Flex alignItems="center" columnGap="12px" paddingBottom="6px">
		<Flex {...CELL}>
			<Text fontFamily={MONO} fontSize="9px" color="var(--tt-muted, #9a9aa6)">
				live
			</Text>
		</Flex>
		<Flex {...CELL}>
			<Text fontFamily={MONO} fontSize="9px" color="var(--tt-muted, #9a9aa6)">
				emoji
			</Text>
		</Flex>
		<Flex {...CELL}>
			<Text fontFamily={MONO} fontSize="9px" color="var(--tt-muted, #9a9aa6)">
				lucide
			</Text>
		</Flex>
		<Text fontFamily={MONO} fontSize="9px" color="var(--tt-muted, #9a9aa6)">
			twin name · meaning
		</Text>
	</Flex>
);

const TwinRow = (props: { emoji: string; meaning: string }) => {
	const twinName = LUCIDE_FOR_EMOJI[props.emoji];

	return (
		<Flex
			alignItems="center"
			columnGap="12px"
			paddingY="6px"
			borderTop="1px solid var(--tt-border-light, #f0f0f2)"
		>
			<Flex {...CELL}>
				<Icon name={props.emoji} size="16px"></Icon>
			</Flex>
			<Flex {...CELL} fontSize="16px">
				{props.emoji}
			</Flex>
			<Flex {...CELL}>
				<LucideByName name={twinName} />
			</Flex>
			<Text fontFamily={MONO} fontSize="11px" color="var(--tt-ink, #16161a)">
				{twinName || 'emoji only'}
				<Box as="span" color="var(--tt-muted, #9a9aa6)">
					{' · '}
					{props.meaning}
				</Box>
			</Text>
		</Flex>
	);
};

const TwinGroup = (props: { label: string; rows: { emoji: string; meaning: string }[] }) => (
	<Box>
		<GroupLabel>{props.label}</GroupLabel>
		<TwinHeaderRow />
		{props.rows.map((row) => (
			<TwinRow key={row.emoji} {...row} />
		))}
	</Box>
);

const EmojiLucideMatrixStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<TwinGroup
			label="Thing types"
			rows={[
				{ emoji: '🪄', meaning: 'any' },
				{ emoji: '📦', meaning: 'object / thing' },
				{ emoji: '📚', meaning: 'array / list' },
				{ emoji: '💬', meaning: 'string' },
				{ emoji: '💯', meaning: 'number' },
				{ emoji: '🌗', meaning: 'boolean' },
				{ emoji: '📐', meaning: 'function' },
				{ emoji: '🔮', meaning: 'crystal' }
			]}
		/>
		<TwinGroup
			label="Menu verbs"
			rows={[
				{ emoji: '🎨', meaning: 'edit mode' },
				{ emoji: '✏️', meaning: 'modify' },
				{ emoji: '🐑', meaning: 'duplicate' },
				{ emoji: '📋', meaning: 'copy' },
				{ emoji: '✂️', meaning: 'cut' },
				{ emoji: '📥', meaning: 'paste' },
				{ emoji: '🔗', meaning: 'share link' },
				{ emoji: '🗑️', meaning: 'recycle' }
			]}
		/>
		<TwinGroup
			label="Status + identity"
			rows={[
				{ emoji: '✅', meaning: 'success' },
				{ emoji: '⚠️', meaning: 'warning' },
				{ emoji: '❌', meaning: 'error / close' },
				{ emoji: '✨', meaning: 'magic / new' },
				{ emoji: '🌈', meaning: 'the signed-in identity mark' },
				{ emoji: '🧙‍♂️', meaning: 'the options-menu wizard' },
				{ emoji: '🌱', meaning: 'the new-child seedling' },
				{ emoji: '🦄', meaning: 'the nav unicorn — deliberately unmapped' }
			]}
		/>
	</Flex>
);

const SEMANTIC_NAMES: { name: string; hint: string }[] = [
	{ name: 'wizard', hint: 'options-menu trigger (also "gandalf")' },
	{ name: 'crystal', hint: 'crystal payloads' },
	{ name: 'edit', hint: 'edit mode (also "paint", "create")' },
	{ name: 'boolean', hint: 'boolean type (also "bool")' },
	{ name: 'seedling', hint: 'new-child row (also "seed")' },
	{ name: 'trash', hint: 'delete (also "bin", "remove")' },
	{ name: 'search', hint: 'search (also "magnify")' },
	{ name: 'thingtime', hint: '🌳/🌀 coin flip · 🎄 every Dec 25 · 1% 🦄' }
];

const SemanticNamesStory = () => (
	<Box>
		{SEMANTIC_NAMES.map((row) => (
			<Flex
				key={row.name}
				alignItems="center"
				columnGap="12px"
				paddingY="6px"
				borderTop="1px solid var(--tt-border-light, #f0f0f2)"
				_first={{ borderTop: 'none' }}
			>
				<Flex {...CELL}>
					<Icon name={row.name} size="16px"></Icon>
				</Flex>
				<Text fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)" minWidth="86px">
					{row.name}
				</Text>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{row.hint}
				</Text>
			</Flex>
		))}
		<Flex alignItems="center" columnGap="12px" paddingY="6px" borderTop="1px solid var(--tt-border-light, #f0f0f2)">
			<Flex {...CELL}>
				<Icon name="definitely-not-an-icon" size="16px"></Icon>
			</Flex>
			<Text fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)" minWidth="86px">
				(unknown)
			</Text>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				anything unrecognised shrugs 🤷‍♂️ instead of crashing
			</Text>
		</Flex>
	</Box>
);

// Contextual twins: menu/type rows can name a DIFFERENT Lucide icon than the
// emoji's default twin via their `lucide` field (contextMenuModel.ts) — the
// literal-object emoji stays, but the professional language picks the icon
// that matches the MEANING in context.
const CONTEXTUAL_PAIRS: { emoji: string; contextual: string; where: string }[] = [
	{ emoji: '💬', contextual: 'quote', where: 'string type row' },
	{ emoji: '📚', contextual: 'brackets', where: 'array type row' },
	{ emoji: '📦', contextual: 'box', where: 'object type row' },
	{ emoji: '📐', contextual: 'square-function', where: 'function type row' }
];

const ContextualTwinsStory = () => (
	<Box>
		{CONTEXTUAL_PAIRS.map((pair) => (
			<Flex
				key={pair.emoji}
				alignItems="center"
				columnGap="12px"
				paddingY="7px"
				borderTop="1px solid var(--tt-border-light, #f0f0f2)"
				_first={{ borderTop: 'none' }}
				flexWrap="wrap"
			>
				<Flex {...CELL} fontSize="16px">
					{pair.emoji}
				</Flex>
				<Flex {...CELL}>
					<LucideByName name={LUCIDE_FOR_EMOJI[pair.emoji]} />
				</Flex>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-faint, #b6b6c0)">
					→
				</Text>
				<Flex {...CELL}>
					<LucideByName name={pair.contextual} />
				</Flex>
				<Flex {...CELL} title="live <Icon lucide=…/>">
					<Icon name={pair.emoji} lucide={pair.contextual} size="16px"></Icon>
				</Flex>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{LUCIDE_FOR_EMOJI[pair.emoji]} → <Box as="span" color="var(--tt-ink, #16161a)">{pair.contextual}</Box>
					{' · '}
					{pair.where}
				</Text>
			</Flex>
		))}
		<Text marginTop="12px" fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			columns: emoji · default twin (LUCIDE_FOR_EMOJI) · → contextual twin (the row&apos;s lucide field) · the live
			&lt;Icon lucide=…/&gt;, which only switches under the Lucide icon style
		</Text>
	</Box>
);

const SizePairStory = () => (
	<Flex alignItems="flex-end" columnGap={7} rowGap={4} flexWrap="wrap">
		{['12px', '16px', '24px', '36px'].map((size) => (
			<Flex key={size} flexDirection="column" alignItems="center" rowGap="6px">
				<Flex alignItems="center" columnGap="10px">
					<Center fontSize={size}>🌈</Center>
					<LucideByName name="rainbow" px={Math.round(parseFloat(size) * 1.15)} />
				</Flex>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{size} · {Math.round(parseFloat(size) * 1.15)}px
				</Text>
			</Flex>
		))}
	</Flex>
);

export const iconStories: DesignSystemStory[] = [
	{
		id: 'emoji-lucide-matrix',
		title: 'Emoji ↔ Lucide matrix',
		description:
			'The dual icon language, row by row: the live <Icon/> (which renders whichever language your theme’s icon style picks), the emoji glyph, and its coloured Lucide twin from LUCIDE_ICONS. LUCIDE_FOR_EMOJI is the bridge — emoji in, twin name out — and anything unmapped simply stays emoji, so the system degrades gracefully and the map grows lazily.',
		render: EmojiLucideMatrixStory,
		note: 'Switch Settings → Appearance → icon style to lucide and the first column of every row flips language live — the 🦄 stays a 🦄 in both, on purpose.'
	},
	{
		id: 'semantic-names',
		title: 'Semantic names',
		description:
			'<Icon/> accepts meaning, not just glyphs: "wizard", "crystal", "boolean", "trash", and friends resolve to their emoji before the language switch applies, so callers write intent and the icon system owns the art. The "thingtime" name is special — a deterministic 🎄 on December 25 (everyone sees it together), an ultra-rare 🦄 roll, then the everyday 🌳/🌀 coin flip. Unknown names never crash: they render the 🤷‍♂️ shrug.',
		render: SemanticNamesStory,
		note: 'There are secret names in Icon.tsx for the curious — rewards, not API. New aliases are added in Icon.tsx’s resolver, twins in ~/theme/icons.tsx.'
	},
	{
		id: 'contextual-twins',
		title: 'Contextual Lucide twins',
		description:
			'A menu or type row can override the default twin with its `lucide` field: the string type keeps 💬 as its emoji but names "quote" (not the 💬 twin "message-circle"), arrays name "brackets" over "library", objects "box" over "package". The rule from ~/theme/icons.tsx: pick the icon for the MEANING in context, not a literal drawing of the emoji — collapse-all maps 🍂 to folding chevrons, not a leaf.',
		render: ContextualTwinsStory,
		note: 'A lucide name must exist in LUCIDE_ICONS — Icon.tsx falls back to the emoji twin for unknown names, so a typo degrades silently instead of breaking.'
	},
	{
		id: 'optical-size',
		title: 'Optical size compensation',
		description:
			'Emoji fill more of their em box than Lucide strokes do, so Icon.tsx renders the twin at ×1.15 of the requested size (Math.round((parseFloat(size) || 14) * 1.15)) — both languages read the same optical weight at every size. Each pair below is the emoji at `size` beside its twin at the compensated pixel size.',
		render: SizePairStory,
		note: 'Pass size as a px string; Lucide twins always draw at strokeWidth 2 with their curated palette colour.'
	}
];
