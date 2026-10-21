import React from 'react';
import { WorkspaceStorageSettings } from './WorkspaceStorageSettings';
import { Switch, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { MobileDeviceSetupCard } from '~/components/Devices/MobileDeviceSetupCard';
import { supportsMobileDevice } from '~/components/Devices/mobileDeviceBridge';
import { DesktopFolderAccess } from '~/components/Devices/DesktopFolderAccess';
import { LocalNodeSetupCard } from '~/components/Devices/LocalNodeSetupCard';
import { useLocalThingtimeNode } from '~/components/Devices/useLocalThingtimeNode';
import { useDeviceStore } from '~/components/Devices/useDeviceStore';
import { useNodePanelPreference } from '~/components/Devices/useNodePanelPreference';
import { getElectronBridge } from '~/utils/electronBridge';
import { SettingsSection, SettingRow } from './SettingsSection';
export function ThingsSettings() {
	const user = useCurrentUser();
	const mobile = supportsMobileDevice();
	const available = mobile || Boolean(getElectronBridge()?.nodeGetStatus);
	const devices = useDeviceStore({ userId: user?.id, enabled: available && !!user && !user.temporary && user.accountKind === 'user' });
	const ids = React.useMemo(() => devices.devices.flatMap((device) => (device.summary?.id ? [device.summary.id] : [])), [devices.devices]);
	const node = useLocalThingtimeNode(null, devices.refreshList, devices.loading ? undefined : ids);
	const [dismissed, setDismissed] = useNodePanelPreference(user?.id);
	return (
		<>
			<WorkspaceStorageSettings />
			<SettingsSection eyebrow={mobile ? "This device" : "This Mac"} description="Your local connection and privacy access are always available here.">
                {mobile && user?.id && !user.temporary && user.accountKind === 'user' ? <MobileDeviceSetupCard ownerId={user.id} onPaired={devices.refreshList} /> : null}
				{node.available ? (
					<>
						<LocalNodeSetupCard state={node} controlFor={node.controlFor} onAction={node.executeAction} onRefresh={node.refresh} />
                        {user?.id ? <DesktopFolderAccess ownerId={user.id} pairedDeviceIds={node.pairedDeviceIds} ownedDeviceIds={ids} /> : null}
						<SettingRow
							label="Show connection panel on Things"
							hint="When off, the panel returns whenever the node or its permissions need attention."
						>
							<Switch aria-label="Show connection panel on Things" isChecked={!dismissed} onChange={(event) => setDismissed(!event.target.checked)} />
						</SettingRow>
					</>
				) : mobile ? null : (
					<Text fontSize="sm">Open Thingtime Desktop on your Mac to manage its local node and privacy access.</Text>
				)}
			</SettingsSection>
		</>
	);
}
