import React from 'react';
import { Box, Button, Flex, Grid, Switch, Text } from '@chakra-ui/react';

import { RainbowButton, SettingRow, SettingsSection } from '~/components/Settings/SettingsSection';
import { CARD_STYLES } from '~/theme/card';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Cards & sections entry. The card stories spread the
// REAL CARD_STYLES const and render the REAL SettingsSection/SettingRow
// components — nothing re-implemented — so a token or recipe change shows up
// here immediately. Row idioms (hairline label/value, readout table) are
// rebuilt faithfully because the live ones (PageScaffold's HairlineRow,
// statusSections' StatusRow) are module-private.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const Eyebrow = (props: { children: React.ReactNode }) => (
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

// The recipe card renders its own ingredient list straight off the imported
// const — if card.ts changes, this story re-documents itself.
const CardRecipeStory = () => (
	<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4} alignItems="start">
		<Box {...CARD_STYLES} padding={5}>
			<Eyebrow>a card_styles card</Eyebrow>
			<Text fontSize="sm" color="var(--tt-text, #5a5a66)" marginTop={2}>
				Spread the const — <Text as="span" fontFamily={MONO}>{'{...CARD_STYLES}'}</Text> — and the surface picks up
				the card background, hairline border, lg radius, and dialect-aware shadow in one move. Every content card on
				Schemas, Search, status, and the admin panels is this exact box.
			</Text>
		</Box>
		<Box {...CARD_STYLES} padding={5}>
			<Eyebrow>the recipe (read live from ~/theme/card)</Eyebrow>
			<Box marginTop={1}>
				{Object.entries(CARD_STYLES).map(([key, value], index) => (
					<Grid
						key={key}
						templateColumns="110px 1fr"
						columnGap={3}
						paddingY={2}
						borderTop={index === 0 ? 'none' : '1px solid'}
						borderColor="var(--tt-border-light, #f0f0f2)"
					>
						<Text fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)" alignSelf="center">
							{key}
						</Text>
						<Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)" overflowWrap="anywhere">
							{String(value)}
						</Text>
					</Grid>
				))}
			</Box>
		</Box>
	</Grid>
);

const SettingsSectionStory = () => (
	<Flex flexDirection="column" rowGap={4} maxWidth="560px">
		<SettingsSection
			eyebrow="Notifications"
			description="Choose how Thingtime reaches you. Rows are label + hint on the left, one control pinned right — separated by whitespace, not rules."
		>
			<SettingRow label="Push notifications" hint="Reactions, comments, and mentions">
				<Switch defaultChecked />
			</SettingRow>
			<SettingRow label="Email digests" hint="A weekly roundup of your things">
				<Switch />
			</SettingRow>
			<SettingRow label="Quiet hours" hint="Pause everything overnight">
				<Flex columnGap={1}>
					<Button size="xs" variant="solid">
						On
					</Button>
					<Button size="xs" variant="ghost">
						Off
					</Button>
				</Flex>
			</SettingRow>
			<Flex justifyContent="flex-end" paddingTop={1}>
				<RainbowButton size="sm">Save changes ✨</RainbowButton>
			</Flex>
		</SettingsSection>
	</Flex>
);

