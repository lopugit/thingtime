import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Touch + accessibility practice. The recipes here are
// quoted from Builder/WebpageBlocksRenderer.tsx (CHROME_TOUCH_SX, the 44px
// InsertZone, useCoarsePointer) and BlockInsertMenu.tsx (the under-640 bottom
// sheet) — the round-3 builder rules that are now house-wide. Everything
// renders offline.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

// Mirror of the (module-local) CHROME_TOUCH_SX const in
// Builder/WebpageBlocksRenderer.tsx:58 — chrome must never behave like page
// text: no long-press selection, no iOS callout, no tap highlight, taps fire
// immediately.
const CHROME_TOUCH_SX = {
	userSelect: 'none',
	WebkitUserSelect: 'none',
	WebkitTouchCallout: 'none',
	WebkitTapHighlightColor: 'transparent',
	touchAction: 'manipulation'
} as const;

const GroupLabel = (props: { children: React.ReactNode }) => (
	<Text
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.14em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
		marginBottom="10px"
	>
		{props.children}
	</Text>
);

// ——— tap targets ————————————————————————————————————————————————————————

const TapTarget = (props: { size: number; pass: boolean }) => {
	const [count, setCount] = React.useState(0);
	return (
		<Flex flexDirection="column" alignItems="center" rowGap="10px">
			{/* the 44px minimum, drawn as a dashed ring around every candidate */}
			<Flex
				width="56px"
				height="56px"
				alignItems="center"
				justifyContent="center"
				position="relative"
			>
				<Box
					position="absolute"
					width="44px"
					height="44px"
					border="1px dashed var(--tt-faint, #b6b6c0)"
					borderRadius="var(--tt-radius-sm, 9px)"
					pointerEvents="none"
				/>
				<Flex
					as="button"
					type="button"
					aria-label={`Tap target ${props.size}px`}
					width={`${props.size}px`}
					height={`${props.size}px`}
					alignItems="center"
					justifyContent="center"
					background={props.pass ? 'var(--tt-accent, hotpink)' : 'var(--tt-surface-alt, #f5f5f7)'}
					color={props.pass ? 'var(--tt-accent-contrast, #ffffff)' : 'var(--tt-text, #5a5a66)'}
					border="1px solid"
					borderColor={props.pass ? 'var(--tt-accent, hotpink)' : 'var(--tt-border, #ececef)'}
					borderRadius="var(--tt-radius-sm, 9px)"
					fontSize="13px"
					cursor="pointer"
					sx={CHROME_TOUCH_SX}
					onClick={() => setCount((current) => current + 1)}
				>
					＋
				</Flex>
			</Flex>
			<Box textAlign="center">
				<Text fontFamily={MONO} fontSize="11px" fontWeight={700} color={props.pass ? 'var(--tt-positive, #2f9e63)' : 'var(--tt-danger, #e5484d)'}>
					{props.size}px {props.pass ? '✓' : '✗'}
				</Text>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{count} hit{count === 1 ? '' : 's'}
				</Text>
			</Box>
		</Flex>
	);
};

const BigHitSmallGlyph = () => {
	const [count, setCount] = React.useState(0);
	return (
		<Flex flexDirection="column" alignItems="center" rowGap="10px">
			<Flex
				as="button"
				type="button"
				aria-label="Small glyph, 44px hit area"
				width="56px"
				height="56px"
				alignItems="center"
				justifyContent="center"
				background="transparent"
				border="none"
				cursor="pointer"
				position="relative"
				sx={CHROME_TOUCH_SX}
				onClick={() => setCount((current) => current + 1)}
			>
				<Box
					position="absolute"
					width="44px"
					height="44px"
					border="1px dashed var(--tt-positive, #2f9e63)"
					borderRadius="var(--tt-radius-sm, 9px)"
					pointerEvents="none"
				/>
				<Flex
					width="22px"
					height="22px"
					alignItems="center"
					justifyContent="center"
					background="var(--tt-surface-alt, #f5f5f7)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-xs, 7px)"
					fontSize="11px"
					color="var(--tt-text, #5a5a66)"
				>
					＋
				</Flex>
			</Flex>
			<Box textAlign="center">
				<Text fontFamily={MONO} fontSize="11px" fontWeight={700} color="var(--tt-positive, #2f9e63)">
					22px glyph ✓
				</Text>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{count} hit{count === 1 ? '' : 's'} · 44px hit box
				</Text>
			</Box>
		</Flex>
	);
};

