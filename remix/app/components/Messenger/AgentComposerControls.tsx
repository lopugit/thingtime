import React from 'react';
import { Badge, Box, Button, Flex } from '@chakra-ui/react';

export type AgentSendMode = 'queue' | 'steer';

export type AgentComposerControlState = {
	running: boolean;
	mode: AgentSendMode;
	canQueue: boolean;
	canSteer: boolean;
	canInterrupt: boolean;
	queueDepth: number;
	interrupting?: boolean;
	onModeChange: (mode: AgentSendMode) => void;
	onInterrupt: () => void;
};

export const AgentComposerControls = ({ state }: { state: AgentComposerControlState }) => {
	if (!state.running) return null;
	return (
		<Flex align="center" justify="space-between" gap={2} wrap="wrap" paddingX={1} paddingBottom={2} fontSize="12px">
			<Flex
				role="group"
				aria-label="How to deliver this message"
				align="center"
				gap="2px"
				padding="2px"
				minWidth={0}
				background="var(--tt-surface-alt, #f2f2f5)"
				borderRadius="var(--tt-radius-pill, 999px)"
			>
				<Button
					size="xs"
					variant="ghost"
					isDisabled={!state.canQueue}
					aria-pressed={state.mode === 'queue'}
					background={state.mode === 'queue' ? 'var(--tt-card, #fff)' : 'transparent'}
					borderRadius="var(--tt-radius-pill, 999px)"
					onClick={() => state.onModeChange('queue')}
					title="Send after the active turn finishes"
				>
					Queue
				</Button>
				<Button
					size="xs"
					variant="ghost"
					isDisabled={!state.canSteer}
					aria-pressed={state.mode === 'steer'}
					background={state.mode === 'steer' ? 'var(--tt-card, #fff)' : 'transparent'}
					borderRadius="var(--tt-radius-pill, 999px)"
					onClick={() => state.onModeChange('steer')}
					title="Redirect the currently active turn"
				>
					Steer
				</Button>
				{state.queueDepth > 0 ? (
					<Badge marginX={1} borderRadius="full" colorScheme="purple">
						{state.queueDepth > 99 ? '99+' : state.queueDepth} queued
					</Badge>
				) : null}
			</Flex>
			<Button
				size="xs"
				variant="outline"
				colorScheme="red"
				isDisabled={!state.canInterrupt}
				isLoading={state.interrupting}
				onClick={state.onInterrupt}
				borderRadius="var(--tt-radius-pill, 999px)"
			>
				Stop turn
			</Button>
			{!state.canSteer && state.mode === 'steer' ? (
				<Box role="status" width="100%" color="var(--tt-muted, #777782)" whiteSpace="normal">
					This connector cannot steer the active turn. Queue the message instead.
				</Box>
			) : null}
		</Flex>
	);
};
