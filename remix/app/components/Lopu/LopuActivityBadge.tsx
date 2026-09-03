import React from 'react';
import { Box } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import { RAINBOW } from '~/theme/rainbow';
import { getLopuStoreServerSnapshot, getLopuStoreSnapshot, selectLopuStreaming, subscribeLopuStore } from './lopuChatStore';
import { isLopuTurnActive } from './lopuTurnCore';

// A tiny pulsing rainbow dot shown wherever Lopu is mentioned (the drawer's
// "Lopu" row, the launcher bubble, the window header) while one of her turns
// is still streaming. Reads the shared chat store so the badge stays in sync
// whether the turn was started from the floating window or the /lopu page.
// Renders nothing while she is idle, so callers can drop it in unconditionally.

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

export const LopuActivityBadge = (props: {
	// 'inline' sits in a text row (default); 'corner' pins to the top-right of a
	// relatively-positioned parent (the launcher bubble)
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
			background={RAINBOW}
			backgroundSize="calc(100px + 200%)"
			boxShadow="0 0 0 2px var(--tt-card, #ffffff)"
			sx={{
				animation: `${pulse} 1.4s ease-in-out infinite, var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)`
			}}
		/>
	);
};
