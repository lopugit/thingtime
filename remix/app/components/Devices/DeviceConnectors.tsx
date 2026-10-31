import React, { memo } from 'react';

import { Box, Flex, Select, Text } from '@chakra-ui/react';
import { MessageSquarePlus, Plug, TriangleAlert } from 'lucide-react';

import type { DeviceConnector, DeviceConnectorStatus } from './deviceTypes';
import { DeviceStatusPill, formatDeviceLastSeen } from './DeviceCard';
import type { DeviceActionHandler, DeviceControlResolver } from './DeviceStateGrid';
import { DevicePolicyButton } from './DeviceStateGrid';

const connectorTone = (status: DeviceConnectorStatus): 'positive' | 'warning' | 'negative' | 'neutral' => {
	if (status === 'ready') return 'positive';
	if (status === 'connecting' || status === 'degraded' || status === 'update-required') return 'warning';
	if (status === 'error') return 'negative';
	return 'neutral';
};

export type DeviceConnectorsProps = {
	deviceId: string;
	connectors: DeviceConnector[];
	now?: number;
	controlFor?: DeviceControlResolver;
	onAction?: DeviceActionHandler;
};

export const DeviceConnectors = memo(({ deviceId, connectors, now, controlFor, onAction }: DeviceConnectorsProps) => {
	const [selectedProjects, setSelectedProjects] = React.useState<Record<string, string>>({});

	if (!connectors.length) {
		return (
			<Box
				border="1px dashed var(--tt-border-strong, #d4d4d8)"
				borderRadius="var(--tt-radius-md, 12px)"
				color="var(--tt-muted, #71717a)"
				fontSize="12px"
				padding={4}
				textAlign="center"
			>
				No application connectors are installed on this node.
			</Box>
		);
	}

	return (
		<Flex direction="column" gap={2.5}>
			{connectors.map((connector) => {
				const requestedProjectId = selectedProjects[connector.id];
				const selectedProjectId =
					requestedProjectId && connector.projects.some((project) => project.projectId === requestedProjectId)
						? requestedProjectId
						: connector.projects[0]?.projectId || '';
				const projectRequired = connector.id === 'codex-app-server' || connector.kind.toLowerCase().includes('codex');
				const projectUnavailableReason =
					projectRequired && !selectedProjectId ? 'Add a local Codex project from this Mac’s Thingtime Node setup.' : null;
				const visibleCapabilities = connector.capabilities.filter((capability) => capability.supported).slice(0, 5);
				const hiddenCapabilityCount = Math.max(0, connector.capabilities.filter((capability) => capability.supported).length - 5);
				const toggleAction = 'set-connector-enabled';
				const toggleControl = controlFor?.(toggleAction, `${connector.id}:${connector.enabled ? 'disable' : 'enable'}`);
				const createControl = controlFor?.('create-agent-session', `${connector.id}:${selectedProjectId || 'no-project'}`);
				const blockedMessage =
					projectUnavailableReason ||
					(!toggleControl?.policy.allowed && toggleControl?.policy.message) ||
					(!createControl?.policy.allowed && createControl?.policy.message) ||
					null;
				return (
					<Box
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-md, 12px)"
						key={connector.id}
						padding={3}
					>
						<Flex alignItems="flex-start" gap={2.5} minWidth={0}>
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
								<Plug aria-hidden size={16} />
							</Flex>
							<Box flex="1" minWidth={0}>
								<Flex alignItems="center" gap={1.5} minWidth={0} wrap="wrap">
									<Text fontSize="12px" fontWeight={700} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
										{connector.label || connector.kind}
									</Text>
									<DeviceStatusPill label={connector.status} tone={connectorTone(connector.status)} />
								</Flex>
								<Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={0.5}>
									{connector.kind}
									{connector.version ? ` · v${connector.version}` : ''}
									{connector.lastSeenAt ? ` · ${formatDeviceLastSeen(connector.lastSeenAt, now)}` : ''}
								</Text>
							</Box>
						</Flex>

						{visibleCapabilities.length ? (
							<Flex gap={1} marginTop={2.5} wrap="wrap">
								{visibleCapabilities.map((capability) => (
									<DeviceStatusPill
										key={capability.id}
										label={capability.label || capability.id}
										tone={capability.enabled ? 'neutral' : 'warning'}
										title={capability.unavailableReason || capability.id}
									/>
								))}
								{hiddenCapabilityCount ? <DeviceStatusPill label={`+${hiddenCapabilityCount}`} /> : null}
							</Flex>
						) : (
							<Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={2}>
								This connector has no usable capabilities.
							</Text>
						)}

						{connector.lastError ? (
							<Flex alignItems="center" color="var(--tt-danger, #dc2626)" fontSize="10px" gap={1.5} marginTop={2}>
								<TriangleAlert aria-hidden size={12} />
								{connector.lastError.code}
							</Flex>
						) : null}

						{connector.projects.length ? (
							<Box marginTop={3}>
								<Text as="label" color="var(--tt-muted, #71717a)" fontSize="10px" htmlFor={`connector-project-${connector.id}`}>
									Local project
								</Text>
								<Select
									background="var(--tt-card, #ffffff)"
									id={`connector-project-${connector.id}`}
									marginTop={1}
									onChange={(event) =>
										setSelectedProjects((current) => ({ ...current, [connector.id]: event.target.value }))
									}
									size="xs"
									value={selectedProjectId}
								>
									{connector.projects.map((project) => (
										<option key={project.projectId} value={project.projectId}>
											{project.projectLabel}
										</option>
									))}
								</Select>
							</Box>
						) : projectRequired ? (
							<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={2}>
								No local projects are advertised by this connector.
							</Text>
						) : null}

						<Flex alignItems="center" gap={1.5} justifyContent="flex-end" marginTop={3} wrap="wrap">
							<DevicePolicyButton
								action={toggleAction}
								controlFor={controlFor}
								controlKey={`${connector.id}:${connector.enabled ? 'disable' : 'enable'}`}
								deviceId={deviceId}
								input={{ connectorId: connector.id, enabled: !connector.enabled }}
								label={connector.enabled ? 'Disable' : 'Enable'}
								onAction={onAction}
								targetId={connector.id}
								variant="ghost"
							/>
							{connector.enabled ? (
								<DevicePolicyButton
									action="create-agent-session"
									controlFor={controlFor}
									controlKey={`${connector.id}:${selectedProjectId || 'no-project'}`}
									deviceId={deviceId}
									disabledReason={projectUnavailableReason}
									input={{ connectorId: connector.id, ...(selectedProjectId ? { projectId: selectedProjectId } : {}) }}
									label="New chat"
									onAction={onAction}
									targetId={connector.id}
								/>
							) : null}
						</Flex>
						{blockedMessage ? (
							<Text color="var(--tt-muted, #71717a)" fontSize="10px" lineHeight="1.35" marginTop={1.5}>
								{blockedMessage}
							</Text>
						) : null}
					</Box>
				);
			})}
		</Flex>
	);
});
DeviceConnectors.displayName = 'DeviceConnectors';
