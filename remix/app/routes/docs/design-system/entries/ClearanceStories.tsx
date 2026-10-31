import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { PAGE_TOP_CLEARANCE } from '~/components/Layout/PageShell';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Clearance + safe area practice. The diagram is built
// from the REAL tokens: the nav band is exactly var(--tt-nav-clearance) tall,
// the content pad is the imported PAGE_TOP_CLEARANCE constant, and the notch
// toggle works by overriding --thingtime-safe-area-top inside the frame — so
// the calc() you see responding is the shipped calc, not an illustration.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const RailLabel = (props: { children: React.ReactNode }) => (
	<Text fontFamily={MONO} fontSize="9.5px" fontWeight={600} letterSpacing="0.06em" color="var(--tt-muted, #9a9aa6)" whiteSpace="nowrap">
		{props.children}
	</Text>
);

const ClearanceDiagramStory = () => {
	const [notch, setNotch] = React.useState(true);

	return (
		<Box>
			<Flex as="label" alignItems="center" columnGap="8px" cursor="pointer" marginBottom={3} minHeight="44px" width="fit-content">
				<input type="checkbox" checked={notch} onChange={(event) => setNotch(event.target.checked)} />
				<Text fontSize="12px" color="var(--tt-text, #5a5a66)">
					simulate an iOS notch (sets --thingtime-safe-area-top to 34px inside the frame)
				</Text>
			</Flex>
			<Box
				position="relative"
				height="320px"
				overflow="hidden"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				background="var(--tt-surface, #fafafb)"
				sx={{ '--thingtime-safe-area-top': notch ? '34px' : '0px' }}
			>
				{/* the safe-area band — env(safe-area-inset-top) on device */}
				<Flex
					position="absolute"
					top={0}
					left={0}
					right={0}
					height="var(--thingtime-safe-area-top, 0px)"
					alignItems="center"
					justifyContent="center"
					background="repeating-linear-gradient(45deg, var(--tt-surface-alt, #f5f5f7), var(--tt-surface-alt, #f5f5f7) 6px, var(--tt-card, #ffffff) 6px, var(--tt-card, #ffffff) 12px)"
					borderBottom="1px dashed var(--tt-border, #ececef)"
					overflow="hidden"
					transition="height 0.2s ease"
					zIndex={2}
				>
					<RailLabel>--thingtime-safe-area-top = env(safe-area-inset-top, 0px)</RailLabel>
				</Flex>
				{/* the fixed nav — exactly var(--tt-nav-clearance) tall */}
				<Flex
					position="absolute"
					top="var(--thingtime-safe-area-top, 0px)"
					left={0}
					right={0}
					height="var(--tt-nav-clearance, 54px)"
					alignItems="center"
					justifyContent="space-between"
					paddingX={4}
					background="rgba(255, 255, 255, 0.78)"
					backdropFilter="blur(14px)"
					borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
					transition="top 0.2s ease"
					zIndex={2}
				>
					<RailLabel>fixed nav</RailLabel>
					<RailLabel>height = var(--tt-nav-clearance, 54px)</RailLabel>
				</Flex>
				{/* the page — padded by the ONE blessed constant */}
				<Box position="absolute" inset={0} overflow="auto">
					<Box paddingTop={PAGE_TOP_CLEARANCE} paddingX={4} transition="padding-top 0.2s ease">
						<Box
							borderTop="2px solid var(--tt-accent, hotpink)"
							paddingTop="8px"
						>
							<Text fontFamily={MONO} fontSize="10px" fontWeight={600} color="var(--tt-accent, hotpink)">
								← content starts here: paddingTop = PAGE_TOP_CLEARANCE
							</Text>
							<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop="4px">
								= calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px)) = {notch ? '34 + 54 = 88px' : '0 + 54 = 54px'}
							</Text>
							<Text fontSize="13px" lineHeight="1.6" color="var(--tt-text, #5a5a66)" marginTop={3} maxWidth="520px">
								Toggle the notch and watch the shipped calc respond — the nav slides down by the inset and the content
								follows, because both read the same two variables. No page ever re-derives this.
							</Text>
						</Box>
					</Box>
				</Box>
			</Box>
		</Box>
	);
};

const MiniPage = (props: { fullBleed?: boolean }) => (
	<Box
		position="relative"
		height="230px"
		overflow="hidden"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-md, 12px)"
		background="var(--tt-surface, #fafafb)"
	>
		<Flex
			position="absolute"
			top={0}
			left={0}
			right={0}
			height="26px"
			alignItems="center"
			paddingX={3}
			background="rgba(255, 255, 255, 0.85)"
			borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
			zIndex={2}
		>
			<RailLabel>nav</RailLabel>
		</Flex>
		{props.fullBleed ? (
			<Flex position="absolute" top="26px" bottom={0} left={0} right={0} flexDirection="column">
				<Box flex="1" overflow="auto" paddingX={3} paddingY={2}>
					{['hey! 🌻', 'the chat pane owns its own scroll', 'the page under it never moves'].map((line, index) => (
						<Flex key={line} justifyContent={index % 2 ? 'flex-start' : 'flex-end'} marginTop={2}>
							<Box
								paddingX="10px"
								paddingY="5px"
								borderRadius="var(--tt-radius-md, 12px)"
								background={index % 2 ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-accent-tint, #ffe3f1)'}
								fontSize="11.5px"
								color="var(--tt-ink, #16161a)"
								maxWidth="80%"
							>
								{line}
							</Box>
						</Flex>
					))}
				</Box>
				<Flex paddingX={3} paddingY={2} borderTop="1px solid var(--tt-border-light, #f0f0f2)" background="var(--tt-card, #ffffff)">
					<Text fontFamily={MONO} fontSize="10px" color="var(--tt-faint, #b6b6c0)">
						message… (composer pinned — no footer, no tail spacer)
					</Text>
				</Flex>
			</Flex>
		) : (
			<Box position="absolute" top="26px" bottom={0} left={0} right={0} overflow="auto">
				<Box paddingX={3} paddingY={3}>
					{[1, 2, 3].map((card) => (
						<Box
							key={card}
							height="44px"
							marginBottom={2}
							background="var(--tt-card, #ffffff)"
							border="1px solid var(--tt-border, #ececef)"
							borderRadius="var(--tt-radius-sm, 9px)"
						/>
					))}
					<Flex height="52px" alignItems="center" justifyContent="center" borderTop="1px solid var(--tt-border-light, #f0f0f2)">
						<RailLabel>footer + tail spacer scroll in at the end</RailLabel>
					</Flex>
				</Box>
			</Box>
		)}
	</Box>
);

