import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import type { PageShellWidth } from '~/components/Layout/PageShell';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Typography + spacing practice. Every sample reads the
// real --tt-font-* tokens, the eyebrow rows are the exact recipes shipped in
// PageShell.tsx / the docs group labels, and the width bars are the real
// PageShellWidth scale drawn to proportion. No fetches, no mocks.

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

const RoleRow = (props: { spec: string; where: string; children: React.ReactNode }) => (
	<Box paddingY="14px" borderTop="1px solid var(--tt-border-light, #f0f0f2)" _first={{ borderTop: 'none', paddingTop: 0 }}>
		{props.children}
		<Text marginTop="6px" fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			<Box as="span" fontWeight={700} color="var(--tt-text, #5a5a66)">
				{props.spec}
			</Box>
			{' · '}
			{props.where}
		</Text>
	</Box>
);

const TypeRampStory = () => (
	<Box>
		<RoleRow
			spec="--tt-font-display · 800–900 · clamp(44px, 7vw, 74px) · −0.03em"
			where="landing hero + marketing headlines ONLY — never product chrome (shown smaller)"
		>
			<Text
				fontFamily="var(--tt-font-display, system-ui, sans-serif)"
				fontSize="clamp(30px, 5vw, 46px)"
				fontWeight={900}
				letterSpacing="-0.03em"
				lineHeight="1.05"
				color="var(--tt-ink, #16161a)"
			>
				A GUI for the internet.
			</Text>
		</RoleRow>
		<RoleRow spec="--tt-font-heading · 700 · 2xl · −0.02em" where="the page h1 (PageHeader), one per page">
			<Text fontFamily="var(--tt-font-heading, system-ui, sans-serif)" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)">
				Your stuff, structured
			</Text>
		</RoleRow>
		<RoleRow spec="--tt-font-heading · 700 · 19px · −0.02em" where="card + section titles inside a page">
			<Text fontFamily="var(--tt-font-heading, system-ui, sans-serif)" fontSize="19px" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)">
				Sunflower patch 🌻
			</Text>
		</RoleRow>
		<RoleRow spec="--tt-font-body · 400 · 16px / 1.65" where="reading copy — long-form paragraphs, post bodies">
			<Text fontFamily="var(--tt-font-body, system-ui, sans-serif)" fontSize="16px" lineHeight="1.65" color="var(--tt-text, #5a5a66)" maxWidth="560px">
				Thingtime keeps every value, list, and object as a thing you can open, edit, and share — the interface reads like a
				document and edits like a database.
			</Text>
		</RoleRow>
		<RoleRow spec="--tt-font-body · sm (13–13.5px) / 1.6" where="UI copy — subtitles, hints, card body text">
			<Text fontFamily="var(--tt-font-body, system-ui, sans-serif)" fontSize="13.5px" lineHeight="1.6" color="var(--tt-text, #5a5a66)" maxWidth="560px">
				Twelve heads, all facing the fence by 9am. Water on Tuesdays.
			</Text>
		</RoleRow>
		<RoleRow spec="--tt-font-mono · 400–600 · 13px → 10px" where="keys, paths, shortcuts, eyebrows — anything machine-shaped">
			<Flex alignItems="center" columnGap={3} flexWrap="wrap" rowGap={2}>
				<Text fontFamily={MONO} fontSize="13px" color="var(--tt-ink, #16161a)">
					user.garden.flowers
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
				<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
					settings · appearance
				</Text>
			</Flex>
		</RoleRow>
	</Box>
);

// The three tracking dialects of the one eyebrow recipe, each quoted from a
// real shipped surface.
const EYEBROW_VARIANTS: { tracking: string; sample: string; where: string }[] = [
	{ tracking: '0.08em', sample: 'settings · appearance', where: 'PageHeader eyebrows + hairline row labels (PageShell.tsx)' },
	{ tracking: '0.12em', sample: 'brand assets', where: 'section labels on denser panels (BrandAssetSection, OAuth, status pages)' },
	{ tracking: '0.14em', sample: 'ink + text', where: 'docs group labels — the widest, most display-like setting' }
];

