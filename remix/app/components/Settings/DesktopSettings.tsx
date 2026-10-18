import { DesktopConnectionSettings } from './DesktopConnectionSettings';
import { SettingsSection } from './SettingsSection';
import React from 'react';
import { Box, Button, Flex, Select, Switch, Text } from '@chakra-ui/react';
import { DesktopNodeControls } from '~/components/Nav/Drawer/DesktopNodeControls';
import { ElectronUpdateManager } from '~/components/Nav/Drawer/ElectronUpdateManager';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { useLopu } from '~/components/Lopu/useLopu';
import {
	electronAutoUpdateSettingPath,
	getElectronAutoUpdateEnabled,
	getElectronBridge,
	type ThingtimeDesktopInfo,
	type ThingtimeDesktopSettings
} from '~/utils/electronBridge';
export function DesktopSettings() {
	const lopu = useLopu();
	const { thingtime, setThingtime } = useThingtime();
	const [desktopInfo, setDesktopInfo] = React.useState<ThingtimeDesktopInfo | null>(null);
	const [electronSettingsLoading, setElectronSettingsLoading] = React.useState(false);
	const runtime = desktopInfo?.localRuntime;
	const electronSessionHash = desktopInfo?.sessionHash || '';
	const desktopSettings = desktopInfo?.desktopSettings || null;
	const electronAutoUpdateEnabled = getElectronAutoUpdateEnabled(thingtime, electronSessionHash);
	const electronAutoUpdatePathLabel = electronSessionHash ? electronAutoUpdateSettingPath(electronSessionHash) : '';
	React.useEffect(() => {
		const bridge = getElectronBridge();

		if (!bridge?.getInfo) {
			setDesktopInfo(null);
			return;
		}

		let cancelled = false;

		bridge
			.getInfo()
			.then(async (info) => {
				if (!cancelled) setDesktopInfo(info);
				return bridge.checkEndpointCompatibility ? bridge.checkEndpointCompatibility() : info;
			})
			.then((info) => {
				if (!cancelled) setDesktopInfo(info);
			})
			.catch((error) => {
				console.warn('Unable to read Thingtime desktop info', error);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const applyDesktopSettings = React.useCallback((settings: ThingtimeDesktopSettings) => {
		setDesktopInfo((current) => (current ? { ...current, desktopSettings: settings } : current));
	}, []);

	const handleMenuBarIconSelect = React.useCallback(
		async (iconId: string) => {
			const bridge = getElectronBridge();
			if (!bridge?.selectMenuBarIcon) return;
			setElectronSettingsLoading(true);
			try {
				applyDesktopSettings(await bridge.selectMenuBarIcon({ iconId }));
				lopu({ title: 'Menu bar icon updated ✨', status: 'success', duration: 5000 });
			} catch (error) {
				lopu({
					title: 'Could not change menu bar icon',
					description: error instanceof Error ? error.message : 'Thingtime desktop rejected that icon.',
					status: 'error',
					duration: 7000
				});
			} finally {
				setElectronSettingsLoading(false);
			}
		},
		[applyDesktopSettings, lopu]
	);

	const handleMenuBarIconUpload = React.useCallback(async () => {
		const bridge = getElectronBridge();
		if (!bridge?.uploadMenuBarIcon) return;
		setElectronSettingsLoading(true);
		try {
			const result = await bridge.uploadMenuBarIcon();
			if ('settings' in result) {
				applyDesktopSettings(result.settings);
				lopu({ title: 'Custom menu bar icon installed ✨', status: 'success', duration: 5000 });
			}
		} catch (error) {
			lopu({
				title: 'Could not use custom icon',
				description: error instanceof Error ? error.message : 'Thingtime desktop could not read that image.',
				status: 'error',
				duration: 7000
			});
		} finally {
			setElectronSettingsLoading(false);
		}
	}, [applyDesktopSettings, lopu]);

	const handleNodeAutoStartChange = React.useCallback(
		async (enabled: boolean) => {
			const bridge = getElectronBridge();
			if (!bridge?.setNodeAutoStart) return;
			setElectronSettingsLoading(true);
			try {
				applyDesktopSettings(await bridge.setNodeAutoStart({ enabled }));
				lopu({
					title: enabled ? 'Thingtime will start your node on launch ✨' : 'Node auto-start is off',
					status: 'success',
					duration: 5000
				});
			} catch (error) {
				lopu({
					title: 'Could not change node auto-start',
					description: error instanceof Error ? error.message : 'Thingtime desktop could not save that preference.',
					status: 'error',
					duration: 7000
				});
			} finally {
				setElectronSettingsLoading(false);
			}
		},
		[applyDesktopSettings, lopu]
	);

	const handleElectronAutoUpdateChange = React.useCallback(
		(enabled: boolean) => {
			if (!electronSessionHash) {
				return;
			}

			setThingtime(electronAutoUpdateSettingPath(electronSessionHash), enabled, {
				ignoreUndoRedo: true,
				namespace: 'electron'
			});
		},
		[electronSessionHash, setThingtime]
	);


	return (
		<>
			{desktopInfo && (
				<SettingsSection
					eyebrow="Thingtime desktop"
					description="API connections, menu bar icon, local node, and app updates."
					summary={desktopSettings?.selectedEndpoint.label}
				>
					<DesktopConnectionSettings desktopInfo={desktopInfo} onInfo={setDesktopInfo} />
					<DesktopNodeControls active={true} />
					<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop="1px solid" borderColor="blackAlpha.100">
						<Text fontSize="sm">Thingtime Node menu bar icon</Text>
						<Select
							size="sm"
							value={desktopSettings?.selectedMenuBarIconId || ''}
							isDisabled={electronSettingsLoading || !desktopSettings || runtime?.active}
							onChange={(event) => handleMenuBarIconSelect(event.target.value)}
						>
							{desktopSettings?.menuBarIcons.map((icon) => (
								<option key={icon.id} value={icon.id} disabled={icon.custom && !desktopSettings.customMenuBarIconConfigured}>
									{icon.label}
								</option>
							))}
						</Select>
						<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
							<Button size="xs" variant="outline" isLoading={electronSettingsLoading} onClick={handleMenuBarIconUpload}>
								Upload custom icon
							</Button>
							<Text fontSize="xs" opacity={0.55}>
								Changing this restarts only the managed node.
							</Text>
						</Flex>
					</Flex>
					<Flex alignItems="center" columnGap={4} paddingTop={2} borderTop="1px solid" borderColor="blackAlpha.100">
						<Box minWidth={0}>
							<Text fontSize="sm">Auto-start node on Thingtime launch</Text>
							<Text fontSize="xs" opacity={0.55}>
								Starts the bundled node and keeps it up to date with this Desktop app.
							</Text>
						</Box>
						<Switch
							aria-label="Auto-start node on Thingtime launch"
							isChecked={desktopSettings?.autoStartNodeOnLaunch !== false}
							isDisabled={electronSettingsLoading || !desktopSettings || !getElectronBridge()?.setNodeAutoStart}
							marginLeft="auto"
							onChange={(event) => handleNodeAutoStartChange(event.target.checked)}
						/>
					</Flex>
					<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop="1px solid" borderColor="blackAlpha.100">
						<Flex alignItems="center" columnGap={4}>
							<Box minWidth={0}>
								<Text fontSize="sm">Automatic update checks</Text>
								<Text fontSize="xs" opacity={0.55} wordBreak="break-all">
									{electronAutoUpdatePathLabel || 'Local desktop update preference'}
								</Text>
							</Box>
							<Switch
								marginLeft="auto"
								isChecked={electronAutoUpdateEnabled}
								onChange={(event) => handleElectronAutoUpdateChange(event.target.checked)}
							></Switch>
						</Flex>
						<ElectronUpdateManager />
					</Flex>
				</SettingsSection>
			)}
		</>
	);
}
