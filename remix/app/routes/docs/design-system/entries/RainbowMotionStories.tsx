import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { burstAtEvent } from '~/components/Landing/confetti';
import { RAINBOW, RAINBOW_CONIC, RAINBOW_TEXT, RAINBOW_VARS } from '~/theme/rainbow';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Rainbow + motion entry. Every animation here rides
// var(--tt-rainbow-anim, …) or the shared tt-* keyframes from
// GlobalStyles.tsx, so the theme's motion switch (and reduced-motion themes)
// govern this page exactly like the product. No fetches.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

// The canonical pairing: seamless tile width + the motion-switch animation var.
const RAINBOW_ANIM = 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)';
const TILE = 'calc(100px + 200%)';

const Caption = (props: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="8px">
		{props.children}
	</Text>
);

// The ConfettiCanvas motionEnabled() recipe as a hook: prefers-reduced-motion
// OR the theme flag --tt-motion: 0 turns decorative loops off.
const useMotionOn = () => {
	const [on, setOn] = React.useState(true);

	React.useEffect(() => {
		try {
			const reduced = !!(
				window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
			);
			const flag = getComputedStyle(document.documentElement).getPropertyValue('--tt-motion').trim();
			setOn(!reduced && flag !== '0');
		} catch {
			// non-browser render — leave the default
		}
	}, []);

	return on;
};

const AnimatedHeadlineStory = () => (
	<Box>
		<Box
			as="h2"
			width="fit-content"
			fontFamily="var(--tt-font-heading, system-ui, sans-serif)"
			fontSize="clamp(26px, 5vw, 40px)"
			fontWeight={800}
			letterSpacing="-0.03em"
			background={RAINBOW_TEXT}
			backgroundSize={TILE}
			sx={{
				WebkitBackgroundClip: 'text',
				backgroundClip: 'text',
				WebkitTextFillColor: 'transparent',
				animation: RAINBOW_ANIM
			}}
		>
			Everything is a thing.
		</Box>
		<Caption>
			RAINBOW_TEXT · backgroundSize: calc(100px + 200%) · animation: var(--tt-rainbow-anim, moving-rainbow 5s linear
			infinite) — freezes to a static gradient when the theme motion switch is off
		</Caption>
	</Box>
);

const GradientTileStory = () => (
	<Flex flexDirection="column" rowGap={5} maxWidth="440px">
		<Box>
			<Box
				height="16px"
				borderRadius="var(--tt-radius-pill, 999px)"
				background={RAINBOW}
				backgroundSize={TILE}
				sx={{ animation: RAINBOW_ANIM }}
			/>
			<Caption>RAINBOW as a bar — progress, dividers, banner strips</Caption>
		</Box>
		<Box>
			<Box
				padding="2px"
				borderRadius="var(--tt-radius-md, 12px)"
				background={RAINBOW}
				backgroundSize={TILE}
				sx={{ animation: RAINBOW_ANIM }}
			>
				<Box
					background="var(--tt-card, #ffffff)"
					borderRadius="calc(var(--tt-radius-md, 12px) - 2px)"
					paddingX={4}
					paddingY={3}
				>
					<Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
						Rainbow-border card
					</Text>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
						a 2px gradient frame: RAINBOW behind padding, card surface inside
					</Text>
				</Box>
			</Box>
			<Caption>RAINBOW as a border — the UserCard / Lopu toast frame idiom</Caption>
		</Box>
		<Box>
			<Flex columnGap="8px">
				{RAINBOW_VARS.map((stop) => (
					<Box key={stop} width="14px" height="14px" borderRadius="50%" background={stop} />
				))}
			</Flex>
			<Caption>RAINBOW_VARS — the five stops as var() strings, for dots, depth guides, accents</Caption>
		</Box>
	</Flex>
);

const ConicRingStory = () => (
	<Flex alignItems="center" columnGap={6} rowGap={4} flexWrap="wrap">
		<Flex flexDirection="column" alignItems="center" rowGap="6px">
			<Box width="28px" height="28px" borderRadius="50%" background={RAINBOW_CONIC} />
			<Caption>filled — DevKit trigger</Caption>
		</Flex>
		<Flex flexDirection="column" alignItems="center" rowGap="6px">
			<Box padding="3px" borderRadius="50%" background={RAINBOW_CONIC}>
				<Box width="30px" height="30px" borderRadius="50%" background="var(--tt-card, #ffffff)" />
			</Box>
			<Caption>ring — conic behind padding</Caption>
		</Flex>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" maxWidth="260px">
			RAINBOW_CONIC is built from the five stop VARS (blue-first, wrapping back to blue), so custom themes re-tint the
			ring live. It does not pan — spin it with a transform if a spinner needs motion, gated on the switch.
		</Text>
	</Flex>
);

const KeyframeChip = (props: { label: string; children: React.ReactNode }) => (
	<Flex flexDirection="column" alignItems="center" rowGap="8px" minWidth="96px">
		<Flex
			height="56px"
			minWidth="96px"
			alignItems="center"
			justifyContent="center"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
		>
			{props.children}
		</Flex>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
			{props.label}
		</Text>
	</Flex>
);

