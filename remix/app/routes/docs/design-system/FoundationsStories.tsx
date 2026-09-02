import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { RAINBOW, RAINBOW_CONIC, RAINBOW_TEXT } from '~/theme/rainbow';
import type { DesignSystemStory } from './ThingContextMenuStories';

// Live stories for the Foundations (design tokens) entry. Every swatch reads
// the real --tt-* CSS custom properties straight off <html>, so this page IS
// the current theme: switch to Fable/Prism/Midnight in settings and the grids
// re-skin live. No fetches, no theme plumbing — just var() reads.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

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

const Swatch = (props: { token: string; role: string }) => (
	<Box minWidth={0}>
		<Box
			height="44px"
			borderRadius="var(--tt-radius-sm, 9px)"
			border="1px solid var(--tt-border, #ececef)"
			background={`var(${props.token})`}
		/>
		<Text marginTop="6px" fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)" overflowWrap="anywhere">
			{props.token}
		</Text>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			{props.role}
		</Text>
	</Box>
);

const SwatchGrid = (props: { label: string; swatches: { token: string; role: string }[] }) => (
	<Box>
		<GroupLabel>{props.label}</GroupLabel>
		<Grid templateColumns="repeat(auto-fill, minmax(150px, 1fr))" gap={3}>
			{props.swatches.map((swatch) => (
				<Swatch key={swatch.token} {...swatch} />
			))}
		</Grid>
	</Box>
);

const ColorTokensStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<SwatchGrid
			label="Ink + text"
			swatches={[
				{ token: '--tt-ink', role: 'headings, primary labels' },
				{ token: '--tt-text', role: 'body copy' },
				{ token: '--tt-muted', role: 'hints, eyebrows, meta' },
				{ token: '--tt-faint', role: 'disabled, carets, shortcuts' }
			]}
		/>
		<SwatchGrid
			label="Chrome"
			swatches={[
				{ token: '--tt-border', role: 'card + control borders' },
				{ token: '--tt-border-light', role: 'hairline dividers' },
				{ token: '--tt-surface', role: 'page wash' },
				{ token: '--tt-surface-alt', role: 'inset panels, pills' },
				{ token: '--tt-surface-hover', role: 'row hover' },
				{ token: '--tt-card', role: 'card surfaces' },
				{ token: '--tt-page-bg', role: 'document background' }
			]}
		/>
		<SwatchGrid
			label="Accent + link"
			swatches={[
				{ token: '--tt-accent', role: 'primary CTA, selection' },
				{ token: '--tt-accent-tint', role: 'accent hover wash' },
				{ token: '--tt-accent-contrast', role: 'text on accent' },
				{ token: '--tt-link', role: 'links, url values' }
			]}
		/>
		<SwatchGrid
			label="Signals"
			swatches={[
				{ token: '--tt-positive', role: 'success text' },
				{ token: '--tt-positive-soft', role: 'success pill fill' },
				{ token: '--tt-danger', role: 'destructive actions' },
				{ token: '--tt-warning', role: 'caution highlights' }
			]}
		/>
	</Flex>
);

const RAINBOW_STOPS: { token: string; role: string }[] = [
	{ token: '--tt-rainbow-1', role: 'red' },
	{ token: '--tt-rainbow-2', role: 'amber' },
	{ token: '--tt-rainbow-3', role: 'green' },
	{ token: '--tt-rainbow-4', role: 'blue' },
	{ token: '--tt-rainbow-5', role: 'purple' }
];

const RainbowStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<Box>
			<GroupLabel>The five stops</GroupLabel>
			<Grid templateColumns="repeat(auto-fill, minmax(110px, 1fr))" gap={3}>
				{RAINBOW_STOPS.map((stop) => (
					<Swatch key={stop.token} {...stop} />
				))}
			</Grid>
		</Box>
		<Box>
			<GroupLabel>--tt-gradient-rainbow · borders, buttons, progress (blue-first, tiles seamlessly)</GroupLabel>
			<Box
				height="18px"
				borderRadius="var(--tt-radius-pill, 999px)"
				background={RAINBOW}
				backgroundSize="calc(100px + 200%)"
				sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
			/>
		</Box>
		<Box>
			<GroupLabel>--tt-gradient-rainbow-x · animated headline text (red-first)</GroupLabel>
			<Box
				as="h2"
				width="fit-content"
				fontFamily="var(--tt-font-heading, system-ui, sans-serif)"
				fontSize="clamp(28px, 5vw, 44px)"
				fontWeight={800}
				letterSpacing="-0.03em"
				background={RAINBOW_TEXT}
				backgroundSize="calc(100px + 200%)"
				sx={{
					WebkitBackgroundClip: 'text',
					backgroundClip: 'text',
					WebkitTextFillColor: 'transparent',
					animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
				}}
			>
				A GUI for the internet.
			</Box>
		</Box>
		<Flex alignItems="center" columnGap={3}>
			<Box width="26px" height="26px" borderRadius="50%" background={RAINBOW_CONIC} flexShrink={0} />
			<Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
				RAINBOW_CONIC · conic spinner fill (DevKit trigger ring) — built from the same five stop vars
			</Text>
		</Flex>
	</Flex>
);

