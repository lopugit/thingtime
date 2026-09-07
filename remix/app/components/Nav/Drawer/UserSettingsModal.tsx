import React from 'react';
import { Box, Button, Center, Flex, Input, Select, Switch, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';

import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z, DRAWER_TOP_LEVEL_DEFAULT_LIMIT, useDrawer, useIsMobileViewport } from './useDrawer';
import { drawerItemClosesOnClick, drawerMenuItems, filterDrawerItemsByAuth, filterDrawerTopItems } from './drawerMenu';
import { AccountSwitcher } from '../../Account/AccountSwitcher';
import { ElectronUpdateManager } from './ElectronUpdateManager';
import { LopuPositionSelect } from '../../Lopu/LopuPositionSelect';
import { useLopu } from '../../Lopu/useLopu';
import { LopuSettingsRows } from '../../Lopu/LopuHost';
import { ColorControl, ThingsBadgePaddingControl } from '../../ThemeSettings/controls';
import { useThingtime } from '../../Thingtime/useThingtime';
import { useMarketingPublications } from '~/components/Marketing/marketingPublicationsStore';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useTtTheme } from '~/hooks/useTtTheme';
import { isKeyPublished } from '~/marketing/publishingCore';
import { getUserMention } from '~/utils/userIdentity';
import {
	electronAutoUpdateSettingPath,
	getElectronAutoUpdateEnabled,
	getElectronBridge,
	type ThingtimeDesktopInfo,
	type ThingtimeDesktopSettings
} from '~/utils/electronBridge';

// User/app settings surface opened from the drawer's avatar button.
// Desktop: centre-aligned floating modal. Mobile: full-width slide-up sheet
// layered over the drawer / shifted page.