const EyebrowRecipeStory = () => (
	<Flex flexDirection="column" rowGap={5}>
		<Box>
			<GroupLabel>The recipe — one spec, three tracking widths</GroupLabel>
			<Flex flexDirection="column" rowGap={3} maxWidth="620px">
				{EYEBROW_VARIANTS.map((variant) => (
					<Grid key={variant.tracking} templateColumns={{ base: '1fr', md: '220px 1fr' }} columnGap={4} rowGap={1} alignItems="baseline">
						<Text
							fontFamily={MONO}
							fontSize="10px"
							fontWeight={600}
							letterSpacing={variant.tracking}
							textTransform="uppercase"
							color="var(--tt-muted, #9a9aa6)"
						>
							{variant.sample}
						</Text>
						<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
							<Box as="span" fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)">
								{variant.tracking}
							</Box>
							{' — '}
							{variant.where}
						</Text>
					</Grid>
				))}
			</Flex>
		</Box>
		<Box>
			<GroupLabel>Do / don’t</GroupLabel>
			<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} columnGap={6} rowGap={4}>
				<Box>
					<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
						docs · design system
					</Text>
					<Text fontSize="xs" color="var(--tt-positive, #2f9e63)" marginTop="4px">
						✓ lowercase source text, middot hierarchy — CSS does the uppercasing
					</Text>
				</Box>
				<Box>
					<Text fontFamily={MONO} fontSize="10px" fontWeight={600} color="var(--tt-muted, #9a9aa6)">
						DOCS &gt;&gt; DESIGN SYSTEM!!
					</Text>
					<Text fontSize="xs" color="var(--tt-danger, #e5484d)" marginTop="4px">
						✗ typed-uppercase source, no tracking, ad-hoc separators — reads as shouting, breaks find-in-page
					</Text>
				</Box>
			</Grid>
		</Box>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			spec: --tt-font-mono · 10–11px · 600–700 · letter-spacing 0.08–0.14em · text-transform uppercase · --tt-muted
		</Text>
	</Flex>
);

const WIDTH_SCALE: { width: PageShellWidth; usedBy: string }[] = [
	{ width: 680, usedBy: 'default reading column — settings, feed, /p pages' },
	{ width: 760, usedBy: 'status/report pages with denser rows' },
	{ width: 860, usedBy: 'content pages that add side metadata' },
	{ width: 920, usedBy: 'form-and-panel pages — builder, migrations' },
	{ width: 1100, usedBy: 'card grids and dashboards' },
	{ width: 1180, usedBy: 'test/report tables' },
	{ width: 1280, usedBy: 'admin dashboard tables' },
	{ width: 1400, usedBy: 'full workbench — raw data explorer' }
];

// The scale drawn the way it behaves: centered columns nested inside the
// viewport, narrowest (most common) on top.
const WidthScaleStory = () => (
	<Box>
		<Box border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" background="var(--tt-surface, #fafafb)" paddingY={4} paddingX={2}>
			<Flex flexDirection="column" rowGap="7px" alignItems="center">
				{WIDTH_SCALE.map((row) => (
					<Flex
						key={row.width}
						width={`${(row.width / 1400) * 100}%`}
						minWidth="200px"
						maxWidth="100%"
						alignItems="baseline"
						justifyContent="space-between"
						columnGap={3}
						paddingX={3}
						paddingY="5px"
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-sm, 9px)"
						boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
					>
						<Text fontFamily={MONO} fontSize="11px" fontWeight={700} color="var(--tt-ink, #16161a)" flexShrink={0}>
							{row.width}
						</Text>
						<Text fontSize="11px" color="var(--tt-muted, #9a9aa6)" noOfLines={1} textAlign="right">
							{row.usedBy}
						</Text>
					</Flex>
				))}
			</Flex>
		</Box>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={2}>
			PageShellWidth = 680 | 760 | 860 | 920 | 1100 | 1180 | 1280 | 1400 — a closed union type; in-between numbers are a
			type error on purpose
		</Text>
	</Box>
);