const KeyframesStory = () => {
	const motionOn = useMotionOn();
	const [round, setRound] = React.useState(0);
	const [gallops, setGallops] = React.useState(0);

	return (
		<Box>
			<Flex columnGap={4} rowGap={4} flexWrap="wrap" alignItems="flex-start">
				<KeyframeChip label="tt-pop · enter">
					<Box key={`pop-${round}`} sx={{ animation: 'tt-pop 320ms ease both' }} fontSize="20px">
						🌱
					</Box>
				</KeyframeChip>
				<KeyframeChip label="tt-toast-in · toasts">
					<Box
						key={`toast-${round}`}
						sx={{ animation: 'tt-toast-in 300ms ease both' }}
						paddingX="10px"
						paddingY="4px"
						fontSize="11px"
						fontWeight={600}
						color="var(--tt-ink, #16161a)"
						background="var(--tt-surface-alt, #f5f5f7)"
						borderRadius="var(--tt-radius-sm, 9px)"
					>
						Saved ✨
					</Box>
				</KeyframeChip>
				<KeyframeChip label="tt-blink · carets">
					<Text fontFamily={MONO} fontSize="14px" color="var(--tt-ink, #16161a)">
						typing
						<Box as="span" sx={{ animation: motionOn ? 'tt-blink 1s steps(1) infinite' : undefined }}>
							▍
						</Box>
					</Text>
				</KeyframeChip>
				<KeyframeChip label="tt-bob · floaters">
					<Box fontSize="20px" sx={{ animation: motionOn ? 'tt-bob 2.4s ease-in-out infinite' : undefined }}>
						🎈
					</Box>
				</KeyframeChip>
				<KeyframeChip label="tt-pan · shimmer text">
					<Text
						fontSize="13px"
						fontWeight={800}
						background={RAINBOW_TEXT}
						backgroundSize="200% auto"
						sx={{
							WebkitBackgroundClip: 'text',
							backgroundClip: 'text',
							WebkitTextFillColor: 'transparent',
							animation: motionOn ? 'tt-pan 3s linear infinite' : undefined
						}}
					>
						shimmer
					</Text>
				</KeyframeChip>
				<KeyframeChip label="tt-gallop · 🥚 click me">
					<Box
						as="button"
						key={`gallop-${gallops}`}
						onClick={() => setGallops((count) => count + 1)}
						cursor="pointer"
						fontSize="20px"
						sx={{ animation: gallops ? 'tt-gallop 900ms ease-in-out' : undefined }}
					>
						🦄
					</Box>
				</KeyframeChip>
			</Flex>
			<Flex marginTop={4} alignItems="center" columnGap={3}>
				<Box
					as="button"
					onClick={() => setRound((value) => value + 1)}
					paddingX="12px"
					paddingY="6px"
					fontSize="12px"
					fontWeight={600}
					color="var(--tt-ink, #16161a)"
					background="var(--tt-surface-alt, #f5f5f7)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-sm, 9px)"
					cursor="pointer"
				>
					Replay enters
				</Box>
				<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)">
					looping chips are gated on the motion switch; enter animations always play (they are feedback, not
					decoration)
				</Text>
			</Flex>
		</Box>
	);
};

const MotionSwitchStory = () => {
	const [values, setValues] = React.useState<{ motion: string; anim: string } | null>(null);

	React.useEffect(() => {
		try {
			const styles = getComputedStyle(document.documentElement);
			setValues({
				motion: styles.getPropertyValue('--tt-motion').trim() || '(unset)',
				anim: styles.getPropertyValue('--tt-rainbow-anim').trim() || '(unset)'
			});
		} catch {
			// non-browser render
		}
	}, []);

	return (
		<Flex flexDirection="column" rowGap={4} maxWidth="480px">
			<Box
				height="16px"
				borderRadius="var(--tt-radius-pill, 999px)"
				background={RAINBOW}
				backgroundSize={TILE}
				sx={{ animation: RAINBOW_ANIM }}
			/>
			<Grid templateColumns="auto 1fr" columnGap={4} rowGap={2} alignItems="baseline">
				<Text fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)">
					--tt-motion
				</Text>
				<Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
					{values ? values.motion : 'reading…'} — the 0/1 flag JS reads (ConfettiCanvas, gated effects)
				</Text>
				<Text fontFamily={MONO} fontSize="11px" fontWeight={600} color="var(--tt-ink, #16161a)">
					--tt-rainbow-anim
				</Text>
				<Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)" overflowWrap="anywhere">
					{values ? values.anim : 'reading…'} — the shorthand CSS rides; resolves to none when motion is off
				</Text>
			</Grid>
			<Caption>
				One theme boolean (general.motion) writes both vars in themeToCssVars() — flip motion in Settings →
				Appearance and this tile freezes while the values above change, no reload
			</Caption>
		</Flex>
	);
};

