import React from 'react';
import { Box, Button, Flex, Input, Select, Switch, Text } from '@chakra-ui/react';
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
	const [endpointLabelDraft, setEndpointLabelDraft] = React.useState('');
	const [endpointUrlDraft, setEndpointUrlDraft] = React.useState('');
	const [electronSettingsLoading, setElectronSettingsLoading] = React.useState(false);
	const [endpointCompatibilityChecking, setEndpointCompatibilityChecking] = React.useState(false);
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
				if (!cancelled) {
					setDesktopInfo(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const applyDesktopSettings = React.useCallback((settings: ThingtimeDesktopSettings) => {
		setDesktopInfo((current) => (current ? { ...current, desktopSettings: settings } : current));
	}, []);

	const handleEndpointSelect = React.useCallback(
		async (endpointId: string) => {
			const bridge = getElectronBridge();
			if (!bridge?.selectEndpoint || endpointId === desktopSettings?.selectedEndpointId) return;
			setElectronSettingsLoading(true);
			try {
				const info = await bridge.selectEndpoint({ endpointId });
				setDesktopInfo(info);
			} catch (error) {
				lopu({
					title: 'Could not switch API endpoint',
					description: error instanceof Error ? error.message : 'Thingtime desktop rejected that endpoint.',
					status: 'error',
					duration: 8000
				});
			} finally {
				setElectronSettingsLoading(false);
			}
		},
		[desktopSettings?.selectedEndpointId, lopu]
	);

	const handleEndpointCompatibilityCheck = React.useCallback(async () => {
		const bridge = getElectronBridge();
		if (!bridge?.checkEndpointCompatibility) return;
		setEndpointCompatibilityChecking(true);
		try {
			setDesktopInfo(await bridge.checkEndpointCompatibility());
		} catch (error) {
			lopu({
				title: 'Could not check API compatibility',
				description: error instanceof Error ? error.message : 'Thingtime desktop could not check this endpoint.',
				status: 'error',
				duration: 7000
			});
		} finally {
			setEndpointCompatibilityChecking(false);
		}
	}, [lopu]);

	const handleEndpointAdd = React.useCallback(async () => {
		const bridge = getElectronBridge();
		if (!bridge?.addEndpoint) return;
		setElectronSettingsLoading(true);
		try {
			applyDesktopSettings(await bridge.addEndpoint({ label: endpointLabelDraft, url: endpointUrlDraft }));
			setEndpointLabelDraft('');
			setEndpointUrlDraft('');
			lopu({ title: 'API endpoint saved ✨', status: 'success', duration: 5000 });
		} catch (error) {
			lopu({
				title: 'Could not save endpoint',
				description: error instanceof Error ? error.message : 'Thingtime desktop rejected that endpoint.',
				status: 'error',
				duration: 7000
			});
		} finally {
			setElectronSettingsLoading(false);
		}
	}, [applyDesktopSettings, endpointLabelDraft, endpointUrlDraft, lopu]);

	const handleEndpointRemove = React.useCallback(
		async (endpointId: string) => {
			const bridge = getElectronBridge();
			if (!bridge?.removeEndpoint) return;
			setElectronSettingsLoading(true);
			try {
				applyDesktopSettings(await bridge.removeEndpoint({ endpointId }));
			} catch (error) {
				lopu({
					title: 'Could not remove endpoint',
					description: error instanceof Error ? error.message : 'Thingtime desktop could not remove that endpoint.',
					status: 'error',
					duration: 7000
				});
			} finally {
				setElectronSettingsLoading(false);
			}
		},
		[applyDesktopSettings, lopu]
	);

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
				<Flex flexDirection="column" rowGap={3}>
					<Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
						Thingtime desktop
					</Text>
					<Flex flexDirection="column" rowGap={2}>
						<Text fontSize="sm">API endpoint</Text>
						<Select
							size="sm"
							value={desktopSettings?.selectedEndpointId || ''}
							isDisabled={electronSettingsLoading || !desktopSettings}
							onChange={(event) => handleEndpointSelect(event.target.value)}
						>
							{desktopSettings?.endpointProfiles.map((endpoint) => (
								<option key={endpoint.id} value={endpoint.id}>
									{endpoint.label}
								</option>
							))}
						</Select>
						<Text fontSize="xs" opacity={0.55} wordBreak="break-all">
							{desktopSettings?.selectedEndpoint.url || 'No endpoint selected'}
						</Text>
						<Text fontSize="xs" opacity={0.55}>
							The packaged interface stays on this computer. Account data and Thingtime Node use this API endpoint; pairing stays separate per
							endpoint.
						</Text>
						{desktopInfo.endpointCompatibility && (
							<Flex alignItems="center" columnGap={2} flexWrap="wrap">
								<Text
									fontSize="xs"
									color={
										desktopInfo.endpointCompatibility.status === 'compatible'
											? 'green.600'
											: desktopInfo.endpointCompatibility.status === 'checking'
											? 'blue.600'
											: 'red.500'
									}
								>
									{desktopInfo.endpointCompatibility.status === 'compatible'
										? '✓ Computers API and packaged proxy are compatible'
										: desktopInfo.endpointCompatibility.status === 'checking'
										? 'Checking computers API compatibility…'
										: desktopInfo.endpointCompatibility.message}
								</Text>
								<Button size="xs" variant="ghost" isLoading={endpointCompatibilityChecking} onClick={handleEndpointCompatibilityCheck}>
									Check now
								</Button>
							</Flex>
						)}
						{desktopInfo.desktopSettingsLastError && (
							<Text fontSize="xs" color="red.500" wordBreak="break-word">
								{desktopInfo.desktopSettingsLastError}
							</Text>
						)}
						{desktopSettings?.endpointProfiles.some((endpoint) => endpoint.source === 'custom') && (
							<Flex flexDirection="column" rowGap={1}>
								{desktopSettings.endpointProfiles
									.filter((endpoint) => endpoint.source === 'custom')
									.map((endpoint) => (
										<Flex key={endpoint.id} alignItems="center" columnGap={2} minWidth={0}>
											<Text fontSize="xs" flex="1" minWidth={0} wordBreak="break-all">
												{endpoint.label} · {endpoint.url}
											</Text>
											<Button
												size="xs"
												variant="ghost"
												isDisabled={electronSettingsLoading || endpoint.id === desktopSettings.selectedEndpointId}
												onClick={() => handleEndpointRemove(endpoint.id)}
											>
												Remove
											</Button>
										</Flex>
									))}
							</Flex>
						)}
						<Flex columnGap={2} rowGap={2} flexWrap="wrap">
							<Input
								size="sm"
								flex="1 1 150px"
								value={endpointLabelDraft}
								placeholder="Preview name"
								onChange={(event) => setEndpointLabelDraft(event.target.value)}
							/>
							<Input
								size="sm"
								flex="2 1 260px"
								value={endpointUrlDraft}
								placeholder="https://pr-123.previews.dev.thingtime.com/"
								onChange={(event) => setEndpointUrlDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') handleEndpointAdd();
								}}
							/>
							<Button
								size="xs"
								variant="outline"
								isLoading={electronSettingsLoading}
								isDisabled={!endpointLabelDraft.trim() || !endpointUrlDraft.trim()}
								onClick={handleEndpointAdd}
							>
								Add endpoint
							</Button>
						</Flex>
					</Flex>
					<DesktopNodeControls active={true} />
					<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop="1px solid" borderColor="blackAlpha.100">
						<Text fontSize="sm">Thingtime Node menu bar icon</Text>
						<Select
							size="sm"
							value={desktopSettings?.selectedMenuBarIconId || ''}
							isDisabled={electronSettingsLoading || !desktopSettings}
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
				</Flex>
			)}
		</>
	);
}
