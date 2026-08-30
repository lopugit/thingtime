import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { normalizeLopuMessage } from '~/components/Lopu/lopuMessage';
import { RAINBOW, RAINBOW_PALETTE } from '~/theme/rainbow';
import type { DesignSystemStory } from '../ThingContextMenuStories';

// Live stories for the Toasts (Lopu) entry. The static cards are a faithful
// replica of the module-private LopuToast (useLopu.tsx renders it through
// Chakra's toast manager, so it can't be imported directly) — same tokens,
// same geometry — kept static so the catalog never fires global toasts on
// mount. The last story wires the REAL useLopu() and fires on click.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const statusEmoji = (status?: 'success' | 'error' | 'info') =>
	status === 'success' ? '✨ ' : status === 'error' ? '🌧️ ' : '';

// Static countdown ring — the live one drains via a stroke-dashoffset
// animation over the toast's remaining lifetime (r=5 → circumference 31.42).
const StaticRing = () => (
	<Box position="absolute" bottom="6px" right="8px" pointerEvents="none">
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
			<defs>
				<linearGradient id="lopu-story-ring" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor={RAINBOW_PALETTE[3]} />
					<stop offset="25%" stopColor={RAINBOW_PALETTE[4]} />
					<stop offset="50%" stopColor={RAINBOW_PALETTE[0]} />
					<stop offset="75%" stopColor={RAINBOW_PALETTE[1]} />
					<stop offset="100%" stopColor={RAINBOW_PALETTE[2]} />
				</linearGradient>
			</defs>
			<circle cx="7" cy="7" r="5" fill="none" stroke="#edf2f7" strokeWidth="2" />
			<circle
				cx="7"
				cy="7"
				r="5"
				fill="none"
				stroke="url(#lopu-story-ring)"
				strokeWidth="2"
				strokeLinecap="round"
				strokeDasharray="31.42"
				strokeDashoffset="10"
				transform="rotate(-90 7 7)"
			/>
		</svg>
	</Box>
);