const TapTargetStory = () => (
	<Box>
		<Flex columnGap={7} rowGap={5} flexWrap="wrap" alignItems="flex-end">
			<TapTarget size={24} pass={false} />
			<TapTarget size={32} pass={false} />
			<TapTarget size={44} pass />
			<BigHitSmallGlyph />
		</Flex>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={4} maxWidth="620px">
			the dashed ring is the 44px minimum · the rule is about the HIT AREA, not the glyph — the rightmost control keeps a
			22px icon but pads its button to 44px, exactly how the builder’s InsertZone makes its whole 44px strip tappable
			while the pill stays slim
		</Text>
	</Box>
);

// ——— chrome touch behaviour ————————————————————————————————————————————

const ChromeChip = (props: { children: React.ReactNode; chrome?: boolean }) => (
	<Flex
		as="button"
		type="button"
		aria-label={props.chrome ? 'Chrome-behaviour chip' : 'Text-behaviour chip'}
		alignItems="center"
		columnGap="8px"
		minHeight="44px"
		paddingX="14px"
		background="var(--tt-card, #ffffff)"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		fontSize="13px"
		color="var(--tt-ink, #16161a)"
		cursor="pointer"
		sx={props.chrome ? CHROME_TOUCH_SX : { userSelect: 'text', WebkitUserSelect: 'text' }}
	>
		{props.children}
	</Flex>
);

const ChromeTouchStory = () => (
	<Box>
		<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} columnGap={6} rowGap={5}>
			<Box>
				<GroupLabel>Default — behaves like page text</GroupLabel>
				<ChromeChip>🖱️ long-press me on touch — I select, callout, flash</ChromeChip>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="8px" maxWidth="300px">
					Drag across the label: it highlights like prose. On iOS a long-press pops the copy callout and taps wait out
					the double-tap-zoom heuristic.
				</Text>
			</Box>
			<Box>
				<GroupLabel>CHROME_TOUCH_SX — behaves like a control</GroupLabel>
				<ChromeChip chrome>✨ long-press me — nothing but the tap</ChromeChip>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="8px" maxWidth="300px">
					No selection, no callout, transparent tap highlight, and touch-action: manipulation so the tap fires
					immediately instead of waiting for a possible double-tap.
				</Text>
			</Box>
		</Grid>
		<Box
			marginTop={4}
			padding="10px 14px"
			background="var(--tt-surface-alt, #f5f5f7)"
			borderRadius="var(--tt-radius-sm, 9px)"
			fontFamily={MONO}
			fontSize="11px"
			lineHeight="1.7"
			color="var(--tt-text, #5a5a66)"
			overflowX="auto"
		>
			userSelect: &apos;none&apos; · WebkitUserSelect: &apos;none&apos; · WebkitTouchCallout: &apos;none&apos; ·
			WebkitTapHighlightColor: &apos;transparent&apos; · touchAction: &apos;manipulation&apos;
		</Box>
	</Box>
);

// ——— coarse pointer ————————————————————————————————————————————————————

// Mirror of the (module-local) useCoarsePointer hook in
// Builder/WebpageBlocksRenderer.tsx:68 — touch devices have no hover, so
// every affordance stays visible there.
const useCoarsePointer = (): boolean => {
	const [coarse, setCoarse] = React.useState(() => {
		try {
			return window.matchMedia('(pointer: coarse)').matches;
		} catch {
			return false;
		}
	});
	React.useEffect(() => {
		try {
			const media = window.matchMedia('(pointer: coarse)');
			const onChange = () => setCoarse(media.matches);
			media.addEventListener('change', onChange);
			return () => media.removeEventListener('change', onChange);
		} catch {
			return undefined;
		}
	}, []);
	return coarse;
};

