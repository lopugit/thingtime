import React, { memo } from 'react';

import { Box, Button, Flex, Menu, MenuButton, MenuList, Portal, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Text } from '@chakra-ui/react';
import { ChevronDown, Mic2, Speaker, Volume2 } from 'lucide-react';

import { DRAWER_POPUP_Z } from '~/components/Nav/Drawer/useDrawer';

import type { DeviceActionKind, DeviceAudioDevice } from './deviceTypes';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton, DevicePolicyMenuItem } from './DeviceStateGrid';

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

const percent = (value: number | null): string => (value === null ? 'Unavailable' : `${Math.round(value * 100)}%`);

const AudioLevelControl = ({
	deviceId,
	label,
	level,
	muted,
	volumeAction,
	muteAction,
	controlFor,
	onAction
}: {
	deviceId: string;
	label: string;
	level: number | null;
	muted: boolean | null;
	volumeAction: DeviceActionKind;
	muteAction: DeviceActionKind;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
}) => {
	const control = controlFor?.(volumeAction, `${volumeAction}:level`);
	const actionable = Boolean(control?.policy.allowed && control.idempotencyKey && onAction && !control.busy);
	return (
		<Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" minWidth={0} padding={2.5}>
			<Flex alignItems="baseline" justifyContent="space-between" gap={2}>
				<Text color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={700} letterSpacing="0.04em" textTransform="uppercase">
					{label}
				</Text>
				<Text fontSize="12px" fontWeight={700}>{muted ? `Muted · ${percent(level)}` : percent(level)}</Text>
			</Flex>
			{level === null ? (
				<Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={2}>Not reported by this device.</Text>
			) : (
				<Slider
					aria-label={`Set ${label.toLowerCase()}`}
					defaultValue={Math.round(level * 100)}
					isDisabled={!actionable}
					key={`${volumeAction}:${Math.round(level * 100)}`}
					marginTop={2}
					max={100}
					min={0}
					onChangeEnd={(nextPercent) => {
						if (!actionable || !control || !onAction) return;
						onAction({
							deviceId,
							action: volumeAction,
							idempotencyKey: control.idempotencyKey,
							commandId: control.commandId,
							targetId: `${volumeAction}:level`,
							input: { level: nextPercent / 100 }
						});
					}}
					step={1}
				>
					<SliderTrack background="var(--tt-surface-alt, #eeeeef)"><SliderFilledTrack background="var(--tt-accent, #f472b6)" /></SliderTrack>
					<SliderThumb boxShadow="0 1px 3px rgba(0, 0, 0, 0.24)" />
				</Slider>
			)}
			{muted !== null ? (
				<Box marginTop={2}>
					<DevicePolicyButton
						action={muteAction}
						controlFor={controlFor}
						controlKey={`${muteAction}:toggle`}
						deviceId={deviceId}
						input={{ muted: !muted }}
						label={muted ? 'Unmute' : 'Mute'}
						onAction={onAction}
					/>
				</Box>
			) : null}
			{control && !control.policy.allowed ? <Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1}>{control.policy.message || 'This control is unavailable.'}</Text> : null}
		</Box>
	);
};

export type DeviceAudioControlsProps = {
	deviceId: string;
	devices: DeviceAudioDevice[];
	inputVolume: number | null;
	inputMuted: boolean | null;
	soundEffectsVolume: number | null;
	soundEffectsMuted: boolean | null;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceAudioControls = memo(({ deviceId, devices, inputVolume, inputMuted, soundEffectsVolume, soundEffectsMuted, controlFor, onAction }: DeviceAudioControlsProps) => (
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
			<Flex gap={2} minWidth={0} wrap={{ base: 'wrap', sm: 'nowrap' }}>
				<Box flex="1 1 180px" minWidth={0}>
					<AudioLevelControl
						controlFor={controlFor}
						deviceId={deviceId}
						label="Microphone level"
						level={inputVolume}
						muteAction="set-input-muted"
						muted={inputMuted}
						onAction={onAction}
						volumeAction="set-input-volume"
					/>
				</Box>
				<Box flex="1 1 180px" minWidth={0}>
					<AudioLevelControl
						controlFor={controlFor}
						deviceId={deviceId}
						label="Alerts & effects"
						level={soundEffectsVolume}
						muteAction="set-sound-effects-muted"
						muted={soundEffectsMuted}
						onAction={onAction}
						volumeAction="set-sound-effects-volume"
					/>
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