const TypeSample = (props: { label: string; meta: string; children: React.ReactNode }) => (
	<Box paddingY="14px" borderTop="1px solid var(--tt-border-light, #f0f0f2)" _first={{ borderTop: 'none', paddingTop: 0 }}>
		{props.children}
		<Text marginTop="6px" fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			<Box as="span" fontWeight={700} color="var(--tt-text, #5a5a66)">
				{props.label}
			</Box>
			{' · '}
			{props.meta}
		</Text>
	</Box>
);

const TypographyStory = () => (
	<Box>
		<TypeSample label="--tt-font-display" meta="landing hero · 800–900, clamp(44px, 7vw, 74px), −0.03em (shown smaller)">
			<Text fontFamily="var(--tt-font-display, system-ui, sans-serif)" fontSize="clamp(30px, 5vw, 48px)" fontWeight={900} letterSpacing="-0.03em" lineHeight="1.05" color="var(--tt-ink, #16161a)">
				Everything is a thing.
			</Text>
		</TypeSample>
		<TypeSample label="--tt-font-heading" meta="page + section headings · 600/700, −0.02em (Space Grotesk in the default theme)">
			<Text fontFamily="var(--tt-font-heading, system-ui, sans-serif)" fontSize="24px" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)">
				Your stuff, structured.
			</Text>
		</TypeSample>
		<TypeSample label="--tt-font-body" meta="body copy · 400–600, 16px / 1.65 (Hanken Grotesk in the default theme)">
			<Text fontFamily="var(--tt-font-body, system-ui, sans-serif)" fontSize="16px" lineHeight="1.65" color="var(--tt-text, #5a5a66)" maxWidth="560px">
				Thingtime keeps every value, list, and object as a thing you can open, edit, and share — the interface reads like a
				document and edits like a database.
			</Text>
		</TypeSample>
		<TypeSample label="--tt-font-mono" meta="keys, paths, eyebrows, shortcuts · 400–600 (JetBrains Mono in the default theme)">
			<Flex alignItems="center" columnGap={3} flexWrap="wrap">
				<Text fontFamily={MONO} fontSize="13px" color="var(--tt-ink, #16161a)">
					user.garden.flowers
				</Text>
				<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
					section eyebrow
				</Text>
				<Box
					fontFamily={MONO}
					fontSize="11px"
					padding="2px 6px"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="6px"
					color="var(--tt-text, #5a5a66)"
				>
					⌘P
				</Box>
			</Flex>
		</TypeSample>
	</Box>
);

const RADIUS_STEPS: { token: string; label: string }[] = [
	{ token: '--tt-radius-xs', label: 'xs · 7' },
	{ token: '--tt-radius-sm', label: 'sm · 9' },
	{ token: '--tt-radius-md', label: 'md · 12' },
	{ token: '--tt-radius-lg', label: 'lg · 16' },
	{ token: '--tt-radius-xl', label: 'xl · 20' },
	{ token: '--tt-radius-2xl', label: '2xl · 26' }
];

