import React from 'react';
import { Badge, Box, Button, Flex, Spinner } from '@chakra-ui/react';

import type { AgentSessionState } from './agentSessionCore';

export const AgentLiveActivity = ({
	state,
	connected,
	onApproval
}: {
	state: AgentSessionState;
	connected: boolean;
	onApproval: (approvalId: string, decision: 'approved' | 'denied') => Promise<void>;
}) => {
	const [deciding, setDeciding] = React.useState<string | null>(null);
	const pending = state.approvals.filter((approval) => approval.status === 'pending');
	const activeMessages = state.messages.filter((message) => message.delivery !== 'complete').slice(-4);
	const recentActivities = state.activities.slice(-4);
	if (!activeMessages.length && !recentActivities.length && !pending.length && !state.warning && state.status === 'idle') return null;

	const decide = async (approvalId: string, decision: 'approved' | 'denied') => {
		const key = `${approvalId}:${decision}`;
		setDeciding(key);
		try {
			await onApproval(approvalId, decision);
		} finally {
			setDeciding(null);
		}
	};

	return (
		<Box
			marginX={3}
			marginBottom={1}
			padding={3}
			border="1px solid var(--tt-border-light, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			background="var(--tt-surface-alt, #f7f7f9)"
			aria-live="polite"
		>
			<Flex align="center" gap={2} marginBottom={activeMessages.length || pending.length || state.warning ? 2 : 0}>
				{state.status === 'running' ? <Spinner size="xs" /> : null}
				<Box fontSize="12px" fontWeight={700}>
					Desktop agent
				</Box>
				<Badge borderRadius="full" colorScheme={connected ? 'green' : 'gray'}>
					{connected ? state.status : 'reconnecting'}
				</Badge>
			</Flex>
			{activeMessages.map((message) => (
				<Box key={message.id} fontSize="12px" marginTop={1} whiteSpace="pre-wrap" overflowWrap="anywhere">
					<Box as="span" fontWeight={700}>
						{message.role === 'assistant' ? 'Agent: ' : 'You: '}
					</Box>
					{message.text || (message.delivery === 'queued' ? 'Queued…' : 'Working…')}
					{message.delivery === 'streaming' ? ' ▍' : null}
				</Box>
			))}
			{recentActivities.map((activity) => (
				<Flex key={activity.id} align="center" gap={2} marginTop={1} fontSize="11px">
					<Badge borderRadius="full" colorScheme={activity.status === 'failed' ? 'red' : 'gray'}>
						{activity.status}
					</Badge>
					<Box minWidth={0} overflowWrap="anywhere">
						{activity.label}
					</Box>
				</Flex>
			))}
			{pending.map((approval) => (
				<Flex key={approval.id} align="center" gap={2} wrap="wrap" marginTop={2}>
					<Box flex={1} minWidth="180px" fontSize="12px" whiteSpace="normal">
						{approval.label}
					</Box>
					<Button
						size="xs"
						colorScheme="green"
						isLoading={deciding === `${approval.id}:approved`}
						isDisabled={deciding !== null}
						onClick={() => void decide(approval.id, 'approved')}
					>
						Approve
					</Button>
					<Button
						size="xs"
						variant="outline"
						isLoading={deciding === `${approval.id}:denied`}
						isDisabled={deciding !== null}
						onClick={() => void decide(approval.id, 'denied')}
					>
						Deny
					</Button>
				</Flex>
			))}
			{state.warning ? (
				<Box marginTop={2} fontSize="11px" color="orange.600" whiteSpace="normal">
					{state.warning}
				</Box>
			) : null}
		</Box>
	);
};
