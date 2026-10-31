import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Chips & badges entry. The Chip and dot components in
// the app are module-local (routes/tests.tsx, components/Admin/
// AdminDashboard.tsx, routes/vercel.tsx) rather than a shared export, so the
// stories render the exact recipes those modules define — same tokens, same
// literals — with each source named. No fetches.

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

// The house chip tones — union of the tests.tsx CHIP_TONES and AdminDashboard
// CHIP_TONE_STYLES maps. Every fill is a token tint (or the rgba literal of
// the default signal hex where no *-soft token exists yet), and the text is
// the matching signal colour.
const CHIP_TONES = {
	neutral: { bg: 'var(--tt-surface-alt, #f5f5f7)', color: 'var(--tt-muted, #9a9aa6)' },
	positive: { bg: 'var(--tt-positive-soft, rgba(88, 202, 112, 0.14))', color: 'var(--tt-positive, #2f8f4f)' },
	danger: { bg: 'rgba(214, 69, 90, 0.12)', color: 'var(--tt-danger, #d6455a)' },
	accent: { bg: 'var(--tt-accent-tint, #fff5fa)', color: 'var(--tt-accent, hotpink)' },
	link: { bg: 'rgba(47, 143, 214, 0.12)', color: 'var(--tt-link, #2f8fd6)' },
	warning: { bg: 'rgba(255, 188, 72, 0.2)', color: 'var(--tt-ink, #16161a)' }
} as const;

type ChipTone = keyof typeof CHIP_TONES;

const Chip = (props: { tone?: ChipTone; dot?: string; children: React.ReactNode }) => {
	const tone = CHIP_TONES[props.tone ?? 'neutral'];

	return (
		<Box
			as="span"
			display="inline-flex"
			alignItems="center"
			columnGap="6px"
			bg={tone.bg}
			color={tone.color}
			borderRadius="var(--tt-radius-pill, 999px)"
			px={2}
			py="2px"
			fontFamily={MONO}
			fontSize="10px"
			fontWeight={600}
			letterSpacing="0.06em"
			textTransform="uppercase"
			whiteSpace="nowrap"
		>
			{props.dot ? <Box as="span" width="6px" height="6px" borderRadius="2px" bg={props.dot} flexShrink={0} /> : null}
			{props.children}
		</Box>
	);
};

// The square status dot + mono uppercase label lockup (AdminDashboard
// StatusDot): 7px box, 2px radius, label in --tt-muted.
const StatusDot = (props: { color: string; label: string }) => (
	<Flex align="center" display="inline-flex" gap="6px">
		<Box bg={props.color} borderRadius="2px" boxSize="7px" flexShrink={0} />
		<Text
			as="span"
			color="var(--tt-muted, #9a9aa6)"
			fontFamily={MONO}
			fontSize="10px"
			fontWeight={600}
			letterSpacing="0.05em"
			textTransform="uppercase"
		>
			{props.label}
		</Text>
	</Flex>
);

const TONE_ROWS: { tone: ChipTone; label: string; fill: string; text: string; usedFor: string }[] = [
	{ tone: 'neutral', label: 'neutral', fill: '--tt-surface-alt', text: '--tt-muted', usedFor: 'counts, meta, default state' },
	{ tone: 'positive', label: 'positive', fill: '--tt-positive-soft', text: '--tt-positive', usedFor: 'passed, ready, configured' },
	{ tone: 'danger', label: 'danger', fill: 'rgba(--tt-danger · 0.12)', text: '--tt-danger', usedFor: 'failed, error, blocked' },
	{ tone: 'accent', label: 'accent', fill: '--tt-accent-tint', text: '--tt-accent', usedFor: 'selection, ownership, featured' },
	{ tone: 'link', label: 'link / info', fill: 'rgba(--tt-link · 0.12)', text: '--tt-link', usedFor: 'informational, external refs' },
	{ tone: 'warning', label: 'warning', fill: 'rgba(--tt-warning · 0.2)', text: '--tt-ink', usedFor: 'caution, throttles, sandboxes' }
];

const ChipToneMatrixStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<Box>
			<GroupLabel>The tone matrix — pill radius, mono 10px 600 uppercase, tint fill + signal text</GroupLabel>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
				<Chip>3 visible</Chip>
				<Chip tone="positive">12 passed</Chip>
				<Chip tone="danger">1 failed</Chip>
				<Chip tone="accent">2 selected</Chip>
				<Chip tone="link">preview</Chip>
				<Chip tone="warning">ses sandbox</Chip>
				<Chip dot="var(--tt-warning, #ffbc48)">throttle 1000ms</Chip>
			</Flex>
		</Box>
		<Box>
			<GroupLabel>Tone table</GroupLabel>
			<Box border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" overflow="hidden">
				{TONE_ROWS.map((row, index) => (
					<Grid
						key={row.tone}
						templateColumns={{ base: '110px 1fr', md: '110px 170px 130px 1fr' }}
						columnGap={4}
						rowGap={1}
						alignItems="center"
						paddingX={4}
						paddingY="9px"
						borderTop={index === 0 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'}
					>
						<Box>
							<Chip tone={row.tone}>{row.label}</Chip>
						</Box>
						<Text fontFamily={MONO} fontSize="10px" color="var(--tt-text, #5a5a66)">
							{row.fill}
						</Text>
						<Text fontFamily={MONO} fontSize="10px" color="var(--tt-text, #5a5a66)" display={{ base: 'none', md: 'block' }}>
							{row.text}
						</Text>
						<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
							{row.usedFor}
						</Text>
					</Grid>
				))}
			</Box>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="8px">
				danger / link / warning tints are rgba literals of the default signal hexes — no *-soft tokens exist for them
				yet, so custom themes re-colour the text but keep the default tint.
			</Text>
		</Box>
	</Flex>
);