const RadiusStory = () => (
	<Flex alignItems="flex-end" columnGap={5} rowGap={5} flexWrap="wrap">
		{RADIUS_STEPS.map((step) => (
			<Flex key={step.token} flexDirection="column" alignItems="center" rowGap="8px">
				<Box
					width="56px"
					height="56px"
					background="var(--tt-card, #ffffff)"
					border="2px solid var(--tt-ink, #16161a)"
					borderRadius={`var(${step.token})`}
				/>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					{step.label}
				</Text>
			</Flex>
		))}
		<Flex flexDirection="column" alignItems="center" rowGap="8px">
			<Flex
				width="104px"
				height="40px"
				marginBottom="8px"
				alignItems="center"
				justifyContent="center"
				background="var(--tt-card, #ffffff)"
				border="2px solid var(--tt-ink, #16161a)"
				borderRadius="var(--tt-radius-pill, 999px)"
				fontFamily={MONO}
				fontSize="10px"
				color="var(--tt-text, #5a5a66)"
			>
				pill
			</Flex>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				pill · 999
			</Text>
		</Flex>
	</Flex>
);

const ShadowChip = (props: { label: string; shadow: string; hard?: boolean }) => (
	<Flex flexDirection="column" alignItems="flex-start" rowGap="10px">
		<Box
			width="96px"
			height="64px"
			background="var(--tt-card, #ffffff)"
			border={props.hard ? '2px solid var(--tt-ink, #16161a)' : '1px solid var(--tt-border, #ececef)'}
			borderRadius={props.hard ? '0' : 'var(--tt-radius-md, 12px)'}
			boxShadow={props.shadow}
		/>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" overflowWrap="anywhere" maxWidth="120px">
			{props.label}
		</Text>
	</Flex>
);

const ShadowStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<Box>
			<GroupLabel>Themed elevation set — soft in Prism, hard-offset in Fable (same tokens)</GroupLabel>
			<Flex columnGap={7} rowGap={5} flexWrap="wrap" padding="8px 8px 8px 0">
				<ShadowChip label="--tt-shadow-card" shadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))" />
				<ShadowChip label="--tt-shadow-panel" shadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))" />
				<ShadowChip label="--tt-shadow-popover" shadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))" />
				<ShadowChip label="--tt-shadow-toast" shadow="var(--tt-shadow-toast, 0 14px 38px rgba(20, 20, 40, 0.18))" />
			</Flex>
		</Box>
		<Box>
			<GroupLabel>The hard Fable trio — always hard, in every theme (3 / 5 / 8px ink offsets)</GroupLabel>
			<Flex columnGap={8} rowGap={5} flexWrap="wrap" padding="8px 12px 12px 0">
				<ShadowChip hard label="3px 3px 0 --tt-ink (card, hard mode)" shadow="3px 3px 0 var(--tt-ink, #16161a)" />
				<ShadowChip hard label="--tt-shadow-hard-sm" shadow="var(--tt-shadow-hard-sm, 5px 5px 0 #16161a)" />
				<ShadowChip hard label="--tt-shadow-hard-lg" shadow="var(--tt-shadow-hard-lg, 8px 8px 0 #16161a)" />
			</Flex>
		</Box>
	</Flex>
);

const DialectCardBody = () => (
	<>
		<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
			garden · sunflowers
		</Text>
		<Text fontFamily="var(--tt-font-heading, system-ui, sans-serif)" fontSize="19px" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)" marginTop="4px">
			Sunflower patch 🌻
		</Text>
		<Text fontFamily="var(--tt-font-body, system-ui, sans-serif)" fontSize="13.5px" lineHeight="1.6" color="var(--tt-text, #5a5a66)" marginTop="6px">
			Twelve heads, all facing the fence by 9am. Water on Tuesdays.
		</Text>
	</>
);