export const UserSettingsModal = () => {
	const {
		accountModalOpen,
		setAccountModalOpen,
		direction,
		setDirection,
		searchClosesDrawer,
		setSearchClosesDrawer,
		topLevelLimit,
		topLevelLimitIsUnlimited,
		setTopLevelLimit,
		setTopLevelLimitUnlimited,
		resetOrdering,
		closeOnClick,
		setCloseOnClickFor
	} = useDrawer();

	const isMobile = useIsMobileViewport();
	const user = useCurrentUser();
	// the "Close after click" list mirrors the drawer, so it needs the same
	// publish state DrawerContent reads — without it every publication-gated
	// item (Marketing) fails closed here and a visitor can no longer configure
	// a section they can actually see. It must also use the drawer's own pair
	// of filters (filterDrawerTopItems for the sections, filterDrawerItemsByAuth
	// for their children): a top-level section is listed as soon as ANY child is
	// visible, so gating it on its own key would hide Marketing here while the
	// drawer still shows it (published `category:landing`, unpublished `hub`).
	const { publications } = useMarketingPublications();
	const isPublished = React.useCallback((key: string) => isKeyPublished(publications, key), [publications]);
	const api = useApi();
	const navigate = useNavigate();
	const lopu = useLopu();
	const { theme, preset, overrides, hasOverrides, appliedThemeShareId, builtinThemes, setPreset, setColor, setGeneral, resetOverrides } =
		useTtTheme();
	const thingsBadgeCustomPadding =
		typeof overrides.general?.thingsBadgeCustomPadding === 'string'
			? overrides.general.thingsBadgeCustomPadding
			: theme.general.thingsBadgeCustomPadding;
	const { thingtime, setThingtime } = useThingtime();
	const topLevelLimitValue = typeof topLevelLimit === 'number' ? topLevelLimit : DRAWER_TOP_LEVEL_DEFAULT_LIMIT;

	const lowerTopLevelLimit = () => {
		setTopLevelLimit(topLevelLimitIsUnlimited ? DRAWER_TOP_LEVEL_DEFAULT_LIMIT : topLevelLimitValue - 1);
	};

	const raiseTopLevelLimit = () => {
		setTopLevelLimit(topLevelLimitIsUnlimited ? DRAWER_TOP_LEVEL_DEFAULT_LIMIT : topLevelLimitValue + 1);
	};

	// two-frame mount so the open transition animates from the hidden state
	const [visible, setVisible] = React.useState(false);
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
		if (!accountModalOpen) {
			setVisible(false);
			return;
		}

		const raf = requestAnimationFrame(() => {
			setVisible(true);
		});

		return () => {
			cancelAnimationFrame(raf);
		};
	}, [accountModalOpen]);

	const close = React.useCallback(() => {
		setAccountModalOpen(false);
	}, [setAccountModalOpen]);

	React.useEffect(() => {
		if (!accountModalOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === 'Escape') {
				close();
			}
		};

		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [accountModalOpen, close]);

	// freeze the page behind the modal
	React.useEffect(() => {
		if (!accountModalOpen) {
			return;
		}

		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previous;
		};
	}, [accountModalOpen]);

	const handleLogout = React.useCallback(async () => {
		let resp;
		try {
			resp = await api.v1.auth.logout();
		} catch (err) {
			console.error('Logout failed', err);
			lopu({ title: 'Logout failed', description: 'Please try again in a moment.', status: 'error' });
			return;
		}

		// Switcher semantics: other signed-in accounts stay — the next one takes
		// over and the modal stays open on it. Only a fully signed-out browser
		// leaves for /login.
		if (resp?.user) {
			lopu({ title: `Logged out — switched to ${getUserMention(resp.user)} ✨`, status: 'success', duration: 6000 });
			return;
		}

		lopu({ title: 'Logged out', status: 'success', duration: 6000 });
		close();
		navigate('/login');
	}, [api, lopu, close, navigate]);

	const handleGoTo = React.useCallback(
		(to: string) => {
			close();
			navigate(to);
		},
		[close, navigate]
	);

	const handleResetOrdering = React.useCallback(() => {
		resetOrdering();
		lopu({ title: 'Menu order reset ✨', status: 'success', duration: 6000 });
	}, [resetOrdering, lopu]);

	// Match ThemeStudio.applyPreset: picking a preset also clears the
	// server-side active theme so cross-device pickup doesn't resurrect it.
	const handlePreset = React.useCallback(
		(name: string) => {
			setPreset(name);
			if (user) {
				api.v1.themes.setActive({ themeId: null }).catch(() => {});
			}
		},
		[setPreset, user, api]
	);

	React.useEffect(() => {
		if (!accountModalOpen) {
			return;
		}

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
	}, [accountModalOpen]);

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

	if (!accountModalOpen) {
		return null;
	}

	const settingRow = (label: string, control: React.ReactNode, hint?: string) => (
		<Flex alignItems="center" columnGap={4} paddingY={2}>
			<Box>
				<Text fontSize="sm">{label}</Text>
				{hint && (
					<Text fontSize="xs" opacity={0.55}>
						{hint}
					</Text>
				)}
			</Box>
			<Box marginLeft="auto">{control}</Box>
		</Flex>
	);

	const content = (
		<Flex flexDirection="column" rowGap={5} padding={6} paddingBottom={isMobile ? 'calc(24px + var(--thingtime-safe-area-bottom))' : 6}>
			{/* header */}
			<Flex alignItems="center">
				<Text fontSize="md" fontWeight={700}>
					Settings
				</Text>
				<Center
					as="button"
					type="button"
					marginLeft="auto"
					width="28px"
					height="28px"
					borderRadius="8px"
					opacity={0.6}
					_hover={{ opacity: 1, background: 'greys.lightt' }}
					cursor="pointer"
					aria-label="Close settings"
					onClick={close}
				>
					<X size={15} strokeWidth={2} />
				</Center>
			</Flex>

			{/* account — the switcher lists every signed-in account and hosts the
			    add / register-new inline forms */}
			<Flex flexDirection="column" rowGap={3}>
				<Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
					Account
				</Text>
				<AccountSwitcher onNavigate={close} />
				<Flex columnGap={2} rowGap={2} flexWrap="wrap">
					{user && (
						<>
							<Button size="xs" variant="outline" onClick={() => handleGoTo('/profile')}>
								Profile 👤
							</Button>
							<Button size="xs" variant="outline" onClick={handleLogout}>
								Log out 🗝️
							</Button>
						</>
					)}
					<Button size="xs" variant="outline" onClick={() => handleGoTo('/settings')}>
						All settings ⚙️
					</Button>
				</Flex>
			</Flex>

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
								Restarts a node you already enabled; it never installs a new node without asking first.
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

			{/* drawer preferences */}
			<Flex flexDirection="column" rowGap={0}>
				<Text paddingBottom={2} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
					Drawer
				</Text>

				{settingRow(
					'Opens from',
					<Flex columnGap={1}>
						<Button size="xs" variant={direction === 'left' ? 'solid' : 'ghost'} onClick={() => setDirection('left')}>
							Left
						</Button>
						<Button size="xs" variant={direction === 'right' ? 'solid' : 'ghost'} onClick={() => setDirection('right')}>
							Right
						</Button>
					</Flex>,
					'Which edge the drawer slides out from'
				)}

				{settingRow(
					'Search closes drawer',
					<Switch isChecked={searchClosesDrawer} onChange={(e) => setSearchClosesDrawer(e.target.checked)}></Switch>,
					'Close the drawer when opening search'
				)}

				{settingRow(
					'Top-level items',
					<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap" justifyContent="flex-end">
						<Button size="xs" variant="outline" onClick={lowerTopLevelLimit} isDisabled={!topLevelLimitIsUnlimited && topLevelLimitValue <= 1}>
							−
						</Button>
						<Text minWidth="74px" textAlign="center" fontSize="sm">
							{topLevelLimitIsUnlimited ? 'Unlimited' : topLevelLimit}
						</Text>
						<Button size="xs" variant="outline" onClick={raiseTopLevelLimit}>
							+
						</Button>
						<Button size="xs" variant={topLevelLimitIsUnlimited ? 'solid' : 'outline'} onClick={setTopLevelLimitUnlimited}>
							Unlimited
						</Button>
					</Flex>,
					'How many items show before “More”'
				)}

				{settingRow(
					'Menu ordering',
					<Button size="xs" variant="outline" onClick={handleResetOrdering}>
						Reset
					</Button>,
					'Restore the default drag-reordered menu layout'
				)}

				{/* per-item dismiss: navigating items default ON; off keeps the
				drawer open for that item (submenu browsing) */}
				<Flex flexDirection="column" paddingY={2}>
					<Text fontSize="sm">Close after click</Text>
					<Text fontSize="xs" opacity={0.55}>
						Which menu items close the drawer when clicked (desktop and mobile)
					</Text>
					<Flex flexDirection="column" paddingTop={2}>
						{filterDrawerTopItems(drawerMenuItems, !!user, !!user?.isAdmin, isPublished).map((top) => (
							<React.Fragment key={top.id}>
								<Flex alignItems="center" columnGap={4} paddingY={1}>
									<Text fontSize="sm">
										{top.icon} {top.label}
									</Text>
									<Switch
										size="sm"
										marginLeft="auto"
										isChecked={drawerItemClosesOnClick(closeOnClick, top.id)}
										onChange={(event) => setCloseOnClickFor(top.id, event.target.checked)}
									></Switch>
								</Flex>
								{filterDrawerItemsByAuth(top.children || [], !!user, !!user?.isAdmin, isPublished).map((child) => (
									<Flex key={child.id} alignItems="center" columnGap={4} paddingY={0.5} paddingLeft={4}>
										<Text fontSize="xs" opacity={0.8}>
											{child.icon} {child.label}
										</Text>
										<Switch
											size="sm"
											marginLeft="auto"
											isChecked={drawerItemClosesOnClick(closeOnClick, child.id)}
											onChange={(event) => setCloseOnClickFor(child.id, event.target.checked)}
										></Switch>
									</Flex>
								))}
							</React.Fragment>
						))}
					</Flex>
				</Flex>
			</Flex>

			{/* 🦄 Lopu — the assistant's launcher, window and defaults (mirrors
			    SettingsPage's Lopu section; the rows come from LopuSettingsRows) */}
			<Flex flexDirection="column" rowGap={0}>
				<Text paddingBottom={2} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
					Lopu 🦄
				</Text>
				<LopuSettingsRows renderRow={settingRow} />
				{settingRow(
					'Talk to Lopu',
					<Button size="xs" variant="outline" onClick={() => handleGoTo('/lopu')}>
						Open 🦄
					</Button>,
					'The full chat page with every conversation'
				)}
			</Flex>

			{/* theming */}
			<Flex flexDirection="column" rowGap={0}>
				<Text paddingBottom={2} fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
					Theming
				</Text>

				{settingRow(
					'Theme',
					<Flex columnGap={1} flexWrap="wrap" justifyContent="flex-end">
						{builtinThemes.map((builtin) => {
							const active = preset === builtin.name && !hasOverrides && !appliedThemeShareId;
							return (
								<Button key={builtin.name} size="xs" variant={active ? 'solid' : 'ghost'} onClick={() => handlePreset(builtin.name)}>
									{builtin.name}
								</Button>
							);
						})}
					</Flex>,
					appliedThemeShareId ? `Custom theme applied: ${theme.name}` : 'Pick a base look'
				)}

				{settingRow('Accent colour', <ColorControl value={theme.colors.accent} onChange={(v) => setColor('accent', v)} />, 'CTAs and highlights')}

				{settingRow(
					'Shadows',
					<Flex columnGap={1}>
						<Button size="xs" variant={theme.general.shadow === 'soft' ? 'solid' : 'ghost'} onClick={() => setGeneral('shadow', 'soft')}>
							Soft
						</Button>
						<Button size="xs" variant={theme.general.shadow === 'hard' ? 'solid' : 'ghost'} onClick={() => setGeneral('shadow', 'hard')}>
							Hard 🧱
						</Button>
					</Flex>,
					'Soft blur or hard offset'
				)}

				{settingRow(
					'Things badge padding',
					<ThingsBadgePaddingControl
						value={theme.general.thingsBadgePadding}
						customValue={thingsBadgeCustomPadding}
						onValueChange={(value) => setGeneral('thingsBadgePadding', value)}
						onCustomValueChange={(value) => setGeneral('thingsBadgeCustomPadding', value)}
					/>,
					'View / Show / Arrange / Kind controls'
				)}

				{settingRow(
					'Motion',
					<Switch isChecked={theme.general.motion} onChange={(e) => setGeneral('motion', e.target.checked)}></Switch>,
					'Rainbow + decorative animation'
				)}

				{settingRow('Lopu messages 🦄', <LopuPositionSelect />, 'Where notifications pop up on screen')}

				{settingRow(
					'Pet',
					<Switch isChecked={theme.general.pet} onChange={(e) => setGeneral('pet', e.target.checked)}></Switch>,
					'Lopuuu, the floating unicorn 🦄'
				)}

				{settingRow(
					'Theme Studio',
					<Button size="xs" variant="outline" onClick={() => handleGoTo('/themes')}>
						Open 🎨
					</Button>,
					'Full editor: colours, fonts, save + share themes'
				)}

				{hasOverrides &&
					settingRow(
						'Customisations',
						<Button size="xs" variant="outline" onClick={() => resetOverrides()}>
							Reset
						</Button>,
						'Back to the selected preset'
					)}
			</Flex>
		</Flex>
	);

	return (
		<>
			<Box
				className="userSettingsOverlay"
				position="fixed"
				zIndex={DRAWER_MODAL_OVERLAY_Z}
				top={0}
				right={0}
				bottom={0}
				left={0}
				background="rgba(0,0,0,0.4)"
				opacity={visible ? 1 : 0}
				transition="opacity 0.24s ease-out"
				onClick={close}
			></Box>

			{isMobile ? (
				<Box
					className="userSettingsSheet"
					position="fixed"
					zIndex={DRAWER_MODAL_Z}
					right={0}
					bottom={0}
					left={0}
					height="88vh"
					sx={{
						'@supports (height: 100dvh)': {
							height: '88dvh'
						}
					}}
					background="var(--tt-card, white)"
					borderTopRadius="var(--tt-radius-xl, 20px)"
					boxShadow="0px -8px 30px rgba(0,0,0,0.18)"
					transform={visible ? 'translateY(0)' : 'translateY(100%)'}
					transition="transform 0.28s ease-out"
					overflowY="auto"
				>
					{content}
				</Box>
			) : (
				<Center
					className="userSettingsModal"
					position="fixed"
					zIndex={DRAWER_MODAL_Z}
					top={0}
					right={0}
					bottom={0}
					left={0}
					pointerEvents="none"
					padding={6}
				>
					<Box
						width="560px"
						maxWidth="100%"
						maxHeight="86vh"
						background="var(--tt-card, white)"
						borderRadius="var(--tt-radius-lg, 16px)"
						boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0,0,0,0.22))"
						transform={visible ? 'scale(1)' : 'scale(0.96)'}
						opacity={visible ? 1 : 0}
						transition="transform 0.22s ease-out, opacity 0.22s ease-out"
						overflowY="auto"
						pointerEvents="all"
					>
						{content}
					</Box>
				</Center>
			)}
		</>
	);
};
