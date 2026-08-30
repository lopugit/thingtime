import React from 'react';
import { Box, Button, Flex, Grid, Text } from '@chakra-ui/react';

import { RainbowButton } from '~/components/Settings/SettingsSection';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Buttons entry. The <Button/> instances here are the
// REAL themed Chakra Button — the provider's defaultProps (colorScheme ttInk,
// size sm, variant solid) apply exactly as they do in the app, so a theme
// change to Providers/Chakra/Components/Button.tsx shows up here immediately.
// RainbowButton is imported from the live settings surface. No fetches.

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

const VoiceRow = (props: { label: string; meta: string; children: React.ReactNode }) => (
	<Grid
		templateColumns={{ base: '1fr', md: '170px 1fr' }}
		columnGap={5}
		rowGap={2}
		alignItems="center"
		paddingY="12px"
		borderTop="1px solid var(--tt-border-light, #f0f0f2)"
		_first={{ borderTop: 'none', paddingTop: 0 }}
	>
		<Box>
			<Text fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)">
				{props.label}
			</Text>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				{props.meta}
			</Text>
		</Box>
		<Flex alignItems="center" columnGap={3} rowGap={3} flexWrap="wrap">
			{props.children}
		</Flex>
	</Grid>
);

// The accent conversion CTA exactly as ThingsPage's logged-out "Log in 🗝️"
// button styles it (components/Things/ThingsPage.tsx) — the recipe is three
// props over the themed chassis.
const AccentCta = (props: { size?: 'xs' | 'sm' | 'md'; isDisabled?: boolean; children: React.ReactNode }) => (
	<Button
		size={props.size || 'sm'}
		isDisabled={props.isDisabled}
		background="var(--tt-accent, hotpink)"
		color="var(--tt-accent-contrast, #ffffff)"
		_hover={{ opacity: 0.9 }}
	>
		{props.children}
	</Button>
);

const ButtonMatrixStory = () => (
	<Box>
		<VoiceRow label="Default (ink)" meta="colorScheme ttInk · solid · the app-wide default">
			<Button size="xs">Save</Button>
			<Button>Save changes</Button>
			<Button size="md">Save changes</Button>
		</VoiceRow>
		<VoiceRow label="Accent CTA" meta="bg --tt-accent · text --tt-accent-contrast">
			<AccentCta size="xs">Log in 🗝️</AccentCta>
			<AccentCta>Log in 🗝️</AccentCta>
			<AccentCta size="md">Create account</AccentCta>
		</VoiceRow>
		<VoiceRow label="Rainbow CTA" meta="RainbowButton · animated RAINBOW fill">
			<RainbowButton size="xs">Add a passkey</RainbowButton>
			<RainbowButton size="sm">Save profile</RainbowButton>
			<RainbowButton size="sm" minHeight="44px">
				Mint token 🪙
			</RainbowButton>
		</VoiceRow>
		<VoiceRow label="Outline" meta="variant outline · bordered secondary">
			<Button size="xs" variant="outline">
				Open 🎨
			</Button>
			<Button variant="outline">Run Auth</Button>
			<Button size="md" variant="outline">
				Preview
			</Button>
		</VoiceRow>
		<VoiceRow label="Ghost" meta="variant ghost · quiet tertiary / dismiss">
			<Button size="xs" variant="ghost">
				Clear selected
			</Button>
			<Button variant="ghost">Cancel</Button>
			<Button size="md" variant="ghost">
				Skip
			</Button>
		</VoiceRow>
		<VoiceRow label="Disabled" meta="isDisabled — any voice">
			<Button isDisabled>Save changes</Button>
			<AccentCta isDisabled>Log in 🗝️</AccentCta>
			<Button variant="outline" isDisabled>
				Preview
			</Button>
		</VoiceRow>
	</Box>
);

// Tokened tinted buttons — the TierManager POSITIVE/DANGER_BUTTON_STYLES
// recipes (components/Admin/TierManager.tsx): a soft tint fill with the
// matching signal colour as text, darkening slightly on hover/active.
const POSITIVE_BUTTON_STYLES = {
	bg: 'var(--tt-positive-soft, rgba(88, 202, 112, 0.14))',
	color: 'var(--tt-positive, #2f8f4f)',
	_hover: { bg: 'rgba(88, 202, 112, 0.22)' },
	_active: { bg: 'rgba(88, 202, 112, 0.3)' }
} as const;

