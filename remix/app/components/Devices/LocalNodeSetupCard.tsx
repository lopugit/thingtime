import React from 'react';
import { localNodeIsHealthy } from './localNodePanel';

import { Badge, Box, Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { FolderPlus, Laptop, Settings, ShieldCheck } from 'lucide-react';

import { DevicePolicyButton, type DeviceActionHandler, type DeviceControlResolver } from './DeviceStateGrid';
import { PermissionRecoveryControls } from './PermissionRecoveryControls';
import { permissionStatusLabel } from './localNodePermissions';
import { localNodeBadgePresentation, PASTEL_PAIRED_ACCOUNT_BADGE_STYLE } from './localNodePresentation';
import type { LocalThingtimeNodeState } from './useLocalThingtimeNode';

export const LocalNodeSetupCard = ({
	state,
	controlFor,
	onAction,
	onRefresh,
	onDismiss
}: {
	state: LocalThingtimeNodeState;
	controlFor: DeviceControlResolver;
	onAction: DeviceActionHandler;
	onRefresh: () => unknown;
	onDismiss?: () => void;
}) => {
	if (!state.available) return null;
	const registered = state.status?.loginItem?.registered === true;
	const paired = state.status?.pairingStatus === 'paired';
	const pairedToCurrentAccount = state.pairedToCurrentAccount === true;
	const recoverablePairing = state.status?.recoverablePairing === true;
	const permissions = [
		{
			kind: 'accessibility' as const,
			label: 'Accessibility',
			detail: 'Required to list, read, and send in supported desktop AI apps.',
			status: state.permissions.find((permission) => permission.kind === 'accessibility')?.status || 'unknown'
		},
		{
			kind: 'screen-recording' as const,
			label: 'Screen Recording',
			detail: 'Optional preflight for the bounded screen-sharing foundation.',
			status:
				state.permissions.find((permission) => permission.kind === 'screenRecording' || permission.kind === 'screen-recording')?.status || 'unknown'
		}
	];
	const missingPermissions = permissions.filter((permission) => permission.status !== 'authorized');
	const ready = localNodeIsHealthy(state);
	const badge = localNodeBadgePresentation({
		checking: state.checking,
		paired,
		pairedAccountCount: state.pairedAccountCount,
		pairedToCurrentAccount: state.pairedToCurrentAccount,
		recoverablePairing,
		registered
	});

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
							{ready
								? 'This Mac is connected to your account'
								: registered && pairedToCurrentAccount
								? missingPermissions.length === 0 && state.permissionsCheckedAt && !state.permissionCheckError
									? 'This Mac needs connection attention'
									: state.permissionCheckError || !state.permissionsCheckedAt
									? 'Check privacy access for this Mac'
									: 'Finish privacy access for this Mac'
								: registered && paired
								? 'Pair this Thingtime account to this Mac'
								: 'Make this Mac a Thingtime node'}
						</Text>
						<Badge
							borderRadius="full"
							borderWidth={paired ? '1px' : undefined}
							colorScheme={badge.colorScheme}
							data-paired-account-badge={paired ? 'true' : undefined}
							style={paired ? PASTEL_PAIRED_ACCOUNT_BADGE_STYLE : undefined}
						>
							{badge.label}
						</Badge>
						{badge.showChecking ? (
							<Spinner aria-label="Refreshing local node status" color="green.400" emptyColor="green.100" size="xs" speed="0.7s" thickness="2px" />
						) : null}
					</Flex>
					<Text color="var(--tt-muted, #71717a)" fontSize="12px" lineHeight="1.45" marginTop={1} whiteSpace="normal">
						{ready
							? 'The persistent node is paired to this account. Add local Codex folders here whenever you want to create chats in a new project.'
							: registered && pairedToCurrentAccount
							? missingPermissions.length === 0 && !state.permissionCheckError
								? 'Check the node’s connection and service status in Settings → Things.'
								: 'macOS privacy grants stay local and must be enabled explicitly for the signed Thingtime Node helper.'
							: registered && paired
							? 'This Mac already serves another Thingtime account and can safely add this account as a separate connection.'
							: 'The signed local node keeps approved device state and desktop AI connectors available when the Thingtime window is closed.'}
					</Text>
					<Flex align="center" color="var(--tt-faint, #8a8a94)" fontSize="11px" gap={1.5} marginTop={2}>
						<ShieldCheck aria-hidden size={13} />
						Each pairing link works once. A Mac and account can each connect to multiple devices or accounts.
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
					) : state.pairedToCurrentAccount === false ? (
						<DevicePolicyButton
							action="begin-pairing"
							controlFor={controlFor}
							controlKey="onboarding-pairing"
							deviceId="local-node"
							label={recoverablePairing ? 'Resume pairing' : 'Pair this account'}
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
			{registered ? (
				<Box borderTop="1px solid var(--tt-border, #ececef)" marginTop={3} paddingTop={3}>
					<Flex align="center" justify="space-between" gap={2} wrap="wrap" marginBottom={2}>
						<Text color="var(--tt-muted, #71717a)" fontSize="11px" role="status">
							{state.permissionCheckError
								? 'Access check unavailable · showing last known results'
								: state.permissionsCheckedAt
								? `Checked at ${new Date(state.permissionsCheckedAt).toLocaleTimeString()}`
								: 'Access has not been checked yet'}
						</Text>
						<Button size="xs" variant="outline" isDisabled={state.checking} onClick={() => void onRefresh()}>
							{state.checking ? 'Checking access…' : 'Check access'}
						</Button>
					</Flex>
					{state.permissionCheckError ? (
						<Text role="alert" color="orange.600" fontSize="12px" marginBottom={2}>
							{state.permissionCheckError}
						</Text>
					) : null}
					{permissions.map((permission) => (
						<Flex align="center" gap={3} key={permission.kind} paddingY={1.5} wrap="wrap">
							<Settings aria-hidden size={14} />
							<Box flex="1" minWidth="190px">
								<Text fontSize="12px" fontWeight={700}>
									{permission.label} · {permissionStatusLabel(permission.status, Boolean(state.permissionCheckError))}
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
									label="Open System Settings"
									onAction={onAction}
									size="xs"
								/>
							) : null}
						</Flex>
					))}
					<PermissionRecoveryControls />
					{missingPermissions.length ? (
						<Text color="var(--tt-muted, #71717a)" fontSize="12px" lineHeight="1.5" marginTop={2} whiteSpace="normal">
							Already enabled in System Settings? macOS may still be using a grant from an older signed Node. Turn Thingtime Node off and on once for
							each affected permission, then restart the node in Desktop settings and choose Check access. Access is checked again automatically when
							you return here.
						</Text>
					) : null}
				</Box>
			) : null}
			{ready && onDismiss && (
				<Button
					mt={3}
					size="sm"
					variant="link"
					color="var(--tt-accent, #805ad5)"
					whiteSpace="normal"
					height="auto"
					textAlign="left"
					onClick={onDismiss}
				>
					Don’t show again unless there’s a problem
				</Button>
			)}
		</Box>
	);
};
