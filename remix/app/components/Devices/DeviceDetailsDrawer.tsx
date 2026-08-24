import React, { memo } from 'react';

import { Box, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay, Flex, Text } from '@chakra-ui/react';
import { ChevronDown, CircleAlert, LockKeyhole, WifiOff } from 'lucide-react';

import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';

import { resolvedDevicePresence, DeviceHealthBadges, DeviceStatusPill, formatDeviceLastSeen } from './DeviceCard';
import { DeviceApplications } from './DeviceApplications';
import { DeviceAudioControls } from './DeviceAudioControls';
import { DeviceApprovalCard } from './DeviceApprovalCard';
import { DeviceCommandTimeline } from './DeviceCommandTimeline';
import { DeviceConnectors } from './DeviceConnectors';
import { DeviceNetworkControls } from './DeviceNetworkControls';
import { DevicePowerControls } from './DevicePowerControls';
import { DeviceSystemControls } from './DeviceSystemControls';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton, DeviceStateGrid } from './DeviceStateGrid';
import { ScreenSessionPanel } from './ScreenSessionPanel';
import type { ScreenVideoContract } from './ScreenSessionPanel';
import type { ScreenSessionAvailability } from './ScreenSessionPanel';
import {
	DEVICE_DRAWER_DEFAULT_WIDTH,
	DEVICE_DRAWER_KEYBOARD_STEP,
	DEVICE_DRAWER_MAX_WIDTH,
	DEVICE_DRAWER_MOBILE_MIN_WIDTH,
	clampDeviceDrawerWidth
} from './deviceDrawerLayout';
import { readDeviceDrawerPreferences, setDeviceDrawerSectionExpanded, setDeviceDrawerWidthPreference } from './deviceDrawerPreferences';
import type { DeviceDrawerSectionId } from './deviceDrawerPreferences';
import type { DeviceCommandStatus, DeviceExecutionPermissionMode, DeviceRuntimeState, DeviceScreenSession } from './deviceTypes';

const Section = ({
	deviceId,
	section,
	label,
	count,
	advanced = false,
	children
}: {
	deviceId: string;
	section: DeviceDrawerSectionId;
	label: string;
	count?: number;
	advanced?: boolean;
	children: React.ReactNode;
}) => {
	const [expanded, setExpanded] = React.useState(() => readDeviceDrawerPreferences(deviceId).sections[section]);
	const panelId = React.useId();
	const toggleExpanded = React.useCallback(() => {
		setExpanded((current) => {
			const next = !current;
			setDeviceDrawerSectionExpanded(deviceId, section, next);
			return next;
		});
	}, [deviceId, section]);

	return (
		<Box marginTop={5}>
			<Flex
				alignItems="center"
				aria-controls={panelId}
				aria-expanded={expanded}
				aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
				as="button"
				borderRadius="var(--tt-radius-sm, 8px)"
				gap={1.5}
				justifyContent="space-between"
				marginBottom={expanded ? 2 : 0}
				marginX={-1.5}
				onClick={toggleExpanded}
				paddingX={1.5}
				paddingY={1}
				sx={{ WebkitAppRegion: 'no-drag' }}
				type="button"
				width="calc(100% + 12px)"
				_hover={{ background: 'var(--tt-surface-alt, #f7f7f8)' }}
				_focusVisible={{ boxShadow: '0 0 0 2px var(--tt-accent, #ec4899)' }}
			>
				<Flex alignItems="center" gap={1.5} minWidth={0}>
					<Text as="h3" color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={800} letterSpacing="0.055em" textTransform="uppercase">
						{label}
					</Text>
					{typeof count === 'number' ? <DeviceStatusPill label={String(count)} tone="neutral" /> : null}
					{advanced ? <DeviceStatusPill label="advanced" tone="neutral" /> : null}
				</Flex>
				<Box
					aria-hidden
					color="var(--tt-muted, #71717a)"
					flexShrink={0}
					transform={expanded ? 'rotate(0deg)' : 'rotate(-90deg)'}
					transition="transform 140ms ease"
				>
					<ChevronDown size={15} strokeWidth={2} />
				</Box>
			</Flex>
			<Box hidden={!expanded} id={panelId}>
				{children}
			</Box>
		</Box>
	);
};

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