const FullBleedStory = () => (
	<Box>
		<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} columnGap={6} rowGap={5}>
			<Box>
				<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom="8px">
					Normal page — document flow
				</Text>
				<MiniPage />
			</Box>
			<Box>
				<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom="8px">
					Full bleed — /messages owns the viewport
				</Text>
				<MiniPage fullBleed />
			</Box>
		</Grid>
		<Text fontFamily={MONO} fontSize="10px" color="var(--tt-muted, #9a9aa6)" marginTop={3}>
			FULL_BLEED_PATHS = [&apos;/messages&apos;] (Layout/Main.tsx) — fixed-height panes with internal scroll drop the footer;
			a chat that scrolls the page under its composer is unusable
		</Text>
	</Box>
);

// Main.tsx sets `'*': { whiteSpace: 'pre-wrap' }` on the app root so thing
// values keep their line breaks. The same wrapper is reproduced here so both
// cards live under real pre-wrap inheritance — the right card opts back out
// the way PageShell does (whiteSpace normal on the column).
const JSX_SNIPPET = `<Flex sx={{ '*': { whiteSpace: 'pre-wrap' } }}
	className="mainFlexRoot">
	{children}
</Flex>`;

const PreWrapGotchaStory = () => (
	<Box sx={{ '*': { whiteSpace: 'pre-wrap' } }}>
		<Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} columnGap={6} rowGap={5}>
			<Box>
				<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-danger, #e5484d)" marginBottom="8px" whiteSpace="normal">
					Inherited pre-wrap — source formatting leaks in
				</Text>
				<Box background="var(--tt-card, #ffffff)" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" padding={4}>
					<Text fontSize="12.5px" lineHeight="1.6" color="var(--tt-text, #5a5a66)">{JSX_SNIPPET}</Text>
				</Box>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="6px" whiteSpace="normal">
					This card renders under Main’s real rule: every newline and tab in the JSX source becomes visible layout.
					Innocent template strings turn into staircases.
				</Text>
			</Box>
			<Box>
				<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-positive, #2f9e63)" marginBottom="8px" whiteSpace="normal">
					PageShell’s reset — whiteSpace normal on the column
				</Text>
				<Box background="var(--tt-card, #ffffff)" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 12px)" padding={4} sx={{ '&, & *': { whiteSpace: 'normal' } }}>
					<Text fontSize="12.5px" lineHeight="1.6" color="var(--tt-text, #5a5a66)">{JSX_SNIPPET}</Text>
				</Box>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" marginTop="6px" whiteSpace="normal">
					The same string under the scaffold’s reset: whitespace collapses back to normal prose. Pages that want
					pre-wrap for ACTUAL preformatted content opt in locally.
				</Text>
			</Box>
		</Grid>
	</Box>
);

export const clearanceStories: DesignSystemStory[] = [
	{
		id: 'clearance-diagram',
		title: 'The clearance calc, annotated live',
		description:
			'The whole practice in one frame: the striped band is --thingtime-safe-area-top (env(safe-area-inset-top) on device, simulated here), the glass band is the fixed nav at exactly var(--tt-nav-clearance, 54px), and the content’s paddingTop is the imported PAGE_TOP_CLEARANCE constant — the sum of the two. Toggle the notch: everything moves together because everything reads the same variables.',
		render: ClearanceDiagramStory,
		note: 'PAGE_TOP_CLEARANCE is imported from ~/components/Layout/PageShell in this story — the diagram cannot drift from the shipped constant.'
	},
	{
		id: 'full-bleed',
		title: 'Full-bleed surfaces (the FULL_BLEED_PATHS list)',
		description:
			'Two kinds of page: normal pages are document flow — content, then the footer and its tail spacer scroll in at the end. Full-bleed surfaces (currently just /messages) own the whole viewport as a fixed-height pane with internal scroll, so Main drops the footer entirely. Adding a path to FULL_BLEED_PATHS is the only sanctioned way to get this behaviour.',
		render: FullBleedStory
	},
	{
		id: 'pre-wrap-gotcha',
		title: 'Main’s pre-wrap reset gotcha',
		description:
			'Main.tsx applies whiteSpace: pre-wrap to EVERY descendant (`\'*\'` in its sx) so thing values keep their authored line breaks. Both cards below sit inside a reproduction of that rule: the left one inherits it and renders source whitespace literally; the right one applies the PageShell reset (whiteSpace normal). Any bespoke surface that skips PageShell inherits the left card’s behaviour silently.',
		render: PreWrapGotchaStory,
		note: 'This is why PageShell sets whiteSpace="normal" on its column — and why mystery line breaks on a hand-rolled page are almost always this rule, not your markup.'
	}
];
