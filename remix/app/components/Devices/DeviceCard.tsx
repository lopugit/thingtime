import React, { memo } from 'react';

import { Box, Flex, Text } from '@chakra-ui/react';
import { Laptop, Monitor, Server, Smartphone, Watch as WatchIcon } from 'lucide-react';

import { deriveDevicePresence } from './deviceCore';
import type { DevicePresenceStatus, DeviceSnapshot, DeviceSummary } from './deviceTypes';

type StatusTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'accent';

const STATUS_TONES: Record<StatusTone, { background: string; color: string }> = {
	positive: { background: 'rgba(22, 163, 74, 0.12)', color: 'var(--tt-success, #15803d)' },
	warning: { background: 'rgba(217, 119, 6, 0.13)', color: 'var(--tt-warning, #b45309)' },
	negative: { background: 'rgba(220, 38, 38, 0.11)', color: 'var(--tt-danger, #dc2626)' },
	neutral: { background: 'var(--tt-surface-alt, #f2f2f5)', color: 'var(--tt-muted, #71717a)' },
	accent: { background: 'var(--tt-accent-soft, rgba(244, 114, 182, 0.12))', color: 'var(--tt-accent, #db2777)' }
};

export const DeviceStatusPill = memo(({ label, tone = 'neutral', title }: { label: string; tone?: StatusTone; title?: string }) => (
	<Box
		{...STATUS_TONES[tone]}
		as="span"
		borderRadius="999px"
		fontSize="10px"
		fontWeight={700}
		lineHeight="18px"
		paddingX="7px"
		title={title}
		whiteSpace="nowrap"
	>
		{label}
	</Box>
));
DeviceStatusPill.displayName = 'DeviceStatusPill';

export const resolvedDevicePresence = (summary: DeviceSummary, now = Date.now()): DevicePresenceStatus => {
	const lastSeenPresence = deriveDevicePresence(summary.lastSeenAt, now);
	if (summary.transportStatus === 'offline') return 'offline';
	if (summary.transportStatus === 'connecting' || summary.transportStatus === 'backoff') {
		return lastSeenPresence === 'offline' ? 'offline' : 'stale';
	}
	return lastSeenPresence;
};

