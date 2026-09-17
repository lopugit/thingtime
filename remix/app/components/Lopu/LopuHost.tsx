import { useLopuVisualViewport } from './useLopuVisualViewport';
import React from 'react';
import { Box, Button, Center, Flex, Select, Switch, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { useLocation, useNavigate } from 'react-router';
import { ChevronDown, Maximize2, Mic, Minus, PanelsTopLeft, X } from 'lucide-react';

import { LopuActivityBadge, LopuRingAvatar, useLopuStreamingActivity } from './LopuActivityBadge';
import { LopuChatView } from './LopuChatView';
import { LopuWindowConversations } from './LopuWindowConversations';
import { getLopuStoreServerSnapshot, getLopuStoreSnapshot, selectLopuProviderNames, setLopuSettings, subscribeLopuStore, type LopuVaultProvider } from './lopuChatStore';
import { useLopuAccount } from './useLopuAccount';
import { handlesLopuLinkInApp } from './lopuLinkActivation';
import { vaultProviderUnavailableReason } from './lopuProviderCore';
import { LopuVoiceSurface, lopuVoicePhaseLabel, type LopuVoicePhase } from './LopuVoiceControls';
import { LOPU_UI, lopuIconButtonSx, lopuRainbowRing } from './lopuTheme';
import {
	LOPU_LAUNCHER_BOTTOM_INSET,
	LOPU_LAUNCHER_INSET,
	LOPU_LAUNCHER_SIZE,
	LOPU_PAGE_PATH,
	LOPU_VOICE_PATH,
	resizeLopuWindow,
	type LopuResizeEdge,
	clampLopuLauncherPosition,
	clampLopuWindowGeometry,
	describeLopuEffort,
	describeLopuModelChoice,
	dockedLopuWindowGeometry,
	findLopuCatalogModel,
	isLopuHostHiddenOnPath,
	preferredLopuEffort,
	readLopuLauncherPosition,
	readLopuWindowGeometry,
	resolveLopuModelChoice,
	resolveLopuWindowGeometry,
	useLopuModelCatalog,
	useLopuSettings,
	writeLopuLauncherPosition,
	writeLopuWindowGeometry,
	type LopuCatalog,
	type LopuDock,
	type LopuPoint,
	type LopuViewport,
	type LopuWindowGeometry
} from './useLopuSettings';
import { LOPU_LAUNCHER_Z, LOPU_WINDOW_Z, useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import { startPointerGesture } from '../Thingtime/EditorSplit';
import { useOutsideTapClose } from '~/hooks/useOutsideTapClose';
import { shouldIgnoreGlobalKeydown } from '~/utils/editableTarget';

// 🦄 The global floating Lopu: a draggable launcher bubble (bottom-right,
// stacked above DevKit) and a draggable / resizable / dockable chat window
// that renders the same LopuChatView as the /lopu page (they share one chat
// store, so a conversation continues wherever you open it). The window's
// mic flips it into voice mode with the same LopuVoiceSurface the page
// uses. Mounted once from root.tsx after DrawerSystem; hidden on /lopu*
// itself. The launcher setting hides the bubble only — the navbar's
// LopuNavButton can still open the window.
//
// Layering: LOPU_WINDOW_Z sits with the floating editor windows (above the
// drawer panel, below a hovered drawer, popups and modals); LOPU_LAUNCHER_Z
// keeps the bubble reachable above everything but popups/modals/DevKit.
// The window is non-modal chrome (a complementary region, never a dialog
// role) and never grabs focus on its own: a page input keeps the caret when
// Lopu appears.

const DRAG_THRESHOLD_PX = 4;
const HEADER_HEIGHT_PX = 48;
const DOCK_HANDLE_PX = 6;
// below this width the header drops the model chip (the status line still names the model)
const CHIP_MIN_WINDOW_WIDTH = 380;
const SHEET_DISMISS_PX = 120;

const readViewport = (): LopuViewport => ({
	width: typeof window === 'undefined' ? 1 : window.innerWidth,
	height: typeof window === 'undefined' ? 1 : window.innerHeight
});

const isControlTarget = (target: EventTarget | null): boolean => {
	return !!(target as Element | null)?.closest?.('[data-lopu-control]');
};

const launcherPulse = keyframes`
	0% { transform: scale(0.92); opacity: 0.8; }
	70% { transform: scale(1.4); opacity: 0; }
	100% { transform: scale(1.4); opacity: 0; }
`;

// Render errors inside the chat view must never take the whole app shell
// down with them (LopuHost lives in root.tsx).
class LopuHostBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error) {
		console.error('[lopu] floating chat crashed', error);
	}

	render() {
		if (this.state.error) {
			return (
				<Flex flexDirection="column" alignItems="center" justifyContent="center" rowGap={2} flex="1" padding={6} textAlign="center">
					<Text fontSize="sm" fontWeight={600}>
						Lopu tripped over its horn 🌧️
					</Text>
					<Text fontSize="xs" color={LOPU_UI.muted}>
						{this.state.error.message || 'Something went wrong while drawing the chat.'}
					</Text>
					<Button size="xs" variant="outline" onClick={() => this.setState({ error: null })}>
						Try again
					</Button>
				</Flex>
			);
		}
		return this.props.children;
	}
}

