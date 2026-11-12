import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import type { PageShellWidth } from '~/components/Layout/PageShell';
import { CARD_STYLES } from '~/theme/card';
import type { DesignSystemStory } from './ThingContextMenuStories';

// Live stories for the Page scaffold entry: PageShell + PageHeader +
// CARD_STYLES, rendered inside a clipped "viewport" frame so the 100vh shell
// and the fixed-nav clearance can be shown at storybook scale. The stories use
// the REAL components — nothing is mocked, so a scaffold change shows up here.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

// A miniature browser viewport: relative frame + scrollable inside + a fake
// fixed nav at exactly var(--tt-nav-clearance) so PAGE_TOP_CLEARANCE can be
// seen doing its one job.
const ViewportFrame = (props: { children: React.ReactNode; height?: string; nav?: boolean }) => (
	<Box
		position="relative"
		height={props.height || '440px'}
		overflow="hidden"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-surface, #fafafb)"
	>
		<Box position="absolute" inset={0} overflow="auto">
			{props.children}
		</Box>
		{props.nav !== false && (
			<Flex
				position="absolute"
				top={0}
				left={0}
				right={0}
				height="var(--tt-nav-clearance, 54px)"
				alignItems="center"
				justifyContent="space-between"
				paddingX={4}
				background="rgba(255, 255, 255, 0.78)"
				backdropFilter="blur(14px)"
				borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
				fontFamily={MONO}
				fontSize="10px"
				letterSpacing="0.08em"
				textTransform="uppercase"
				color="var(--tt-muted, #9a9aa6)"
				pointerEvents="none"
				zIndex={2}
			>
				<Text>fixed nav</Text>
				<Text>height = var(--tt-nav-clearance, 54px)</Text>
			</Flex>
		)}
	</Box>
);

const HairlineRow = (props: { label: string; value: string; first?: boolean }) => (
	<Grid
		templateColumns="120px 1fr"
		columnGap={4}
		paddingY={2.5}
		borderTop={props.first ? 'none' : '1px solid'}
		borderColor="var(--tt-border-light, #f0f0f2)"
	>
		<Text
			alignSelf="center"
			fontFamily={MONO}
			fontSize="10px"
			fontWeight={600}
			letterSpacing="0.08em"
			textTransform="uppercase"
			color="var(--tt-muted, #9a9aa6)"
		>
			{props.label}
		</Text>
		<Text fontSize="sm" color="var(--tt-ink, #16161a)">
			{props.value}
		</Text>
	</Grid>
);

const CanonicalPageStory = () => (
	<ViewportFrame height="480px">
		<PageShell width={680}>
			<PageHeader
				eyebrow="docs · design system"
				title="The canonical page"
				subtitle="PageShell centres the column on the --tt-surface wash and clears the fixed nav with PAGE_TOP_CLEARANCE; PageHeader stacks the mono eyebrow over the animated rainbow h1; CARD_STYLES draws the card. Scroll the frame — the nav stays put, the page slides under it."
			/>
			<Box {...CARD_STYLES} padding={5}>
				<Text
					fontFamily={MONO}
					fontSize="10px"
					fontWeight={600}
					letterSpacing="0.14em"
					textTransform="uppercase"
					color="var(--tt-muted, #9a9aa6)"
					marginBottom={2}
				>
					Thing details
				</Text>
				<HairlineRow first label="name" value="Sunflower patch" />
				<HairlineRow label="kind" value="garden" />
				<HairlineRow label="visibility" value="private" />
				<HairlineRow label="updated" value="2 minutes ago" />
			</Box>
		</PageShell>
	</ViewportFrame>
);

const InkHeaderStory = () => (
	<ViewportFrame height="300px">
		<PageShell width={760}>
			<PageHeader
				variant="ink"
				eyebrow="admin · migrations"
				title="Collection generations"
				subtitle="Utility, admin, and secondary surfaces use the ink variant — one solid-ink h1, no gradient. The rainbow headline is reserved for primary destinations so it stays special."
				after={
					<Flex
						alignItems="center"
						padding="3px 10px"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-pill, 999px)"
						background="var(--tt-card, #ffffff)"
						fontFamily={MONO}
						fontSize="10px"
						fontWeight={600}
						color="var(--tt-muted, #9a9aa6)"
					>
						2 pending
					</Flex>
				}
			/>
		</PageShell>
	</ViewportFrame>
);

