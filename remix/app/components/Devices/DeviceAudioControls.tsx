import React, { memo } from 'react';

import { Box, Button, Flex, Menu, MenuButton, MenuList, Portal, Text } from '@chakra-ui/react';
import { ChevronDown, Mic2, Speaker, Volume2 } from 'lucide-react';

import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';

import type { DeviceAudioDevice } from './deviceTypes';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyMenuItem } from './DeviceStateGrid';

type RouteKind = 'output' | 'input' | 'sound-effects-output';

const routeConfig: Record<RouteKind, { action: 'set-audio-output' | 'set-audio-input' | 'set-sound-effects-output'; label: string; selected: keyof DeviceAudioDevice }> = {
	output: { action: 'set-audio-output', label: 'Sound output', selected: 'isDefaultOutput' },
	input: { action: 'set-audio-input', label: 'Microphone', selected: 'isDefaultInput' },
	'sound-effects-output': { action: 'set-sound-effects-output', label: 'Alerts & effects', selected: 'isDefaultSoundEffectsOutput' }
};

const RouteMenu = ({
	deviceId,
	devices,
	route,
	controlFor,
	onAction
}: {
	deviceId: string;
	devices: DeviceAudioDevice[];
	route: RouteKind;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
}) => {
	const config = routeConfig[route];
	const candidates = devices.filter((device) => (route === 'input' ? device.hasInput : device.hasOutput));
	const selected = candidates.find((device) => device[config.selected]) || null;
	if (!candidates.length) {
		return (
			<Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" padding={3}>
				<Text color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={700} letterSpacing="0.04em" textTransform="uppercase">
					{config.label}
				</Text>
				<Text fontSize="12px" marginTop={1}>
					No compatible device reported.
				</Text>
			</Box>
		);
	}
	return (
		<Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" minWidth={0} padding={2.5}>
			<Text color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={700} letterSpacing="0.04em" textTransform="uppercase">
				{config.label}
			</Text>
			<Menu placement="bottom-start">
				<MenuButton
					as={Button}
					fontSize="12px"
					marginTop={1.5}
					rightIcon={<ChevronDown size={14} />}
					size="sm"
					textAlign="left"
					variant="ghost"
					width="100%"
				>
					{selected?.name || 'Choose device'}
				</MenuButton>
				<Portal>
					<MenuList fontSize="12px" maxWidth="min(300px, calc(100vw - 32px))" zIndex={DRAWER_POPUP_Z}>
						{candidates.map((device) => (
							<DevicePolicyMenuItem
								action={config.action}
								controlFor={controlFor}
								controlKey={`${route}:${device.id}`}
								deviceId={deviceId}
								input={{ deviceId: device.id }}
								key={device.id}
								label={`${device[config.selected] ? '✓ ' : ''}${device.name}`}
								onAction={onAction}
								targetId={device.id}
							/>
						))}
					</MenuList>
				</Portal>
			</Menu>
		</Box>
	);
};

export type DeviceAudioControlsProps = {
	deviceId: string;
	devices: DeviceAudioDevice[];
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceAudioControls = memo(({ deviceId, devices, controlFor, onAction }: DeviceAudioControlsProps) => (
	<Box>
		<Flex alignItems="center" color="var(--tt-muted, #71717a)" gap={2} marginBottom={2}>
			<Speaker aria-hidden size={15} />
			<Text fontSize="11px" lineHeight="1.45">
				Choose which connected device handles sound, microphone input, and alerts.
			</Text>
		</Flex>
		<Flex direction="column" gap={2}>
			<RouteMenu controlFor={controlFor} deviceId={deviceId} devices={devices} onAction={onAction} route="output" />
			<Flex gap={2} minWidth={0} wrap={{ base: 'wrap', sm: 'nowrap' }}>
				<Box flex="1 1 180px" minWidth={0}>
					<RouteMenu controlFor={controlFor} deviceId={deviceId} devices={devices} onAction={onAction} route="input" />
				</Box>
				<Box flex="1 1 180px" minWidth={0}>
					<RouteMenu controlFor={controlFor} deviceId={deviceId} devices={devices} onAction={onAction} route="sound-effects-output" />
				</Box>
			</Flex>
		</Flex>
		<Flex alignItems="center" color="var(--tt-muted, #71717a)" fontSize="10px" gap={1.5} marginTop={2}>
			<Mic2 aria-hidden size={12} />
			<Volume2 aria-hidden size={12} />
			<Text>Routing changes use only the selected device identifier; no audio content is read or sent.</Text>
		</Flex>
	</Box>
));
DeviceAudioControls.displayName = 'DeviceAudioControls';