export const formatDeviceLastSeen = (lastSeenAt: string | null | undefined, now = Date.now()): string => {
	if (!lastSeenAt) return 'Never seen';
	const seenAt = new Date(lastSeenAt).getTime();
	if (!Number.isFinite(seenAt)) return 'Last seen unknown';
	const elapsed = Math.max(0, now - seenAt);
	if (elapsed < 10_000) return 'Just now';
	if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)}s ago`;
	if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
	if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
	return `${Math.floor(elapsed / 86_400_000)}d ago`;
};

const presenceTone = (presence: DevicePresenceStatus): StatusTone => {
	if (presence === 'online') return 'positive';
	if (presence === 'stale') return 'warning';
	return 'neutral';
};

const serviceTone = (summary: DeviceSummary): StatusTone => {
	if (summary.serviceStatus === 'running') return 'positive';
	if (summary.serviceStatus === 'starting' || summary.serviceStatus === 'needs-approval') return 'warning';
	if (summary.serviceStatus === 'degraded') return 'warning';
	if (summary.serviceStatus === 'version-mismatch') return 'negative';
	return 'neutral';
};

export const DeviceHealthBadges = memo(({ summary, now }: { summary: DeviceSummary; now?: number }) => {
	const presence = resolvedDevicePresence(summary, now);
	return (
		<Flex alignItems="center" gap={1.5} minWidth={0} wrap="wrap">
			<DeviceStatusPill label={presence} tone={presenceTone(presence)} />
			{summary.serviceStatus !== 'running' ? <DeviceStatusPill label={summary.serviceStatus} tone={serviceTone(summary)} /> : null}
			{summary.pairingStatus !== 'paired' ? (
				<DeviceStatusPill label={summary.pairingStatus} tone={summary.pairingStatus === 'revoked' ? 'negative' : 'warning'} />
			) : null}
		</Flex>
	);
});
DeviceHealthBadges.displayName = 'DeviceHealthBadges';

const DevicePlatformIcon = ({ platform }: { platform: string }) => {
	const normalized = platform.toLowerCase();
	if (normalized.includes('watch')) return <WatchIcon aria-hidden size={22} />;
	if (normalized.includes('ios') || normalized.includes('android')) return <Smartphone aria-hidden size={22} />;
	if (normalized.includes('server') || normalized.includes('linux')) return <Server aria-hidden size={22} />;
	if (normalized.includes('desktop') || normalized.includes('windows')) return <Monitor aria-hidden size={22} />;
	return <Laptop aria-hidden size={22} />;
};

export type DeviceCardProps = {
	device: DeviceSummary;
	snapshot?: DeviceSnapshot | null;
	selected?: boolean;
	pendingCommandCount?: number;
	pendingApprovalCount?: number;
	now?: number;
	onSelect: (deviceId: string) => void;
};

export const DeviceCard = memo(
	({ device, snapshot = null, selected = false, pendingCommandCount = 0, pendingApprovalCount = 0, now, onSelect }: DeviceCardProps) => {
		const observed = snapshot?.observed;
		const model = device.system?.model || (device.platform === 'watchos' ? 'Apple Watch' : device.platform) || 'Device';
		const version = device.system?.osVersion || device.nodeVersion || null;

		return (
			<Box
				_focusVisible={{ boxShadow: '0 0 0 3px var(--tt-accent-soft, rgba(244, 114, 182, 0.25))' }}
				_hover={{ borderColor: 'var(--tt-border-strong, #d4d4d8)', transform: 'translateY(-1px)' }}
				aria-label={`Open ${device.name}`}
				aria-pressed={selected}
				as="button"
				background={selected ? 'var(--tt-accent-soft, rgba(244, 114, 182, 0.08))' : 'var(--tt-card, #ffffff)'}
				border="1px solid"
				borderColor={selected ? 'var(--tt-accent, #f472b6)' : 'var(--tt-border, #ececef)'}
				borderRadius="var(--tt-radius-lg, 16px)"
				boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
				color="var(--tt-ink, #17171c)"
				minWidth={0}
				onClick={() => onSelect(device.id)}
				padding={4}
				textAlign="left"
				transition="border-color 120ms ease, transform 120ms ease, background 120ms ease"
				type="button"
				width="100%"
			>
				<Flex alignItems="flex-start" gap={3}>
					<Flex
						alignItems="center"
						background="var(--tt-surface-alt, #f2f2f5)"
						borderRadius="12px"
						color="var(--tt-muted, #71717a)"
						flexShrink={0}
						height="42px"
						justifyContent="center"
						width="42px"
					>
						<DevicePlatformIcon platform={device.platform} />
					</Flex>
					<Box flex="1" minWidth={0}>
						<Text fontSize="14px" fontWeight={700} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
							{device.name}
						</Text>
						<Text color="var(--tt-muted, #71717a)" fontSize="11px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
							{model}
							{version ? ` · ${version}` : ''}
						</Text>
						<Box marginTop={2}>
							<DeviceHealthBadges now={now} summary={device} />
						</Box>
					</Box>
				</Flex>

				<Flex alignItems="center" color="var(--tt-muted, #71717a)" fontSize="11px" gap={2} marginTop={4} wrap="wrap">
					<Text title={device.lastSeenAt || undefined}>{formatDeviceLastSeen(device.lastSeenAt, now)}</Text>
					{observed?.locked ? <DeviceStatusPill label="locked" tone="warning" /> : null}
					{pendingCommandCount > 0 ? <DeviceStatusPill label={`${pendingCommandCount} queued`} tone="accent" /> : null}
					{pendingApprovalCount > 0 ? <DeviceStatusPill label={`${pendingApprovalCount} approval`} tone="warning" /> : null}
				</Flex>
			</Box>
		);
	}
);
DeviceCard.displayName = 'DeviceCard';
