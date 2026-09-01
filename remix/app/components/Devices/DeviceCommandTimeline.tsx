import React, { memo } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { CircleAlert, CircleCheck, Clock3, LoaderCircle, XCircle } from 'lucide-react';

import type { DeviceCommand, DeviceCommandStatus } from './deviceTypes';
import { DeviceStatusPill, formatDeviceLastSeen } from './DeviceCard';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton } from './DeviceStateGrid';

const commandTone = (status: DeviceCommandStatus): 'positive' | 'warning' | 'negative' | 'neutral' | 'accent' => {
	if (status === 'succeeded') return 'positive';
	if (status === 'failed' || status === 'cancelled' || status === 'expired') return 'negative';
	if (status === 'needs-approval' || status === 'needs-review') return 'warning';
	if (status === 'running' || status === 'streaming') return 'accent';
	return 'neutral';
};

const commandIcon = (status: DeviceCommandStatus) => {
	if (status === 'succeeded') return <CircleCheck aria-hidden size={15} />;
	if (status === 'failed' || status === 'cancelled' || status === 'expired') return <XCircle aria-hidden size={15} />;
	if (status === 'needs-approval' || status === 'needs-review') return <CircleAlert aria-hidden size={15} />;
	if (status === 'running' || status === 'streaming') return <LoaderCircle aria-hidden size={15} />;
	return <Clock3 aria-hidden size={15} />;
};

const humanAction = (command: DeviceCommand): string =>
	String(command.kind || command.action)
		.split('-')
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(' ');

const desiredLabel = (command: DeviceCommand): string | null => {
	const desired = command.desired;
	if (!desired) return null;
	const labels: string[] = [];
	if (typeof desired.volume === 'number') labels.push(`volume ${Math.round(desired.volume * 100)}%`);
	if (typeof desired.brightness === 'number') labels.push(`brightness ${Math.round(desired.brightness * 100)}%`);
	if (typeof desired.muted === 'boolean') labels.push(desired.muted ? 'muted' : 'unmuted');
	if (typeof desired.locked === 'boolean') labels.push(desired.locked ? 'locked' : 'unlocked');
	if (desired.activeAppBundleId) labels.push(desired.activeAppBundleId);
	return labels.length ? labels.join(' · ') : null;
};

const CANCELLABLE_STATUSES = new Set<DeviceCommandStatus>(['queued', 'claimed', 'leased', 'running', 'streaming', 'needs-approval']);

export type DeviceCommandTimelineProps = {
	deviceId: string;
	commands: DeviceCommand[];
	now?: number;
	maxItems?: number;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceCommandTimeline = memo(({ deviceId, commands, now, maxItems = 30, controlFor, onAction }: DeviceCommandTimelineProps) => {
	if (!commands.length) {
		return (
			<Box
				border="1px dashed var(--tt-border-strong, #d4d4d8)"
				borderRadius="var(--tt-radius-md, 12px)"
				color="var(--tt-muted, #71717a)"
				fontSize="12px"
				padding={4}
				textAlign="center"
			>
				No device commands yet.
			</Box>
		);
	}

	const visible = [...commands]
		.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || right.revision - left.revision)
		.slice(0, Math.max(1, maxItems));

	return (
		<Box>
			{visible.map((command, index) => {
				const desired = desiredLabel(command);
				return (
					<Flex gap={2.5} key={command.id} minWidth={0} position="relative" paddingBottom={index === visible.length - 1 ? 0 : 3}>
						{index < visible.length - 1 ? (
							<Box background="var(--tt-border, #ececef)" height="calc(100% - 17px)" left="7px" position="absolute" top="19px" width="1px" />
						) : null}
						<Flex
							alignItems="center"
							background="var(--tt-card, #ffffff)"
							color={command.status === 'failed' ? 'var(--tt-danger, #dc2626)' : 'var(--tt-muted, #71717a)'}
							flexShrink={0}
							height="16px"
							justifyContent="center"
							marginTop="2px"
							position="relative"
							width="16px"
							zIndex={1}
						>
							{commandIcon(command.status)}
						</Flex>
						<Box flex="1" minWidth={0}>
							<Flex alignItems="center" gap={1.5} minWidth={0} wrap="wrap">
								<Text fontSize="12px" fontWeight={700}>
									{humanAction(command)}
								</Text>
								<DeviceStatusPill label={command.status} tone={commandTone(command.status)} />
								{command.id.startsWith('local:') ? <DeviceStatusPill label="syncing" tone="accent" /> : null}
							</Flex>
							<Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={0.5} title={command.updatedAt}>
								{formatDeviceLastSeen(command.updatedAt, now)}
								{desired ? ` · ${desired}` : ''}
							</Text>
							{command.error ? (
								<Text color="var(--tt-danger, #dc2626)" fontSize="10px" lineHeight="1.35" marginTop={1}>
									{command.error.code}
								</Text>
							) : null}
						</Box>
						{CANCELLABLE_STATUSES.has(command.status) ? (
							<DevicePolicyButton
								action="cancel-command"
								color="var(--tt-danger, #dc2626)"
								controlFor={controlFor}
								deviceId={deviceId}
								input={{ commandId: command.id }}
								label="Cancel"
								onAction={onAction}
								targetId={command.id}
								variant="ghost"
							/>
						) : null}
					</Flex>
				);
			})}
		</Box>
	);
});
DeviceCommandTimeline.displayName = 'DeviceCommandTimeline';
