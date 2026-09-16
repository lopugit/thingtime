import React from 'react';
import { Box } from '@chakra-ui/react';
import type { AiBackgroundTask } from '~/api/utils/lopu/backgroundTaskCore';
import { getAiTasks, getServerAiTasks, subscribeAiTasks } from './aiTasks.client';

export const useAiBackgroundTasks = () => React.useSyncExternalStore(subscribeAiTasks, getAiTasks, getServerAiTasks);
// Fixed phase arcs, with no animation and no invented completion percentage.
export const LopuTaskRing = ({ task, size = 18 }: { task: Pick<AiBackgroundTask, 'status' | 'stage'>; size?: number }) => {
	const arc =
		task.status !== 'running' ? 100 : task.stage === 'Starting' ? 20 : task.stage === 'Thinking' ? 40 : task.stage === 'Using tools' ? 60 : 75;
	return (
		<Box
			as="span"
			display="inline-flex"
			flexShrink={0}
			role="status"
			aria-label={task.status === 'running' ? `Running in background: ${task.stage}` : task.stage}
			title={task.stage}
		>
			<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'none', transform: 'none' }}>
				<circle cx="12" cy="12" r="9" fill="none" stroke="var(--tt-border, #e4e4e7)" strokeWidth="2.5" />
				<circle
					cx="12"
					cy="12"
					r="9"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					pathLength="100"
					strokeDasharray={`${arc} 100`}
					strokeLinecap="round"
					transform="rotate(-90 12 12)"
				/>
			</svg>
		</Box>
	);
};
export const LopuChatTaskRing = ({ chatId }: { chatId: string }) => {
	const task = useAiBackgroundTasks().find((task) => task.chatId === chatId && task.status === 'running');
	return task ? <LopuTaskRing task={task} /> : null;
};