const HeaderButton = (props: { title: string; onClick: () => void; children: React.ReactNode; active?: boolean; href?: string }) => (
	<Center
		as={props.href ? 'a' : 'button'}
		{...(props.href ? { href: props.href } : { type: 'button' as const })}
		data-lopu-control
		aria-label={props.title}
		aria-pressed={props.active}
		title={props.title}
		width="28px"
		height="28px"
		flexShrink={0}
		cursor="pointer"
		background={props.active ? LOPU_UI.surfaceAlt : 'transparent'}
		sx={{ ...lopuIconButtonSx, color: props.active ? LOPU_UI.ink : LOPU_UI.muted }}
		_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '1px' }}
		onClick={(event: React.MouseEvent) => {
			if (props.href) {
				// Leave modified clicks to the browser, including opening a new tab/window.
				if (!handlesLopuLinkInApp(event)) return;
				event.preventDefault();
			}
			props.onClick();
		}}
	>
		{props.children}
	</Center>
);

// The header's model chip: shows what the CURRENT CHAT thinks with — the
// viewer's own Secure Vault provider when one is pinned (the shared store's
// per-chat settings), else the effective catalog model — and opens a small
// in-window picker (a plain absolutely-positioned list — Chakra's portal
// menus would layer beneath the window's z rung) listing the viewer's
// providers above the catalog.
const ModelChip = (props: { catalog: LopuCatalog; hasCatalog: boolean; providerId: string | null; providerName: string | null; vaultProviders: LopuVaultProvider[] }) => {
	const { catalog, hasCatalog, providerId, providerName, vaultProviders } = props;
	const { settings, setModelChoice } = useLopuSettings();
	const [menuOpen, setMenuOpen] = React.useState(false);
	const menuRef = useOutsideTapClose<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

	const choice = resolveLopuModelChoice(catalog, settings);
	const model = findLopuCatalogModel(catalog, choice.model);
	const label = providerName ?? model?.label ?? (choice.model ? choice.model : catalog.models.length ? 'No model' : 'Auto');
	const optionSx = (selected: boolean, disabled: boolean) => ({
		alignItems: 'center',
		columnGap: 2,
		textAlign: 'left' as const,
		paddingX: 2,
		paddingY: '6px',
		borderRadius: LOPU_UI.radiusSm,
		opacity: disabled ? 0.45 : 1,
		cursor: disabled ? 'not-allowed' : 'pointer',
		background: selected ? LOPU_UI.surfaceAlt : 'transparent',
		_hover: disabled ? undefined : { background: LOPU_UI.surfaceHover }
	});

	return (
		<Box ref={menuRef} position="relative" data-lopu-control minWidth={0}>
			<Flex
				as="button"
				type="button"
				aria-haspopup="listbox"
				aria-expanded={menuOpen}
				title={hasCatalog ? 'Choose the model Lopu thinks with' : 'Model'}
				alignItems="center"
				columnGap={1}
				maxWidth="128px"
				paddingX={2}
				height="24px"
				borderRadius="999px"
				border={LOPU_UI.border}
				background={LOPU_UI.surfaceAlt}
				color={LOPU_UI.muted}
				cursor="pointer"
				transition={`color ${LOPU_UI.transitionFast}, border-color ${LOPU_UI.transitionFast}`}
				_hover={{ color: LOPU_UI.ink, borderColor: LOPU_UI.faint }}
				_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '1px' }}
				onClick={() => setMenuOpen((prev) => !prev)}
			>
				<Text fontSize={LOPU_UI.fontTiny} fontWeight={600} noOfLines={1} wordBreak="break-all">
					{label}
				</Text>
				<ChevronDown size={11} strokeWidth={2} />
			</Flex>
			{menuOpen && (
				<Flex
					role="listbox"
					aria-label="Lopu model"
					position="absolute"
					right={0}
					top="calc(100% + 6px)"
					zIndex={2}
					flexDirection="column"
					minWidth="240px"
					maxHeight="280px"
					overflowY="auto"
					padding={1}
					background={LOPU_UI.card}
					border={LOPU_UI.border}
					borderRadius={LOPU_UI.radiusMd}
					boxShadow={LOPU_UI.shadowFloating}
				>
					{catalog.models.length === 0 && (
						<Text fontSize="xs" color={LOPU_UI.muted} padding={2}>
							{hasCatalog ? 'No models in the catalog yet.' : 'Loading models…'}
						</Text>
					)}
					{vaultProviders.length > 0 && (
						<Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={LOPU_UI.muted} paddingX={2} paddingTop={1} paddingBottom="2px">
							Your providers
						</Text>
					)}
					{vaultProviders.map((entry) => {
						const selected = providerId === entry.id;
						const reason = vaultProviderUnavailableReason(entry);
						const disabled = !!reason;
						return (
							<Flex
								key={entry.id}
								as="button"
								type="button"
								role="option"
								aria-selected={selected}
								disabled={disabled}
								title={reason || `Think with ${entry.name}`}
								{...optionSx(selected, disabled)}
								onClick={() => {
									if (disabled) {
										return;
									}
									setLopuSettings({ providerId: entry.id });
									setMenuOpen(false);
								}}
							>
								<Box minWidth={0} flex="1">
									<Text fontSize="xs" fontWeight={selected ? 700 : 500} noOfLines={1} color={LOPU_UI.ink}>
										{entry.name}
									</Text>
									<Text fontSize="10px" color={LOPU_UI.muted} noOfLines={1}>
										{entry.model || entry.endpointHost || entry.kind}
										{reason ? ` · ${reason}` : ''}
									</Text>
								</Box>
								{selected && (
									<Text fontSize="xs" flexShrink={0} color={LOPU_UI.ink}>
										✓
									</Text>
								)}
							</Flex>
						);
					})}
					{vaultProviders.length > 0 && catalog.models.length > 0 && (
						<Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={LOPU_UI.muted} paddingX={2} paddingTop={2} paddingBottom="2px">
							Thingtime models
						</Text>
					)}
					{catalog.models.map((entry) => {
						const selected = !providerId && choice.model === entry.id;
						const disabled = !entry.available;
						return (
							<Flex
								key={entry.id}
								as="button"
								type="button"
								role="option"
								aria-selected={selected}
								disabled={disabled}
								{...optionSx(selected, disabled)}
								title={disabled ? (entry.enabled ? `needs ${entry.provider} key` : 'disabled by an admin') : undefined}
								onClick={() => {
									if (disabled) {
										return;
									}
									// a catalog pick also leaves the chat's own provider
									if (providerId) setLopuSettings({ providerId: null });
									setModelChoice({ model: entry.id, effort: preferredLopuEffort(entry, catalog.defaults.effort), speed: null });
									setMenuOpen(false);
								}}
							>
								<Box minWidth={0} flex="1">
									<Text fontSize="xs" fontWeight={selected ? 700 : 500} noOfLines={1} color={LOPU_UI.ink}>
										{entry.label}
									</Text>
									<Text fontSize="10px" color={LOPU_UI.muted} noOfLines={1}>
										{entry.provider}
										{disabled ? (entry.enabled ? ` · needs ${entry.provider} key` : ' · disabled') : ''}
										{entry.isDefault ? ' · default' : ''}
									</Text>
								</Box>
								{selected && (
									<Text fontSize="xs" flexShrink={0} color={LOPU_UI.ink}>
										✓
									</Text>
								)}
							</Flex>
						);
					})}
					{settings.model && (
						<Flex
							as="button"
							type="button"
							alignItems="center"
							paddingX={2}
							paddingY="6px"
							marginTop={1}
							borderTop={LOPU_UI.border}
							cursor="pointer"
							_hover={{ background: LOPU_UI.surfaceHover }}
							onClick={() => {
								setModelChoice({ model: null, effort: null, speed: null });
								setMenuOpen(false);
							}}
						>
							<Text fontSize="xs" color={LOPU_UI.muted}>
								Use the catalog default
							</Text>
						</Flex>
					)}
				</Flex>
			)}
		</Box>
	);
};

