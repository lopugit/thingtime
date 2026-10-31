import React from 'react';
import { Box, Center } from '@chakra-ui/react';
import { LopuTaskRing, useAiBackgroundTasks } from './LopuTaskRing';

import { getLopuStoreServerSnapshot, getLopuStoreSnapshot, selectLopuStreaming, subscribeLopuStore } from './lopuChatStore';
import { LOPU_UI, lopuRainbowRing } from './lopuTheme';
import { isLopuTurnActive } from './lopuTurnCore';

// 🦄 Lopu's identity chrome, shared by every surface so the launcher, the
// navbar opener, the window header and the page title read as ONE object:
//
// - `LopuRingAvatar` — the 🦄 on Lopu's single restrained rainbow ring.
// - `LopuActivityBadge` — a static stage ring shown wherever Lopu is mentioned
//   (the drawer's "Lopu" row, the launcher, the nav button, the window
//   header) while one of its turns is still streaming. Reads the shared chat
//   store so the badge stays in sync whether the turn was started from the
//   floating window or the /lopu page. Renders nothing while it is idle, so
//   callers can drop it in unconditionally.

const readStreaming = (): boolean => isLopuTurnActive(selectLopuStreaming(getLopuStoreSnapshot()));
const readServerStreaming = (): boolean => isLopuTurnActive(selectLopuStreaming(getLopuStoreServerSnapshot()));

// true while the shared store has a turn mid-stream (any surface)
export const useLopuStreamingActivity = (): boolean => {
	const local = React.useSyncExternalStore(subscribeLopuStore, readStreaming, readServerStreaming);
    const tasks = useAiBackgroundTasks();
    return local || tasks.some(task => task.status === 'running');
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
	const task = useAiBackgroundTasks().find(task => task.status === 'running');
	const size = props.size ?? 14;

	if (!streaming) {
		return null;
	}

	const positioning =
		props.placement === 'corner'
			? ({ position: 'absolute', display: 'block', top: '-1px', right: '-1px' } as const)
			: ({ position: 'relative', display: 'inline-block', marginLeft: '6px', verticalAlign: 'middle' } as const);

	return <Box as="span" className="lopuActivityBadge" {...positioning} color={LOPU_UI.ink}><LopuTaskRing task={task || { status: 'running', stage: 'Thinking' }} size={size} /></Box>;
};
