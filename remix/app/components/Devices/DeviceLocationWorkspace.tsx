import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { nativeBridgeMessageEvent } from '~/utils/nativeBridge';
import { resolveWebpageClient, type ResolvedWebpage } from '../Builder/useWebpage';
import { ContentExecutionBoundary } from '../Builder/ContentExecutionHold';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { deviceModelArtwork } from './deviceModelArtwork';
import { useDeviceLocateActions } from './useDeviceLocateActions';
import type { MobileLocationAction } from './mobileDeviceLocationBridge';
import { requestDeviceLocationNative, supportsDeviceLocationNative, type DeviceNativeLocationStatus } from './deviceLocationNative.client';
import {
	deviceLocationPoints,
	readDeviceLocations,
	saveDeviceLocationSettings,
	type DeviceLocationPage,
	type DeviceLocationScope
} from './deviceLocation.client';

/** Data/permission adapter only. The map, marker, legend and settings layouts
 * remain private authored Things; this host never seeds a product template. */
export function DeviceLocationWorkspace({
	ownerId,
	deviceId,
	model,
	platform
}: {
	ownerId: string;
	deviceId: string;
	model?: string;
	platform?: string;
}) {
	const user = useCurrentUser(),
		plane = useDataPlane();
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	if (user?.id !== ownerId || user.temporary || user.isCharacter || identity.pending || !plane || typeof window === 'undefined') return null;
	const scope = { ownerId, deviceId, origin: window.location.origin };
	return <LocationSession key={JSON.stringify([scope, plane, identity.generation])} scope={scope} model={model} platform={platform} />;
}
function LocationSession({ scope, model, platform }: { scope: DeviceLocationScope; model?: string; platform?: string }) {
	const scopeKey = JSON.stringify(scope),
		lifetime = React.useRef(new AbortController());
	const stableScope = React.useMemo(
		() => ({ origin: scope.origin, ownerId: scope.ownerId, deviceId: scope.deviceId }),
		[scope.origin, scope.ownerId, scope.deviceId]
	);
	const [page, setPage] = React.useState<DeviceLocationPage | null>(null),
		[composition, setComposition] = React.useState<ResolvedWebpage | null>(null);
	const [error, setError] = React.useState(''),
		[busy, setBusy] = React.useState(false),
		[native, setNative] = React.useState<DeviceNativeLocationStatus | null>(null);
	const [from, setFrom] = React.useState(''),
		[to, setTo] = React.useState(''),
		[cleanupRemaining, setCleanupRemaining] = React.useState(false);
	const running = React.useRef(false),
		filter = React.useRef({ from: '', to: '' });
	const load = async (append = false) => {
		const next = await readDeviceLocations(scope, lifetime.current.signal, {
			...(filter.current.from ? { from: filter.current.from } : {}),
			...(filter.current.to ? { to: filter.current.to } : {}),
			...(append && page?.nextCursor ? { cursor: page.nextCursor } : {})
		});
		lifetime.current.signal.throwIfAborted();
		setPage((previous) =>
			append && previous
				? { ...next, observations: [...new Map([...previous.observations, ...next.observations].map((row) => [row.id, row])).values()] }
				: next
		);
	};
	React.useEffect(() => {
		const controller = new AbortController();
		lifetime.current = controller;
		setBusy(true);
		void Promise.all([readDeviceLocations(stableScope, controller.signal), resolveWebpageClient({ kind: 'path', path: '/devices/location' })])
			.then(
				([next, saved]) => {
					if (!controller.signal.aborted) {
						setPage(next);
						setComposition(saved);
					}
				},
				() => {
					if (!controller.signal.aborted) setError('Could not load location history. Retry to reconnect.');
				}
			)
			.finally(() => {
				if (!controller.signal.aborted) setBusy(false);
			});
		return () => controller.abort();
	}, [stableScope]); // The enclosing keyed scope owns origin, account, plane and device.
	React.useEffect(() => {
		const controller = new AbortController();
		let checking = false;
		const refreshNative = () => {
			if (checking || document.visibilityState !== 'visible' || !supportsDeviceLocationNative()) return;
			checking = true;
			void requestDeviceLocationNative(stableScope, 'status', controller.signal)
				.then((next) => { if (!controller.signal.aborted) setNative(next); })
				.catch(() => { if (!controller.signal.aborted) setNative(null); })
				.finally(() => { checking = false; });
		};
		const changed = (event: Event) => {
			const message = (event as CustomEvent).detail;
			if (message?.type === 'mobile-device-location-changed' && message.payload?.ownerId === stableScope.ownerId && message.payload?.origin === stableScope.origin) refreshNative();
		};
		window.addEventListener(nativeBridgeMessageEvent, changed);
		document.addEventListener('visibilitychange', refreshNative);
		refreshNative();
		return () => { controller.abort(); window.removeEventListener(nativeBridgeMessageEvent, changed); document.removeEventListener('visibilitychange', refreshNative); };
	}, [stableScope]);
	const operation = async (run: () => Promise<void>) => {
		if (running.current) return;
		running.current = true;
		setBusy(true);
		setError('');
		try {
			await run();
		} catch (cause) {
			if (!lifetime.current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Location operation failed.');
		} finally {
			running.current = false;
			if (!lifetime.current.signal.aborted) setBusy(false);
		}
	};
	const nativeAction = async (action: MobileLocationAction | 'request-notification-permission', options: { always?: boolean; collectionId?: string } = {}) => {
		const next = await requestDeviceLocationNative(scope, action, lifetime.current.signal, options);
		lifetime.current.signal.throwIfAborted();
		setNative(next);
	};
	const saveSettings = async (settings: Parameters<typeof saveDeviceLocationSettings>[2]) => {
		const before = page?.settings;
		// Native checkbox activation must reconcile synchronously before React restores
		// its controlled value. Keep other fields and history visible during the write.
		setPage((previous) => (previous ? { ...previous, settings: { ...previous.settings, ...settings } } : previous));
		try {
			const next = await saveDeviceLocationSettings(scope, lifetime.current.signal, settings);
			lifetime.current.signal.throwIfAborted();
			setCleanupRemaining(next.cleanup.hasMore);
			setPage((previous) => (previous ? { ...previous, settings: next.settings } : previous));
			await load();
		} catch (cause) {
			if (!lifetime.current.signal.aborted && before) setPage((previous) => (previous ? { ...previous, settings: before } : previous));
			throw cause;
		}
	};
	const locate = useDeviceLocateActions(scope, () => lifetime.current.signal, operation, setError);
	const actions: TransientBlockActions = {
		...locate.actions,
		refresh: () => operation(() => load()),
		more: () =>
			operation(async () => {
				if (page?.nextCursor) await load(true);
			}),
		filter: ({ readField }) =>
			operation(async () => {
				const parse = (name: string) => {
					const value = readField(name);
					if (!value) return '';
					const at = Date.parse(String(value));
					if (!Number.isFinite(at)) throw new Error('Choose a valid location date.');
					return new Date(at).toISOString();
				};
				const next = { from: parse('from'), to: parse('to') };
				if (next.from && next.to && next.from > next.to) throw new Error('The start date must precede the end date.');
				filter.current = next;
				setFrom(next.from);
				setTo(next.to);
				await load();
			}),
		'set-enabled': ({ value }) => operation(() => saveSettings({ enabled: value === true || value === 'true' })),
		'set-retention': ({ value }) =>
			operation(async () => {
				const retentionMs = value === 'never' || value === '' ? null : Number(value);
				if (retentionMs !== null && (!Number.isSafeInteger(retentionMs) || retentionMs <= 0))
					throw new Error('Retention must be Never or a positive duration in milliseconds.');
				await saveSettings({ retentionMs });
			}),
		'set-retention-days': ({ readField }) => operation(async () => {
			const retentionMs = Math.round(Number(readField('retentionDays')) * 86_400_000);
			if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) throw new Error('Enter a positive number of days.');
			await saveSettings({ retentionMs });
		}),
		'continue-cleanup': () => operation(() => saveSettings({})),
		'native-status': () => operation(() => nativeAction('status')),
		'native-enable': () =>
			operation(async () => {
				if (!page?.settings.enabled || !page.settings.collectionId) throw new Error('Enable location collection in its saved policy first.');
				await nativeAction('enable', { collectionId: page.settings.collectionId });
			}),
		'native-disable': () => operation(() => nativeAction('disable')),
		'request-permission': ({ inputs }) => operation(() => nativeAction('request-permission', { always: inputs.always === true })),
		'open-settings': () => operation(() => nativeAction('open-settings')),
		'request-notification-permission': () => operation(() => nativeAction('request-notification-permission'))
	};
	const artwork = deviceModelArtwork(model, platform);
	const retentionMs = page?.settings.retentionMs ?? null;
	const retentionPreset = retentionMs === null || [1, 7, 30, 90, 365].some((days) => days * 86_400_000 === retentionMs);
	const points = deviceLocationPoints(page?.observations ?? [], page?.latest?.id).map((point) => ({ ...point, artwork }));
	const display = {
		locate: locate.display,
		artwork,
		deviceId: scope.deviceId,
		enabled: page?.settings.enabled ?? false,
		retentionMs,
		retentionValue: retentionMs === null ? 'never' : String(retentionMs),
		customRetention: !retentionPreset,
		retentionDays: retentionMs === null ? '' : String(retentionMs / 86_400_000),
		retentionLabel: retentionMs === null ? 'Never' : `${retentionMs / 86_400_000} days`,
		points,
		latest: page?.latest ?? null,
		observations: page?.observations ?? [],
		latestPoints: deviceLocationPoints(page?.latest ? [page.latest] : [], page?.latest?.id).map((point) => ({ ...point, artwork })),
		hasMore: !!page?.nextCursor,
		from,
		to,
		busy: busy || locate.display.uploadBusy,
		error,
		cleanupRemaining,
		native,
		nativeAvailable: supportsDeviceLocationNative(),
		status: !page
			? 'Location history unavailable'
			: points.length
			? `${points.length} recorded locations`
			: 'No recorded locations',
		compositionAvailable: !!composition?.page
	};
	return (
		<TransientBlockHost
			scopeKey={scopeKey}
			scope={{ location: display }}
			actions={actions}
			enabled={!composition?.page?.executionHeld}
			onError={() => setError('The location control could not run.')}
		>
			<div aria-busy={busy} data-device-location={scope.deviceId}>
				{error && <p role="alert">{error}</p>}
				{composition?.page ? (
					<ContentExecutionBoundary held={composition.page.executionHeld}>
						<WebpageBlocksRenderer blocks={composition.page.crystal.blocks} componentsByRef={composition.componentsByRef} interactive />
					</ContentExecutionBoundary>
				) : (
					busy ? <progress aria-label="Loading location history" style={{ width: 48, height: 3 }} /> : <p role="status">No saved location workspace is available for this account.</p>
				)}
				<SettingsDocumentHost
					documentKey="device-location-settings"
					defaultDocument={[]}
					scopeKey={scopeKey}
					title="Location settings"
					allowMediaUploads
				>
					{({ blocks, chrome, editing }) => (
						<TransientBlockHost
							scopeKey={scopeKey + ':settings'}
							scope={{ location: display }}
							actions={actions}
							enabled={!editing && !composition?.page?.executionHeld}
							onError={() => setError('The location setting could not be changed.')}
						>
							<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
						</TransientBlockHost>
					)}
				</SettingsDocumentHost>
			</div>
		</TransientBlockHost>
	);
}
