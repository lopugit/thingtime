import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { PermissionRecoveryControls } from '~/components/Devices/PermissionRecoveryControls';
import { getElectronBridge, type ThingtimeNodeStatus } from '~/utils/electronBridge';

export function DesktopNodeControls({ active }: { active: boolean }) {
	const [status, setStatus] = React.useState<ThingtimeNodeStatus | null>(null);
	const [busy, setBusy] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const operation = React.useRef(false);
	const generation = React.useRef(0);
	const bridge = getElectronBridge();

	React.useEffect(() => {
		if (!active || !bridge?.nodeGetStatus || !bridge.nodeControl) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				if (!operation.current) {
					const current = generation.current;
					const next = await bridge.nodeGetStatus!();
					if (!cancelled && !operation.current && current === generation.current) { setStatus(next); setError(null); }
				}
			} catch {
				if (!cancelled) setError('Could not read node status.');
			} finally {
				if (!cancelled) timer = setTimeout(refresh, 5000);
			}
		};
		void refresh();
		return () => { cancelled = true; clearTimeout(timer); };
	}, [active, bridge]);

	if (!bridge?.nodeControl) return null;
	const control = async (action: 'start' | 'stop' | 'restart') => {
		if (operation.current) return;
		operation.current = true;
		generation.current += 1;
		setBusy(action);
		setError(null);
		try {
			setStatus(await bridge.nodeControl!({ action }));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'The node could not complete this action.');
		} finally {
			operation.current = false;
			setBusy(null);
		}
	};
	const stopped = status?.serviceStatus === 'stopped' || status?.serviceStatus === 'absent';
	return (
		<Box borderTop="1px solid" borderColor="blackAlpha.100" pt={4} mt={4} minW={0}>
			<Text fontSize="sm" fontWeight="600">Thingtime Node</Text>
			<Text fontSize="sm" color="gray.600" role="status" overflowWrap="anywhere">
				{status ? `Status: ${status.serviceStatus}${status.version ? ` · Desktop ${status.version}` : ''}` : 'Checking node status…'}
			</Text>
			<Flex gap={2} mt={3} flexWrap="wrap" aria-label="Thingtime Node controls">
				<Button size="sm" onClick={() => void control('start')} isDisabled={!!busy || status?.serviceStatus === 'running'}>
					{busy === 'start' ? 'Starting…' : 'Start node'}
				</Button>
				<Button size="sm" onClick={() => void control('stop')} isDisabled={!!busy || !status || stopped}>
					{busy === 'stop' ? 'Stopping…' : 'Stop node'}
				</Button>
				<Button size="sm" onClick={() => void control('restart')} isDisabled={!!busy || !status || stopped}>
					{busy === 'restart' ? 'Restarting…' : 'Restart node'}
				</Button>
			</Flex>
			<Text fontSize="xs" color="gray.500" mt={2}>Stopping keeps your pairing and settings. Auto-start can resume the node next time you open Desktop.</Text>
			<PermissionRecoveryControls />
			{(error || status?.lastError?.message) && <Text role="alert" fontSize="sm" color="red.500" mt={2} overflowWrap="anywhere">{error || status?.lastError?.message}</Text>}
		</Box>
	);
}
