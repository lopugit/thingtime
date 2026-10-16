import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { MobileFolderAccess } from './MobileFolderAccess';
import { getNativeBridge, nativeBridgeReadyEvent } from '~/utils/nativeBridge';
import { requestMobileDevice, supportsMobileDevice, type MobileDeviceStatus } from './mobileDeviceBridge';

const observations = new Map<string, MobileDeviceStatus>();

export function MobileDeviceSetupCard({ ownerId, onPaired }: { ownerId: string; onPaired?: () => unknown }) {
	const [available, setAvailable] = useState(() => supportsMobileDevice());
	useEffect(() => {
		const ready = () => setAvailable(supportsMobileDevice());
		window.addEventListener(nativeBridgeReadyEvent, ready);
		return () => window.removeEventListener(nativeBridgeReadyEvent, ready);
	}, []);
	if (!available) return null;
	return <MobileDeviceConnection key={`${window.location.origin}:${ownerId}`} ownerId={ownerId} onPaired={onPaired} />;
}

function MobileDeviceConnection({ ownerId, onPaired }: { ownerId: string; onPaired?: () => unknown }) {
	const scope = `${window.location.origin}:${ownerId}`;
	const [status, setStatus] = useState<MobileDeviceStatus | null>(() => observations.get(scope) ?? null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const pending = useRef<AbortController | null>(null);
	const paired = useRef(onPaired); paired.current = onPaired;
	const run = useCallback(async (action: 'status' | 'pair') => {
		if (pending.current && !pending.current.signal.aborted) return;
		const controller = new AbortController(); pending.current = controller;
		setBusy(true); setError('');
		try {
			const next = await requestMobileDevice(ownerId, action, controller.signal);
			if (controller.signal.aborted) return;
			observations.set(scope, next);
			if (observations.size > 32) observations.delete(observations.keys().next().value!);
			setStatus(next);
			if (action === 'pair' && next.state === 'paired') void paired.current?.();
		} catch (cause) {
			if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Device connection unavailable. Try again.');
		} finally {
			if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
		}
	}, [ownerId, scope]);
	useEffect(() => {
		const refresh = () => {
            if (document.visibilityState === 'visible') void run('status');
            else { pending.current?.abort(); pending.current = null; setBusy(false); }
        };
		refresh();
		const interval = window.setInterval(refresh, 30_000);
		window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
		return () => { clearInterval(interval); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); pending.current?.abort(); };
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
					{isPaired ? <Button as={Link} to={`/things?device=${encodeURIComponent(status.deviceId!)}`} size="sm" variant="outline">View device</Button> : null}
					<Button size="sm" isDisabled={busy} onClick={() => void run(isPaired ? 'status' : 'pair')}>
						{busy ? 'Connecting…' : isPaired ? 'Check connection' : status?.state === 'pending' ? 'Resume pairing' : status?.state === 'revoked' ? 'Reconnect device' : 'Add this device'}
					</Button>
				</Flex>
			</Flex>
			{error ? <Text role="alert" color="orange.600" fontSize="12px" marginTop={2}>{error}</Text> : null}
            {isPaired ? <MobileFolderAccess ownerId={ownerId} /> : null}
		</Box>
	);
}