const permissionOptions: Array<{ mode: DeviceExecutionPermissionMode; label: string; detail: string }> = [
	{ mode: 'always-allow', label: 'Always allow', detail: 'Run supported actions without a repeated prompt.' },
	{ mode: 'ask-every-time', label: 'Ask every time', detail: 'Show an approval card before each action.' },
	{ mode: 'deny', label: 'Deny', detail: 'Reject future remote actions for this account.' }
];

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
	onPermissionModeChange?: (deviceId: string, mode: DeviceExecutionPermissionMode) => void | Promise<void>;
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
		screenStartInput = null,
		onPermissionModeChange
	}: DeviceDetailsDrawerProps) => {
		const [drawerWidth, setDrawerWidth] = React.useState(DEVICE_DRAWER_DEFAULT_WIDTH);
		const [resizing, setResizing] = React.useState(false);
		const resizeOrigin = React.useRef<{ pointerId: number; x: number; width: number } | null>(null);
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
		const permissionMode = summary?.permissionMode || 'always-allow';
		const deviceId = state?.deviceId || null;
		const serviceControl = controlFor?.(localServiceAction, 'service');
		const pairingControl = summary?.pairingStatus !== 'paired' ? controlFor?.('begin-pairing', 'pairing') : null;
		const nodeBlockedMessage =
			(!serviceControl?.policy.allowed && serviceControl?.policy.message) ||
			(!pairingControl?.policy.allowed && pairingControl?.policy.message) ||
			null;

		React.useEffect(() => {
			const clampToViewport = () => {
				setDrawerWidth((current) => clampDeviceDrawerWidth(current, window.innerWidth));
			};

			clampToViewport();
			window.addEventListener('resize', clampToViewport);
			return () => window.removeEventListener('resize', clampToViewport);
		}, []);

		React.useEffect(() => {
			if (!deviceId) return;
			const savedWidth = readDeviceDrawerPreferences(deviceId).drawerWidth;
			setDrawerWidth(clampDeviceDrawerWidth(savedWidth ?? DEVICE_DRAWER_DEFAULT_WIDTH, window.innerWidth));
		}, [deviceId]);

		React.useEffect(() => {
			if (!resizing) return;
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;
			document.body.style.cursor = 'ew-resize';
			document.body.style.userSelect = 'none';

			return () => {
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
			};
		}, [resizing]);

		const persistDrawerWidth = React.useCallback(
			(nextWidth: number) => {
				if (deviceId) setDeviceDrawerWidthPreference(deviceId, nextWidth);
			},
			[deviceId]
		);

		const applyResize = React.useCallback(
			(clientX: number) => {
				const origin = resizeOrigin.current;
				if (!origin) return;
				setDrawerWidth(() => {
					const nextWidth = clampDeviceDrawerWidth(origin.width + origin.x - clientX, window.innerWidth);
					persistDrawerWidth(nextWidth);
					return nextWidth;
				});
			},
			[persistDrawerWidth]
		);

		const finishResize = React.useCallback((event?: { pointerId?: number }) => {
			if (event?.pointerId != null) {
				if (resizeOrigin.current?.pointerId !== event.pointerId) return;
			}
			resizeOrigin.current = null;
			setResizing(false);
		}, []);

		const beginResize = React.useCallback(
			(event: React.PointerEvent<HTMLElement>) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				resizeOrigin.current = { pointerId: event.pointerId, width: drawerWidth, x: event.clientX };
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {
					// Window listeners below keep the resize alive when capture is unavailable.
				}
				setResizing(true);
			},
			[drawerWidth]
		);

		React.useEffect(() => {
			const onPointerMove = (event: PointerEvent) => {
				if (resizeOrigin.current?.pointerId !== event.pointerId) return;
				event.preventDefault();
				applyResize(event.clientX);
			};
			const onPointerEnd = (event: PointerEvent) => {
				finishResize(event);
			};
			window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
			window.addEventListener('pointerup', onPointerEnd, true);
			window.addEventListener('pointercancel', onPointerEnd, true);
			return () => {
				window.removeEventListener('pointermove', onPointerMove, true);
				window.removeEventListener('pointerup', onPointerEnd, true);
				window.removeEventListener('pointercancel', onPointerEnd, true);
			};
		}, [applyResize, finishResize]);

		const resizeWithKeyboard = React.useCallback(
			(event: React.KeyboardEvent<HTMLElement>) => {
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
				event.preventDefault();
				setDrawerWidth((current) => {
					if (event.key === 'Home') {
						const nextWidth = clampDeviceDrawerWidth(DEVICE_DRAWER_DEFAULT_WIDTH, window.innerWidth);
						persistDrawerWidth(nextWidth);
						return nextWidth;
					}
					const delta = event.key === 'ArrowLeft' ? DEVICE_DRAWER_KEYBOARD_STEP : -DEVICE_DRAWER_KEYBOARD_STEP;
					const nextWidth = clampDeviceDrawerWidth(current + delta, window.innerWidth);
					persistDrawerWidth(nextWidth);
					return nextWidth;
				});
			},
			[persistDrawerWidth]
		);

		return (
			<Drawer isOpen={isOpen} onClose={onClose} placement="right" size="full">
				<DrawerOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
				<DrawerContent
					background="var(--tt-card, #ffffff)"
					color="var(--tt-ink, #17171c)"
					containerProps={{ zIndex: DRAWER_MODAL_Z }}
					cursor={resizing ? 'ew-resize' : undefined}
					marginLeft="auto"
					maxWidth="100vw"
					minWidth={0}
					pointerEvents="auto"
					sx={{
						WebkitAppRegion: 'no-drag',
						width: `${drawerWidth}px !important`
					}}
					width={`${drawerWidth}px`}
				>
					<Box
						aria-label="Resize device details panel"
						aria-orientation="vertical"
						aria-valuemax={DEVICE_DRAWER_MAX_WIDTH}
						aria-valuemin={DEVICE_DRAWER_MOBILE_MIN_WIDTH}
						aria-valuenow={drawerWidth}
						bottom={0}
						cursor="ew-resize"
						display="block"
						left={0}
						onDoubleClick={() => {
							const nextWidth = clampDeviceDrawerWidth(DEVICE_DRAWER_DEFAULT_WIDTH, window.innerWidth);
							setDrawerWidth(nextWidth);
							persistDrawerWidth(nextWidth);
						}}
						onKeyDown={resizeWithKeyboard}
						onPointerDown={beginResize}
						position="absolute"
						role="separator"
						tabIndex={0}
						top={0}
						title="Drag this edge to resize device details"
						width={6}
						zIndex={3}
						sx={{ WebkitAppRegion: 'no-drag', touchAction: 'none' }}
						_before={{
							background: resizing ? 'var(--tt-accent, #ec4899)' : 'var(--tt-border-strong, #d4d4d8)',
							borderRadius: '999px',
							bottom: 0,
							content: '""',
							left: 0,
							opacity: resizing ? 1 : 0,
							position: 'absolute',
							top: 0,
							transition: 'background 120ms ease, opacity 120ms ease',
							width: '2px'
						}}
						_hover={{ _before: { opacity: 1 } }}
						_focusVisible={{ boxShadow: 'inset 0 0 0 2px var(--tt-accent, #ec4899)', _before: { opacity: 1 } }}
					/>
					<DrawerCloseButton
						aria-label="Close device details"
						height={11}
						marginTop={{ base: 'env(safe-area-inset-top)', md: 0 }}
						pointerEvents="auto"
						right={{ base: 2, md: 3 }}
						sx={{ WebkitAppRegion: 'no-drag' }}
						top={{ base: 2, md: 2 }}
						width={11}
						zIndex={4}
					/>
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

								<Section deviceId={state.deviceId} key={`observed-state:${state.deviceId}`} label="Quick controls" section="observed-state">
									<DeviceStateGrid
										commands={state.commands}
										controlFor={controlFor}
										deviceId={state.deviceId}
										now={now}
										onAction={onAction}
										snapshot={snapshot}
									/>
								</Section>

								<Section advanced deviceId={state.deviceId} key={`audio:${state.deviceId}`} label="Audio & routing" section="audio">
									<DeviceAudioControls
										controlFor={controlFor}
										deviceId={state.deviceId}
										devices={snapshot?.observed.audioDevices || []}
										inputMuted={snapshot?.observed.inputMuted ?? null}
										inputVolume={snapshot?.observed.inputVolume ?? null}
										onAction={onAction}
										soundEffectsMuted={snapshot?.observed.soundEffectsMuted ?? null}
										soundEffectsVolume={snapshot?.observed.soundEffectsVolume ?? null}
									/>
								</Section>

								<Section advanced deviceId={state.deviceId} key={`network:${state.deviceId}`} label="Network & connectivity" section="network">
									<DeviceNetworkControls controlFor={controlFor} deviceId={state.deviceId} onAction={onAction} wifi={snapshot?.observed.wifi || null} />
								</Section>

								<Section advanced deviceId={state.deviceId} key={`system-controls:${state.deviceId}`} label="Displays & system hardware" section="system-controls">
									<DeviceSystemControls
										appleMusic={snapshot?.observed.appleMusic}
										chromeYouTube={snapshot?.observed.chromeYouTube}
										powerTimers={snapshot?.observed.powerTimers}
										spotify={snapshot?.observed.spotify}
										battery={snapshot?.observed.battery || null}
										bluetoothDevices={snapshot?.observed.bluetoothDevices || []}
										cameras={snapshot?.observed.cameras || []}
										controlFor={controlFor}
										deviceId={state.deviceId}
										displays={snapshot?.observed.displays || []}
										onAction={onAction}
										printers={snapshot?.observed.printers || []}
										vpnServices={snapshot?.observed.vpnServices || []}
									/>
								</Section>

								<Section
									deviceId={state.deviceId}
									key={`applications:${state.deviceId}`}
									count={snapshot?.observed.runningApps.length || 0}
									label="Applications"
									section="applications"
								>
									<DeviceApplications
										activeAppBundleId={snapshot?.observed.activeAppBundleId}
										applications={snapshot?.observed.runningApps || []}
										controlFor={controlFor}
										deviceId={state.deviceId}
										locked={snapshot?.observed.locked}
										onAction={onAction}
									/>
								</Section>

								<Section advanced deviceId={state.deviceId} key={`node:${state.deviceId}`} label="Node & pairing" section="node">
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

								<Section advanced deviceId={state.deviceId} key={`permissions:${state.deviceId}`} label="Action permissions" section="permissions">
									<Box
										background="var(--tt-surface-alt, #f7f7f8)"
										border="1px solid var(--tt-border, #ececef)"
										borderRadius="var(--tt-radius-md, 12px)"
										padding={3}
									>
										<Flex alignItems="center" gap={1.5} wrap="wrap">
											<Text fontSize="12px" fontWeight={700}>
												This account on this computer
											</Text>
											<DeviceStatusPill
												label={permissionOptions.find((option) => option.mode === permissionMode)?.label || 'Always allow'}
												tone={permissionMode === 'deny' ? 'negative' : permissionMode === 'ask-every-time' ? 'warning' : 'positive'}
											/>
										</Flex>
										<Text color="var(--tt-muted, #71717a)" fontSize="11px" lineHeight="1.45" marginTop={1}>
											Always allow is the default. Pairing, device capability, locked-session and macOS privacy checks still apply.
										</Text>
										<Flex gap={1.5} marginTop={3} wrap="wrap">
											{permissionOptions.map((option) => {
												const selected = option.mode === permissionMode;
												return (
													<Box
														aria-pressed={selected}
														as="button"
														background={
															selected
																? option.mode === 'always-allow'
																	? 'rgba(22, 163, 74, 0.13)'
																	: option.mode === 'deny'
																	? 'rgba(220, 38, 38, 0.1)'
																	: 'rgba(217, 119, 6, 0.12)'
																: 'var(--tt-card, #fff)'
														}
														border="1px solid"
														borderColor={
															selected
																? option.mode === 'always-allow'
																	? 'rgba(22, 163, 74, 0.38)'
																	: option.mode === 'deny'
																	? 'rgba(220, 38, 38, 0.3)'
																	: 'rgba(217, 119, 6, 0.34)'
																: 'var(--tt-border, #ececef)'
														}
														borderRadius="10px"
														color={
															selected
																? option.mode === 'always-allow'
																	? 'var(--tt-success, #15803d)'
																	: option.mode === 'deny'
																	? 'var(--tt-danger, #dc2626)'
																	: 'var(--tt-warning, #b45309)'
																: 'var(--tt-ink, #17171c)'
														}
														disabled={!onPermissionModeChange}
														fontSize="11px"
														key={option.mode}
														onClick={() => void onPermissionModeChange?.(state.deviceId, option.mode)}
														paddingX={2.5}
														paddingY={2}
														sx={{ WebkitAppRegion: 'no-drag' }}
														title={option.detail}
														type="button"
														_hover={{ borderColor: selected ? undefined : 'var(--tt-border-strong, #d4d4d8)' }}
														_focusVisible={{ boxShadow: '0 0 0 2px var(--tt-accent, #ec4899)' }}
													>
														{option.label}
													</Box>
												);
											})}
										</Flex>
									</Box>
								</Section>

								<Section advanced deviceId={state.deviceId} key={`power:${state.deviceId}`} label="Power" section="power">
									<DevicePowerControls controlFor={controlFor} deviceId={state.deviceId} onAction={onAction} />
								</Section>

								<Section
									deviceId={state.deviceId}
									key={`connectors:${state.deviceId}`}
									count={snapshot?.connectors.length || 0}
									advanced
									label="Connectors"
									section="connectors"
								>
									<DeviceConnectors
										connectors={snapshot?.connectors || []}
										controlFor={controlFor}
										deviceId={state.deviceId}
										now={now}
										onAction={onAction}
									/>
								</Section>

								<Section advanced deviceId={state.deviceId} key={`screen:${state.deviceId}`} label="Screen" section="screen">
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

								<Section advanced deviceId={state.deviceId} key={`approvals:${state.deviceId}`} count={pendingApprovals} label="Approvals" section="approvals">
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

								<Section
									advanced
									deviceId={state.deviceId}
									key={`command-activity:${state.deviceId}`}
									count={pendingCommands}
									label="Command activity"
									section="command-activity"
								>
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
