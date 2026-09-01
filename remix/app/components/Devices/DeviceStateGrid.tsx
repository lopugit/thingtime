import React, { memo } from 'react';

import { Box, Button, Flex, Grid, MenuItem, Progress, Slider, SliderFilledTrack, SliderThumb, SliderTrack, Text } from '@chakra-ui/react';
import { AppWindow, LockKeyhole, Moon, Sun, Volume2, VolumeX } from 'lucide-react';

import { reconcileDesiredState } from './deviceCore';
import type { DeviceActionKind, DeviceActionPolicy, DeviceCommand, DeviceDesiredState, DeviceSnapshot } from './deviceTypes';
import { DeviceStatusPill } from './DeviceCard';

export type DeviceActionControl = {
	policy: DeviceActionPolicy;
	idempotencyKey: string;
	commandId?: string | null;
	busy?: boolean;
	pendingLabel?: string;
};

export type DeviceActionIntent = {
	deviceId: string;
	action: DeviceActionKind;
	idempotencyKey: string;
	commandId?: string | null;
	targetId?: string | null;
	desired?: DeviceDesiredState | null;
	input?: Record<string, unknown> | null;
};

export type DeviceControlResolver = (action: DeviceActionKind, targetKey?: string | null) => DeviceActionControl | null | undefined;

export type DeviceActionHandler = (intent: DeviceActionIntent) => void;

export type DevicePolicyButtonProps = {
	deviceId: string;
	action: DeviceActionKind;
	label: string;
	targetId?: string | null;
	controlKey?: string | null;
	desired?: DeviceDesiredState | null;
	input?: Record<string, unknown> | null;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
	size?: 'xs' | 'sm' | 'md';
	variant?: 'solid' | 'outline' | 'ghost';
	color?: string;
	disabledReason?: string | null;
};

export const DevicePolicyButton = memo(
	({
		deviceId,
		action,
		label,
		targetId = null,
		controlKey,
		desired = null,
		input = null,
		controlFor,
		onAction,
		size = 'xs',
		variant = 'outline',
		color,
		disabledReason = null
	}: DevicePolicyButtonProps) => {
		const control = controlFor?.(action, controlKey === undefined ? targetId : controlKey);
		if (!control) return null;
		const actionable = !disabledReason && control.policy.allowed && Boolean(control.idempotencyKey) && Boolean(onAction) && !control.busy;
		const buttonLabel = control.busy ? control.pendingLabel || `${label}…` : label;
		return (
			<Button
				aria-disabled={!actionable}
				borderColor="var(--tt-border-strong, #d4d4d8)"
				color={color || 'var(--tt-ink, #17171c)'}
				isDisabled={!actionable}
				onClick={() => {
					if (!actionable || !onAction) return;
					onAction({
						deviceId,
						action,
						idempotencyKey: control.idempotencyKey,
						commandId: control.commandId,
						targetId,
						desired,
						input
					});
				}}
				size={size}
				title={disabledReason || control.policy.message || undefined}
				variant={variant}
			>
				{buttonLabel}
			</Button>
		);
	}
);
DevicePolicyButton.displayName = 'DevicePolicyButton';

export type DevicePolicyMenuItemProps = Omit<DevicePolicyButtonProps, 'size' | 'variant' | 'color'> & {
	color?: string;
};

export const DevicePolicyMenuItem = memo(
	({ deviceId, action, label, targetId = null, controlKey, desired = null, input = null, controlFor, onAction, color, disabledReason = null }: DevicePolicyMenuItemProps) => {
		const control = controlFor?.(action, controlKey === undefined ? targetId : controlKey);
		if (!control) return null;
		const actionable = !disabledReason && control.policy.allowed && Boolean(control.idempotencyKey) && Boolean(onAction) && !control.busy;
		const itemLabel = control.busy ? control.pendingLabel || `${label}…` : label;
		return (
			<MenuItem
				color={color}
				isDisabled={!actionable}
				onClick={() => {
					if (!actionable || !onAction) return;
					onAction({ deviceId, action, idempotencyKey: control.idempotencyKey, commandId: control.commandId, targetId, desired, input });
				}}
				title={disabledReason || control.policy.message || undefined}
			>
				{itemLabel}
			</MenuItem>
		);
	}
);
DevicePolicyMenuItem.displayName = 'DevicePolicyMenuItem';

const percent = (value: number | null): string => (value === null ? 'Unavailable' : `${Math.round(value * 100)}%`);

const StateCell = ({
	icon,
	label,
	value,
	pending = false,
	children
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	pending?: boolean;
	children?: React.ReactNode;
}) => (
	<Box
		background="var(--tt-card, #ffffff)"
		border="1px solid"
		borderColor={pending ? 'var(--tt-accent, #f472b6)' : 'var(--tt-border, #ececef)'}
		borderRadius="var(--tt-radius-md, 12px)"
		minWidth={0}
		padding={3}
	>
		<Flex alignItems="center" color="var(--tt-muted, #71717a)" gap={2}>
			{icon}
			<Text fontSize="10px" fontWeight={700} letterSpacing="0.04em" textTransform="uppercase">
				{label}
			</Text>
			{pending ? <DeviceStatusPill label="pending" tone="accent" /> : null}
		</Flex>
		<Text fontSize="16px" fontWeight={700} marginTop={2} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
			{value}
		</Text>
		{children ? <Box marginTop={2}>{children}</Box> : null}
	</Box>
);