const HairlineRow = (props: { label: string; value: React.ReactNode; first?: boolean }) => (
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

const HairlineRowsStory = () => (
	<Box {...CARD_STYLES} padding={5} maxWidth="560px">
		<Eyebrow>thing details</Eyebrow>
		<Box marginTop={2}>
			<HairlineRow first label="name" value="Sunflower patch" />
			<HairlineRow label="kind" value="garden" />
			<HairlineRow label="visibility" value="private" />
			<HairlineRow
				label="link"
				value={
					<Text as="span" fontFamily={MONO} fontSize="13px" color="var(--tt-link, #319795)">
						thingtime.com/things/garden
					</Text>
				}
			/>
			<HairlineRow label="updated" value="2 minutes ago" />
		</Box>
	</Box>
);

const READOUT_ROWS: { label: string; value: string; tone: 'positive' | 'warning' | 'danger' | 'muted' }[] = [
	{ label: 'deployment', value: 'Ready', tone: 'positive' },
	{ label: 'branch', value: 'develop', tone: 'muted' },
	{ label: 'build', value: 'Building…', tone: 'warning' },
	{ label: 'mongo', value: 'Unreachable', tone: 'danger' }
];

const TONE_COLOR: Record<string, string> = {
	positive: 'var(--tt-positive, #2f8f4f)',
	warning: 'var(--tt-warning, #ffbc48)',
	danger: 'var(--tt-danger, #d6455a)',
	muted: 'var(--tt-muted, #9a9aa6)'
};

const ReadoutTableStory = () => (
	<Box {...CARD_STYLES} paddingX={5} paddingY={3} maxWidth="560px">
		{READOUT_ROWS.map((row, index) => (
			<Flex
				key={row.label}
				justify="space-between"
				alignItems="baseline"
				gap={4}
				paddingY={2.5}
				borderTop={index === 0 ? undefined : '1px solid var(--tt-border-light, #f0f0f2)'}
			>
				<Text
					fontFamily={MONO}
					fontSize="xs"
					fontWeight={600}
					letterSpacing="0.06em"
					textTransform="uppercase"
					color="var(--tt-muted, #9a9aa6)"
					flexShrink={0}
				>
					{row.label}
				</Text>
				<Flex alignItems="center" gap={2}>
					<Box width="8px" height="8px" borderRadius="full" background={TONE_COLOR[row.tone]} flexShrink={0} />
					<Text fontSize="sm" color="var(--tt-ink, #16161a)">
						{row.value}
					</Text>
				</Flex>
			</Flex>
		))}
	</Box>
);

export const cardsAndSectionsStories: DesignSystemStory[] = [
	{
		id: 'card-recipe',
		title: 'The CARD_STYLES recipe',
		description:
			'One const, spread everywhere: bg --tt-card, a 1px --tt-border, --tt-radius-lg corners, and the dialect-aware --tt-shadow-card. The right card lists the recipe read live off the imported const — change ~/theme/card and this story re-documents itself.',
		render: CardRecipeStory,
		note: 'Spread it ({...CARD_STYLES}) rather than copying values — the whole point is that a token change cannot leave sibling pages drifted.'
	},
	{
		id: 'settings-section',
		title: 'SettingsSection + SettingRow',
		description:
			'The real /settings building blocks: a flat card (card bg, border, lg radius — deliberately no shadow) with a mono uppercase eyebrow and optional description, then SettingRows — label + hint left, one control pinned right with marginLeft auto. RainbowButton is the section-level primary CTA idiom, animated only through var(--tt-rainbow-anim).',
		render: SettingsSectionStory,
		note: 'SettingRow mirrors the settingRow helper inside UserSettingsModal — same geometry (columnGap 4, paddingY 2), so the modal and the page read as one surface.'
	},
	{
		id: 'hairline-rows',
		title: 'Hairline label/value rows',
		description:
			'The quiet readout inside a card: a 120px mono label column against ink values, rows separated by 1px --tt-border-light borderTop with the FIRST row borderless — so the card border stays the strong line and the hairlines stay whispers. This is the PageScaffold/things-details idiom.',
		render: HairlineRowsStory
	},
	{
		id: 'readout-table',
		title: 'Readout table (status pattern)',
		description:
			'The status/vercel variant of hairline rows: space-between with baseline alignment instead of a fixed label column, mono uppercase labels at xs with 0.06em tracking, and values that lead with a status dot — --tt-positive / --tt-warning / --tt-danger / --tt-muted mapped from state, never colour alone (the word carries the meaning). Mirrors StatusRow in components/Status/statusSections.tsx.',
		render: ReadoutTableStory
	}
];