const AffordanceRow = (props: { alwaysVisible: boolean; label: string }) => (
	<Flex
		alignItems="center"
		justifyContent="space-between"
		columnGap={3}
		paddingX="12px"
		minHeight="48px"
		background="var(--tt-card, #ffffff)"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-sm, 9px)"
		role="group"
	>
		<Text fontSize="13px" color="var(--tt-ink, #16161a)">
			{props.label}
		</Text>
		<Flex
			as="button"
			type="button"
			aria-label={`Edit ${props.label}`}
			alignItems="center"
			justifyContent="center"
			width="34px"
			height="34px"
			borderRadius="var(--tt-radius-xs, 7px)"
			background="var(--tt-surface-alt, #f5f5f7)"
			fontSize="13px"
			cursor="pointer"
			opacity={props.alwaysVisible ? 0.9 : 0}
			transition="opacity 0.12s ease"
			sx={{ '[role=group]:hover &, &:focus-visible': { opacity: 1 } }}
		>
			✏️
		</Flex>
	</Flex>
);

const CoarsePointerStory = () => {
	const detected = useCoarsePointer();
	const [simulate, setSimulate] = React.useState(false);
	const coarse = detected || simulate;

	return (
		<Box>
			<Flex alignItems="center" columnGap={4} rowGap={2} flexWrap="wrap" marginBottom={4}>
				<Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
					matchMedia(&apos;(pointer: coarse)&apos;) →{' '}
					<Box as="span" fontWeight={700} color={detected ? 'var(--tt-positive, #2f9e63)' : 'var(--tt-ink, #16161a)'}>
						{detected ? 'true (you are on touch)' : 'false (fine pointer)'}
					</Box>
				</Text>
				{!detected && (
					<Flex as="label" alignItems="center" columnGap="7px" cursor="pointer" minHeight="44px">
						<input type="checkbox" checked={simulate} onChange={(event) => setSimulate(event.target.checked)} />
						<Text fontSize="12px" color="var(--tt-text, #5a5a66)">
							simulate a coarse pointer
						</Text>
					</Flex>
				)}
			</Flex>
			<Flex flexDirection="column" rowGap="8px" maxWidth="440px">
				<AffordanceRow alwaysVisible={coarse} label="Sunflower patch 🌻" />
				<AffordanceRow alwaysVisible={coarse} label="Watering schedule" />
			</Flex>
			<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop={3} maxWidth="520px">
				{coarse
					? 'Coarse pointer: the edit affordances are simply visible — hidden-until-hover controls do not exist on touch.'
					: 'Fine pointer: affordances may rest hidden and reveal on row hover or keyboard focus. Hover the rows to see the reveal — then flip the toggle to see what touch users get.'}
			</Text>
		</Box>
	);
};

// ——— bottom sheet under 640px ———————————————————————————————————————————

const SheetOption = (props: { icon: string; label: string }) => (
	<Flex
		as="button"
		type="button"
		aria-label={`Insert ${props.label}`}
		alignItems="center"
		columnGap="10px"
		width="100%"
		minHeight="44px"
		paddingX="10px"
		borderRadius="var(--tt-radius-sm, 9px)"
		background="transparent"
		cursor="pointer"
		_hover={{ background: 'var(--tt-surface-hover, #f2f2f5)' }}
		sx={CHROME_TOUCH_SX}
	>
		<Text fontSize="15px">{props.icon}</Text>
		<Text fontSize="13px" color="var(--tt-ink, #16161a)">
			{props.label}
		</Text>
	</Flex>
);