const Meter = ({
	action,
	deviceId,
	field,
	value,
	controlFor,
	onAction
}: {
	action: 'set-volume' | 'set-brightness';
	deviceId: string;
	field: 'volume' | 'brightness';
	value: number | null;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
}) => {
	if (value === null)
		return (
			<Text color="var(--tt-muted, #71717a)" fontSize="10px">
				Not reported by this device
			</Text>
		);
	const valuePercent = Math.round(value * 100);
	const control = controlFor?.(action, field);
	if (!control) {
		return (
			<Progress
				aria-label={`${field} ${valuePercent}%`}
				background="var(--tt-surface-alt, #eeeeef)"
				borderRadius="999px"
				colorScheme="pink"
				height="5px"
				value={valuePercent}
			/>
		);
	}
	const actionable = control.policy.allowed && Boolean(control.idempotencyKey) && Boolean(onAction) && !control.busy;
	return (
		<Box>
			<Slider
				aria-label={`Set ${field}`}
				defaultValue={valuePercent}
				isDisabled={!actionable}
				key={`${field}:${valuePercent}`}
				min={0}
				max={100}
				onChangeEnd={(nextPercent) => {
					if (!actionable || !onAction) return;
					onAction({
						deviceId,
						action,
						idempotencyKey: control.idempotencyKey,
						commandId: control.commandId,
						targetId: field,
						desired: { [field]: nextPercent / 100 }
					});
				}}
				step={1}
			>
				<SliderTrack background="var(--tt-surface-alt, #eeeeef)">
					<SliderFilledTrack background="var(--tt-accent, #f472b6)" />
				</SliderTrack>
				<SliderThumb boxShadow="0 1px 3px rgba(0, 0, 0, 0.24)" />
			</Slider>
			{!control.policy.allowed ? (
				<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1}>
					{control.policy.message || 'This control is unavailable.'}
				</Text>
			) : null}
		</Box>
	);
};

export type DeviceStateGridProps = {
	deviceId: string;
	snapshot: DeviceSnapshot | null;
	commands?: DeviceCommand[];
	now?: number;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceStateGrid = memo(({ deviceId, snapshot, commands = [], now, controlFor, onAction }: DeviceStateGridProps) => {
	const reconciliation = reconcileDesiredState(snapshot, commands, now);
	const state = reconciliation.effective;
	if (!state) {
		return (
			<Box
				border="1px dashed var(--tt-border-strong, #d4d4d8)"
				borderRadius="var(--tt-radius-md, 12px)"
				color="var(--tt-muted, #71717a)"
				fontSize="12px"
				padding={4}
				textAlign="center"
			>
				Device state has not been observed yet.
			</Box>
		);
	}

	const pending = new Set(reconciliation.pendingFields);
	const lockControl = controlFor?.('lock', 'device');
	return (
		<Grid gap={2.5} templateColumns={{ base: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }}>
			<StateCell
				icon={state.muted ? <VolumeX aria-hidden size={15} /> : <Volume2 aria-hidden size={15} />}
				label="Volume"
				pending={pending.has('volume') || pending.has('muted')}
				value={state.muted ? `Muted · ${percent(state.volume)}` : percent(state.volume)}
			>
				<Meter action="set-volume" controlFor={controlFor} deviceId={deviceId} field="volume" onAction={onAction} value={state.volume} />
				{state.muted !== null ? (
					<DevicePolicyButton
						action="set-muted"
						controlFor={controlFor}
						controlKey="mute"
						desired={{ muted: !state.muted }}
						deviceId={deviceId}
						input={{ muted: !state.muted }}
						label={state.muted ? 'Unmute' : 'Mute'}
						onAction={onAction}
					/>
				) : null}
			</StateCell>

			<StateCell icon={<Sun aria-hidden size={15} />} label="Brightness" pending={pending.has('brightness')} value={percent(state.brightness)}>
				<Meter action="set-brightness" controlFor={controlFor} deviceId={deviceId} field="brightness" onAction={onAction} value={state.brightness} />
			</StateCell>

			<StateCell
				icon={<LockKeyhole aria-hidden size={15} />}
				label="Security"
				pending={pending.has('locked')}
				value={state.locked === null ? 'Unknown' : state.locked ? 'Locked' : 'Unlocked'}
			>
				{state.locked === false ? (
					<>
						<DevicePolicyButton
							action="lock"
							controlFor={controlFor}
							controlKey="device"
							desired={{ locked: true }}
							deviceId={deviceId}
							label="Lock device"
							onAction={onAction}
						/>
						{lockControl && !lockControl.policy.allowed ? (
							<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1}>
								{lockControl.policy.message || 'Locking is unsupported.'}
							</Text>
						) : null}
					</>
				) : null}
			</StateCell>

			<StateCell
				icon={<AppWindow aria-hidden size={15} />}
				label="Active app"
				pending={pending.has('activeAppBundleId')}
				value={state.activeAppBundleId || 'None reported'}
			/>

			<StateCell
				icon={<Moon aria-hidden size={15} />}
				label="Power"
				value={state.sleeping === null ? 'Unknown' : state.sleeping ? 'Sleeping' : 'Awake'}
			/>
		</Grid>
	);
});
DeviceStateGrid.displayName = 'DeviceStateGrid';
