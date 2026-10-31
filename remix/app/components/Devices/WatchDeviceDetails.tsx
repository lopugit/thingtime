import React, { memo } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { Battery, BatteryLow, CircleAlert, Cloud, History } from 'lucide-react';

import { DeviceStatusPill, formatDeviceLastSeen } from './DeviceCard';
import type { DeviceSummary } from './deviceTypes';

const percentage = (value: number | null | undefined): string => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not reported';
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
};

const timestamp = (value: string | null | undefined): string => {
	if (!value) return 'Not yet';
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown';
};

const Metric = ({ label, value }: { label: string; value: string }) => (
	<Box background="var(--tt-card, #fff)" border="1px solid var(--tt-border, #ececef)" borderRadius="10px" minWidth={0} padding={3}>
		<Text color="var(--tt-muted, #71717a)" fontSize="10px" fontWeight={700} textTransform="uppercase">
			{label}
		</Text>
		<Text fontSize="13px" fontWeight={700} marginTop={1} overflow="hidden" textOverflow="ellipsis">
			{value}
		</Text>
	</Box>
);

export const WatchDeviceDetails = memo(({ summary, now = Date.now() }: { summary: DeviceSummary; now?: number }) => {
	const health = summary.watchHealth;
	const things = summary.recentThings || [];
	const syncTone = summary.syncStatus === 'healthy' ? 'positive' : summary.syncStatus === 'error' ? 'negative' : 'warning';

	return (
		<Box>
			<Flex alignItems="center" gap={2} marginBottom={2} marginTop={1}>
				<Cloud aria-hidden size={15} />
				<Text as="h3" fontSize="12px" fontWeight={800}>
					Direct sync & health
				</Text>
				<DeviceStatusPill label={summary.syncStatus || 'paired'} tone={syncTone} />
			</Flex>
			<Text color="var(--tt-muted, #71717a)" fontSize="11px" lineHeight="1.45">
				This Watch connects directly to Thingtime. Its latest successful API contact was {formatDeviceLastSeen(summary.lastSeenAt, now).toLowerCase()}.
			</Text>
			<Box display="grid" gap={2} gridTemplateColumns="repeat(2, minmax(0, 1fr))" marginTop={3}>
				<Metric label="Last sync" value={timestamp(summary.lastSyncAt)} />
				<Metric label="Battery" value={percentage(health?.batteryLevel)} />
				<Metric label="Low power" value={health?.lowPowerMode ? 'On' : 'Off'} />
				<Metric label="Things created" value={String(summary.createdThingCount || 0)} />
			</Box>
			{health?.error ? (
				<Flex alignItems="flex-start" background="rgba(220, 38, 38, 0.07)" border="1px solid rgba(220, 38, 38, 0.24)" borderRadius="10px" color="var(--tt-danger, #dc2626)" fontSize="11px" gap={2} marginTop={3} padding={3}>
					<CircleAlert aria-hidden size={14} />
					<Text>{health.error}</Text>
				</Flex>
			) : null}

			<Flex alignItems="center" gap={2} marginBottom={2} marginTop={6}>
				<History aria-hidden size={15} />
				<Text as="h3" fontSize="12px" fontWeight={800}>
					Things from this Watch
				</Text>
				<DeviceStatusPill label={String(summary.createdThingCount || 0)} />
			</Flex>
			{things.length ? (
				<Flex direction="column" gap={2}>
					{things.map((thing) => (
						<Box
							_hover={{ borderColor: 'var(--tt-border-strong, #d4d4d8)', background: 'var(--tt-surface-hover, #f7f7f8)' }}
							as="a"
							border="1px solid var(--tt-border, #ececef)"
							borderRadius="10px"
							href={`/thing/${encodeURIComponent(thing.id)}`}
							key={thing.id}
							padding={3}
						>
							<Text fontSize="12px" fontWeight={700} noOfLines={2}>
								{thing.label}
							</Text>
							<Text color="var(--tt-muted, #71717a)" fontSize="10px" marginTop={1}>
								{timestamp(thing.createdAt)}
							</Text>
						</Box>
					))}
				</Flex>
			) : (
				<Flex alignItems="center" border="1px dashed var(--tt-border-strong, #d4d4d8)" borderRadius="10px" color="var(--tt-muted, #71717a)" fontSize="11px" gap={2} padding={4}>
					{health?.batteryLevel != null && health.batteryLevel < 0.2 ? <BatteryLow aria-hidden size={15} /> : <Battery aria-hidden size={15} />}
					No Things have been uploaded from this Watch yet.
				</Flex>
			)}
		</Box>
	);
});
WatchDeviceDetails.displayName = 'WatchDeviceDetails';