const BottomSheetStory = () => (
	<Grid templateColumns={{ base: '1fr', md: '260px 1fr' }} columnGap={6} rowGap={5} alignItems="start">
		<Box>
			<GroupLabel>&lt; 640px — bottom sheet</GroupLabel>
			<Box
				position="relative"
				height="300px"
				overflow="hidden"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="18px"
				background="var(--tt-surface, #fafafb)"
				maxWidth="220px"
			>
				<Box position="absolute" inset={0} background="rgba(22, 22, 26, 0.28)" />
				<Box
					position="absolute"
					left={0}
					right={0}
					bottom={0}
					background="var(--tt-card, #ffffff)"
					borderTopRadius="16px"
					boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
					padding="10px 12px 14px"
				>
					{/* the 44×5 grab handle from BlockInsertMenu.tsx:153 */}
					<Box width="44px" height="5px" borderRadius="999px" background="var(--tt-border, #ececef)" marginX="auto" marginBottom={3} />
					<SheetOption icon="🔤" label="Text" />
					<SheetOption icon="⬇️" label="Column" />
					<SheetOption icon="➡️" label="Row" />
					<SheetOption icon="🔲" label="Grid" />
				</Box>
			</Box>
			<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="8px">
				Full-width, thumb-reachable, 44px rows. The search input does NOT autofocus — the keyboard would cover the sheet.
			</Text>
		</Box>
		<Box>
			<GroupLabel>≥ 640px — anchored popover</GroupLabel>
			<Box position="relative" height="220px" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" background="var(--tt-surface, #fafafb)" padding={4}>
				<Flex
					width="fit-content"
					alignItems="center"
					paddingX="12px"
					minHeight="36px"
					background="var(--tt-accent-tint, #ffe3f1)"
					border="1px dashed var(--tt-accent, hotpink)"
					borderRadius="var(--tt-radius-pill, 999px)"
					fontFamily={MONO}
					fontSize="10px"
					color="var(--tt-accent, hotpink)"
				>
					+ add block (anchor)
				</Flex>
				<Box
					marginTop="6px"
					width="200px"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
					padding="8px"
				>
					<SheetOption icon="🔤" label="Text" />
					<SheetOption icon="⬇️" label="Column" />
				</Box>
			</Box>
			<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="8px">
				Desktop keeps the anchored popover, flipping above the anchor when space below runs out — open whichever way has
				more room, never grow past the viewport. Escape closes both forms.
			</Text>
		</Box>
	</Grid>
);

export const touchA11yStories: DesignSystemStory[] = [
	{
		id: 'tap-targets',
		title: '44px minimum tap targets',
		description:
			'Four live targets with the 44px minimum drawn as a dashed ring — tap or click each and watch the hit counters. 24px and 32px glyph-sized buttons fail the rule; the fix is never “make the icon huge” but “pad the hit area”: the rightmost control keeps a 22px glyph inside a 44px button, the same trick the builder’s InsertZone uses (a slim visual line whose whole 44px strip is the target).',
		render: TapTargetStory,
		note: 'Source of the convention: InsertZone in Builder/WebpageBlocksRenderer.tsx — height 44px when visible, the pill is just the label.'
	},
	{
		id: 'chrome-touch',
		title: 'CHROME_TOUCH_SX — chrome must not behave like text',
		description:
			'Interactive chrome gets the five-property recipe from WebpageBlocksRenderer.tsx: no user selection (long-press must not start selecting a drag handle), no iOS callout, transparent tap highlight, and touch-action: manipulation so taps fire without the 300ms double-tap wait. Try drag-selecting or long-pressing both chips — only the left one misbehaves.',
		render: ChromeTouchStory,
		note: 'Apply it to CONTROLS only — content stays selectable. A whole page under userSelect: none is an accessibility bug, not a polish.'
	},
	{
		id: 'coarse-pointer',
		title: 'Coarse pointers get always-visible affordances',
		description:
			'Hidden-until-hover controls do not exist on touch — there is no hover. The useCoarsePointer recipe (matchMedia("(pointer: coarse)") with a live change listener) switches reveal-on-hover affordances to simply-visible ones. This story shows the real detection result for your device, with a simulation toggle for fine-pointer machines. Keyboard focus reveals them too (:focus-visible), so the hover reveal never gates anything.',
		render: CoarsePointerStory
	},
	{
		id: 'bottom-sheet',
		title: 'Bottom sheets under 640px',
		description:
			'A popover anchored to a cramped zone is exactly what makes mobile taps miserable, so below 640px pickers become bottom sheets: full-width, thumb-reachable, 44px rows, a 44×5px grab handle, and no input autofocus (the keyboard would cover the sheet). At 640px and up the same menu is an anchored popover that flips upward when space below runs out. One component, two placements — BlockInsertMenu.tsx is the reference implementation.',
		render: BottomSheetStory
	}
];