const ConfettiStory = () => (
	<Flex alignItems="center" columnGap={4} flexWrap="wrap" rowGap={3}>
		<Box
			as="button"
			onClick={(event: React.MouseEvent) => burstAtEvent(event, 90)}
			paddingX="18px"
			paddingY="10px"
			fontFamily="var(--tt-font-display, system-ui, sans-serif)"
			fontSize="14px"
			fontWeight={800}
			color="var(--tt-accent-contrast, #ffffff)"
			background="var(--tt-accent, hotpink)"
			border="var(--tt-border-w-chunky, 3px) solid var(--tt-ink, #16161a)"
			boxShadow="var(--tt-shadow-hard-sm, 5px 5px 0 #16161a)"
			cursor="pointer"
		>
			Celebrate 🎉
		</Box>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" maxWidth="300px">
			burstAtEvent(event, 90) → a &apos;tt:confetti&apos; CustomEvent → the app-root ConfettiCanvas. If motion is off or
			the OS prefers reduced motion, nothing fires — the gate lives in the canvas, not in every caller.
		</Text>
	</Flex>
);

export const rainbowMotionStories: DesignSystemStory[] = [
	{
		id: 'animated-headline',
		title: 'Animated headline',
		description:
			'The signature move: RAINBOW_TEXT (red-first, wrapping back to red) clipped into heading type via background-clip: text, panned by the moving-rainbow keyframes. The recipe is always the same three lines — backgroundSize: calc(100px + 200%) so the tile wraps seamlessly, and animation: var(--tt-rainbow-anim, …) so the theme motion switch stops it globally. Real text underneath: screen readers and find-in-page are unaffected.',
		render: AnimatedHeadlineStory,
		note: 'One animated headline per screen (the page-scaffold rule). Turn motion off in Settings → Appearance and this freezes into a static gradient.'
	},
	{
		id: 'gradient-tile',
		title: 'Gradient tiles + borders',
		description:
			'RAINBOW (blue-first) is the workhorse gradient for everything that is not headline text: bars, progress, and the border trick — paint the gradient on a wrapper, pad by the border width, and put the card surface inside. Blue-first vs red-first is not arbitrary: each gradient starts and ends on the same stop so the 90deg tile loops without a seam under animation.',
		render: GradientTileStory,
		note: 'Import RAINBOW / RAINBOW_TEXT / RAINBOW_VARS from ~/theme/rainbow — never re-type the hexes; custom themes re-tint everything through the vars.'
	},
	{
		id: 'conic-ring',
		title: 'Conic ring',
		description:
			'RAINBOW_CONIC sweeps the five stop vars in a circle — the DevKit trigger fill and any spinner ring. Filled circle or ring (conic behind padding), it re-themes live like the linear gradients. Conic gradients cannot background-position-pan, so a spinning ring animates transform: rotate instead — still gated on the motion switch.',
		render: ConicRingStory,
		note: 'Each of these three gradient stories freezes (or stops) under the theme motion toggle — that is the contract, not an accident.'
	},
	{
		id: 'tt-keyframes',
		title: 'The tt-* keyframe language',
		description:
			'GlobalStyles.tsx registers one shared keyframe vocabulary: moving-rainbow (gradient panning), tt-pop (content enter), tt-toast-in (toast drop-in), tt-blink (carets), tt-bob (floating accents), tt-pan (shimmer text), and tt-gallop (the nav unicorn’s 7-click victory lap). Surfaces reference them by name instead of registering private keyframes, so the motion language stays consistent — and one file says everything Thingtime knows how to do.',
		render: KeyframesStory,
		note: 'Feedback animations (tt-pop, tt-toast-in) always play; decorative loops (tt-bob, tt-blink, tt-pan, moving-rainbow) must ride --tt-rainbow-anim or check --tt-motion / prefers-reduced-motion, as this story does.'
	},
	{
		id: 'motion-switch',
		title: 'The motion switch',
		description:
			'One theme boolean, two outputs: themeToCssVars() writes --tt-rainbow-anim (the full animation shorthand, or none) for CSS, and --tt-motion (1/0) for JS. CSS rides the var; imperative effects call the ConfettiCanvas recipe — prefers-reduced-motion OR --tt-motion === "0" means stay still. This story reads the live values off <html>.',
		render: MotionSwitchStory,
		note: '--tt-anim-speed (default 200ms) is the third motion token — the base duration for UI transitions, separate from the decorative switch.'
	},
	{
		id: 'confetti-etiquette',
		title: 'Confetti etiquette',
		description:
			'Celebration is an event bus: burstConfetti(x, y, count) / burstAtEvent(event, count) dispatch a tt:confetti CustomEvent, and the single app-root ConfettiCanvas draws square confetti in the extended celebration palette (capped at 200 particles per burst). Callers never own a canvas, and the motion gate is centralised — a burst on a reduced-motion machine is simply a no-op.',
		render: ConfettiStory,
		note: 'Etiquette: user-initiated milestones only (waitlist joined, first post, a big save) — never on page load, never in loops, never for errors.'
	}
];
