import { activityEvents } from '~/activity/activityManager';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { MobileFolderAccess } from './MobileFolderAccess';
import { getNativeBridge, nativeBridgeReadyEvent } from '~/utils/nativeBridge';
import { requestMobileDevice, supportsMobileDevice, type MobileDeviceStatus } from './mobileDeviceBridge';
import { deviceThingsPageHref } from './deviceNavigation';
import { rootIdentity } from '~/utils/rootIdentity';

import { mobileDeviceScope, readMobileDeviceObservation, observeMobileDevice, publishMobileDeviceObservation } from './mobileDeviceObservations';

export const LOCAL_MOBILE_SYNC_ID = 'local-mobile-sync';
export function MobileDeviceSetupCard({ ownerId, onPaired, syncAnchor = false }: { ownerId: string; onPaired?: () => unknown; syncAnchor?: boolean }) {
	const identity = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const [available, setAvailable] = useState(() => supportsMobileDevice());
	useEffect(() => {
		const ready = () => setAvailable(supportsMobileDevice());
		activityEvents(window, 'events:components/Devices/MobileDeviceSetupCard', 'MobileDeviceSetupCard').addEventListener(nativeBridgeReadyEvent, ready);
		return () => activityEvents(window, 'events:components/Devices/MobileDeviceSetupCard', 'MobileDeviceSetupCard').removeEventListener(nativeBridgeReadyEvent, ready);
	}, []);
	if (!available || identity.pending) return null;
	const scope = mobileDeviceScope(window.location.origin, ownerId, identity.generation);
	return <MobileDeviceConnection key={scope} ownerId={ownerId} onPaired={onPaired} scope={scope} generation={identity.generation} syncAnchor={syncAnchor} />;
}

function MobileDeviceConnection({ ownerId, onPaired, scope, generation, syncAnchor }: { ownerId: string; onPaired?: () => unknown; scope: string; generation: number; syncAnchor: boolean }) {
	const [status, setStatus] = useState<MobileDeviceStatus | null>(() => readMobileDeviceObservation(scope) ?? null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => observeMobileDevice(scope, next => { setStatus(next); setError(''); }), [scope]);
	const pending = useRef<{ controller: AbortController; action: 'status' | 'pair'; woke: boolean } | null>(null);
	const paired = useRef(onPaired); paired.current = onPaired;
	const run = useCallback(async (action: 'status' | 'pair', foregroundWake = false) => {
		const existing = pending.current;
		if (existing && !existing.controller.signal.aborted) {
			if (action === 'status' && existing.action === 'status' && foregroundWake) existing.woke = true;
			return;
		}
		const controller = new AbortController(), bridge = getNativeBridge(), origin = window.location.origin;
		const request = { controller, action, woke: false };
		pending.current = request;
		const current = () => !controller.signal.aborted && !rootIdentity.read().pending && rootIdentity.read().generation === generation &&
			window.location.origin === origin && getNativeBridge() === bridge;
		setBusy(true); setError('');
		try {
			let next: MobileDeviceStatus;
			try { next = await requestMobileDevice(ownerId, action, controller.signal); }
			catch (cause) {
				// A native cancellation can arrive after the browser has already
				// reported focus. Recheck status once; never replay an explicit pair.
				if (action !== 'status' || !request.woke || !current() || document.visibilityState !== 'visible' ||
					!(cause instanceof Error) || cause.message !== 'Device connection paused. Retry when the app is active.') throw cause;
				next = await requestMobileDevice(ownerId, 'status', controller.signal);
			}
			if (!current()) return;
			publishMobileDeviceObservation(scope, next);
			setStatus(next);
			if (action === 'pair' && next.state === 'paired') void paired.current?.();
		} catch (cause) {
			if (current()) setError(cause instanceof Error ? cause.message : 'Device connection unavailable. Try again.');
		} finally {
			if (pending.current === request) { pending.current = null; if (current()) setBusy(false); }
		}
	}, [ownerId, scope, generation]);
	useEffect(() => {
		const refresh = (event?: Event) => {
            if (document.visibilityState === 'visible') return run('status', !!event);
            else { pending.current?.controller.abort(); pending.current = null; setBusy(false); }
        };
		refresh();
		// The root shell owns recurring presence across every route.
		activityEvents(window, 'events:components/Devices/MobileDeviceSetupCard', 'MobileDeviceSetupCard').addEventListener('focus', refresh); activityEvents(document, 'events:components/Devices/MobileDeviceSetupCard', 'MobileDeviceSetupCard').addEventListener('visibilitychange', refresh);
		return () => { activityEvents(window, 'events:components/Devices/MobileDeviceSetupCard', 'MobileDeviceSetupCard').removeEventListener('focus', refresh); activityEvents(document, 'events:components/Devices/MobileDeviceSetupCard', 'MobileDeviceSetupCard').removeEventListener('visibilitychange', refresh); pending.current?.controller.abort(); };
	}, [run]);
	const isPaired = status?.state === 'paired';
	return (
		<Box border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-lg, 16px)" background="var(--tt-card, #fff)" padding={4}>
			<Flex align="center" justify="space-between" gap={3} wrap="wrap">
				<Box flex="1" minWidth="180px">
					<Text fontSize="14px" fontWeight={800}>{isPaired ? 'This device is paired to your account' : 'Add this device to Things'}</Text>
					<Text fontSize="12px" color="var(--tt-muted, #71717a)" marginTop={1}>
						{getNativeBridge()?.platform === 'ios' ? 'iPhone and iPad' : 'Android'} · {isPaired ? 'Pairing is saved securely on this device.' : 'Connect this app to your current Thingtime account.'}
					</Text>
					<Text fontSize="12px" color="var(--tt-muted, #71717a)" marginTop={1}>File and photo access remain off until you select what to sync.</Text>
				</Box>
				<Flex gap={2} wrap="wrap">
					{isPaired ? <Button as={Link} to={deviceThingsPageHref(status.deviceId!)} size="sm" variant="outline">View device</Button> : null}
					<Button size="sm" isDisabled={busy} onClick={() => void run(isPaired ? 'status' : 'pair')}>
						{busy ? 'Connecting…' : isPaired ? 'Check connection' : status?.state === 'pending' ? 'Resume pairing' : status?.state === 'revoked' ? 'Reconnect device' : 'Add this device'}
					</Button>
				</Flex>
			</Flex>
			{error ? <Text role="alert" color="orange.600" fontSize="12px" marginTop={2}>{error}</Text> : null}
            {isPaired ? <Box id={syncAnchor ? LOCAL_MOBILE_SYNC_ID : undefined} tabIndex={syncAnchor ? -1 : undefined} scrollMarginTop="calc(var(--tt-nav-clearance, 54px) + 16px)"><MobileFolderAccess ownerId={ownerId} deviceId={status!.deviceId!} /></Box> : null}
		</Box>
	);
}