const LopuCard = (props: {
	title?: string;
	description?: string;
	status?: 'success' | 'error' | 'info';
	thinking?: boolean;
	streamingCaret?: boolean;
	ring?: boolean;
}) => (
	<Box
		p="2px"
		borderRadius="var(--tt-radius-xl, 20px)"
		background={RAINBOW}
		boxShadow="var(--tt-shadow-toast, 0 14px 38px rgba(20,20,40,0.18))"
		width="360px"
		maxWidth="100%"
	>
		<Box bg="var(--tt-card, #ffffff)" borderRadius="calc(var(--tt-radius-xl, 20px) - 2px)" px={4} py={3} position="relative">
			<Flex align="center" gap={2} mb={1.5}>
				<Text fontSize="md" lineHeight={1}>
					🦄
				</Text>
				<Text
					fontWeight="800"
					fontSize="sm"
					background={RAINBOW}
					sx={{ WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
				>
					Lopu
				</Text>
				<Text
					fontFamily={MONO}
					fontSize="10px"
					fontWeight="500"
					letterSpacing="0.1em"
					textTransform="uppercase"
					color="var(--tt-muted, #9a9aa6)"
				>
					Thingtime AI
				</Text>
				<Box flex={1} />
				<Box
					as="button"
					type="button"
					aria-label="Close"
					display="flex"
					alignItems="center"
					justifyContent="center"
					width="20px"
					height="20px"
					borderRadius="full"
					fontSize="xs"
					lineHeight={1}
					color="var(--tt-faint, #b6b6c0)"
					_hover={{ color: 'var(--tt-ink, #16161a)', bg: 'var(--tt-surface-alt, #f5f5f7)' }}
					transition="all 140ms ease"
				>
					✕
				</Box>
			</Flex>
			{props.thinking ? (
				<Text fontSize="sm" fontWeight="500" color="var(--tt-muted, #9a9aa6)" fontStyle="italic">
					Lopu is thinking
					<Box as="span" sx={{ animation: 'tt-blink 1s steps(1) infinite' }}>
						…
					</Box>
				</Text>
			) : (
				props.title && (
					<Text fontSize="sm" fontWeight="600" color="var(--tt-ink, #16161a)">
						{statusEmoji(props.status)}
						{props.title}
						{props.streamingCaret && (
							<Box as="span" ml="1px" color="var(--tt-faint, #b6b6c0)" sx={{ animation: 'tt-blink 1s steps(1) infinite' }}>
								▍
							</Box>
						)}
					</Text>
				)
			)}
			{props.description && (
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt="2px" whiteSpace="pre-wrap" overflowWrap="anywhere">
					{props.description}
				</Text>
			)}
			{props.ring && <StaticRing />}
		</Box>
	</Box>
);

const AnatomyStory = () => (
	<Flex flexDirection="column" rowGap={3} alignItems="flex-start">
		<LopuCard
			title="Theme saved ✨"
			description="Your custom theme is live on every device signed into this account."
			ring
		/>
		<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" fontFamily={MONO} maxWidth="480px">
			2px RAINBOW gradient frame (p=&quot;2px&quot; wrapper) · --tt-card inner at calc(--tt-radius-xl − 2px) ·
			--tt-shadow-toast · 360px wide, capped at calc(100vw − 24px) · countdown ring drains over the toast lifetime
		</Text>
	</Flex>
);

const TONES: { title: string; args: { title?: string; description?: string; status?: 'success' | 'error' | 'info' } }[] = [
	{ title: 'success — ✨ prefix', args: { title: 'Logged out — switched to @nf ✨', status: 'success' } },
	{
		title: 'error — 🌧️ prefix + explanation',
		args: { title: 'Could not load URL', description: 'Thingtime desktop rejected that URL.', status: 'error' }
	},
	{ title: 'info — no prefix', args: { title: 'Update available', description: 'Version 1.4.0 is ready to download.', status: 'info' } }
];

const TonesStory = () => (
	<Flex flexDirection="column" rowGap={4} alignItems="flex-start">
		{TONES.map((tone) => {
			const message = normalizeLopuMessage(tone.args);
			return (
				<Box key={tone.title}>
					<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
						{tone.title}
					</Text>
					<LopuCard title={message.title} description={message.description} status={tone.args.status} />
				</Box>
			);
		})}
		<Box>
			<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
				empty payload + status: &apos;error&apos; — normalizeLopuMessage fallback (live)
			</Text>
			<LopuCard title={normalizeLopuMessage({ status: 'error' }).title} status="error" />
		</Box>
	</Flex>
);

const StreamingStory = () => (
	<Flex flexDirection="column" rowGap={4} alignItems="flex-start">
		<Box>
			<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
				1 · pops instantly (duration: null while streaming)
			</Text>
			<LopuCard thinking />
		</Box>
		<Box>
			<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
				2 · deltas type in live, caret blinking
			</Text>
			<LopuCard title="A thing named is a thing half-organised — the rest is" description="from Lopu's little book 📖" streamingCaret />
		</Box>
		<Box>
			<Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
				3 · stream done — the 16s read-timer starts NOW, ring drains
			</Text>
			<LopuCard
				title="A thing named is a thing half-organised — the rest is just love."
				description="from Lopu's little book 📖"
				ring
			/>
		</Box>
	</Flex>
);

const LiveFireStory = () => {
	const lopu = useLopu();
	return (
		<Flex columnGap={2} rowGap={2} flexWrap="wrap">
			<Button
				size="sm"
				variant="outline"
				onClick={() => lopu({ title: 'Saved from the design system ✨', status: 'success', duration: 6000 })}
			>
				Fire success
			</Button>
			<Button
				size="sm"
				variant="outline"
				onClick={() =>
					lopu({
						title: 'Something needs attention',
						description: 'This one is the error tone — 🌧️ prefix, ink title, muted description.',
						status: 'error',
						duration: 8000
					})
				}
			>
				Fire error
			</Button>
			<Button size="sm" variant="outline" onClick={() => lopu({ status: 'info' })}>
				Fire empty payload
			</Button>
		</Flex>
	);
};

export const toastsStories: DesignSystemStory[] = [
	{
		id: 'lopu-anatomy',
		title: 'Anatomy of a Lopu toast',
		description:
			'A 2px animated RAINBOW gradient frame ("unicorn vomit border") around a clean --tt-card message card: the 🦄 + gradient-clipped "Lopu" wordmark + mono THINGTIME AI eyebrow header, a faint ✕ close, the ink title, muted description, and the rainbow countdown ring bottom-right that drains over the toast’s remaining lifetime. Toasts render at position top, pushed below the fixed nav by a translateY(70px) full-viewport flex container that centres by flow (immune to ancestor-transform quirks) and eats no clicks.',
		render: AnatomyStory,
		note: 'Static replica — LopuToast itself is module-private and renders through Chakra’s toast manager. The tokens and geometry here match useLopu.tsx line for line.'
	},
	{
		id: 'tones',
		title: 'Tones + the message normaliser',
		description:
			'status only prefixes the title: success ✨, error 🌧️, info nothing — colour never changes, so every tone stays readable on the same card. Every one-shot toast passes through normalizeLopuMessage(), which trims empty strings and guarantees a toast can never render as a bare glyph: an empty error payload becomes "Something went wrong. Please try again.", empty success "Done ✨", and nothing at all "Here when you need me 🦄". The last card calls the real normaliser live.',
		render: TonesStory
	},
	{
		id: 'streaming',
		title: 'useLopuStream — the typing toast',
		description:
			'The streaming variant pops instantly with an italic "Lopu is thinking…" (duration: null keeps it open), then NDJSON deltas from /api/v1/lopu/musing type into the title with a blinking ▍ caret, with the source credited in the description (via Claude 🤖 / via ChatGPT 🤖 / from Lopu’s little book 📖). When the stream finishes, the 16s read-timer and countdown ring start — from stream end, not toast open, so the whole musing gets its reading window. Closing mid-stream aborts the fetch.',
		render: StreamingStory,
		note: 'Static frames of the three phases — the live variant needs the musing endpoint. Errors fall back to "Lopu is daydreaming… try again 🔮".'
	},
	{
		id: 'live-fire',
		title: 'Fire a real toast',
		description:
			'These buttons call the real useLopu() from ~/components/Lopu/useLopu — the exact hook every product surface uses. Fire the empty payload to watch normalizeLopuMessage() fill in the friendly default. Toasts stack tight under the nav and each carries its own countdown ring.',
		render: LiveFireStory,
		note: 'Nothing fires on mount — the catalog never spawns global UI uninvited.'
	}
];