// Settings rows shared by UserSettingsModal (settingRow closure) and
// SettingsPage (SettingRow component): each host passes its own row renderer
// so the same controls land in both surfaces without duplicating the logic.
export const LopuSettingsRows = (props: { renderRow: (label: string, control: React.ReactNode, hint?: string) => React.ReactNode }) => {
	const { renderRow } = props;
	const { settings, setLauncher, setDock, setApplyPatches, setConfirmDeletes, setEnterSends, setModelChoice, setEffort, setSpeed, setSpokenReplies, setTranscribe, setDirectVoice, setDockMode, setAttachCurrentPage } =
		useLopuSettings();
	const { catalog, hasCatalog } = useLopuModelCatalog(true);
	const choice = resolveLopuModelChoice(catalog, settings);
	const chosenModel = findLopuCatalogModel(catalog, choice.model);
	const offersFast = !!chosenModel?.speeds.includes('fast');

	return (
		<>
			{renderRow(
				'Floating Lopu 🦄',
				<Switch isChecked={settings.launcher} onChange={(event) => setLauncher(event.target.checked)} aria-label="Show the floating Lopu bubble" />,
				'Show the draggable Lopu bubble on every page (the navbar 🦄 opens Lopu either way)'
			)}
			{renderRow(
				'Window docking',
				<Flex columnGap={1} flexWrap="wrap">
					{(['free', 'right', 'left', 'top', 'bottom'] as LopuDock[]).map((dock) => (
						<Button key={dock} size="xs" variant={settings.dock === dock ? 'solid' : 'ghost'} onClick={() => setDock(dock)}>
							{dock[0].toUpperCase() + dock.slice(1)}
						</Button>
					))}
				</Flex>,
				'Float anywhere, or pin the chat to a viewport edge (double-click its header to toggle)'
			)}
			{renderRow('Dock behavior', <Select size="sm" aria-label="Dock behavior" value={settings.dockMode} onChange={event => setDockMode(event.target.value as 'overlay' | 'split')}><option value="overlay">Overlay</option><option value="split">Split</option></Select>, 'Split resizes the page beside Lopu; overlay draws over it')}
			{renderRow('Attach current page', <Switch isChecked={settings.attachCurrentPage} onChange={event => setAttachCurrentPage(event.target.checked)} aria-label="Automatically attach the current page" />, 'Include the current page URL and open builder draft with each message')}
			{renderRow(
				'Apply builder changes live',
				<Switch isChecked={settings.applyPatches} onChange={(event) => setApplyPatches(event.target.checked)} aria-label="Apply builder changes live" />,
				'Lopu’s page and component edits paint into the open draft while it is still typing'
			)}
			{renderRow(
				'Confirm conversation deletes',
				<Switch isChecked={settings.confirmDeletes} onChange={(event) => setConfirmDeletes(event.target.checked)} aria-label="Confirm conversation deletes" />,
				'Ask before deleting a conversation from the list (Lopu’s own deletes always wait for your Confirm card)'
			)}
			{renderRow(
				'Enter sends',
				<Switch isChecked={settings.enterSends} onChange={(event) => setEnterSends(event.target.checked)} aria-label="Enter sends the message" />,
				'Enter sends your message and Shift+Enter adds a line'
			)}
			{renderRow(
				'Spoken replies',
				<Switch isChecked={settings.spokenReplies} onChange={(event) => setSpokenReplies(event.target.checked)} aria-label="Spoken replies" />,
				'Voice mode reads Lopu’s replies aloud (off: text only)'
			)}
			{renderRow(
				'Transcribe mode',
				<Switch isChecked={settings.transcribe} onChange={(event) => setTranscribe(event.target.checked)} aria-label="Transcribe mode" />,
				'Voice mode saves each utterance as a private transcript page and quotes it back instead of asking Lopu'
			)}
			{renderRow(
				'Direct voice',
				<Switch isChecked={settings.directVoice} onChange={(event) => setDirectVoice(event.target.checked)} aria-label="Direct voice" />,
				'Voice mode streams your microphone straight to the chat’s own Secure Vault provider when it offers realtime speech (xAI Grok Voice); otherwise the standard path runs'
			)}
			{renderRow(
				'Preferred model',
				<Select
					size="xs"
					maxWidth="220px"
					value={settings.model ?? ''}
					aria-label="Preferred model"
					onChange={(event) => {
						const model = findLopuCatalogModel(catalog, event.target.value);
						setModelChoice({ model: model?.id ?? null, effort: preferredLopuEffort(model, catalog.defaults.effort), speed: null });
					}}
				>
					<option value="">Catalog default{catalog.defaults.model ? ` (${findLopuCatalogModel(catalog, catalog.defaults.model)?.label ?? catalog.defaults.model})` : ''}</option>
					{catalog.models.map((model) => (
						<option key={model.id} value={model.id} disabled={!model.available}>
							{model.label}
							{model.available ? '' : model.enabled ? ` — needs ${model.provider} key` : ' — disabled'}
						</option>
					))}
				</Select>,
				hasCatalog ? 'Which model Lopu thinks with by default; the composer can still change it per turn' : 'Loading the model catalog…'
			)}
			{!!chosenModel?.efforts.length &&
				renderRow(
					'Reasoning effort',
					<Select size="xs" maxWidth="220px" value={choice.effort ?? ''} aria-label="Reasoning effort" onChange={(event) => setEffort(event.target.value || null)}>
						{chosenModel.efforts.map((effort) => (
							<option key={effort} value={effort}>
								{describeLopuEffort(effort)}
							</option>
						))}
					</Select>,
					'Deeper effort thinks longer before answering'
				)}
			{offersFast &&
				renderRow(
					'Fast mode ⚡',
					<Switch isChecked={choice.speed === 'fast'} onChange={(event) => setSpeed(event.target.checked ? 'fast' : 'normal')} aria-label="Fast mode" />,
					'Trade a little depth for snappier replies'
				)}
		</>
	);
};

