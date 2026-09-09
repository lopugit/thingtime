import React from 'react';
import { Switch, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { LocalNodeSetupCard } from '~/components/Devices/LocalNodeSetupCard';
import { useLocalThingtimeNode } from '~/components/Devices/useLocalThingtimeNode';
import { useDeviceStore } from '~/components/Devices/useDeviceStore';
import { useNodePanelPreference } from '~/components/Devices/useNodePanelPreference';
import { getElectronBridge } from '~/utils/electronBridge';
import { SettingsSection, SettingRow } from './SettingsSection';
export function ThingsSettings() {
	const user = useCurrentUser();
	const available = Boolean(getElectronBridge()?.nodeGetStatus);
	const devices = useDeviceStore({ userId: user?.id, enabled: available && !!user && !user.temporary && user.accountKind === 'user' });
	const ids = React.useMemo(() => devices.devices.flatMap((device) => (device.summary?.id ? [device.summary.id] : [])), [devices.devices]);
	const node = useLocalThingtimeNode(null, devices.refreshList, devices.loading ? undefined : ids);
	const [dismissed, setDismissed] = useNodePanelPreference(user?.id);
	return (
		<>
			<SettingsSection eyebrow="This Mac" description="Your local connection and privacy access are always available here.">
				{node.available ? (
					<>
						<LocalNodeSetupCard state={node} controlFor={node.controlFor} onAction={node.executeAction} onRefresh={node.refresh} />
						<SettingRow
							label="Show connection panel on Things"
							hint="When off, the panel returns whenever the node or its permissions need attention."
						>
							<Switch aria-label="Show connection panel on Things" isChecked={!dismissed} onChange={(event) => setDismissed(!event.target.checked)} />
						</SettingRow>
					</>
				) : (
					<Text fontSize="sm">Open Thingtime Desktop on your Mac to manage its local node and privacy access.</Text>
				)}
			</SettingsSection>
		</>
	);
}
