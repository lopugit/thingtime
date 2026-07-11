import React from 'react';
import { Box, Button, Center, Flex, Input, Switch, Text } from '@chakra-ui/react';
import { stringify } from 'flatted';
import localforage from 'localforage';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';

import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z, DRAWER_TOP_LEVEL_DEFAULT_LIMIT, useDrawer, useIsMobileViewport } from './useDrawer';
import { AccountSwitcher } from '../../Account/AccountSwitcher';
import { useLopu } from '../../Lopu/useLopu';
import { ColorControl } from '../../ThemeSettings/controls';
import { useThingtime } from '../../Thingtime/useThingtime';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useTtTheme } from '~/hooks/useTtTheme';
import {
	electronAutoUpdateSettingPath,
	electronUrlSettingKey,
	electronUrlSettingPath,
	getElectronAutoUpdateEnabled,
	getElectronBridge,
	getElectronSettingUrl,
	loadElectronUrl,
	normalizeElectronUrl,
	type ThingtimeDesktopInfo,
	type ThingtimeDesktopUpdateInfo
} from '~/utils/electronBridge';

// User/app settings surface opened from the drawer's avatar button.
// Desktop: centre-aligned floating modal. Mobile: full-width slide-up sheet
// layered over the drawer / shifted page.

const waitForElectronSetting = (settingKey: string, expectedValue: string) =>
	new Promise<void>((resolve) => {
		if (typeof window === 'undefined') {
			resolve();
			return;
		}

		const startedAt = Date.now();
		const check = () => {
			const currentValue = window.thingtime?.settings?.electron?.[settingKey];

			if (currentValue === expectedValue || Date.now() - startedAt > 1500) {
				resolve();
				return;
			}

			requestAnimationFrame(check);
		};

		check();
	});

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
		resetOrdering
	} = useDrawer();

	const isMobile = useIsMobileViewport();
	const user = useCurrentUser();
	const api = useApi();
	const navigate = useNavigate();
	const lopu = useLopu();
	const { theme, preset, hasOverrides, appliedThemeShareId, builtinThemes, setPreset, setColor, setGeneral, resetOverrides } =
		useTtTheme();
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
	const [electronUrlDraft, setElectronUrlDraft] = React.useState('');
	const [electronUrlLoading, setElectronUrlLoading] = React.useState(false);
	const [electronUpdateInfo, setElectronUpdateInfo] = React.useState<ThingtimeDesktopUpdateInfo | null>(null);
	const [electronUpdateLoading, setElectronUpdateLoading] = React.useState(false);
	const [electronUpdateDownloadLoading, setElectronUpdateDownloadLoading] = React.useState(false);
	const electronUrlInputRef = React.useRef<HTMLInputElement | null>(null);
	const electronSessionHash = desktopInfo?.sessionHash || '';
	const electronStoredUrl = getElectronSettingUrl(thingtime, electronSessionHash);
	const electronAutoUpdateEnabled = getElectronAutoUpdateEnabled(thingtime, electronSessionHash);
	const electronSettingPathLabel = electronSessionHash ? electronUrlSettingPath(electronSessionHash) : '';
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
			lopu({ title: `Logged out — switched to @${resp.user.username} ✨`, status: 'success', duration: 6000 });
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
			.then((info) => {
				if (!cancelled) {
					setDesktopInfo(info);
				}
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

	React.useEffect(() => {
		if (!accountModalOpen || !desktopInfo) {
			return;
		}

		const savedUrl = normalizeElectronUrl(electronStoredUrl);
		const currentUrl = normalizeElectronUrl(desktopInfo.currentUrl);
		const originUrl = normalizeElectronUrl(desktopInfo.origin);
		setElectronUrlDraft(savedUrl || currentUrl || originUrl);
	}, [accountModalOpen, desktopInfo?.currentUrl, desktopInfo?.origin, desktopInfo, electronStoredUrl]);

	React.useEffect(() => {
		if (!accountModalOpen) {
			return;
		}

		const onElectronUpdateInfo = (event: Event) => {
			setElectronUpdateInfo((event as CustomEvent<ThingtimeDesktopUpdateInfo>).detail);
		};

		window.addEventListener('thingtime:electron-update-info', onElectronUpdateInfo);

		return () => {
			window.removeEventListener('thingtime:electron-update-info', onElectronUpdateInfo);
		};
	}, [accountModalOpen]);

	const handleElectronUrlLoad = React.useCallback(
		async (rawUrl: string, options?: { clearSavedUrl?: boolean }) => {
			const bridge = getElectronBridge();
			const sessionHash = desktopInfo?.sessionHash;
			const targetUrl = normalizeElectronUrl(rawUrl);

			if (!bridge || !sessionHash) {
				return;
			}

			if (!targetUrl) {
				lopu({
					title: 'Enter a valid URL',
					description: 'Use an http:// or https:// URL.',
					status: 'error',
					duration: 6000
				});
				return;
			}

			const storedValue = options?.clearSavedUrl ? '' : targetUrl;
			const settingKey = electronUrlSettingKey(sessionHash);

			setThingtime(electronUrlSettingPath(sessionHash), storedValue, {
				ignoreUndoRedo: true,
				namespace: 'electron'
			});
			setElectronUrlDraft(targetUrl);
			setElectronUrlLoading(true);

			try {
				await waitForElectronSetting(settingKey, storedValue);

				if (window.thingtime) {
					await localforage.setItem('thingtime', stringify(window.thingtime));
				}

				const nextInfo = await loadElectronUrl(bridge, targetUrl);
				setDesktopInfo(nextInfo);
				lopu({
					title: storedValue ? 'Electron URL updated' : 'Loaded bundled app',
					status: 'success',
					duration: 5000
				});
			} catch (error) {
				console.error('Unable to load Thingtime desktop URL', error);
				lopu({
					title: 'Could not load URL',
					description: error instanceof Error ? error.message : 'Thingtime desktop rejected that URL.',
					status: 'error',
					duration: 7000
				});
			} finally {
				setElectronUrlLoading(false);
			}
		},
		[desktopInfo, lopu, setThingtime]
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

	const handleElectronUpdateCheck = React.useCallback(async () => {
		const bridge = getElectronBridge();

		if (!bridge?.checkForUpdates) {
			lopu({
				title: 'Update checks unavailable',
				description: 'This Thingtime desktop build does not expose update checks.',
				status: 'error',
				duration: 6000
			});
			return;
		}

		setElectronUpdateLoading(true);

		try {
			const info = await bridge.checkForUpdates();
			setElectronUpdateInfo(info);
			lopu({
				title: info.updateAvailable ? 'Update available' : info.status === 'error' ? 'Update check failed' : 'Update check complete',
				description: info.message,
				status: info.status === 'error' ? 'error' : info.updateAvailable ? 'info' : 'success',
				duration: 7000
			});
		} catch (error) {
			console.error('Unable to check Thingtime desktop updates', error);
			lopu({
				title: 'Update check failed',
				description: error instanceof Error ? error.message : 'Thingtime desktop could not check for updates.',
				status: 'error',
				duration: 7000
			});
		} finally {
			setElectronUpdateLoading(false);
		}
	}, [lopu]);

	const handleElectronUpdateDownload = React.useCallback(async () => {
		const bridge = getElectronBridge();

		if (!bridge?.downloadUpdateBundle) {
			lopu({
				title: 'Update downloads unavailable',
				description: 'This Thingtime desktop build does not expose update downloads.',
				status: 'error',
				duration: 6000
			});
			return;
		}

		setElectronUpdateDownloadLoading(true);

		try {
			const info = await bridge.downloadUpdateBundle();
			setElectronUpdateInfo(info);
			lopu({
				title: 'Electron bundle downloaded',
				description: info.downloadPath || info.message,
				status: 'success',
				duration: 9000
			});
		} catch (error) {
			console.error('Unable to download Thingtime desktop update', error);
			lopu({
				title: 'Update download failed',
				description: error instanceof Error ? error.message : 'Thingtime desktop could not download the release bundle.',
				status: 'error',
				duration: 8000
			});
		} finally {
			setElectronUpdateDownloadLoading(false);
		}
	}, [lopu]);

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

			{desktopInfo?.sessionHash && (
				<Flex flexDirection="column" rowGap={3}>
					<Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
						Electron
					</Text>
					<Flex flexDirection="column" rowGap={2}>
						<Box minWidth={0}>
							<Text fontSize="sm">Session URL</Text>
							<Text fontSize="xs" opacity={0.55} wordBreak="break-all">
								{electronSettingPathLabel}
							</Text>
						</Box>
						<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
							<Input
								ref={electronUrlInputRef}
								size="sm"
								flex="1 1 260px"
								minWidth={0}
								value={electronUrlDraft}
								placeholder={desktopInfo.origin || 'https://thingtime.com/'}
								onChange={(event) => setElectronUrlDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										handleElectronUrlLoad(electronUrlInputRef.current?.value || electronUrlDraft);
									}
								}}
							/>
							<Button
								size="xs"
								variant="solid"
								isLoading={electronUrlLoading}
								onClick={() => handleElectronUrlLoad(electronUrlInputRef.current?.value || electronUrlDraft)}
							>
								Load
							</Button>
						</Flex>
						<Flex columnGap={2} rowGap={2} flexWrap="wrap">
							<Button
								size="xs"
								variant="outline"
								isDisabled={!desktopInfo.origin || electronUrlLoading}
								onClick={() => handleElectronUrlLoad(desktopInfo.origin || '', { clearSavedUrl: true })}
							>
								Bundled
							</Button>
							<Button
								size="xs"
								variant="outline"
								isDisabled={electronUrlLoading}
								onClick={() => handleElectronUrlLoad('https://thingtime.com/')}
							>
								Production
							</Button>
							{electronStoredUrl && (
								<Button
									size="xs"
									variant="ghost"
									isDisabled={electronUrlLoading}
									onClick={() => {
										setThingtime(electronSettingPath(electronSessionHash), '', {
											ignoreUndoRedo: true,
											namespace: 'electron'
										});
										setElectronUrlDraft(normalizeElectronUrl(desktopInfo.currentUrl) || normalizeElectronUrl(desktopInfo.origin));
									}}
								>
									Clear
								</Button>
							)}
							</Flex>
						</Flex>
						<Flex flexDirection="column" rowGap={2} paddingTop={2} borderTop="1px solid" borderColor="blackAlpha.100">
							<Flex alignItems="center" columnGap={4}>
								<Box minWidth={0}>
									<Text fontSize="sm">Updates</Text>
									<Text fontSize="xs" opacity={0.55} wordBreak="break-all">
										{electronAutoUpdatePathLabel}
									</Text>
								</Box>
								<Switch
									marginLeft="auto"
									isChecked={electronAutoUpdateEnabled}
									onChange={(event) => handleElectronAutoUpdateChange(event.target.checked)}
								></Switch>
							</Flex>
							<Text fontSize="xs" opacity={0.55} wordBreak="break-word">
								{electronUpdateInfo?.message ||
									`Current version ${desktopInfo.appVersion || 'unknown'}. Downloads use the latest GitHub release asset for Electron App Release.`}
							</Text>
							{electronUpdateInfo?.asset?.name && (
								<Text fontSize="xs" opacity={0.55} wordBreak="break-all">
									{electronUpdateInfo.asset.name}
								</Text>
							)}
							{electronUpdateInfo?.downloadPath && (
								<Text fontSize="xs" opacity={0.55} wordBreak="break-all">
									{electronUpdateInfo.downloadPath}
								</Text>
							)}
							<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap">
								<Button size="xs" variant="outline" isLoading={electronUpdateLoading} onClick={handleElectronUpdateCheck}>
									Check
								</Button>
								<Button
									size="xs"
									variant="solid"
									isLoading={electronUpdateDownloadLoading}
									onClick={handleElectronUpdateDownload}
								>
									Download
								</Button>
								{electronUpdateInfo?.releaseUrl && (
									<Button as="a" size="xs" variant="ghost" href={electronUpdateInfo.releaseUrl} target="_blank" rel="noreferrer">
										Release
									</Button>
								)}
								{electronUpdateInfo?.checkedAt && (
									<Text fontSize="xs" opacity={0.5}>
										{new Date(electronUpdateInfo.checkedAt).toLocaleString()}
									</Text>
								)}
							</Flex>
						</Flex>
					</Flex>
				)}

			{/* drawer preferences */}
			<Flex flexDirection="column" rowGap={0}>
				<Text
					paddingBottom={2}
					fontSize="10px"
					fontWeight={600}
					letterSpacing="0.08em"
					textTransform="uppercase"
					opacity={0.45}
				>
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
					<Switch
						isChecked={searchClosesDrawer}
						onChange={(e) => setSearchClosesDrawer(e.target.checked)}
					></Switch>,
					'Close the drawer when opening search'
				)}

				{settingRow(
					'Top-level items',
					<Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap" justifyContent="flex-end">
						<Button
							size="xs"
							variant="outline"
							onClick={lowerTopLevelLimit}
							isDisabled={!topLevelLimitIsUnlimited && topLevelLimitValue <= 1}
						>
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
			</Flex>

			{/* theming */}
			<Flex flexDirection="column" rowGap={0}>
				<Text
					paddingBottom={2}
					fontSize="10px"
					fontWeight={600}
					letterSpacing="0.08em"
					textTransform="uppercase"
					opacity={0.45}
				>
					Theming
				</Text>

				{settingRow(
					'Theme',
					<Flex columnGap={1} flexWrap="wrap" justifyContent="flex-end">
						{builtinThemes.map((builtin) => {
							const active = preset === builtin.name && !hasOverrides && !appliedThemeShareId;
							return (
								<Button
									key={builtin.name}
									size="xs"
									variant={active ? 'solid' : 'ghost'}
									onClick={() => handlePreset(builtin.name)}
								>
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
					'Motion',
					<Switch isChecked={theme.general.motion} onChange={(e) => setGeneral('motion', e.target.checked)}></Switch>,
					'Rainbow + decorative animation'
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