const DANGER_BUTTON_STYLES = {
	bg: 'rgba(214, 69, 90, 0.12)',
	color: 'var(--tt-danger, #d6455a)',
	_hover: { bg: 'rgba(214, 69, 90, 0.18)' },
	_active: { bg: 'rgba(214, 69, 90, 0.24)' }
} as const;

const TintedButtonsStory = () => (
	<Flex flexDirection="column" rowGap={5}>
		<Box>
			<GroupLabel>Positive — approve / activate (tint fill, signal text)</GroupLabel>
			<Flex columnGap={3} rowGap={3} flexWrap="wrap">
				<Button size="xs" {...POSITIVE_BUTTON_STYLES}>
					Approve
				</Button>
				<Button size="sm" {...POSITIVE_BUTTON_STYLES}>
					Set active
				</Button>
			</Flex>
		</Box>
		<Box>
			<GroupLabel>Danger — destructive, and only ever the last resort in a row</GroupLabel>
			<Flex columnGap={3} rowGap={3} flexWrap="wrap" alignItems="center">
				<Button size="xs" variant="ghost">
					Cancel
				</Button>
				<Button size="xs" {...DANGER_BUTTON_STYLES}>
					Delete passkey
				</Button>
			</Flex>
		</Box>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			The tint pairs with wording and position — colour never carries the meaning alone. The danger tint is the
			rgba(214, 69, 90, 0.12) literal because no --tt-danger-soft token exists yet.
		</Text>
	</Flex>
);

// The busyId pattern from components/Settings/AlgorithmManager.tsx: one busy
// string keyed per action means only the clicked button spins, and its
// siblings stay inert (isDisabled) instead of half-active.
const LoadingStatesStory = () => {
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	const run = (id: string) => {
		if (timerRef.current) clearTimeout(timerRef.current);
		setBusyId(id);
		timerRef.current = setTimeout(() => setBusyId(null), 1400);
	};

	return (
		<Flex flexDirection="column" rowGap={5}>
			<Box>
				<GroupLabel>isLoading — spinner replaces the label, width preserved (click one)</GroupLabel>
				<Flex columnGap={3} rowGap={3} flexWrap="wrap">
					<Button size="sm" isLoading={busyId === 'save'} isDisabled={!!busyId && busyId !== 'save'} onClick={() => run('save')}>
						Save changes
					</Button>
					<RainbowButton
						size="sm"
						isLoading={busyId === 'mint'}
						isDisabled={!!busyId && busyId !== 'mint'}
						onClick={() => run('mint')}
					>
						Mint token 🪙
					</RainbowButton>
					<Button
						size="sm"
						variant="outline"
						isLoading={busyId === 'run'}
						isDisabled={!!busyId && busyId !== 'run'}
						onClick={() => run('run')}
					>
						Run Auth
					</Button>
				</Flex>
			</Box>
			<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
				{"busyId === 'save' · one busy key per surface, compared per action id (AlgorithmManager keys rows as"}
				{" 'id:active', 'id:delete', …), so a list of rows never spins in unison."}
			</Text>
		</Flex>
	);
};

export const buttonsStories: DesignSystemStory[] = [
	{
		id: 'button-matrix',
		title: 'The button voices',
		description:
			'Every button voice across sizes, rendered by the real themed Button. Default is the ttInk solid (ink fill, hover lightens to --tt-text, label in --tt-card so dark themes stay legible). Accent is the conversion CTA (--tt-accent + --tt-accent-contrast, hover opacity 0.9 — the ThingsPage Log in recipe). Rainbow is the settings commit CTA. Outline and ghost are the quiet secondary/tertiary tiers.',
		render: ButtonMatrixStory,
		note: 'No props needed for the default voice: <Button>Save</Button> IS the house button — colorScheme ttInk, size sm, variant solid come from the provider theme.'
	},
	{
		id: 'tinted-status-buttons',
		title: 'Tinted signal buttons',
		description:
			'Stateful admin actions use the tokened tint recipe instead of Chakra colorSchemes: a positive-soft or danger-tint fill with the matching signal colour as the label, darkening one step on hover/active. From TierManager’s POSITIVE_BUTTON_STYLES / DANGER_BUTTON_STYLES.',
		render: TintedButtonsStory,
		note: 'Danger buttons sit last in their row, after an escape hatch — the position is part of the pattern.'
	},
	{
		id: 'loading-states',
		title: 'Loading states',
		description:
			'Async actions ride Chakra isLoading — the spinner replaces the label without a width jump — scoped by the busyId pattern: one busy string per surface, compared per action id, so exactly the clicked button spins and its siblings disable.',
		render: LoadingStatesStory
	}
];