const DialectsStory = () => (
	<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} columnGap={8} rowGap={6} paddingRight="10px" paddingBottom="10px">
		<Box>
			<GroupLabel>Prism — soft chrome (product UI)</GroupLabel>
			<Box
				background="var(--tt-card, #ffffff)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="16px"
				boxShadow="0 24px 60px -28px rgba(20, 20, 40, 0.28)"
				padding={5}
			>
				<DialectCardBody />
				<Flex
					as="span"
					width="fit-content"
					marginTop="14px"
					alignItems="center"
					padding="7px 14px"
					background="var(--tt-ink, #16161a)"
					color="var(--tt-card, #ffffff)"
					borderRadius="11px"
					fontSize="12.5px"
					fontWeight={600}
					boxShadow="0 6px 20px rgba(0, 0, 0, 0.16)"
				>
					Open thing
				</Flex>
			</Box>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="10px">
				1px --tt-border · radius-lg · soft shadows · Space Grotesk headings
			</Text>
		</Box>
		<Box>
			<GroupLabel>Fable — neo-brutalist (marketing)</GroupLabel>
			<Box
				background="var(--tt-card, #ffffff)"
				border="var(--tt-border-w-chunky, 3px) solid var(--tt-ink, #16161a)"
				borderRadius="0"
				boxShadow="var(--tt-shadow-hard-lg, 8px 8px 0 #16161a)"
				padding={5}
			>
				<DialectCardBody />
				<Flex
					as="span"
					width="fit-content"
					marginTop="14px"
					alignItems="center"
					padding="7px 14px"
					background="var(--tt-accent, hotpink)"
					color="var(--tt-accent-contrast, #ffffff)"
					border="var(--tt-border-w-chunky, 3px) solid var(--tt-ink, #16161a)"
					borderRadius="0"
					fontSize="12.5px"
					fontWeight={800}
					boxShadow="var(--tt-shadow-hard-sm, 5px 5px 0 #16161a)"
				>
					Open thing
				</Flex>
			</Box>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="10px">
				--tt-border-w-chunky ink border · radius 0 · --tt-shadow-hard-sm/-lg · system 800/900
			</Text>
		</Box>
	</Grid>
);

export const foundationsStories: DesignSystemStory[] = [
	{
		id: 'color-tokens',
		title: 'Colour tokens',
		description:
			'The full colour vocabulary, read live from the --tt-* custom properties on <html>. Ink→faint is the four-step text ramp; chrome tokens paint surfaces and hairlines; accent/link/signal colours carry meaning. Change the theme in settings and every swatch here updates without a rebuild.',
		render: ColorTokensStory,
		note: 'Components must always pair the var() with its Thingtime literal fallback — e.g. var(--tt-ink, #16161a) — so first paint is correct before the ThemeHost runs.'
	},
	{
		id: 'rainbow',
		title: 'Rainbow palette + gradients',
		description:
			'The five-stop brand rainbow (--tt-rainbow-1…5) and both canonical gradients: --tt-gradient-rainbow (blue-first, 90deg, tiles seamlessly for borders/buttons/progress) and --tt-gradient-rainbow-x (red-first, for animated headline text). Both animate with var(--tt-rainbow-anim), which resolves to none when the theme’s motion switch is off.',
		render: RainbowStory,
		note: 'Import RAINBOW / RAINBOW_TEXT / RAINBOW_CONIC / RAINBOW_VARS from ~/theme/rainbow — never hardcode the five hexes.'
	},
	{
		id: 'typography',
		title: 'Typography',
		description:
			'Four font roles, each a token: display (landing hero), heading (pages + sections), body, and mono (keys, paths, eyebrows, shortcuts). The default theme loads Space Grotesk / Hanken Grotesk / JetBrains Mono; Fable collapses display+heading+body onto the system stack at 800/900 weights.',
		render: TypographyStory
	},
	{
		id: 'radius-scale',
		title: 'Radius scale',
		description:
			'Seven steps: xs 7 · sm 9 · md 12 · lg 16 · xl 20 · 2xl 26 · pill 999. Every step is multiplied by the theme’s radiusScale — Prism is 1, Fable is 0, so the same tokens render fully square in the brutalist dialect (pill included: it collapses to 0 too).',
		render: RadiusStory,
		note: 'Chips/inputs use xs–sm, cards/buttons md, panels lg–xl, hero cards 2xl, badges pill.'
	},
	{
		id: 'shadows',
		title: 'Shadow set',
		description:
			'The themed elevation set (card / panel / popover / toast) is soft in Prism and swaps to hard ink offsets in Fable — components just use the token and inherit the dialect. The hard trio (3px card, --tt-shadow-hard-sm 5px, --tt-shadow-hard-lg 8px) is ALWAYS hard, for surfaces that are deliberately brutalist in any theme (BrutalButton, landing cards).',
		render: ShadowStory
	},
	{
		id: 'dialects',
		title: 'Two dialects, one vocabulary',
		description:
			'The same card spoken in both dialects. Prism (product UI): 1px borders, soft radii, soft shadows, refined type. Fable (marketing): chunky --tt-border-w-chunky ink borders, radius 0, hard offset shadows, heavy system type. Everything on both cards is drawn from the same token set — a theme flips the dialect, not the components.',
		render: DialectsStory,
		note: 'Rule of thumb: product chrome speaks Prism through the themed tokens; only marketing surfaces hardcode the hard/chunky tokens.'
	}
];
