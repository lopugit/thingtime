import React, { memo } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { MonitorUp, MousePointer2, ScreenShare, Square } from 'lucide-react';

import type { DeviceScreenSession, DeviceScreenSessionStatus } from './deviceTypes';
import { DeviceStatusPill } from './DeviceCard';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton } from './DeviceStateGrid';

const screenTone = (status: DeviceScreenSessionStatus): 'positive' | 'warning' | 'negative' | 'neutral' | 'accent' => {
	if (status === 'active') return 'positive';
	if (status === 'starting' || status === 'stopping') return 'accent';
	if (status === 'denied' || status === 'failed') return 'negative';
	return 'neutral';
};

const screenMessage = (status: DeviceScreenSessionStatus): string => {
	if (status === 'starting') return 'Waiting for local approval and the encrypted screen stream.';
	if (status === 'stopping') return 'Ending the screen session safely.';
	if (status === 'denied') return 'Screen access was denied on the device.';
	if (status === 'failed') return 'The screen session could not be established.';
	if (status === 'active') return 'Waiting for video frames from the node.';
	return 'Start a view-only session. Control remains a separate capability and approval.';
};

export type ScreenVideoContract = {
	ref?: React.Ref<HTMLVideoElement>;
	ready?: boolean;
	props?: Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'ref'>;
};

export type ScreenSessionAvailability = 'available' | 'unsupported' | 'not-installed';

export type ScreenSessionPanelProps = {
	deviceId: string;
	session: DeviceScreenSession | null;
	startInput?: Record<string, unknown> | null;
	availability?: ScreenSessionAvailability;
	video?: ScreenVideoContract;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const ScreenSessionPanel = memo(
	({ deviceId, session, startInput = null, availability, video, controlFor, onAction }: ScreenSessionPanelProps) => {
		const status = session?.status || 'inactive';
		const active = status === 'active';
		const videoReady = active && video?.ready === true;
		const startControl = controlFor?.('start-screen-session', 'screen');
		const stopControl = controlFor?.('stop-screen-session', session?.id || 'screen');
		const controlSession = controlFor?.('control-screen-session', session?.id || 'screen');
		const blockedMessage =
			(!startControl?.policy.allowed && startControl?.policy.message) ||
			(!stopControl?.policy.allowed && stopControl?.policy.message) ||
			(!controlSession?.policy.allowed && controlSession?.policy.message) ||
			null;
		const resolvedAvailability: ScreenSessionAvailability =
			availability ||
			(session
				? 'available'
				: startControl?.policy.reason === 'capability-unsupported'
				? 'unsupported'
				: startControl
				? 'available'
				: 'not-installed');
		const displayedStatus = resolvedAvailability === 'available' ? status : resolvedAvailability;
		const unavailableMessage =
			resolvedAvailability === 'not-installed'
				? 'This node build does not include screen streaming yet. Permission preflight alone does not enable capture or control.'
				: resolvedAvailability === 'unsupported'
				? startControl?.policy.message || 'Screen streaming is not supported by this device.'
				: null;

		return (
			<Box
				background="var(--tt-card, #ffffff)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-md, 12px)"
				overflow="hidden"
			>
				<Flex alignItems="center" gap={2} paddingX={3} paddingY={2.5}>
					<ScreenShare aria-hidden color="var(--tt-muted, #71717a)" size={16} />
					<Text flex="1" fontSize="12px" fontWeight={700}>
						Screen session
					</Text>
					<DeviceStatusPill
						label={displayedStatus}
						tone={resolvedAvailability === 'unsupported' ? 'negative' : resolvedAvailability === 'not-installed' ? 'neutral' : screenTone(status)}
					/>
					{session?.controlEnabled ? <DeviceStatusPill label="control" tone="warning" /> : null}
				</Flex>

				<Box
					aspectRatio="16 / 10"
					background="#111114"
					borderTop="1px solid var(--tt-border, #ececef)"
					color="#d4d4d8"
					overflow="hidden"
					position="relative"
					width="100%"
				>
					{active ? (
						<video
							aria-label="Live device screen"
							autoPlay
							muted
							playsInline
							{...video?.props}
							ref={video?.ref}
							style={{
								display: 'block',
								height: '100%',
								objectFit: 'contain',
								opacity: videoReady ? 1 : 0,
								width: '100%',
								...(video?.props?.style || {})
							}}
						/>
					) : null}
					{!videoReady ? (
						<Flex alignItems="center" direction="column" gap={2} inset={0} justifyContent="center" padding={5} position="absolute" textAlign="center">
							<MonitorUp aria-hidden size={24} />
							<Text fontSize="11px" lineHeight="1.45" maxWidth="280px">
								{unavailableMessage || screenMessage(status)}
							</Text>
							{session?.lastError ? (
								<Text color="#fca5a5" fontSize="10px">
									{session.lastError.code}
								</Text>
							) : null}
						</Flex>
					) : null}
				</Box>

				<Box padding={3}>
					<Flex alignItems="center" gap={1.5} justifyContent="flex-end" wrap="wrap">
						{resolvedAvailability === 'available' && (status === 'inactive' || status === 'denied' || status === 'failed') ? (
							<DevicePolicyButton
								action="start-screen-session"
								controlFor={controlFor}
								controlKey="screen"
								deviceId={deviceId}
								input={startInput}
								label={status === 'inactive' ? 'Start viewing' : 'Try again'}
								onAction={onAction}
							/>
						) : null}
						{resolvedAvailability === 'available' && active ? (
							<DevicePolicyButton
								action="control-screen-session"
								controlFor={controlFor}
								deviceId={deviceId}
								input={{ sessionId: session?.id, enabled: !session?.controlEnabled }}
								label={session?.controlEnabled ? 'Disable control' : 'Enable control'}
								onAction={onAction}
								targetId={session?.id}
								variant="ghost"
							/>
						) : null}
						{resolvedAvailability === 'available' && (status === 'starting' || status === 'active' || status === 'stopping') ? (
							<DevicePolicyButton
								action="stop-screen-session"
								color="var(--tt-danger, #dc2626)"
								controlFor={controlFor}
								deviceId={deviceId}
								input={{ sessionId: session?.id }}
								label={status === 'stopping' ? 'Stopping…' : 'Stop'}
								onAction={onAction}
								targetId={session?.id || 'screen'}
								variant="ghost"
							/>
						) : null}
					</Flex>
					{blockedMessage ? (
						<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1.5} textAlign="right">
							{blockedMessage}
						</Text>
					) : null}
					{active ? (
						<Flex alignItems="center" color="var(--tt-muted, #71717a)" fontSize="10px" gap={1.5} marginTop={2}>
							{session?.controlEnabled ? <MousePointer2 aria-hidden size={11} /> : <Square aria-hidden size={10} />}
							{session?.controlEnabled ? 'Remote input is enabled for this session.' : 'View-only mode.'}
						</Flex>
					) : null}
				</Box>
			</Box>
		);
	}
);
ScreenSessionPanel.displayName = 'ScreenSessionPanel';
