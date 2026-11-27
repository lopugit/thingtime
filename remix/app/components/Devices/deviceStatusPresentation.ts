import { deriveDevicePresence } from './deviceCore';
import type { DeviceSummary } from './deviceTypes';

export type DeviceStatusTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'accent';
export type DeviceStatusPresentation = { label: string; tone: DeviceStatusTone };

// Display contact time only. Pairing, resource observations and errors are not heartbeats.
export function deviceLastSeenLabel(lastSeenAt: string | null | undefined, now = Date.now()): string {
	const seenAt = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
	if (!Number.isFinite(seenAt) || !Number.isFinite(now) || seenAt > now + 60_000) return 'Last seen unknown';
	let seconds = Math.floor(Math.max(0, now - seenAt) / 1000);
	if (seconds < 10) return 'Last seen just now';
	const units = [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const;
	const parts: string[] = [];
	for (const [size, suffix] of units) {
		const value = Math.floor(seconds / size);
		seconds %= size;
		if (value) parts.push(`${value}${suffix}`);
		if (parts.length === 2) break;
	}
	return `Last seen ${parts.join(' ')} ago`;
}

export function resolvedDevicePresence(summary: Pick<DeviceSummary, 'lastSeenAt' | 'transportStatus'>, now = Date.now()) {
	const presence = deriveDevicePresence(summary.lastSeenAt, now);
	if (summary.transportStatus === 'offline') return 'offline';
	if (summary.transportStatus === 'connecting' || summary.transportStatus === 'backoff') return presence === 'offline' ? 'offline' : 'stale';
	return presence;
}

export function deviceServicePresentation(status: string, lastSeenAt?: string | null, now = Date.now()): DeviceStatusPresentation {
	if (status === 'degraded') return { label: deviceLastSeenLabel(lastSeenAt, now), tone: 'neutral' };
	return { label: status, tone: status === 'running' ? 'positive' : status === 'version-mismatch' ? 'negative' : ['starting', 'needs-approval'].includes(status) ? 'warning' : 'neutral' };
}

export function deviceHealthPresentation(summary: DeviceSummary, now = Date.now()): DeviceStatusPresentation[] {
	const presence = resolvedDevicePresence(summary, now);
	const lastSeen = deviceLastSeenLabel(summary.lastSeenAt, now);
	const live = presence === 'online' && summary.serviceStatus !== 'degraded' && lastSeen !== 'Last seen unknown';
	const items: DeviceStatusPresentation[] = [{ label: live ? 'online' : lastSeen, tone: live ? 'positive' : 'neutral' }];
	if (!['running', 'degraded'].includes(summary.serviceStatus)) items.push(deviceServicePresentation(summary.serviceStatus, summary.lastSeenAt, now));
	if (summary.pairingStatus !== 'paired') items.push({ label: summary.pairingStatus, tone: summary.pairingStatus === 'revoked' ? 'negative' : 'warning' });
	return items;
}

export function deviceConnectorPresentation(status: string, lastSeenAt?: string | null, now = Date.now()): DeviceStatusPresentation {
	if (status === 'degraded') return { label: deviceLastSeenLabel(lastSeenAt, now), tone: 'neutral' };
	return { label: status, tone: status === 'ready' ? 'positive' : status === 'error' ? 'negative' : ['connecting', 'update-required'].includes(status) ? 'warning' : 'neutral' };
}
