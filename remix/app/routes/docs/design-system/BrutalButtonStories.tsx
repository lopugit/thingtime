import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { BrutalButton } from '~/components/Landing/BrutalButton';
import type { DesignSystemStory } from './ThingContextMenuStories';

// Live stories for the Brutal Button entry — the Fable-dialect CTA from the
// v2 landing page. Real component, real hover physics; the click log proves
// the button/anchor duality without navigating anywhere.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const Caption = (props: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="10px">
		{props.children}
	</Text>
);

const VariantsStory = () => {
	const [clicks, setClicks] = React.useState<string | null>(null);

	return (
		<Box>
			<Flex columnGap={7} rowGap={6} flexWrap="wrap" alignItems="center" padding="6px 10px 10px 2px">
				<Box>
					<BrutalButton variant="primary" onClick={() => setClicks('primary')}>
						Join the waitlist 🚀
					</BrutalButton>
					<Caption>primary · --tt-accent</Caption>
				</Box>
				<Box>
					<BrutalButton variant="secondary" onClick={() => setClicks('secondary')}>
						See the demo
					</BrutalButton>
					<Caption>secondary · --tt-card, tint hover</Caption>
				</Box>
				<Box>
					<BrutalButton variant="ink" onClick={() => setClicks('ink')}>
						Open the app
					</BrutalButton>
					<Caption>ink · --tt-ink</Caption>
				</Box>
				<Box>
					<BrutalButton variant="secondary" shadow={false} onClick={() => setClicks('shadow={false}')}>
						Quiet CTA
					</BrutalButton>
					<Caption>shadow={'{false}'} · border only, no lift</Caption>
				</Box>
			</Flex>
			<Text fontFamily={MONO} fontSize="11px" color={clicks ? 'var(--tt-ink, #16161a)' : 'var(--tt-faint, #b6b6c0)'}>
				onClick → {clicks || 'nothing clicked yet'}
			</Text>
		</Box>
	);
};

const HoverLiftStory = () => (
	<Flex columnGap={9} rowGap={6} flexWrap="wrap" alignItems="flex-start" padding="6px 12px 12px 2px">
		<Box>
			<BrutalButton variant="primary" onClick={() => {}}>
				Resting
			</BrutalButton>
			<Caption>rest · --tt-shadow-hard-sm (5px 5px 0)</Caption>
		</Box>
		<Box>
			<BrutalButton
				variant="primary"
				onClick={() => {}}
				chakras={{
					transform: 'translate(-2px, -2px)',
					boxShadow: 'var(--tt-shadow-hard-lg, 8px 8px 0 #1a1a1a)'
				}}
			>
				Lifted (frozen)
			</BrutalButton>
			<Caption>hover · translate(-2px, -2px) + --tt-shadow-hard-lg (8px 8px 0)</Caption>
		</Box>
		<Box maxWidth="300px">
			<BrutalButton variant="ink" onClick={() => {}}>
				Try me live
			</BrutalButton>
			<Caption>
				the button moves up-left exactly as far as the shadow grows, so the ink “ground” stays planted — that is the whole
				trick
			</Caption>
		</Box>
	</Flex>
);

const LinkStory = () => (
	<Flex columnGap={7} rowGap={6} flexWrap="wrap" alignItems="flex-start" padding="6px 10px 10px 2px">
		<Box>
			<BrutalButton variant="primary" href="#story-link-cta">
				Read the docs →
			</BrutalButton>
			<Caption>href → renders as &lt;a&gt;, same look, real link semantics</Caption>
		</Box>
		<Box>
			<BrutalButton variant="secondary" href="#story-link-cta" target="_blank" rel="noopener noreferrer">
				Get an API key ↗
			</BrutalButton>
			<Caption>target/rel pass straight through — set rel yourself for _blank</Caption>
		</Box>
	</Flex>
);

export const brutalButtonStories: DesignSystemStory[] = [
	{
		id: 'variants',
		title: 'Variants',
		description:
			'Three fills over the same chassis (chunky --tt-ink border + --tt-shadow-hard-sm): primary is the --tt-accent conversion CTA, secondary is the white companion (accent-tint on hover), ink is the maximum-contrast "Open the app" style. shadow={false} keeps the border but drops the offset shadow and the hover lift.',
		render: VariantsStory,
		note: 'All colours are tokens, so a theme with a different accent re-skins every CTA — hotpink is just the default.'
	},
	{
		id: 'hover-lift',
		title: 'Hover lift',
		description:
			'The signature move, shown frozen and live: at rest the button sits on a 5px hard shadow; on hover it translates (-2px, -2px) while the shadow grows to 8px — the shadow’s far edge never moves, so the button appears to lift OFF the page rather than drift across it. 120ms ease on transform, shadow, and background.',
		render: HoverLiftStory
	},
	{
		id: 'link-cta',
		title: 'Link CTA (anchor form)',
		description:
			'Pass href and the same component renders an <a> instead of a <button> — landing CTAs that navigate ("Read the docs", store links) keep real link semantics (open in new tab, copy link, middle-click) with zero visual difference.',
		render: LinkStory
	}
];
