import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { getElectronBridge } from '~/utils/electronBridge';
import { AgentNetworkSettings } from './AgentNetworkSettings';
import type { AgentBrowserSnapshot, AgentNetworkPolicy } from './networkTypes';

export function AgentBrowserDefaults() {
	const [policy, setPolicy] = React.useState<AgentNetworkPolicy | null>(null);
	const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
	const bridge = getElectronBridge();
	React.useEffect(() => {
		let active = true;
		bridge?.agentBrowsers?.({ method: 'status' }).then(result => { if (active) setPolicy((result as AgentBrowserSnapshot).defaults); })
			.catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Could not load security settings.'); });
		return () => { active = false; };
	}, [bridge]);
	if (!bridge?.agentBrowserVersion) return null;
	return <Box id="agent-browser-security" scrollMarginTop="calc(var(--tt-nav-clearance, 54px) + 16px)" display="grid" gap={4} width="100%" minWidth={0}>
		<Text fontWeight="semibold">Agent browser security</Text>
		{policy && <AgentNetworkSettings value={policy} onChange={setPolicy} disabled={busy} prefix="Default network security" />}
		<Text fontSize="sm" color="gray.500">New agent tasks inherit this device default unless their custom security checkbox is enabled. Existing claims keep their current policy.</Text>
		<Button alignSelf="start" width="fit-content" isDisabled={!policy || busy} onClick={async () => {
			if (!policy) return;
			setBusy(true); setMessage('');
			try { await bridge.agentBrowsers?.({ method: 'defaults.set', params: { network: policy } }); setMessage('Default saved for new browser claims.'); }
			catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save security settings.'); }
			finally { setBusy(false); }
		}}>Save default</Button>
		{message && <Text role="status" fontSize="sm">{message}</Text>}
	</Box>;
}
