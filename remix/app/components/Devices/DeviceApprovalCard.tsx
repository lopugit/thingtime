import React, { memo } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { ShieldCheck } from 'lucide-react';

import type { DeviceApproval } from './deviceTypes';
import { DeviceStatusPill } from './DeviceCard';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton } from './DeviceStateGrid';

const approvalTone = (status: DeviceApproval['status']): 'positive' | 'warning' | 'negative' | 'neutral' => {
	if (status === 'approved') return 'positive';
	if (status === 'pending') return 'warning';
	if (status === 'denied') return 'negative';
	return 'neutral';
};

const scopeLabel = (scope: string): string => {
	if (scope === 'once') return 'Approve once';
	if (scope === 'chat') return 'For this chat';
	if (scope === 'while-unlocked') return 'While unlocked';
	return `Approve · ${scope}`;
};

const expiryLabel = (expiresAt: string | null, now: number): string | null => {
	if (!expiresAt) return null;
	const expires = new Date(expiresAt).getTime();
	if (!Number.isFinite(expires)) return null;
	const remaining = expires - now;
	if (remaining <= 0) return 'Expired';
	if (remaining < 60_000) return `Expires in ${Math.max(1, Math.ceil(remaining / 1_000))}s`;
	return `Expires in ${Math.ceil(remaining / 60_000)}m`;
};

export type DeviceApprovalCardProps = {
	approval: DeviceApproval;
	now?: number;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceApprovalCard = memo(({ approval, now = Date.now(), controlFor, onAction }: DeviceApprovalCardProps) => {
	const expiry = expiryLabel(approval.expiresAt, now);
	const scopes = approval.scopes?.length ? approval.scopes.slice(0, 3) : ['once'];
	const firstApprovalControl = controlFor?.('respond-approval', `${approval.id}:approved:${scopes[0]}`);
	const denyControl = controlFor?.('respond-approval', `${approval.id}:denied`);
	const blockedMessage =
		(!firstApprovalControl?.policy.allowed && firstApprovalControl?.policy.message) ||
		(!denyControl?.policy.allowed && denyControl?.policy.message) ||
		null;

	return (
		<Box
			background={approval.status === 'pending' ? 'rgba(217, 119, 6, 0.055)' : 'var(--tt-card, #ffffff)'}
			border="1px solid"
			borderColor={approval.status === 'pending' ? 'rgba(217, 119, 6, 0.35)' : 'var(--tt-border, #ececef)'}
			borderRadius="var(--tt-radius-md, 12px)"
			padding={3}
		>
			<Flex alignItems="flex-start" gap={2.5}>
				<Flex
					alignItems="center"
					background="var(--tt-surface-alt, #f2f2f5)"
					borderRadius="9px"
					color="var(--tt-muted, #71717a)"
					flexShrink={0}
					height="32px"
					justifyContent="center"
					width="32px"
				>
					<ShieldCheck aria-hidden size={16} />
				</Flex>
				<Box flex="1" minWidth={0}>
					<Flex alignItems="center" gap={1.5} wrap="wrap">
						<Text fontSize="12px" fontWeight={700}>
							{approval.kind || 'Device approval'}
						</Text>
						<DeviceStatusPill label={approval.status} tone={approvalTone(approval.status)} />
						{approval.localOnly ? <DeviceStatusPill label="on-device" tone="neutral" /> : null}
					</Flex>
					<Text fontSize="12px" lineHeight="1.45" marginTop={1.5} whiteSpace="pre-wrap">
						{approval.prompt}
					</Text>
					{expiry ? (
						<Text color={expiry === 'Expired' ? 'var(--tt-danger, #dc2626)' : 'var(--tt-muted, #71717a)'} fontSize="10px" marginTop={1}>
							{expiry}
						</Text>
					) : null}
				</Box>
			</Flex>

			{approval.status === 'pending' ? (
				<Box marginTop={3}>
					<Flex gap={1.5} justifyContent="flex-end" wrap="wrap">
						<DevicePolicyButton
							action="respond-approval"
							color="var(--tt-danger, #dc2626)"
							controlFor={controlFor}
							controlKey={`${approval.id}:denied`}
							deviceId={approval.deviceId}
							input={{ requestId: approval.id, decision: 'denied' }}
							label="Deny"
							onAction={onAction}
							targetId={approval.id}
							variant="ghost"
						/>
						{scopes.map((scope) => (
							<DevicePolicyButton
								action="respond-approval"
								controlFor={controlFor}
								controlKey={`${approval.id}:approved:${scope}`}
								deviceId={approval.deviceId}
								input={{ requestId: approval.id, decision: 'approved', scope }}
								key={scope}
								label={scopeLabel(scope)}
								onAction={onAction}
								targetId={approval.id}
							/>
						))}
					</Flex>
					{blockedMessage ? (
						<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1.5} textAlign="right">
							{blockedMessage}
						</Text>
					) : null}
				</Box>
			) : null}
		</Box>
	);
});
DeviceApprovalCard.displayName = 'DeviceApprovalCard';
