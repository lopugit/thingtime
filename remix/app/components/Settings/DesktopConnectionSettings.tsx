import { DesktopSessionSettings } from './DesktopSessionSettings';
import React from 'react';
import { Box, Button, Flex, Input, Link, Select, Switch, Text } from '@chakra-ui/react';
import { getElectronBridge, type ThingtimeDesktopInfo, type ThingtimeDesktopSettings } from '~/utils/electronBridge';

/** Native connection settings are available before an account API is reachable. */
export function DesktopConnectionSettings({ desktopInfo, onInfo }: {
 desktopInfo: ThingtimeDesktopInfo;
 onInfo: (info: ThingtimeDesktopInfo) => void;
}) {
 const [notice, setNotice] = React.useState<{ text: string; error: boolean } | null>(null);
 const notify = React.useCallback((message: { title: string; description?: string; status?: string; duration?: number }) => {
  setNotice({ text: [message.title, message.description].filter(Boolean).join('. '), error: message.status === 'error' });
 }, []);
	const [runtimeEnabled, setRuntimeEnabled] = React.useState(desktopInfo.localRuntime?.enabled ?? false);
	const [databaseMode, setDatabaseMode] = React.useState<'managed' | 'external'>(desktopInfo.localRuntime?.databaseMode ?? 'managed');
	const [mongoUri, setMongoUri] = React.useState('');
	const [apiPort, setApiPort] = React.useState(String(desktopInfo.localRuntime?.apiPort ?? 28631));
	const [databasePort, setDatabasePort] = React.useState(String(desktopInfo.localRuntime?.databasePort ?? 28632));
	const [endpointLabelDraft, setEndpointLabelDraft] = React.useState('');
	const [endpointUrlDraft, setEndpointUrlDraft] = React.useState('');
	const [electronSettingsLoading, setElectronSettingsLoading] = React.useState(false);
	const [endpointCompatibilityChecking, setEndpointCompatibilityChecking] = React.useState(false);
	const runtime = desktopInfo.localRuntime;
	const savedEnabled = runtime?.enabled;
	const savedDatabaseMode = runtime?.databaseMode;
	const savedApiPort = runtime?.apiPort;
	const savedDatabasePort = runtime?.databasePort;
	React.useEffect(() => {
		if (savedEnabled === undefined || !savedDatabaseMode || !savedApiPort || !savedDatabasePort) return;
		setRuntimeEnabled(savedEnabled);
		setDatabaseMode(savedDatabaseMode);
		setApiPort(String(savedApiPort));
		setDatabasePort(String(savedDatabasePort));
	}, [savedEnabled, savedDatabaseMode, savedApiPort, savedDatabasePort]);
 const desktopSettings = desktopInfo.desktopSettings;
 const applyDesktopSettings = React.useCallback((settings: ThingtimeDesktopSettings) => {
  onInfo({ ...desktopInfo, desktopSettings: settings });
 }, [desktopInfo, onInfo]);
	const handleEndpointSelect = React.useCallback(
		async (endpointId: string) => {
			const bridge = getElectronBridge();
			if (!bridge?.selectEndpoint || endpointId === desktopSettings?.selectedEndpointId) return;
			setElectronSettingsLoading(true);
			try {
				const info = await bridge.selectEndpoint({ endpointId });
				onInfo(info);
			} catch (error) {
				notify({
					title: 'Could not switch API endpoint',
					description: error instanceof Error ? error.message : 'Thingtime desktop rejected that endpoint.',
					status: 'error',
					duration: 8000
				});
			} finally {
				setElectronSettingsLoading(false);
			}
		},
		[desktopSettings?.selectedEndpointId, notify, onInfo]
	);

	const handleEndpointCompatibilityCheck = React.useCallback(async () => {
		const bridge = getElectronBridge();
		if (!bridge?.checkEndpointCompatibility) return;
		setEndpointCompatibilityChecking(true);
		try {
			onInfo(await bridge.checkEndpointCompatibility());
		} catch (error) {
			notify({
				title: 'Could not check API compatibility',
				description: error instanceof Error ? error.message : 'Thingtime desktop could not check this endpoint.',
				status: 'error',
				duration: 7000
			});
		} finally {
			setEndpointCompatibilityChecking(false);
		}
	}, [notify, onInfo]);

	const handleEndpointAdd = React.useCallback(async () => {
		const bridge = getElectronBridge();
		if (!bridge?.addEndpoint) return;
		setElectronSettingsLoading(true);
		try {
			applyDesktopSettings(await bridge.addEndpoint({ label: endpointLabelDraft, url: endpointUrlDraft }));
			setEndpointLabelDraft('');
			setEndpointUrlDraft('');
			notify({ title: 'API endpoint saved ✨', status: 'success', duration: 5000 });
		} catch (error) {
			notify({
				title: 'Could not save endpoint',
				description: error instanceof Error ? error.message : 'Thingtime desktop rejected that endpoint.',
				status: 'error',
				duration: 7000
			});
		} finally {
			setElectronSettingsLoading(false);
		}
	}, [applyDesktopSettings, endpointLabelDraft, endpointUrlDraft, notify]);

	const handleEndpointRemove = React.useCallback(
		async (endpointId: string) => {
			const bridge = getElectronBridge();
			if (!bridge?.removeEndpoint) return;
			setElectronSettingsLoading(true);
			try {
				applyDesktopSettings(await bridge.removeEndpoint({ endpointId }));
			} catch (error) {
				notify({
					title: 'Could not remove endpoint',
					description: error instanceof Error ? error.message : 'Thingtime desktop could not remove that endpoint.',
					status: 'error',
					duration: 7000
				});
			} finally {
				setElectronSettingsLoading(false);
			}
		},
		[applyDesktopSettings, notify]
	);

	const saveRuntime = async () => {
		const bridge = getElectronBridge();
		if (!bridge?.configureLocalRuntime) return;
		setElectronSettingsLoading(true);
		try {
			onInfo(
				await bridge.configureLocalRuntime({
					enabled: runtimeEnabled,
					databaseMode,
					apiPort: Number(apiPort),
					databasePort: Number(databasePort),
					...(mongoUri.trim() ? { mongoUri: mongoUri.trim() } : {})
				})
			);
			setMongoUri('');
			notify({ title: 'Runtime settings saved', description: 'Restart Thingtime to apply the change.', status: 'success', duration: 6000 });
		} catch (error) {
			notify({
				title: 'Could not save local runtime',
				description: error instanceof Error ? error.message : 'Please try again.',
				status: 'error',
				duration: 8000
			});
		} finally {
			setElectronSettingsLoading(false);
		}
	};
	const chooseMongod = async () => {
		setElectronSettingsLoading(true);
		try {
			const info = await getElectronBridge()?.chooseLocalMongod?.();
			if (info) onInfo(info);
		} catch (error) {
			notify({
				title: 'Could not select MongoDB',
				description: error instanceof Error ? error.message : 'Please try again.',
				status: 'error',
				duration: 8000
			});
		} finally {
			setElectronSettingsLoading(false);
		}
	};

 const restartRuntime = async () => {
  try { await getElectronBridge()?.restartRuntime?.(); }
  catch { notify({ title: 'Could not restart Thingtime', description: 'Close and reopen this desktop app to apply the saved settings.', status: 'error' }); }
 };

 return (
					<Flex flexDirection="column" rowGap={2} minW={0} sx={{ '&, & *': { boxSizing: 'border-box' } }}>
                        <DesktopSessionSettings desktopInfo={desktopInfo} onInfo={onInfo} />
						{runtime && (
							<Box border="1px solid var(--tt-border, #ececef)" borderRadius="10px" p={3} mb={3} minW={0}>
								<Text fontWeight={600} fontSize="sm">
									Local API and database
								</Text>
								<Text fontSize="xs" mt={2}>
									Run Thingtime and connect your ChatGPT plan on this computer. Local accounts and data are separate from your cloud account; enabling
									this does not copy cloud data.
								</Text>
								<Flex gap={3} mt={3} align="center">
									<Switch
										id="desktop-local-api"
										isChecked={runtimeEnabled}
										isDisabled={electronSettingsLoading}
										onChange={(e) => setRuntimeEnabled(e.target.checked)}
									/>
									<Text as="label" htmlFor="desktop-local-api" fontSize="sm">
										Use a local API
									</Text>
								</Flex>
								<Text fontSize="xs" mt={2}>
									Currently using: {runtime.active ? 'local API' : 'selected remote API'}. Changes apply after restart. Local mode never falls back to
									the cloud.
								</Text>
								{runtimeEnabled && (
									<>
										<Text as="label" htmlFor="desktop-database-mode" fontSize="sm" display="block" mt={3}>
											Database for the local API
										</Text>
										<Select
											id="desktop-database-mode"
											size="sm"
											mt={1}
											value={databaseMode}
											onChange={(e) => setDatabaseMode(e.target.value as 'managed' | 'external')}
										>
											<option value="managed">MongoDB on this computer</option>
											<option value="external">Existing MongoDB connection</option>
										</Select>
										{databaseMode === 'managed' ? (
											<>
												<Text fontSize="xs" mt={2} overflowWrap="anywhere">
													{runtime.bundledMongoSelected ? 'MongoDB Community Server · Included with Thingtime' : runtime.mongodPath || 'MongoDB Server was not found.'}
												</Text>
												<Flex flexWrap="wrap" gap={2} mt={2}>
													<Button size="sm" isDisabled={electronSettingsLoading} onClick={() => void chooseMongod()}>
														Choose mongod
													</Button>
													<Link
														href="https://www.mongodb.com/try/download/community"
														target="_blank"
														rel="noopener noreferrer"
														fontSize="sm"
														textDecoration="underline"
													>
														Download MongoDB Community
													</Link>
												</Flex>
												<Text fontSize="xs" mt={2}>
													Thingtime includes MongoDB Community Server for a new local setup. You can also choose an existing mongod executable. Thingtime manages an authenticated database
													in its own app data folder while the app runs. No system service is installed.
												</Text>
											</>
										) : (
											<>
												<Text as="label" htmlFor="desktop-mongo-uri" fontSize="sm" display="block" mt={3}>
													MongoDB connection URI
												</Text>
												<Input
													id="desktop-mongo-uri"
													type="password"
													autoComplete="off"
													size="sm"
													mt={1}
													value={mongoUri}
													onChange={(e) => setMongoUri(e.target.value)}
													placeholder={runtime.externalDatabaseConfigured ? 'Saved securely · enter to replace' : 'mongodb:// or mongodb+srv://'}
												/>
												<Text fontSize="xs" mt={2}>
													Stored using the system credential store. Use a database dedicated to this Thingtime installation with replica-set
													transactions enabled. Its accounts are managed by this local API.
												</Text>
											</>
										)}
										<Flex mt={3} gap={3} direction={{ base: 'column', sm: 'row' }}>
											<Box flex="1" minW={0}>
												<Text as="label" htmlFor="desktop-api-port" fontSize="xs">
													Local API port
												</Text>
												<Input
													id="desktop-api-port"
													type="number"
													min={1024}
													max={65535}
													size="sm"
													value={apiPort}
													onChange={(e) => setApiPort(e.target.value)}
												/>
											</Box>
											{databaseMode === 'managed' && (
												<Box flex="1" minW={0}>
													<Text as="label" htmlFor="desktop-db-port" fontSize="xs">
														Local database port
													</Text>
													<Input
														id="desktop-db-port"
														type="number"
														min={1024}
														max={65535}
														size="sm"
														value={databasePort}
														onChange={(e) => setDatabasePort(e.target.value)}
													/>
												</Box>
											)}
										</Flex>
									</>
								)}
								{runtime.bundledMongoSelected && runtime.bundledMongoSupported === false && <Text role="alert" fontSize="xs" mt={2}>The included MongoDB requires macOS 14 or later. Choose a compatible executable or an existing MongoDB connection on this Mac.</Text>}
								{!runtime.encryptionAvailable && (
									<Text role="alert" fontSize="xs" mt={2}>
										Unlock the system credential store to save local runtime settings.
									</Text>
								)}
								{runtime.error && (
									<Text role="alert" fontSize="xs" mt={2} color="red.500">
										{runtime.error}
									</Text>
								)}
								<Flex gap={2} mt={3} flexWrap="wrap">
									<Button size="sm" isDisabled={electronSettingsLoading || !runtime.encryptionAvailable} onClick={() => void saveRuntime()}>
										Save runtime settings
									</Button>
									{runtime.restartRequired && (
										<Button size="sm" isDisabled={electronSettingsLoading} onClick={() => void restartRuntime()}>
											Restart Thingtime
										</Button>
									)}
								</Flex>
							</Box>
						)}
						<Text fontSize="sm">{runtime?.active ? 'API endpoint (turn off local API and restart to change)' : 'API endpoint'}</Text>
						<Select
							size="sm"
							aria-label="API endpoint"
 value={desktopSettings?.selectedEndpointId || ''}
							isDisabled={electronSettingsLoading || !desktopSettings || runtime?.active}
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
										? runtime?.active
											? '✓ Local API is compatible'
											: '✓ Computers API and packaged proxy are compatible'
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
								aria-label="Endpoint name"
 placeholder="Endpoint name"
								onChange={(event) => setEndpointLabelDraft(event.target.value)}
							/>
							<Input
								size="sm"
								flex="2 1 260px"
								value={endpointUrlDraft}
								aria-label="Endpoint URL"
 placeholder="https://your-thingtime.example/"
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
 {notice ? <Text role={notice.error ? "alert" : "status"} fontSize="sm" overflowWrap="anywhere">{notice.text}</Text> : null}
					</Flex>
 );
}