// The Chakra 0.25rem ramp: the numbers pages actually use, with their jobs.
const SPACE_STEPS: { unit: string; px: number; job: string }[] = [
	{ unit: '1', px: 4, job: 'micro gaps — icon-to-label inside a chip' },
	{ unit: '2', px: 8, job: 'tight internal gaps — rows inside a control' },
	{ unit: '2.5', px: 10, job: 'hairline row paddingY (label/value rows)' },
	{ unit: '3', px: 12, job: 'grid gaps in swatch/card grids' },
	{ unit: '4', px: 16, job: 'THE workhorse — column rowGap, px gutters (PageShell)' },
	{ unit: '5', px: 20, job: 'card padding (CARD_STYLES sections)' },
	{ unit: '6', px: 24, job: 'gaps between story groups / big sections' },
	{ unit: '8', px: 32, job: 'header paddingTop on desktop (PageHeader pt=[4, 8])' },
	{ unit: '12', px: 48, job: 'page tail — PageShell pb so pages never end at the fold' }
];

const SpaceRampStory = () => (
	<Box>
		<Flex flexDirection="column" rowGap="8px">
			{SPACE_STEPS.map((step) => (
				<Grid key={step.unit} templateColumns={{ base: '54px 60px 1fr', md: '54px 100px 1fr' }} columnGap={3} alignItems="center">
					<Text fontFamily={MONO} fontSize="11px" fontWeight={700} color="var(--tt-ink, #16161a)">
						{step.unit}
					</Text>
					<Flex alignItems="center" columnGap="6px">
						<Box width={`${step.px}px`} height="14px" background="var(--tt-accent, hotpink)" borderRadius="2px" flexShrink={0} />
						<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
							{step.px}px
						</Text>
					</Flex>
					<Text fontSize="12px" color="var(--tt-text, #5a5a66)" noOfLines={2}>
						{step.job}
					</Text>
				</Grid>
			))}
		</Flex>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={3}>
			Chakra spacing: 1 unit = 0.25rem = 4px — write gap/padding as unit numbers (rowGap={'{4}'}), reserve raw px strings
			for optical values the ramp can’t express (7px control padding, 44px tap minimums)
		</Text>
	</Box>
);

export const typographyAndSpacingStories: DesignSystemStory[] = [
	{
		id: 'type-ramp',
		title: 'The type ramp — four roles, six settings',
		description:
			'Every text setting in the app resolves to one of four font-role tokens: display (marketing hero only), heading (the h1 and card titles), body (16px/1.65 reading copy, 13–13.5px/1.6 UI copy), and mono (keys, paths, shortcuts, eyebrows). The ramp is rendered live from the tokens — switch themes and the faces change while the sizes, weights, and tracking hold.',
		render: TypeRampStory,
		note: 'Negative tracking is reserved for headings (−0.02em) and display (−0.03em); body never tightens, mono never tightens — it TRACKS OUT in the eyebrow recipe instead.'
	},
	{
		id: 'eyebrow-recipe',
		title: 'The mono eyebrow',
		description:
			'The signature label of the design language: --tt-font-mono, 10–11px, weight 600–700, letter-spacing 0.08–0.14em, uppercase, --tt-muted. Three tracking widths are in service — 0.08em on page eyebrows and row labels, 0.12em on denser panel sections, 0.14em on docs group labels. Source text is always lowercase with middot hierarchy; CSS does the uppercasing.',
		render: EyebrowRecipeStory
	},
	{
		id: 'width-scale',
		title: 'The content width scale',
		description:
			'Eight closed steps from 680 to 1400, drawn to proportion as the centred columns they produce. Reading surfaces live at 680, forms and panels around 920, tables 1180–1280, and only full workbenches take 1400. PageShellWidth is a union type, so an arbitrary width does not compile — widening a page is a deliberate step up the scale, not a nudge.',
		render: WidthScaleStory
	},
	{
		id: 'space-ramp',
		title: 'The space ramp (Chakra 0.25rem units)',
		description:
			'Spacing is written in Chakra units (1 = 0.25rem = 4px), and in practice pages use a small working set: 4 is the workhorse (column rowGap, px gutters), 5 pads cards, 2.5 paddings hairline rows, 12 is the page tail. Staying on the ramp is what keeps unrelated pages rhythmically identical.',
		render: SpaceRampStory
	}
];
