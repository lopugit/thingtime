import React from 'react';
import { Box, Button, Center, Flex, Switch, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';
import { ChevronDown, Maximize2, Minus, X } from 'lucide-react';

import { LopuActivityBadge } from './LopuActivityBadge';
import { LopuChatView } from './LopuChatView';
import {
	LOPU_LAUNCHER_BOTTOM_INSET,
	LOPU_LAUNCHER_INSET,
	LOPU_LAUNCHER_SIZE,
	LOPU_WINDOW_MARGIN,
	LOPU_WINDOW_MIN_SIZE,
	clampLopuLauncherPosition,
	clampLopuWindowGeometry,
	dockedLopuWindowGeometry,
	isLopuHostHiddenOnPath,
	readLopuLauncherPosition,
	readLopuWindowGeometry,
	resolveLopuWindowGeometry,
	useLopuSettings,
	writeLopuLauncherPosition,
	writeLopuWindowGeometry,
	type LopuDock,
	type LopuPoint,
	type LopuViewport,
	type LopuWindowGeometry
} from './useLopuSettings';
import { LOPU_LAUNCHER_Z, LOPU_WINDOW_Z, useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import { startPointerGesture } from '../Thingtime/EditorSplit';
import { RAINBOW } from '~/theme/rainbow';
import { shouldIgnoreGlobalKeydown } from '~/utils/editableTarget';

// 🦄 The global floating Lopu: a draggable launcher bubble (bottom-right,
// stacked above DevKit) and a draggable / resizable / dockable chat window
// that renders the same LopuChatView as the /lopu page (they share one chat
// store, so a conversation continues wherever you open it). Mounted once from
// root.tsx after DrawerSystem; hidden on /lopu itself and when the user turns
// the launcher off in settings.
//
// Layering: LOPU_WINDOW_Z sits with the floating editor windows (above the
// drawer panel, below a hovered drawer, popups and modals); LOPU_LAUNCHER_Z
// keeps the bubble reachable above everything but popups/modals/DevKit.
// The window is non-modal chrome (a complementary region, never a dialog
// role) and never grabs focus on its own: a page input keeps the caret when
// Lopu appears.

const DRAG_THRESHOLD_PX = 4;
const HEADER_HEIGHT_PX = 44;
const DOCK_HANDLE_PX = 6;

const readViewport = (): LopuViewport => ({
	width: typeof window === 'undefined' ? 1 : window.innerWidth,
	height: typeof window === 'undefined' ? 1 : window.innerHeight
});

const isControlTarget = (target: EventTarget | null): boolean => {
	return !!(target as Element | null)?.closest?.('[data-lopu-control]');
};

const RAINBOW_TEXT_SX = {
	WebkitBackgroundClip: 'text',
	backgroundClip: 'text',
	WebkitTextFillColor: 'transparent'
} as const;

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
						Lopu tripped over her horn 🌧️
					</Text>
					<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
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

const HeaderButton = (props: { title: string; onClick: () => void; children: React.ReactNode }) => (
	<Center
		as="button"
		type="button"
		data-lopu-control
		aria-label={props.title}
		title={props.title}
		width="26px"
		height="26px"
		flexShrink={0}
		borderRadius="var(--tt-radius-xs, 7px)"
		color="var(--tt-muted, #9a9aa6)"
		cursor="pointer"
		transition="background 0.15s ease, color 0.15s ease"
		_hover={{ background: 'var(--tt-surface-hover, #ececee)', color: 'var(--tt-ink, #16161a)' }}
		onClick={props.onClick}
	>
		{props.children}
	</Center>
);

// Settings rows shared by UserSettingsModal (settingRow closure) and
// SettingsPage (SettingRow component): each host passes its own row renderer
// so the same controls land in both surfaces without duplicating the logic.
export const LopuSettingsRows = (props: { renderRow: (label: string, control: React.ReactNode, hint?: string) => React.ReactNode }) => {
	const { renderRow } = props;
	const { settings, setLauncher, setDock, setApplyPatches, setConfirmDeletes, setEnterSends } = useLopuSettings();

	return (
		<>
			{renderRow(
				'Floating Lopu 🦄',
				<Switch isChecked={settings.launcher} onChange={(event) => setLauncher(event.target.checked)} aria-label="Show the floating Lopu bubble" />,
				'Show the draggable Lopu bubble on every page'
			)}
			{renderRow(
				'Window docking',
				<Flex columnGap={1}>
					{(['free', 'right', 'left'] as LopuDock[]).map((dock) => (
						<Button key={dock} size="xs" variant={settings.dock === dock ? 'solid' : 'ghost'} onClick={() => setDock(dock)}>
							{dock === 'free' ? 'Free' : dock === 'right' ? 'Right' : 'Left'}
						</Button>
					))}
				</Flex>,
				'Float anywhere, or pin the chat to a viewport edge (double-click its header to toggle)'
			)}
			{renderRow(
				'Apply builder changes live',
				<Switch
					isChecked={settings.applyPatches}
					onChange={(event) => setApplyPatches(event.target.checked)}
					aria-label="Apply builder changes live"
				/>,
				'Lopu’s page and component edits paint into the open draft while she is still typing'
			)}
			{renderRow(
				'Confirm deletes',
				<Switch isChecked={settings.confirmDeletes} onChange={(event) => setConfirmDeletes(event.target.checked)} aria-label="Confirm deletes" />,
				'Ask before Lopu deletes one of your things'
			)}
			{renderRow(
				'Enter sends',
				<Switch isChecked={settings.enterSends} onChange={(event) => setEnterSends(event.target.checked)} aria-label="Enter sends the message" />,
				'Enter sends your message and Shift+Enter adds a line'
			)}
		</>
	);
};

export const LopuHost = () => {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const isMobile = useIsMobileViewport();
	const { settings, open, setOpen, toggleOpen, setDock } = useLopuSettings();

	const [viewport, setViewport] = React.useState<LopuViewport>(readViewport);
	const [launcherRaw, setLauncherRaw] = React.useState<LopuPoint | null>(readLopuLauncherPosition);
	const [windowRaw, setWindowRaw] = React.useState<Partial<LopuWindowGeometry> | null>(readLopuWindowGeometry);
	const [gesture, setGesture] = React.useState<'launcher' | 'move' | 'resize' | null>(null);
	const [minimised, setMinimised] = React.useState(false);

	const windowRef = React.useRef<HTMLDivElement | null>(null);
	const launcherRef = React.useRef<HTMLButtonElement | null>(null);
	// a drag that moved past the threshold must not also count as a click
	const launcherMovedRef = React.useRef(false);

	const hidden = isLopuHostHiddenOnPath(pathname) || !settings.launcher;
	const docked = settings.dock !== 'free';

	// keep both surfaces on screen when the viewport changes
	React.useEffect(() => {
		const onResize = () => setViewport(readViewport());
		onResize();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// a fresh open always starts expanded
	React.useEffect(() => {
		if (!open) {
			setMinimised(false);
		}
	}, [open]);

	const launcherPos = launcherRaw ? clampLopuLauncherPosition(launcherRaw, viewport) : null;
	const freeGeometry = resolveLopuWindowGeometry(windowRaw, viewport, launcherPos);
	const geometry = docked ? dockedLopuWindowGeometry(settings.dock as Exclude<LopuDock, 'free'>, freeGeometry.width, viewport) : freeGeometry;

	const showWindow = !hidden && open;
	const showSheet = showWindow && isMobile;
	const showFrame = showWindow && !isMobile;

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
			// an open menu/picker inside the window (model chip, composer
			// picker) owns this Escape — it closes the menu, not the window
			if (windowRef.current?.querySelector('[aria-expanded="true"]')) {
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

	const openFull = React.useCallback(() => {
		setOpen(false);
		navigate('/lopu');
	}, [navigate, setOpen]);

	const close = React.useCallback(() => {
		setOpen(false);
	}, [setOpen]);

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

	// bottom-right grip (free) — the origin stays put, the far edges follow
	const onResizePointerDown = React.useCallback(
		(event: React.PointerEvent) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const startX = event.clientX;
			const startY = event.clientY;
			const origin = geometry;
			let latest: LopuWindowGeometry | null = null;
			setGesture('resize');

			startPointerGesture(
				event,
				(move) => {
					const view = readViewport();
					latest = clampLopuWindowGeometry(
						{
							x: origin.x,
							y: origin.y,
							width: Math.min(origin.width + (move.clientX - startX), view.width - origin.x),
							height: Math.min(origin.height + (move.clientY - startY), view.height - origin.y)
						},
						view
					);
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
		[geometry]
	);

	// docked: the inner edge resizes the column's width
	const onDockHandlePointerDown = React.useCallback(
		(event: React.PointerEvent) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const startX = event.clientX;
			const originWidth = geometry.width;
			const direction = settings.dock === 'right' ? -1 : 1;
			let latest: LopuWindowGeometry | null = null;
			setGesture('resize');

			startPointerGesture(
				event,
				(move) => {
					const view = readViewport();
					const width = Math.max(
						LOPU_WINDOW_MIN_SIZE.width,
						Math.min(originWidth + direction * (move.clientX - startX), view.width - LOPU_WINDOW_MARGIN)
					);
					latest = clampLopuWindowGeometry({ ...freeGeometry, width }, view);
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
		[freeGeometry, geometry.width, settings.dock]
	);

	if (hidden) {
		return null;
	}

	const header = (variant: 'frame' | 'sheet') => (
		<Flex
			className="lopuWindowHeader"
			alignItems="center"
			columnGap={2}
			flexShrink={0}
			height={`${HEADER_HEIGHT_PX}px`}
			paddingX={3}
			borderBottom={minimised ? 'none' : '1px solid var(--tt-border, #ececef)'}
			background="var(--tt-card, #ffffff)"
			cursor={variant === 'frame' ? (gesture === 'move' ? 'grabbing' : 'grab') : 'default'}
			userSelect="none"
			sx={{ touchAction: 'none' }}
			title={variant === 'frame' ? (docked ? 'Drag to float · double-click to undock' : 'Drag to move · double-click to dock right') : undefined}
			onPointerDown={variant === 'frame' ? onHeaderPointerDown : undefined}
			onDoubleClick={variant === 'frame' ? onHeaderDoubleClick : undefined}
		>
			<Text fontSize="md" lineHeight={1} aria-hidden>
				🦄
			</Text>
			<Text fontWeight={800} fontSize="sm" background={RAINBOW} sx={RAINBOW_TEXT_SX} whiteSpace="nowrap">
				Lopu
			</Text>
			<LopuActivityBadge />
			<Box flex="1" minWidth={0} />
			{variant === 'frame' && (
				<HeaderButton title={minimised ? 'Expand' : 'Minimise'} onClick={() => setMinimised((prev) => !prev)}>
					{minimised ? <ChevronDown size={14} strokeWidth={2} style={{ transform: 'rotate(180deg)' }} /> : <Minus size={14} strokeWidth={2} />}
				</HeaderButton>
			)}
			<HeaderButton title="Open Lopu's page" onClick={openFull}>
				<Maximize2 size={13} strokeWidth={2} />
			</HeaderButton>
			<HeaderButton title="Close (Esc)" onClick={close}>
				<X size={14} strokeWidth={2} />
			</HeaderButton>
		</Flex>
	);

	const body = (
		<Flex flex="1" minHeight={0} flexDirection="column" display={minimised ? 'none' : 'flex'}>
			<LopuHostBoundary>
				<LopuChatView compact showConversations={false} onOpenFull={openFull} />
			</LopuHostBoundary>
		</Flex>
	);

	const frameHeight = minimised ? HEADER_HEIGHT_PX + 2 : geometry.height;
	const frameY = minimised && !docked ? Math.min(geometry.y, Math.max(0, viewport.height - frameHeight)) : geometry.y;

	return (
		<>
			{showFrame && (
				<Flex
					ref={windowRef}
					className="lopuWindow"
					role="complementary"
					aria-label="Lopu assistant"
					data-lopu-dock={settings.dock}
					position="fixed"
					zIndex={LOPU_WINDOW_Z}
					left={`${geometry.x}px`}
					top={`${frameY}px`}
					width={`${geometry.width}px`}
					height={`${frameHeight}px`}
					flexDirection="column"
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius={docked ? 0 : 'var(--tt-radius-lg, 16px)'}
					boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
					overflow="hidden"
					opacity={gesture === 'move' ? 0.92 : 1}
					transition={gesture ? 'none' : 'opacity 0.15s ease, width 0.12s ease, height 0.12s ease'}
				>
					{/* rainbow accent line */}
					<Box
						flexShrink={0}
						height="3px"
						background={RAINBOW}
						backgroundSize="calc(100px + 200%)"
						sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
					/>
					{header('frame')}
					{body}
					{!minimised && !docked && (
						<Box
							aria-hidden
							position="absolute"
							right="1px"
							bottom="1px"
							width="16px"
							height="16px"
							cursor="nwse-resize"
							color="var(--tt-faint, #b6b6c0)"
							sx={{ touchAction: 'none' }}
							title="Drag to resize"
							onPointerDown={onResizePointerDown}
						>
							<svg viewBox="0 0 14 14" width="14" height="14">
								<path d="M12 6 L6 12 M12 10 L10 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
							</svg>
						</Box>
					)}
					{docked && (
						<Box
							aria-hidden
							position="absolute"
							top={0}
							bottom={0}
							left={settings.dock === 'right' ? 0 : undefined}
							right={settings.dock === 'left' ? 0 : undefined}
							width={`${DOCK_HANDLE_PX}px`}
							cursor="ew-resize"
							sx={{ touchAction: 'none' }}
							_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
							title="Drag to resize"
							onPointerDown={onDockHandlePointerDown}
						/>
					)}
				</Flex>
			)}

			{showSheet && (
				<>
					<Box
						className="lopuSheetScrim"
						position="fixed"
						zIndex={LOPU_WINDOW_Z - 1}
						top={0}
						right={0}
						bottom={0}
						left={0}
						background="rgba(0,0,0,0.25)"
						onClick={close}
					/>
					<Flex
						ref={windowRef}
						className="lopuSheet"
						role="complementary"
						aria-label="Lopu assistant"
						position="fixed"
						zIndex={LOPU_WINDOW_Z}
						right={0}
						bottom={0}
						left={0}
						height="88vh"
						sx={{
							'@supports (height: 100dvh)': {
								height: '88dvh'
							}
						}}
						flexDirection="column"
						background="var(--tt-card, #ffffff)"
						borderTopRadius="var(--tt-radius-xl, 20px)"
						boxShadow="0px -8px 30px rgba(0,0,0,0.18)"
						overflow="hidden"
						paddingBottom="var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px))"
					>
						<Box
							flexShrink={0}
							height="3px"
							background={RAINBOW}
							backgroundSize="calc(100px + 200%)"
							sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
						/>
						{header('sheet')}
						{body}
					</Flex>
				</>
			)}

			{/* a docked column runs the full edge — the bubble would only sit on top of it */}
			{!showSheet && !(showFrame && docked) && (
				<Box
					className="lopuLauncher"
					position="fixed"
					zIndex={LOPU_LAUNCHER_Z}
					left={launcherPos ? `${launcherPos.x}px` : undefined}
					top={launcherPos ? `${launcherPos.y}px` : undefined}
					right={launcherPos ? undefined : `calc(var(--thingtime-safe-area-right, env(safe-area-inset-right, 0px)) + ${LOPU_LAUNCHER_INSET}px)`}
					bottom={
						launcherPos ? undefined : `calc(var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + ${LOPU_LAUNCHER_BOTTOM_INSET}px)`
					}
					width={`${LOPU_LAUNCHER_SIZE}px`}
					height={`${LOPU_LAUNCHER_SIZE}px`}
				>
					<Center
						ref={launcherRef}
						as="button"
						type="button"
						className="lopuLauncherButton"
						aria-label={open ? 'Hide Lopu' : 'Talk to Lopu'}
						aria-pressed={open}
						title={open ? 'Hide Lopu · drag to move' : 'Talk to Lopu 🦄 · drag to move'}
						position="relative"
						width="100%"
						height="100%"
						padding="2px"
						borderRadius="999px"
						background={RAINBOW}
						backgroundSize="calc(100px + 200%)"
						boxShadow="var(--tt-shadow-toast, 0 10px 28px rgba(20,20,40,0.22))"
						cursor={gesture === 'launcher' ? 'grabbing' : 'grab'}
						transition={gesture === 'launcher' ? 'none' : 'transform 0.15s ease, box-shadow 0.15s ease'}
						_hover={{ transform: 'scale(1.05)' }}
						_active={{ transform: 'scale(0.97)' }}
						_focusVisible={{ outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '2px' }}
						sx={{ touchAction: 'none', animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
						onPointerDown={onLauncherPointerDown}
						onClick={onLauncherClick}
					>
						<Center width="100%" height="100%" borderRadius="999px" background="var(--tt-card, #ffffff)" fontSize="22px" lineHeight={1}>
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
