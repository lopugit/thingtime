import React, { memo } from 'react';

import { Box, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay, Flex, Text } from '@chakra-ui/react';
import { CircleAlert, LockKeyhole, WifiOff } from 'lucide-react';

import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';

import { resolvedDevicePresence, DeviceHealthBadges, DeviceStatusPill, formatDeviceLastSeen } from './DeviceCard';
import { DeviceApplications } from './DeviceApplications';
import { DeviceApprovalCard } from './DeviceApprovalCard';
import { DeviceCommandTimeline } from './DeviceCommandTimeline';
import { DeviceConnectors } from './DeviceConnectors';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton, DeviceStateGrid } from './DeviceStateGrid';
import { ScreenSessionPanel } from './ScreenSessionPanel';
import type { ScreenVideoContract } from './ScreenSessionPanel';
import type { ScreenSessionAvailability } from './ScreenSessionPanel';
import type { DeviceCommandStatus, DeviceRuntimeState, DeviceScreenSession } from './deviceTypes';

const Section = ({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) => (
	<Box marginTop={5}>
		<Flex alignItems="center" gap={1.5} marginBottom={2}>
			<Text as="h3" color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={800} letterSpacing="0.055em" textTransform="uppercase">
				{label}
			</Text>
			{typeof count === 'number' ? <DeviceStatusPill label={String(count)} tone="neutral" /> : null}
		</Flex>
		{children}
	</Box>
);

const NON_TERMINAL_COMMANDS = new Set<DeviceCommandStatus>(['queued', 'claimed', 'leased', 'running', 'streaming', 'needs-approval']);

const newestScreenSession = (sessions: DeviceScreenSession[]): DeviceScreenSession | null => {
	if (!sessions.length) return null;
	return [...sessions].sort(
		(left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || right.revision - left.revision
	)[0];
};

const batteryLabel = (value: number | null | undefined): string | null => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	const normalized = value > 1 ? value / 100 : value;
	return `${Math.round(Math.max(0, Math.min(1, normalized)) * 100)}% battery`;
};

const Notice = ({ icon, children, danger = false }: { icon: React.ReactNode; children: React.ReactNode; danger?: boolean }) => (
	<Flex
		alignItems="flex-start"
		background={danger ? 'rgba(220, 38, 38, 0.07)' : 'rgba(217, 119, 6, 0.08)'}
		border="1px solid"
		borderColor={danger ? 'rgba(220, 38, 38, 0.25)' : 'rgba(217, 119, 6, 0.26)'}
		borderRadius="var(--tt-radius-md, 12px)"
		color={danger ? 'var(--tt-danger, #dc2626)' : 'var(--tt-warning, #b45309)'}
		fontSize="11px"
		gap={2}
		lineHeight="1.45"
		marginTop={2}
		padding={3}
	>
		<Box flexShrink={0} marginTop="1px">
			{icon}
		</Box>
		<Box>{children}</Box>
	</Flex>
);

export type DeviceDetailsDrawerProps = {
	isOpen: boolean;
	onClose: () => void;
	state: DeviceRuntimeState | null;
	now?: number;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
	screenVideo?: ScreenVideoContract;
	screenAvailability?: ScreenSessionAvailability;
	screenStartInput?: Record<string, unknown> | null;
};

export const DeviceDetailsDrawer = memo(
	({
		isOpen,
		onClose,
		state,
		now = Date.now(),
		controlFor,
		onAction,
		screenVideo,
		screenAvailability,
		screenStartInput = null
	}: DeviceDetailsDrawerProps) => {
		const summary = state?.summary || null;
		const snapshot = state?.snapshot || null;
		const pendingCommands = state?.commands.filter((command) => NON_TERMINAL_COMMANDS.has(command.status)).length || 0;
		const visibleApprovals = state
			? [...state.approvals]
					.sort(
						(left, right) =>
							Number(right.status === 'pending') - Number(left.status === 'pending') ||
							new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
							right.revision - left.revision
					)
					.slice(0, 6)
			: [];
		const pendingApprovals = state?.approvals.filter((approval) => approval.status === 'pending').length || 0;
		const screenSession = newestScreenSession(state?.screenSessions || []);
		const presence = summary ? resolvedDevicePresence(summary, now) : 'offline';
		const localServiceAction =
			summary?.serviceStatus === 'running' || summary?.serviceStatus === 'degraded' ? 'unregister-service' : 'register-service';
		const battery = batteryLabel(summary?.system?.batteryPercent);
		const serviceControl = controlFor?.(localServiceAction, 'service');
		const pairingControl = summary?.pairingStatus !== 'paired' ? controlFor?.('begin-pairing', 'pairing') : null;
		const nodeBlockedMessage =
			(!serviceControl?.policy.allowed && serviceControl?.policy.message) ||
			(!pairingControl?.policy.allowed && pairingControl?.policy.message) ||
			null;

		return (
			<Drawer isOpen={isOpen} onClose={onClose} placement="right" size="full">
				<DrawerOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
				<DrawerContent
					background="var(--tt-card, #ffffff)"
					color="var(--tt-ink, #17171c)"
					containerProps={{ zIndex: DRAWER_MODAL_Z }}
					marginLeft="auto"
					maxWidth={{ base: '100vw', md: '560px' }}
					minWidth={0}
					width="100%"
				>
					<DrawerCloseButton marginTop={{ base: 'env(safe-area-inset-top)', md: 0 }} right={{ base: 3, md: 4 }} top={{ base: 3, md: 4 }} />
					<DrawerHeader
						borderBottom="1px solid var(--tt-border, #ececef)"
						paddingBottom={3}
						paddingLeft={{ base: 4, sm: 5 }}
						paddingRight={14}
						paddingTop={{ base: 'calc(16px + env(safe-area-inset-top))', md: 4 }}
					>
						{summary ? (
							<Box minWidth={0}>
								<Flex alignItems="center" gap={2} minWidth={0} wrap="wrap">
									<Text as="h2" fontSize="15px" fontWeight={800} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
										{summary.name}
									</Text>
									<DeviceHealthBadges now={now} summary={summary} />
								</Flex>
								<Text color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={400} marginTop={1}>
									{summary.system?.model || summary.platform}
									{summary.system?.osVersion ? ` · ${summary.system.osVersion}` : ''}
									{battery ? ` · ${battery}` : ''}
									{` · ${formatDeviceLastSeen(summary.lastSeenAt, now)}`}
								</Text>
							</Box>
						) : (
							<Text as="h2" fontSize="15px" fontWeight={800}>
								Device details
							</Text>
						)}
					</DrawerHeader>

					<DrawerBody
						overflowX="hidden"
						paddingBottom="calc(28px + env(safe-area-inset-bottom))"
						paddingLeft={{ base: 4, sm: 5 }}
						paddingRight={{ base: 4, sm: 5 }}
						paddingTop={4}
					>
						{!state || !summary ? (
							<Box
								border="1px dashed var(--tt-border-strong, #d4d4d8)"
								borderRadius="var(--tt-radius-md, 12px)"
								color="var(--tt-muted, #71717a)"
								fontSize="12px"
								padding={6}
								textAlign="center"
							>
								Select a device to inspect its last-known state.
							</Box>
						) : (
							<>
								{presence !== 'online' ? (
									<Notice icon={<WifiOff aria-hidden size={15} />}>
										{presence === 'stale'
											? 'This device has stopped reporting recently. Queueable actions can wait for it to reconnect.'
											: 'This device is offline. Live state may be stale, and unsupported offline actions remain disabled.'}
									</Notice>
								) : null}
								{snapshot?.observed.locked ? (
									<Notice icon={<LockKeyhole aria-hidden size={15} />}>
										The device is locked. Only capabilities explicitly allowed while locked remain available.
									</Notice>
								) : null}
								{summary.serviceStatus === 'version-mismatch' || summary.lastError ? (
									<Notice danger icon={<CircleAlert aria-hidden size={15} />}>
										{summary.serviceStatus === 'version-mismatch'
											? 'The desktop node and web client versions are incompatible.'
											: `Node health: ${summary.lastError?.code || 'degraded'}`}
									</Notice>
								) : null}

								<Section label="Node">
									<Box
										background="var(--tt-surface-alt, #f7f7f8)"
										border="1px solid var(--tt-border, #ececef)"
										borderRadius="var(--tt-radius-md, 12px)"
										padding={3}
									>
										<Flex alignItems="center" gap={1.5} wrap="wrap">
											<DeviceStatusPill
												label={`service · ${summary.serviceStatus}`}
												tone={summary.serviceStatus === 'running' ? 'positive' : 'warning'}
											/>
											<DeviceStatusPill
												label={`pairing · ${summary.pairingStatus}`}
												tone={summary.pairingStatus === 'paired' ? 'positive' : 'warning'}
											/>
											<DeviceStatusPill
												label={`transport · ${summary.transportStatus}`}
												tone={summary.transportStatus === 'online' ? 'positive' : 'neutral'}
											/>
										</Flex>
										<Flex gap={1.5} justifyContent="flex-end" marginTop={3} wrap="wrap">
											<DevicePolicyButton
												action={localServiceAction}
												controlFor={controlFor}
												controlKey="service"
												deviceId={state.deviceId}
												label={localServiceAction === 'unregister-service' ? 'Stop node service' : 'Install node service'}
												onAction={onAction}
												variant="ghost"
											/>
											{summary.pairingStatus !== 'paired' ? (
												<DevicePolicyButton
													action="begin-pairing"
													controlFor={controlFor}
													controlKey="pairing"
													deviceId={state.deviceId}
													label="Pair device"
													onAction={onAction}
												/>
											) : null}
										</Flex>
										{nodeBlockedMessage ? (
											<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1.5} textAlign="right">
												{nodeBlockedMessage}
											</Text>
										) : null}
									</Box>
								</Section>

								<Section label="Observed state">
									<DeviceStateGrid
										commands={state.commands}
										controlFor={controlFor}
										deviceId={state.deviceId}
										now={now}
										onAction={onAction}
										snapshot={snapshot}
									/>
								</Section>

								<Section count={snapshot?.observed.runningApps.length || 0} label="Applications">
									<DeviceApplications
										activeAppBundleId={snapshot?.observed.activeAppBundleId}
										applications={snapshot?.observed.runningApps || []}
										controlFor={controlFor}
										deviceId={state.deviceId}
										locked={snapshot?.observed.locked}
										onAction={onAction}
									/>
								</Section>

								<Section count={snapshot?.connectors.length || 0} label="Connectors">
									<DeviceConnectors
										connectors={snapshot?.connectors || []}
										controlFor={controlFor}
										deviceId={state.deviceId}
										now={now}
										onAction={onAction}
									/>
								</Section>

								<Section label="Screen">
									<ScreenSessionPanel
										availability={screenAvailability}
										controlFor={controlFor}
										deviceId={state.deviceId}
										onAction={onAction}
										session={screenSession}
										startInput={screenStartInput}
										video={screenVideo}
									/>
								</Section>

								<Section count={pendingApprovals} label="Approvals">
									{visibleApprovals.length ? (
										<Flex direction="column" gap={2.5}>
											{visibleApprovals.map((approval) => (
												<DeviceApprovalCard approval={approval} controlFor={controlFor} key={approval.id} now={now} onAction={onAction} />
											))}
										</Flex>
									) : (
										<Text color="var(--tt-muted, #71717a)" fontSize="12px">
											No approval requests.
										</Text>
									)}
								</Section>

								<Section count={pendingCommands} label="Command activity">
									<DeviceCommandTimeline commands={state.commands} controlFor={controlFor} deviceId={state.deviceId} now={now} onAction={onAction} />
								</Section>
							</>
						)}
					</DrawerBody>
				</DrawerContent>
			</Drawer>
		);
	}
);
DeviceDetailsDrawer.displayName = 'DeviceDetailsDrawer';