const EyebrowSample = (props: { children: React.ReactNode }) => (
	<Text
		fontFamily={MONO}
		fontSize="10px"
		fontWeight={600}
		letterSpacing="0.08em"
		textTransform="uppercase"
		color="var(--tt-muted, #9a9aa6)"
	>
		{props.children}
	</Text>
);

const EyebrowStory = () => (
	<Flex flexDirection="column" rowGap={4} maxWidth="560px">
		{[
			{ sample: 'feed', note: 'top-level destination: just the place name' },
			{ sample: 'settings · appearance', note: 'section of a place: parent · child, middot-separated' },
			{ sample: 'docs · design system', note: 'the recipe: lowercase source text, CSS does the uppercasing' }
		].map((row) => (
			<Grid key={row.sample} templateColumns={{ base: '1fr', md: '220px 1fr' }} columnGap={4} rowGap={1} alignItems="baseline">
				<EyebrowSample>{row.sample}</EyebrowSample>
				<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
					{row.note}
				</Text>
			</Grid>
		))}
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={1}>
			spec: --tt-font-mono · 10px · 600 · letter-spacing 0.08em · uppercase · --tt-muted
		</Text>
	</Flex>
);

const WIDTH_SCALE: { width: PageShellWidth; usedBy: string }[] = [
	{ width: 680, usedBy: 'the default reading column — settings, feed, /p pages, apps data' },
	{ width: 760, usedBy: 'status/report pages with slightly denser rows' },
	{ width: 860, usedBy: 'content pages that add side metadata' },
	{ width: 920, usedBy: 'form-and-panel pages — builder, migrations, vercel, crypto' },
	{ width: 1100, usedBy: 'card grids and dashboards' },
	{ width: 1180, usedBy: 'test/report tables' },
	{ width: 1280, usedBy: 'admin dashboard tables' },
	{ width: 1400, usedBy: 'full workbench surfaces — raw data explorer' }
];

const WidthScaleStory = () => (
	<Flex flexDirection="column" rowGap={3}>
		{WIDTH_SCALE.map((row) => (
			<Box key={row.width}>
				<Flex
					height="26px"
					width={`${(row.width / 1400) * 100}%`}
					minWidth="120px"
					alignItems="center"
					paddingX={3}
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-sm, 9px)"
					boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
					fontFamily={MONO}
					fontSize="10px"
					fontWeight={600}
					color="var(--tt-ink, #16161a)"
				>
					{row.width}
				</Flex>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="3px">
					{row.usedBy}
				</Text>
			</Box>
		))}
	</Flex>
);

export const pageScaffoldStories: DesignSystemStory[] = [
	{
		id: 'canonical-page',
		title: 'The canonical page',
		description:
			'PageShell (surface wash, centred 680px column, nav clearance, pre-wrap reset) + PageHeader (mono eyebrow, animated rainbow h1, subtitle) + a CARD_STYLES card with hairline label/value rows. This exact stack is what SettingsPage, Feed, and every conforming page renders — the scaffold was extracted from them verbatim.',
		render: CanonicalPageStory,
		note: 'The frame is a miniature viewport: its fake nav is exactly var(--tt-nav-clearance) tall, so you can see PAGE_TOP_CLEARANCE clearing it (plus the iOS safe area on device).'
	},
	{
		id: 'ink-header',
		title: 'Ink header variant',
		description:
			'variant="ink" renders the same header with a solid --tt-ink title. Use it on utility/admin/secondary pages so the animated rainbow stays reserved for primary destinations. The optional `after` slot sits baseline-aligned at the right of the title row — badges, counts, actions.',
		render: InkHeaderStory
	},
	{
		id: 'eyebrows',
		title: 'Eyebrow conventions',
		description:
			'Eyebrows locate the page: mono, 10px, 600, 0.08em tracking, uppercase, --tt-muted. Write them lowercase with a spaced middot between hierarchy levels ("settings · appearance") and let CSS uppercase them. One eyebrow per header — deeper paths belong in breadcrumbs or the thing path, not the eyebrow.',
		render: EyebrowStory
	},
	{
		id: 'width-scale',
		title: 'The width scale (680–1400)',
		description:
			'PageShellWidth is a closed scale: 680 · 760 · 860 · 920 · 1100 · 1180 · 1280 · 1400. Pick the narrowest step that fits the page’s densest row — reading columns live at 680, forms and panel pages around 920, tables 1180–1280, and only full workbenches take 1400. Arbitrary widths are a type error on purpose.',
		render: WidthScaleStory
	}
];