// The vercel.tsx state → dot-colour map, verbatim.
const DEPLOY_STATES: { state: string; color: string }[] = [
	{ state: 'ready', color: 'var(--tt-positive, #2f8f4f)' },
	{ state: 'building', color: 'var(--tt-warning, #ffbc48)' },
	{ state: 'queued', color: 'var(--tt-border, #ececef)' },
	{ state: 'error', color: 'var(--tt-danger, #d6455a)' },
	{ state: 'canceled', color: 'var(--tt-muted, #9a9aa6)' },
	{ state: 'unknown', color: 'var(--tt-faint, #b6b6c0)' }
];

const StatusDotStory = () => (
	<Flex flexDirection="column" rowGap={6}>
		<Box>
			<GroupLabel>Square lockup — admin dashboards (7px box, 2px radius)</GroupLabel>
			<Flex columnGap={5} rowGap={3} flexWrap="wrap">
				<StatusDot color="var(--tt-positive, #2f8f4f)" label="mongo connected" />
				<StatusDot color="var(--tt-warning, #ffbc48)" label="storage 82%" />
				<StatusDot color="var(--tt-danger, #d6455a)" label="ses unreachable" />
			</Flex>
		</Box>
		<Box>
			<GroupLabel>Round lockup — status page + vercel rows (10px, borderRadius full)</GroupLabel>
			<Flex flexDirection="column" rowGap="10px">
				{DEPLOY_STATES.map((deploy) => (
					<Flex key={deploy.state} alignItems="center" gap={3}>
						<Box width="10px" height="10px" borderRadius="full" bg={deploy.color} flexShrink={0} />
						<Text
							fontFamily={MONO}
							fontSize="xs"
							fontWeight={600}
							letterSpacing="0.08em"
							textTransform="uppercase"
							color="var(--tt-muted, #9a9aa6)"
						>
							{deploy.state}
						</Text>
					</Flex>
				))}
			</Flex>
		</Box>
		<Box>
			<GroupLabel>Dot-in-pill — the vercel deployment state pill (surface-alt pill wrapping a 7px dot)</GroupLabel>
			<Flex columnGap={2} rowGap={2} flexWrap="wrap">
				{DEPLOY_STATES.slice(0, 4).map((deploy) => (
					<Flex
						key={deploy.state}
						alignItems="center"
						gap={2}
						bg="var(--tt-surface-alt, #f5f5f7)"
						borderRadius="var(--tt-radius-pill, 999px)"
						px={2.5}
						py={1}
					>
						<Box width="7px" height="7px" borderRadius="full" bg={deploy.color} flexShrink={0} />
						<Text
							color="var(--tt-muted, #9a9aa6)"
							fontFamily={MONO}
							fontSize="10px"
							fontWeight={600}
							letterSpacing="0.12em"
							textTransform="uppercase"
						>
							{deploy.state}
						</Text>
					</Flex>
				))}
			</Flex>
		</Box>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			The label carries the meaning; the dot colour only echoes it — the same lockup reads correctly in
			greyscale.
		</Text>
	</Flex>
);

export const chipsAndBadgesStories: DesignSystemStory[] = [
	{
		id: 'chip-tone-matrix',
		title: 'Chip tones',
		description:
			'The house chip: an inline pill (--tt-radius-pill) with mono 10px 600 uppercase text, filled with a token tint and coloured with the matching signal token. Six tones cover the product’s whole status vocabulary — neutral, positive, danger, accent, link/info, warning — plus the dot variant that keeps a neutral chip and moves the signal into a 6px square dot.',
		render: ChipToneMatrixStory,
		note: 'Recipe sources: routes/tests.tsx CHIP_TONES, components/Admin/AdminDashboard.tsx CHIP_TONE_STYLES, components/Admin/TierManager.tsx CHIP_STYLES — same chassis, module-local today.'
	},
	{
		id: 'status-dot-language',
		title: 'Status dot language',
		description:
			'The dot + mono uppercase label lockup in its three shipped forms: the square 7px dot of the admin dashboards (StatusDot), the round 10px dot of the status page and /vercel deployment rows, and the dot-in-pill state badge from /vercel. One state → token map drives them all: ready/pass → positive, building → warning, queued → border, error/blocked → danger, canceled → muted, unknown → faint.',
		render: StatusDotStory,
		note: 'The colours come straight from the statusDot() map in routes/vercel.tsx and the AdminDashboard StatusDot — never from Chakra colorScheme greens/reds.'
	}
];
