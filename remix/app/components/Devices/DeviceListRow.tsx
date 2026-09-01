import React, { memo } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { ChevronRight, Laptop, Lock } from 'lucide-react';

import type { DeviceSnapshot, DeviceSummary } from './deviceTypes';
import { DeviceHealthBadges, DeviceStatusPill, formatDeviceLastSeen } from './DeviceCard';

export type DeviceListRowProps = {
	device: DeviceSummary;
	snapshot?: DeviceSnapshot | null;
	selected?: boolean;
	pendingCommandCount?: number;
	pendingApprovalCount?: number;
	now?: number;
	onSelect: (deviceId: string) => void;
};

export const DeviceListRow = memo(
	({ device, snapshot = null, selected = false, pendingCommandCount = 0, pendingApprovalCount = 0, now, onSelect }: DeviceListRowProps) => (
		<Flex
			_focusVisible={{ boxShadow: 'inset 0 0 0 2px var(--tt-accent, #f472b6)' }}
			_hover={{ background: 'var(--tt-surface-hover, #f7f7f8)' }}
			alignItems="center"
			aria-label={`Open ${device.name}`}
			aria-pressed={selected}
			as="button"
			background={selected ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))' : 'transparent'}
			borderBottom="1px solid var(--tt-border, #ececef)"
			color="var(--tt-ink, #17171c)"
			gap={3}
			minHeight="66px"
			minWidth={0}
			onClick={() => onSelect(device.id)}
			paddingX={{ base: 3, md: 4 }}
			paddingY={2.5}
			textAlign="left"
			transition="background 120ms ease"
			type="button"
			width="100%"
		>
			<Flex
				alignItems="center"
				background="var(--tt-surface-alt, #f2f2f5)"
				borderRadius="10px"
				color="var(--tt-muted, #71717a)"
				flexShrink={0}
				height="36px"
				justifyContent="center"
				width="36px"
			>
				<Laptop aria-hidden size={18} />
			</Flex>

			<Box flex="1" minWidth={0}>
				<Flex alignItems="center" gap={2} minWidth={0}>
					<Text flex="0 1 auto" fontSize="13px" fontWeight={700} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
						{device.name}
					</Text>
					{snapshot?.observed.locked ? <Lock aria-label="Locked" color="var(--tt-warning, #b45309)" size={12} /> : null}
					{pendingApprovalCount > 0 ? <DeviceStatusPill label={`${pendingApprovalCount} approval`} tone="warning" /> : null}
				</Flex>
				<Flex alignItems="center" gap={2} marginTop={1} minWidth={0} wrap="wrap">
					<DeviceHealthBadges now={now} summary={device} />
					<Text color="var(--tt-muted, #71717a)" fontSize="10px" title={device.lastSeenAt || undefined}>
						{formatDeviceLastSeen(device.lastSeenAt, now)}
					</Text>
					{pendingCommandCount > 0 ? (
						<Text color="var(--tt-accent, #db2777)" fontSize="10px" fontWeight={700}>
							{pendingCommandCount} queued
						</Text>
					) : null}
				</Flex>
			</Box>

			<ChevronRight aria-hidden color="var(--tt-faint, #a1a1aa)" size={17} />
		</Flex>
	)
);
DeviceListRow.displayName = 'DeviceListRow';
