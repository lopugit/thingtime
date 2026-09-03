import React from 'react';
import { Box, Center } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import { getLopuStoreServerSnapshot, getLopuStoreSnapshot, selectLopuStreaming, subscribeLopuStore } from './lopuChatStore';
import { LOPU_UI, lopuRainbowRing } from './lopuTheme';
import { isLopuTurnActive } from './lopuTurnCore';

// 🦄 Lopu's identity chrome, shared by every surface so the launcher, the
// navbar opener, the window header and the page title read as ONE object:
//
// - `LopuRingAvatar` — the 🦄 on Lopu's single restrained rainbow ring.
// - `LopuActivityBadge` — a tiny pulsing dot shown wherever Lopu is mentioned
//   (the drawer's "Lopu" row, the launcher, the nav button, the window
//   header) while one of her turns is still streaming. Reads the shared chat
//   store so the badge stays in sync whether the turn was started from the
//   floating window or the /lopu page. Renders nothing while she is idle, so
//   callers can drop it in unconditionally.

const pulse = keyframes`
	0% { transform: scale(0.85); opacity: 0.55; }
	50% { transform: scale(1.15); opacity: 1; }
	100% { transform: scale(0.85); opacity: 0.55; }
`;

const readStreaming = (): boolean => isLopuTurnActive(selectLopuStreaming(getLopuStoreSnapshot()));
const readServerStreaming = (): boolean => isLopuTurnActive(selectLopuStreaming(getLopuStoreServerSnapshot()));

// true while the shared store has a turn mid-stream (any surface)
export const useLopuStreamingActivity = (): boolean => {
	return React.useSyncExternalStore(subscribeLopuStore, readStreaming, readServerStreaming);
};

// The 🦄 on a rainbow ring. `size` is the outer diameter (ring included);
// the inner disc is the card surface so it sits calmly on light and dark.
export const LopuRingAvatar = (props: { size?: number; ring?: number; className?: string; title?: string }) => {
	const size = props.size ?? 28;
	const ring = props.ring ?? 2;
	const inner = size - ring * 2;
	return (
		<Box as="span" className={props.className ?? 'lopuRingAvatar'} aria-hidden={props.title ? undefined : true} title={props.title} sx={lopuRainbowRing(size, ring)}>
			<Center as="span" width={`${inner}px`} height={`${inner}px`} borderRadius="999px" background={LOPU_UI.card} fontSize={`${Math.round(inner * 0.58)}px`} lineHeight={1}>
				🦄
			</Center>
		</Box>
	);
};

export const LopuActivityBadge = (props: {
	// 'inline' sits in a text row (default); 'corner' pins to the top-right of a
	// relatively-positioned parent (the launcher bubble, the nav button)
	placement?: 'inline' | 'corner';
	size?: number;
	label?: string;
}) => {
	const streaming = useLopuStreamingActivity();
	const size = props.size ?? 8;

	if (!streaming) {
		return null;
	}

	const positioning =
		props.placement === 'corner'
			? ({ position: 'absolute', display: 'block', top: '-1px', right: '-1px' } as const)
			: ({ position: 'relative', display: 'inline-block', marginLeft: '6px', verticalAlign: 'middle' } as const);

	// a <span>: the inline placement sits inside the drawer row's <p> (a <div>
	// there is invalid HTML and a hydration warning)
	return (
		<Box
			as="span"
			className="lopuActivityBadge"
			role="status"
			aria-label={props.label ?? 'Lopu is replying'}
			title={props.label ?? 'Lopu is replying…'}
			{...positioning}
			width={`${size}px`}
			height={`${size}px`}
			flexShrink={0}
			borderRadius="999px"
			background={LOPU_UI.rainbow}
			boxShadow={`0 0 0 2px ${LOPU_UI.card}`}
			sx={{
				animation: `${pulse} 1.4s ease-in-out infinite`,
				'@media (prefers-reduced-motion: reduce)': { animation: 'none' }
			}}
		/>
	);
};
