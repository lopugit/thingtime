import React from 'react';
import { Box } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { ComponentDataScope } from '../Builder/ComponentSelect';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { deviceDashboardBlocks } from './deviceDashboardBlocks';
import { deviceResourceMetrics } from './deviceResourceMetrics';
import type { DevicePresenceStatus, DeviceSnapshot } from './deviceTypes';

export const DEVICE_DASHBOARD_CAPABILITIES = { 'api.devices': '1.14.0' } as const;
const accent = (color: string) => `color-mix(in srgb, var(--tt-ink, #17171c) 25%, ${color})`;

export function DeviceDashboard({
	deviceId,
	ownerId,
	snapshot,
	presence,
	now
}: {
	deviceId: string;
	ownerId?: string;
	snapshot: DeviceSnapshot | null;
	presence: DevicePresenceStatus;
	now: number;
}) {
	const plane = useDataPlane();
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	// Device state is read from the current web origin by useDeviceApi.
	const origin = typeof window === 'undefined' ? '' : window.location.origin;
	const layoutScope = JSON.stringify([origin, ownerId, plane, deviceId]);
	const capabilityScope = JSON.stringify([layoutScope, identity.generation]);
	const [supportedScope, setSupportedScope] = React.useState<string | null>(null);
	const verification = React.useRef<{ scope: string; attempts: number; sample?: string; pending: boolean } | null>(null);
	const hasResources = snapshot?.observed.resources !== undefined;
	const sample = hasResources ? snapshot?.observed.observedAt : undefined;
	React.useEffect(() => {
		if (!sample || !origin || !ownerId || !plane || identity.pending || supportedScope === capabilityScope) return;
		const previous = verification.current;
		const attempts = previous?.scope === capabilityScope ? previous.attempts : 0;
		if (attempts >= 2 || (previous?.scope === capabilityScope && previous.sample === sample && !previous.pending)) return;
		const request = { scope: capabilityScope, sample, attempts: attempts + 1, pending: true };
		verification.current = request;
		let active = true;
		void requireThingtimeCapability('api.devices', DEVICE_DASHBOARD_CAPABILITIES['api.devices'], origin).then(
			() => {
				if (active) setSupportedScope(capabilityScope);
			},
			() => {
				if (active) request.pending = false;
			}
		);
		return () => {
			active = false;
			if (request.pending && verification.current === request) verification.current = { scope: capabilityScope, attempts, pending: false };
		};
	}, [capabilityScope, identity.pending, origin, ownerId, plane, sample, supportedScope]);
	const supported = !identity.pending && supportedScope === capabilityScope;
	const metrics = deviceResourceMetrics(supported ? snapshot?.observed.resources : undefined);
	const reportedAt = Date.parse(snapshot?.observed.observedAt || '');
	const stale = presence !== 'online' || now - reportedAt > 120_000;
	const status =
		supported && hasResources && Number.isFinite(reportedAt)
			? `${stale ? 'Last reported' : 'Updated'} · ${new Date(reportedAt).toLocaleString(undefined, {
					timeStyle: 'short',
					...(stale ? { dateStyle: 'medium' } : {})
			  })}`
			: 'Resource readings are unavailable for this device.';
	const dashboard = { ...metrics, status };
	return (
		<Box
			marginBottom={3}
			style={
				{
					'--tt-device-cpu-accent': accent('#c2410c'),
					'--tt-device-ram-accent': accent('#7c3aed'),
					'--tt-device-disk-accent': accent('#0369a1'),
					'--tt-device-network-accent': accent('#0f766e'),
					'--tt-device-network-upload': accent('#7c3aed'),
					'--tt-device-network-remainder': metrics.network.hasTraffic ? 'var(--tt-device-network-upload)' : 'var(--tt-border-strong, #d4d4d8)',
					'--tt-device-cpu-fill': `${metrics.cpu.fill}%`,
					'--tt-device-ram-fill': `${metrics.ram.fill}%`,
					'--tt-device-disk-fill': `${metrics.disk.fill}%`,
					'--tt-device-network-fill': `${metrics.network.fill}%`
				} as React.CSSProperties
			}
		>
			<SettingsDocumentHost documentKey="device-dashboard" defaultDocument={deviceDashboardBlocks} scopeKey={layoutScope} title="Device dashboard">
				{({ blocks, chrome }) => (
					<ComponentDataScope.Provider value={{ dashboard }}>
						<WebpageBlocksRenderer blocks={blocks} chrome={chrome} componentsByRef={{}} />
					</ComponentDataScope.Provider>
				)}
			</SettingsDocumentHost>
		</Box>
	);
}