export const LopuHost = () => {
	const visualViewport = useLopuVisualViewport();
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const isMobile = useIsMobileViewport();
	const { settings, open, setOpen, toggleOpen, setDock, setMinimised, setDockMode } = useLopuSettings();
	const streaming = useLopuStreamingActivity();

	const [viewport, setViewport] = React.useState<LopuViewport>(readViewport);
	const [launcherRaw, setLauncherRaw] = React.useState<LopuPoint | null>(readLopuLauncherPosition);
	const [windowRaw, setWindowRaw] = React.useState<Partial<LopuWindowGeometry> | null>(readLopuWindowGeometry);
	const [gesture, setGesture] = React.useState<'launcher' | 'move' | 'resize' | 'sheet' | null>(null);
	const minimised = settings.minimised;
	const [layoutOpen, setLayoutOpen] = React.useState(false);
	const layoutRef = useOutsideTapClose<HTMLDivElement>(layoutOpen, () => setLayoutOpen(false));
	const [voiceMode, setVoiceMode] = React.useState(false);
	const [voicePhase, setVoicePhase] = React.useState<LopuVoicePhase>('idle');
	const [sheetOffset, setSheetOffset] = React.useState(0);

	const windowRef = React.useRef<HTMLDivElement | null>(null);
	const launcherRef = React.useRef<HTMLButtonElement | null>(null);
	// a drag that moved past the threshold must not also count as a click
	const launcherMovedRef = React.useRef(false);

	// the /lopu page IS the chat: nothing floats there. The launcher setting
	// hides the bubble only — the window still follows `open` (the navbar
	// 🦄 toggles it)
	const hiddenOnPath = isLopuHostHiddenOnPath(pathname);
	const showLauncher = !hiddenOnPath && (settings.launcher || minimised);
	const showWindow = !hiddenOnPath && open && !minimised;
	const showSheet = showWindow && isMobile;
	const showFrame = showWindow && !isMobile;
	const docked = settings.dock !== 'free';

	const { catalog, hasCatalog } = useLopuModelCatalog(showWindow);
	// the shared chat store: the current chat's pinned provider + the viewer's
	// vault list (no loads are triggered here — the window's chat view hydrates it)
	const chatStore = React.useSyncExternalStore(subscribeLopuStore, getLopuStoreSnapshot, getLopuStoreServerSnapshot);
	const chatProviderId = chatStore.settings.providerId;
	const chatProviderName = chatProviderId ? selectLopuProviderNames(chatStore)[chatProviderId] || 'Your provider' : null;
	// the access gate (verified-credits design note §4): the window / sheet
	// body draws LopuLockedState through LopuChatView / LopuVoiceSurface; the
	// header's status line and chip follow (the cache seeds it, no fetch here
	// until the window opens)
	const account = useLopuAccount({ byo: !!chatProviderId, active: showWindow });
	const locked = account.access.locked && account.access.reason === 'unverified';

	// keep both surfaces on screen when the viewport changes
	React.useEffect(() => {
		const onResize = () => setViewport(readViewport());
		onResize();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// a fresh open always starts expanded, in chat mode
	React.useEffect(() => {
		if (!open) {
			setVoiceMode(false);
			setVoicePhase('idle');
			setSheetOffset(0);
		}
	}, [open]);

	const launcherPos = launcherRaw ? clampLopuLauncherPosition(launcherRaw, viewport) : null;
	const freeGeometry = resolveLopuWindowGeometry(windowRaw, viewport, launcherPos);
	const geometry = docked ? dockedLopuWindowGeometry(settings.dock as Exclude<LopuDock, 'free'>, freeGeometry.width, viewport, freeGeometry.height, settings.dockMode === 'split') : freeGeometry;

	// Escape closes the window — from inside it, or from anywhere on the page
	// that is not a text field (a caret in a page input keeps its Escape).
	React.useEffect(() => {
		if (!showWindow) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || event.defaultPrevented) {
				return;
			}
			const inside = !!windowRef.current?.contains(event.target as Node);
			if (!inside && shouldIgnoreGlobalKeydown(event)) {
				return;
			}
			// an open menu/picker/popover inside the window (model chip,
			// composer picker, voice gear) owns this Escape — it closes the
			// menu, not the window
			if (windowRef.current?.querySelector('[aria-expanded="true"]:not([data-lopu-conversations-toggle])')) {
				return;
			}
			setOpen(false);
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [showWindow, setOpen]);

	// freeze the page behind the mobile sheet (mirrors DrawerSystem)
	React.useEffect(() => {
		if (!showSheet) {
			return;
		}
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		// the sheet spans the viewport, so the DevKit corner trigger (which
		// hides itself via this attribute) would otherwise sit on the composer
		document.documentElement.setAttribute('data-lopu-sheet', 'open');
		return () => {
			document.body.style.overflow = previous;
			document.documentElement.removeAttribute('data-lopu-sheet');
		};
	}, [showSheet]);

	// one destination for both the expand control's href and the in-app
	// navigation, so a new tab and a plain click can never land anywhere else
	const fullPath = voiceMode ? LOPU_VOICE_PATH : LOPU_PAGE_PATH;

	const openFull = React.useCallback(() => {
		setOpen(false);
		navigate(fullPath);
	}, [fullPath, navigate, setOpen]);

	const close = React.useCallback(() => {
		setOpen(false);
	}, [setOpen]);

	const toggleVoice = React.useCallback(() => {
		setVoiceMode((prev) => !prev);
	}, []);

	// launcher: drag to reposition (persisted per device), click to toggle
	const onLauncherPointerDown = React.useCallback((event: React.PointerEvent) => {
		if (event.button !== 0) {
			return;
		}
		const rect = launcherRef.current?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		const startX = event.clientX;
		const startY = event.clientY;
		const origin = { x: rect.left, y: rect.top };
		let moved = false;
		let latest: LopuPoint | null = null;

		startPointerGesture(
			event,
			(move) => {
				const dx = move.clientX - startX;
				const dy = move.clientY - startY;
				if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
					return;
				}
				if (!moved) {
					moved = true;
					launcherMovedRef.current = true;
					setGesture('launcher');
				}
				latest = clampLopuLauncherPosition({ x: origin.x + dx, y: origin.y + dy }, readViewport());
				setLauncherRaw(latest);
			},
			() => {
				setGesture(null);
				if (latest) {
					writeLopuLauncherPosition(latest);
				}
				// the click for this press fires synchronously after pointerup;
				// clear the flag once it has had its chance to be swallowed
				setTimeout(() => {
					launcherMovedRef.current = false;
				}, 0);
			}
		);
	}, []);

	const onLauncherClick = React.useCallback(() => {
		if (launcherMovedRef.current) {
			return;
		}
		toggleOpen();
	}, [toggleOpen]);

	// window: drag by the header (undocks), double-click the header to dock
	const onHeaderPointerDown = React.useCallback(
		(event: React.PointerEvent) => {
			if (event.button !== 0 || isControlTarget(event.target)) {
				return;
			}
			// no text selection while dragging, and the caret stays wherever it was
			event.preventDefault();
			const startX = event.clientX;
			const startY = event.clientY;
			// a docked column comes free at its last floating size, keeping the
			// pointer's grip on the header (same left edge and width)
			const origin = docked ? { x: geometry.x, y: geometry.y, width: freeGeometry.width, height: freeGeometry.height } : geometry;
			let moved = false;
			let latest: LopuWindowGeometry | null = null;

			startPointerGesture(
				event,
				(move) => {
					const dx = move.clientX - startX;
					const dy = move.clientY - startY;
					if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
						return;
					}
					if (!moved) {
						moved = true;
						setGesture('move');
						if (docked) {
							// pull a docked window free under the pointer
							setDock('free');
						}
					}
					latest = clampLopuWindowGeometry({ ...origin, x: origin.x + dx, y: origin.y + dy }, readViewport());
					setWindowRaw(latest);
				},
				() => {
					setGesture(null);
					if (latest) {
						writeLopuWindowGeometry(latest);
					}
				}
			);
		},
		[docked, freeGeometry, geometry, setDock]
	);

	const onHeaderDoubleClick = React.useCallback(
		(event: React.MouseEvent) => {
			if (isControlTarget(event.target)) {
				return;
			}
			if (docked) {
				setDock('free');
			} else {
				// remember the free frame so undocking restores it
				setWindowRaw(geometry);
				setDock('right');
			}
		},
		[docked, geometry, setDock]
	);

	// A resize keeps the opposite edges anchored, including north/west grips.
	const onResizePointerDown = (event: React.PointerEvent, edge: LopuResizeEdge) => {
		if (event.button !== 0) return;
		event.preventDefault(); event.stopPropagation();
		const startX = event.clientX, startY = event.clientY;
		const origin = geometry;
		let latest: LopuWindowGeometry | null = null;
		setGesture('resize');
		startPointerGesture(event, move => {
			const dx = move.clientX - startX, dy = move.clientY - startY;
			if (docked) {
				const horizontal = settings.dock === 'top' || settings.dock === 'bottom';
				const size = dockedLopuWindowGeometry(settings.dock as Exclude<LopuDock, 'free'>,
					origin.width + (settings.dock === 'right' ? -dx : dx), readViewport(),
					origin.height + (settings.dock === 'bottom' ? -dy : dy), settings.dockMode === 'split');
				latest = { ...freeGeometry, ...(horizontal ? { height: size.height } : { width: size.width }) };
			} else latest = resizeLopuWindow(origin, edge, dx, dy, readViewport());
			setWindowRaw(latest);
		}, () => { setGesture(null); if (latest) writeLopuWindowGeometry(latest); });
	};

	// mobile sheet: drag the handle down to dismiss
	const onSheetHandlePointerDown = React.useCallback(
		(event: React.PointerEvent) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			const startY = event.clientY;
			let latest = 0;
			setGesture('sheet');
			startPointerGesture(
				event,
				(move) => {
					latest = Math.max(0, move.clientY - startY);
					setSheetOffset(latest);
				},
				() => {
					setGesture(null);
					if (latest > SHEET_DISMISS_PX) {
						setOpen(false);
					} else {
						setSheetOffset(0);
					}
				}
			);
		},
		[setOpen]
	);

	React.useEffect(() => { document.getElementById('lopuPageScroll')?.scrollTo(0, 0); }, [pathname]);

	// Resize the app's own containing viewport, so fixed navigation and drawers
	// follow the remaining page area rather than hiding behind a split dock.
	React.useLayoutEffect(() => {
		const page = document.getElementById('lopuPageViewport');
		const split = showFrame && docked && settings.dockMode === 'split';
		if (!page) return;
		page.toggleAttribute('data-lopu-split', split);
		for (const side of ['top', 'right', 'bottom', 'left'] as const) {
			page.style.setProperty(`--lopu-inset-${side}`, split && settings.dock === side ? `${side === 'top' || side === 'bottom' ? geometry.height : geometry.width}px` : '0px');
		}
		page.style.setProperty('--thingtime-page-height', split && (settings.dock === 'top' || settings.dock === 'bottom') ? `${viewport.height - geometry.height}px` : '100dvh');
		// The editing chip lives inside the resized page; the dock itself needs no gap.
		document.documentElement.toggleAttribute('data-lopu-docked', showFrame && docked);
		return () => { page.removeAttribute('data-lopu-split'); document.documentElement.removeAttribute('data-lopu-docked'); };
	}, [showFrame, docked, settings.dock, settings.dockMode, geometry.height, geometry.width, viewport.height]);

	if (hiddenOnPath) {
		return null;
	}

	const choice = resolveLopuModelChoice(catalog, settings);
	const chipVisible = !minimised && !voiceMode && !locked && (isMobile || geometry.width >= CHIP_MIN_WINDOW_WIDTH);
	const detail = [describeLopuEffort(choice.effort), choice.speed === 'fast' ? 'Fast ⚡' : null].filter(Boolean).join(' · ');
	// the chat's own provider (per-chat store settings) wins over the
	// catalog choice in the header, exactly as it does for the turn
	const status = locked
		? 'Invite-only for now'
		: streaming
		? 'Replying…'
		: voiceMode
			? voicePhase === 'idle'
				? 'Voice · tap the mic'
				: lopuVoicePhaseLabel(voicePhase)
			: chatProviderName
				? chipVisible
					? 'Your provider'
					: chatProviderName
				: chipVisible
					? detail || 'Ready'
					: describeLopuModelChoice(catalog, settings);

	const header = (variant: 'frame' | 'sheet') => (
		<Flex
			className="lopuWindowHeader"
			alignItems="center"
			columnGap={2}
			flexShrink={0}
			height={`${HEADER_HEIGHT_PX}px`}
			paddingLeft={3}
			paddingRight={2}
			borderBottom={LOPU_UI.border}
			background={LOPU_UI.card}
			cursor={variant === 'frame' ? (gesture === 'move' ? 'grabbing' : 'grab') : 'default'}
			userSelect="none"
			sx={{ touchAction: 'none' }}
			title={variant === 'frame' ? (docked ? 'Drag to float · double-click to undock' : 'Drag to move · double-click to dock right') : undefined}
			onPointerDown={variant === 'frame' ? onHeaderPointerDown : undefined}
			onDoubleClick={variant === 'frame' ? onHeaderDoubleClick : undefined}
		>
			<Box as="span" position="relative" display="inline-flex" flexShrink={0}>
				<LopuRingAvatar size={28} />
				<LopuActivityBadge placement="corner" size={9} />
			</Box>
			<Box minWidth={0} flex="1">
				<Text fontSize="13px" fontWeight={700} color={LOPU_UI.ink} lineHeight="1.2" whiteSpace="nowrap">
					Lopu
				</Text>
				<Text fontSize={LOPU_UI.fontTiny} color={LOPU_UI.muted} lineHeight="1.3" noOfLines={1} wordBreak="break-all">
					{status}
				</Text>
			</Box>
			<HeaderButton title={voiceMode ? 'Back to typing' : 'Talk to Lopu'} onClick={toggleVoice} active={voiceMode}>
				<Mic size={14} strokeWidth={2} />
			</HeaderButton>
			{chipVisible && <ModelChip catalog={catalog} hasCatalog={hasCatalog} providerId={chatProviderId} providerName={chatProviderName} vaultProviders={chatStore.vaultProviders} />}
			{variant === 'frame' && <Box position="relative" ref={layoutRef} data-lopu-control>
				<button type="button" aria-label="Window layout" aria-expanded={layoutOpen} onClick={() => setLayoutOpen(!layoutOpen)} style={{ padding: 6, display: 'flex' }}><PanelsTopLeft size={15} /></button>
				{layoutOpen && <Flex position="absolute" right={0} top="34px" zIndex={3} width="220px" maxW="calc(100vw - 24px)" p={3} gap={2} direction="column" bg={LOPU_UI.card} border={LOPU_UI.border} borderRadius={LOPU_UI.radiusMd} boxShadow={LOPU_UI.shadowPopover} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setLayoutOpen(false); } }}>
					<Text fontSize="xs" fontWeight={700}>Window position</Text>
					<Select size="sm" aria-label="Dock Lopu" value={settings.dock} onChange={event => setDock(event.target.value as LopuDock)}>
						<option value="free">Floating</option>{(['top', 'left', 'bottom', 'right'] as const).map(side => <option key={side} value={side}>{side[0].toUpperCase() + side.slice(1)}</option>)}
					</Select>
					<Text fontSize="xs" fontWeight={700}>Dock behavior</Text>
					<Select size="sm" aria-label="Dock behavior" value={settings.dockMode} onChange={event => setDockMode(event.target.value as 'overlay' | 'split')}>
						<option value="overlay">Overlay the page</option><option value="split">Split with the page</option>
					</Select>
				</Flex>}
			</Box>}
			<HeaderButton title="Minimise" onClick={() => { setMinimised(true); setLayoutOpen(false); }}><Minus size={14} strokeWidth={2} /></HeaderButton>
			<HeaderButton title={voiceMode ? "Open Lopu's voice page" : "Open Lopu's page"} href={fullPath} onClick={openFull}>
				<Maximize2 size={13} strokeWidth={2} />
			</HeaderButton>
			<HeaderButton title="Close (Esc)" onClick={close}>
				<X size={14} strokeWidth={2} />
			</HeaderButton>
		</Flex>
	);

	const body = (
		<Flex flex="1" minHeight={0} flexDirection="column" display="flex">
			<LopuHostBoundary>
				<LopuWindowConversations wide={!isMobile && geometry.width >= 680}>
					{voiceMode ? <LopuVoiceSurface compact onOpenFull={openFull} onPhaseChange={setVoicePhase} /> : <LopuChatView compact showConversations={false} onOpenFull={openFull} />}
				</LopuWindowConversations>
			</LopuHostBoundary>
		</Flex>
	);

	const frameHeight = geometry.height;
	const frameY = geometry.y;

	return (
		<>
			{!isMobile && open && (
				<Flex
					ref={windowRef}
					className="lopuWindow"
					display={showFrame ? "flex" : "none"}
					role="complementary"
					aria-label="Lopu assistant"
					data-lopu-dock={settings.dock}
					data-lopu-mode={voiceMode ? 'voice' : 'chat'}
					position="fixed"
					zIndex={LOPU_WINDOW_Z}
					left={`${geometry.x}px`}
					top={`${frameY}px`}
					width={`${geometry.width}px`}
					height={`${frameHeight}px`}
					flexDirection="column"
					background={LOPU_UI.card}
					border={LOPU_UI.border}
					borderRadius={docked ? 0 : LOPU_UI.radiusLg}
					boxShadow={LOPU_UI.shadowFloating}
					overflow="hidden"
					opacity={gesture === 'move' ? 0.92 : 1}
					transition={gesture ? 'none' : 'opacity 0.15s ease, width 0.12s ease, height 0.12s ease'}
				>
					{header('frame')}
					{body}
					{(docked ? [settings.dock === 'right' ? 'w' : settings.dock === 'left' ? 'e' : settings.dock === 'top' ? 's' : 'n'] : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']).map(edge => {
						const corner = edge.length === 2;
						return <Box key={edge} data-lopu-resize={edge} aria-hidden position="absolute" zIndex={4}
							top={edge.includes('n') ? 0 : edge === 'e' || edge === 'w' ? '12px' : undefined}
							bottom={edge.includes('s') ? 0 : edge === 'e' || edge === 'w' ? '12px' : undefined}
							left={edge.includes('w') ? 0 : edge === 'n' || edge === 's' ? '12px' : undefined}
							right={edge.includes('e') ? 0 : edge === 'n' || edge === 's' ? '12px' : undefined}
							width={corner ? '12px' : edge === 'e' || edge === 'w' ? `${DOCK_HANDLE_PX}px` : undefined}
							height={corner ? '12px' : edge === 'n' || edge === 's' ? `${DOCK_HANDLE_PX}px` : undefined}
							cursor={corner ? (edge === 'ne' || edge === 'sw' ? 'nesw-resize' : 'nwse-resize') : edge === 'e' || edge === 'w' ? 'ew-resize' : 'ns-resize'}
							sx={{ touchAction: 'none' }} title="Drag to resize" onPointerDown={event => onResizePointerDown(event, edge as LopuResizeEdge)} />;
					})}
				</Flex>
			)}

			{showSheet && (
				<>
					<Box className="lopuSheetScrim" position="fixed" zIndex={LOPU_WINDOW_Z - 1} top={0} right={0} bottom={0} left={0} background="rgba(0,0,0,0.28)" onClick={close} />
					<Flex
						ref={windowRef}
						className="lopuSheet"
						role="complementary"
						aria-label="Lopu assistant"
						data-lopu-mode={voiceMode ? 'voice' : 'chat'}
						position="fixed"
						zIndex={LOPU_WINDOW_Z}
						right={0}
						bottom={visualViewport?.bottom ?? 0}
						left={0}
						height={visualViewport ? `${visualViewport.height * (visualViewport.keyboardOpen ? 1 : 0.88)}px` : "88dvh"}
						flexDirection="column"
						background={LOPU_UI.card}
						borderTopRadius={LOPU_UI.radiusXl}
						boxShadow={LOPU_UI.shadowFloating}
						overflow="hidden"
						paddingBottom={visualViewport?.keyboardOpen ? "0px" : "var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px))"}
						transform={sheetOffset ? `translateY(${sheetOffset}px)` : 'none'}
						transition={gesture === 'sheet' ? 'none' : `transform ${LOPU_UI.transition}`}
					>
						<Center className="lopuSheetHandle" flexShrink={0} paddingTop={2} paddingBottom={1} cursor="grab" sx={{ touchAction: 'none' }} onPointerDown={onSheetHandlePointerDown} aria-hidden>
							<Box width="36px" height="4px" borderRadius="999px" background={LOPU_UI.borderColor} />
						</Center>
						{header('sheet')}
						{body}
					</Flex>
				</>
			)}

			{/* a docked column runs the full edge — the bubble would only sit on top of it */}
			{showLauncher && !showSheet && !(showFrame && docked) && (
				<Box
					className="lopuLauncher"
					position="fixed"
					zIndex={LOPU_LAUNCHER_Z}
					left={launcherPos ? `${launcherPos.x}px` : undefined}
					top={launcherPos ? `${launcherPos.y}px` : undefined}
					right={launcherPos ? undefined : `calc(var(--thingtime-safe-area-right, env(safe-area-inset-right, 0px)) + ${LOPU_LAUNCHER_INSET}px)`}
					bottom={launcherPos ? undefined : `calc(var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + ${LOPU_LAUNCHER_BOTTOM_INSET}px)`}
					width={`${LOPU_LAUNCHER_SIZE}px`}
					height={`${LOPU_LAUNCHER_SIZE}px`}
				>
					<Center
						ref={launcherRef}
						as="button"
						type="button"
						className="lopuLauncherButton"
						aria-label={showWindow ? 'Hide Lopu' : 'Talk to Lopu'}
						aria-pressed={showWindow}
						title={showWindow ? 'Hide Lopu · drag to move' : 'Talk to Lopu 🦄 · drag to move'}
						position="relative"
						boxShadow={LOPU_UI.shadowCard}
						cursor={gesture === 'launcher' ? 'grabbing' : 'grab'}
						transition={gesture === 'launcher' ? 'none' : `transform ${LOPU_UI.transitionFast}, box-shadow ${LOPU_UI.transitionFast}`}
						_hover={{ transform: 'translateY(-2px)', boxShadow: LOPU_UI.shadowFloating }}
						_active={{ transform: 'scale(0.97)' }}
						_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '3px' }}
						_before={
							streaming
								? {
										content: '""',
										position: 'absolute',
										inset: '-3px',
										borderRadius: '999px',
										background: LOPU_UI.rainbowSoft,
										animation: `${launcherPulse} 2s ease-out infinite`,
										pointerEvents: 'none',
										zIndex: -1
									}
								: undefined
						}
						sx={{
							...lopuRainbowRing(LOPU_LAUNCHER_SIZE, 2),
							isolation: 'isolate',
							touchAction: 'none',
							'@media (prefers-reduced-motion: reduce)': { transition: 'none', '&::before': { animation: 'none', opacity: 0.6 } }
						}}
						onPointerDown={onLauncherPointerDown}
						onClick={onLauncherClick}
					>
						<Center width="100%" height="100%" borderRadius="999px" background={LOPU_UI.card} fontSize="22px" lineHeight={1}>
							<Box as="span" aria-hidden transform={open ? 'rotate(-12deg)' : 'none'} transition="transform 0.2s ease">
								🦄
							</Box>
						</Center>
						<LopuActivityBadge placement="corner" size={11} />
					</Center>
				</Box>
			)}
		</>
	);
};
