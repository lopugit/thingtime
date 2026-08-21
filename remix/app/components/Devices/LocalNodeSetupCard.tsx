import React from 'react';

import { Badge, Box, Flex, Text } from '@chakra-ui/react';
import { FolderPlus, Laptop, Settings, ShieldCheck } from 'lucide-react';

import { DevicePolicyButton, type DeviceActionHandler, type DeviceControlResolver } from './DeviceStateGrid';
import type { LocalThingtimeNodeState } from './useLocalThingtimeNode';

export const LocalNodeSetupCard = ({
	state,
	controlFor,
	onAction
}: {
	state: LocalThingtimeNodeState;
	controlFor: DeviceControlResolver;
	onAction: DeviceActionHandler;
}) => {
	if (!state.available) return null;
	const registered = state.status?.loginItem?.registered === true;
	const paired = state.status?.pairingStatus === 'paired';
	const recoverablePairing = state.status?.recoverablePairing === true;
	const permissions = [
		{
			kind: 'accessibility' as const,
			label: 'Accessibility',
			detail: 'Required to list, read, and send in supported desktop AI apps.',
			status: state.permissions.find((permission) => permission.kind === 'accessibility')?.status || 'denied'
		},
		{
			kind: 'screen-recording' as const,
			label: 'Screen Recording',
			detail: 'Optional preflight for the bounded screen-sharing foundation.',
			status:
				state.permissions.find((permission) => permission.kind === 'screenRecording' || permission.kind === 'screen-recording')?.status || 'denied'
		}
	];
	const missingPermissions = permissions.filter((permission) => permission.status !== 'authorized');
	const ready = registered && paired && missingPermissions.length === 0;

	return (
		<Box background="var(--tt-card, #fff)" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-lg, 16px)" padding={[3, 4]}>
			<Flex align="flex-start" gap={3} wrap="wrap">
				<Flex
					align="center"
					background="var(--tt-surface-alt, #f7f7f9)"
					borderRadius="12px"
					flexShrink={0}
					height="40px"
					justify="center"
					width="40px"
				>
					<Laptop aria-hidden size={20} />
				</Flex>
				<Box flex="1" minWidth="210px">
					<Flex align="center" gap={2} wrap="wrap">
						<Text fontSize="14px" fontWeight={800}>
							{ready ? 'Thingtime Node is ready' : registered && paired ? 'Finish privacy access for this Mac' : 'Make this Mac a Thingtime node'}
						</Text>
						<Badge borderRadius="full" colorScheme={state.loading ? 'purple' : registered ? 'orange' : 'gray'}>
							{state.loading
								? 'checking'
								: recoverablePairing
								? 'resume pairing'
								: ready
								? 'ready'
								: registered && paired
								? 'privacy setup'
								: registered
								? 'ready to pair'
								: 'not running'}
						</Badge>
					</Flex>
					<Text color="var(--tt-muted, #71717a)" fontSize="12px" lineHeight="1.45" marginTop={1} whiteSpace="normal">
						{ready
							? 'The persistent node is paired. Add local Codex folders here whenever you want to create chats in a new project.'
							: registered && paired
							? 'macOS privacy grants stay local and must be enabled explicitly for the signed Thingtime Node helper.'
							: 'The signed local node keeps approved device state and desktop AI connectors available when the Thingtime window is closed.'}
					</Text>
					<Flex align="center" color="var(--tt-faint, #8a8a94)" fontSize="11px" gap={1.5} marginTop={2}>
						<ShieldCheck aria-hidden size={13} />
						Pairing is one-use and confirmed in the native app.
					</Flex>
					{state.status?.lastError?.message ? (
						<Text color="orange.600" fontSize="11px" marginTop={2} whiteSpace="normal">
							{state.status.lastError.message}
						</Text>
					) : null}
				</Box>
				<Flex gap={2} justify="flex-end" marginLeft="auto" wrap="wrap">
					{!registered ? (
						<DevicePolicyButton
							action="register-service"
							controlFor={controlFor}
							controlKey="onboarding-service"
							deviceId="local-node"
							label="Start node"
							onAction={onAction}
							size="sm"
						/>
					) : !paired ? (
						<DevicePolicyButton
							action="begin-pairing"
							controlFor={controlFor}
							controlKey="onboarding-pairing"
							deviceId="local-node"
							label={recoverablePairing ? 'Resume pairing' : 'Pair this Mac'}
							onAction={onAction}
							size="sm"
						/>
					) : null}
					{registered ? (
						<DevicePolicyButton
							action="register-project"
							controlFor={controlFor}
							controlKey="local-codex-project"
							deviceId="local-node"
							label="Add Codex project"
							onAction={onAction}
							size="sm"
						/>
					) : null}
				</Flex>
			</Flex>
			{registered ? (
				<Flex align="center" color="var(--tt-muted, #71717a)" fontSize="10px" gap={1.5} marginTop={3}>
					<FolderPlus aria-hidden size={13} />
					Folder paths remain in a private file on this Mac; your account receives only an opaque id and folder name.
				</Flex>
			) : null}
			{registered && missingPermissions.length ? (
				<Box borderTop="1px solid var(--tt-border, #ececef)" marginTop={3} paddingTop={3}>
					{permissions.map((permission) => (
						<Flex align="center" gap={3} key={permission.kind} paddingY={1.5} wrap="wrap">
							<Settings aria-hidden size={14} />
							<Box flex="1" minWidth="190px">
								<Text fontSize="12px" fontWeight={700}>
									{permission.label} · {permission.status === 'authorized' ? 'Allowed' : 'Needs access'}
								</Text>
								<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.4">
									{permission.detail}
								</Text>
							</Box>
							{permission.status !== 'authorized' ? (
								<DevicePolicyButton
									action="open-permission-settings"
									controlFor={controlFor}
									controlKey={`permission-${permission.kind}`}
									deviceId="local-node"
									input={{ permissionKind: permission.kind }}
									label="Request access"
									onAction={onAction}
									size="xs"
								/>
							) : null}
						</Flex>
					))}
				</Box>
			) : null}
		</Box>
	);
};
