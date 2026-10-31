import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { getElectronBridge } from '~/utils/electronBridge';
import { useLopu } from '~/components/Lopu/useLopu';

export function PermissionRecoveryControls() {
	const bridge = getElectronBridge();
	const lopu = useLopu();
	const [busy, setBusy] = React.useState(false);
	const inFlight = React.useRef(false);
	if (!bridge?.openAppLocations) return null;
	const run = async (action: () => Promise<unknown>) => {
		if (inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		try { await action(); }
		catch (error) { lopu({ title: 'Permission recovery', description: error instanceof Error ? error.message : 'Please try again.', status: 'error' }); }
		finally { inFlight.current = false; setBusy(false); }
	};
	return (
		<Box mt={3} minW={0}>
			<Text fontSize="12px" color="var(--tt-muted, #71717a)" lineHeight="1.5" whiteSpace="normal">
				You may need to remove the apps from permissions and re-add them to fix permissions problems.
				Open App Locations, then drag the affected app into the appropriate Privacy &amp; Security list in System Settings.
				The Thingtime Node shortcut points to the helper used by this Desktop app.
			</Text>
			<Flex gap={2} mt={2} wrap="wrap">
				<Button size="sm" variant="outline" isDisabled={busy} onClick={() => void run(() => bridge.openAppLocations!())}>Open App Locations</Button>
				{bridge.restartAfterPermissions && <Button size="sm" variant="outline" isDisabled={busy} onClick={() => void run(() => bridge.restartAfterPermissions!())}>Restart after permission changes…</Button>}
			</Flex>
			<Text fontSize="11px" color="var(--tt-muted, #71717a)" mt={2} whiteSpace="normal">
				If macOS asks, choose Quit &amp; Reopen. Otherwise, restart the affected app after changing access.
				Thingtime offers Later or Restart Node Now when you return here; access is checked again automatically.
			</Text>
		</Box>
	);
}
