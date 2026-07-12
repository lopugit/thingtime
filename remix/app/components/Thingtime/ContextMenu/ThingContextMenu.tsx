import React from 'react';
import { createPortal } from 'react-dom';
import { Box, Flex, Text } from '@chakra-ui/react';

import { Icon } from '../../Icon/Icon';
import type { ThingContextAction, ThingContextMenuModel, ThingContextSection } from './contextMenuModel';
import { resolveDrillPath } from './contextMenuModel';

// Thing Context Menu — design-system reference implementation, live in the
// Thingtime UI via ThingContextMenuTrigger.
//
// One menu surface, three presentations:
//   'popover'  anchored under a hover/click trigger (wrap in position:relative);
//              the surface portals to <body> at a fixed position measured off a
//              zero-size probe in the wrapper, so overflow:hidden/auto
//              ancestors (editor windows, the composer) can never clip it
//   'context'  fixed at a pointer position (right-click / long-press)
//   'modal'    centred over a scrim (programmatic, e.g. from a button)
//
// Submenus never fly out or indent: activating a parent drills the whole
// surface down one level (with a back row), infinitely deep, inside a single
// window whose size stays put — the level body scrolls instead. The surface
// is draggable by its header (made for pinned mode) and resizable from the
// bottom-right grip.
//
// The surface renders a ThingContextMenuModel (see contextMenuModel.ts) and
// reports every leaf activation through onAction — it owns no thing state, so
// the same component serves the live app, the docs stories, and tests.
// Documented at /docs/design-system?component=thing-context-menu.

export type ThingContextMenuPresentation = 'popover' | 'context' | 'modal';

export type ThingContextMenuAction = {
	action: ThingContextAction;
	section: ThingContextSection;
	// drill path (action ids) the leaf was reached through
	path: string[];
};

export interface ThingContextMenuProps {
	model: ThingContextMenuModel;
	open: boolean;
	presentation?: ThingContextMenuPresentation;
	// thing being acted on; rendered in the header. zone names which virtual
	// bounding box was targeted ('key' | 'value' | 'thing' — see thingZones)
	meta?: { path?: string; type?: string; zone?: string };
	// pointer position for the 'context' presentation
	position?: { x: number; y: number };
	pinned?: boolean;
	onPinnedChange?: (pinned: boolean) => void;
	onAction?: (args: ThingContextMenuAction) => void;
	onClose?: () => void;
	// close automatically after a leaf action fires (default true)
	closeOnAction?: boolean;
	// open with this drill path already applied (docs/tests)
	defaultDrillPath?: string[];
	// hover-linger wiring; supplied by useThingContextMenu for popovers
	onSurfaceMouseEnter?: () => void;
	onSurfaceMouseLeave?: () => void;
	width?: number;
	zIndex?: number;
}

const FOCUSABLE_ITEM_CLASS = 'thing-context-menu-item';

const CONTEXT_MENU_MARGIN = 8;
const MIN_MENU_WIDTH = 228;
const MAX_MENU_WIDTH = 520;
const MIN_MENU_HEIGHT = 220;
const MAX_MENU_HEIGHT = 680;
const DEFAULT_MENU_WIDTH = 264;

export const ThingContextMenu = (props: ThingContextMenuProps) => {
	const {
		model,
		open,
		presentation = 'popover',
		meta,
		position,
		pinned = false,
		onPinnedChange,
		onAction,
		onClose,
		closeOnAction = true,
		defaultDrillPath,
		onSurfaceMouseEnter,
		onSurfaceMouseLeave,
		width = DEFAULT_MENU_WIDTH,
		zIndex = 1400
	} = props;

	const surfaceRef = React.useRef<HTMLDivElement>(null);

	// drill navigation — a stack of submenu-carrying actions
	const [stack, setStack] = React.useState<ThingContextAction[]>(() => resolveDrillPath(model, defaultDrillPath));
	// bumps on every push/pop to retrigger the level slide animation
	const [levelTick, setLevelTick] = React.useState(0);

	// drag offset (header) + explicit size (resize grip / drill height lock)
	const [dragOffset, setDragOffset] = React.useState({ x: 0, y: 0 });
	const [menuWidth, setMenuWidth] = React.useState(width);
	const [menuHeight, setMenuHeight] = React.useState<number | null>(null);
	// horizontal correction keeping popovers inside the viewport when the
	// trigger sits near the right edge
	const [popoverShift, setPopoverShift] = React.useState(0);

	// reset on every open/close so a closed (still-mounted) menu never paints
	// one stale frame of old drill/drag/size state when it reopens
	React.useEffect(() => {
		setStack(resolveDrillPath(model, defaultDrillPath));
		setDragOffset({ x: 0, y: 0 });
		setMenuWidth(width);
		setMenuHeight(null);
		setPopoverShift(0);
		setLevelTick(0);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	// measure and nudge the popover back inside the viewport; incremental
	// (rect already includes the current shift) so it converges, and shifted
	// menus drift home again when the viewport grants slack (window resizes)
	const reclampPopover = React.useCallback(() => {
		const surface = surfaceRef.current;
		if (!surface) {
			return;
		}

		const rect = surface.getBoundingClientRect();
		const maxRight = window.innerWidth - CONTEXT_MENU_MARGIN;

		setPopoverShift((shift) => {
			const overflowRight = rect.right - maxRight;
			const overflowLeft = CONTEXT_MENU_MARGIN - rect.left;

			if (overflowRight > 0) {
				return shift - overflowRight;
			}
			if (overflowLeft > 0) {
				return shift + overflowLeft;
			}
			if (shift < 0) {
				return Math.min(0, shift + (maxRight - rect.right));
			}
			if (shift > 0) {
				return Math.max(0, shift - (rect.left - CONTEXT_MENU_MARGIN));
			}
			return shift;
		});
	}, []);

	React.useEffect(() => {
		if (!open || presentation !== 'popover') {
			return;
		}

		reclampPopover();
		window.addEventListener('resize', reclampPopover);

		return () => {
			window.removeEventListener('resize', reclampPopover);
		};
	}, [open, presentation, menuWidth, reclampPopover]);

	const currentLevel = stack.length ? stack[stack.length - 1] : null;
	const currentSections = currentLevel?.submenu?.sections || model.sections;
	const currentPath = React.useMemo(() => stack.map((action) => action.id), [stack]);

	// popover anchoring: a zero-size probe stays in the trigger wrapper's flow
	// (getBoundingClientRect works even inside clipped ancestors); the surface
	// itself portals to <body> at these fixed viewport coordinates, re-measured
	// on any scroll (capture phase reaches nested scrollers) and resize so it
	// stays glued to its open point
	const anchorRef = React.useRef<HTMLDivElement | null>(null);
	const [anchorPoint, setAnchorPoint] = React.useState<{ x: number; y: number } | null>(null);

	React.useLayoutEffect(() => {
		if (!open || presentation !== 'popover') {
			setAnchorPoint(null);
			return;
		}

		const measure = () => {
			const el = anchorRef.current;
			if (!el) {
				return;
			}

			const rect = el.getBoundingClientRect();

			setAnchorPoint((prev) => {
				const next = {
					x: Math.max(CONTEXT_MENU_MARGIN, rect.left),
					// keep at least the header row reachable at the bottom edge
					y: Math.min(rect.top, window.innerHeight - 56)
				};

				return prev && prev.x === next.x && prev.y === next.y ? prev : next;
			});
		};

		measure();
		window.addEventListener('scroll', measure, true);
		window.addEventListener('resize', measure);

		return () => {
			window.removeEventListener('scroll', measure, true);
			window.removeEventListener('resize', measure);
		};
	}, [open, presentation]);

	// clamp the context presentation inside the viewport
	const [clampedPosition, setClampedPosition] = React.useState(position);

	React.useEffect(() => {
		setClampedPosition(position);
	}, [position?.x, position?.y]);

	React.useEffect(() => {
		if (!open || presentation !== 'context' || !position) {
			return;
		}

		const surface = surfaceRef.current;
		if (!surface) {
			return;
		}

		const rect = surface.getBoundingClientRect();
		const maxX = window.innerWidth - rect.width - CONTEXT_MENU_MARGIN;
		const maxY = window.innerHeight - rect.height - CONTEXT_MENU_MARGIN;

		setClampedPosition({
			x: Math.max(CONTEXT_MENU_MARGIN, Math.min(position.x, maxX)),
			y: Math.max(CONTEXT_MENU_MARGIN, Math.min(position.y, maxY))
		});
		// menuWidth/menuHeight: re-clamp after the grip resizes the surface
	}, [open, presentation, position?.x, position?.y, menuWidth, menuHeight]);

	const focusItemAt = React.useCallback((index: number) => {
		const surface = surfaceRef.current;
		if (!surface) {
			return;
		}

		const items = Array.from(surface.querySelectorAll<HTMLElement>(`.${FOCUSABLE_ITEM_CLASS}`));
		if (!items.length) {
			return;
		}

		const next = ((index % items.length) + items.length) % items.length;
		items[next]?.focus();
	}, []);

	const moveFocus = React.useCallback(
		(delta: number) => {
			const surface = surfaceRef.current;
			if (!surface) {
				return;
			}

			const items = Array.from(surface.querySelectorAll<HTMLElement>(`.${FOCUSABLE_ITEM_CLASS}`));
			const current = items.indexOf(document.activeElement as HTMLElement);

			focusItemAt(current === -1 ? (delta > 0 ? 0 : -1) : current + delta);
		},
		[focusItemAt]
	);

	// drilling keeps the window size steady: lock the current height the first
	// time the user leaves the root level, so deeper/shorter levels scroll
	// inside the same frame instead of resizing it. Tiny root levels (the
	// new-child variant has one row) still lock to a usable minimum.
	const lockHeight = React.useCallback(() => {
		if (menuHeight === null && surfaceRef.current) {
			setMenuHeight(Math.max(surfaceRef.current.offsetHeight, MIN_MENU_HEIGHT));
		}
	}, [menuHeight]);

	const pushLevel = React.useCallback(
		(action: ThingContextAction) => {
			if (!action.submenu) {
				return;
			}

			lockHeight();
			setStack((prev) => [...prev, action]);
			setLevelTick((tick) => tick + 1);
			// index 0 is the back row after a drill; land on the first action
			setTimeout(() => focusItemAt(1), 30);
		},
		[lockHeight, focusItemAt]
	);

	const popLevel = React.useCallback(() => {
		const next = stack.length ? stack.slice(0, -1) : stack;
		setStack(next);
		setLevelTick((tick) => tick + 1);
		setTimeout(() => focusItemAt(next.length ? 1 : 0), 30);
	}, [stack, focusItemAt]);

	const onSurfaceKeyDown = React.useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				moveFocus(1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				moveFocus(-1);
			} else if (e.key === 'Home') {
				e.preventDefault();
				focusItemAt(0);
			} else if (e.key === 'End') {
				e.preventDefault();
				focusItemAt(-1);
			} else if (e.key === 'ArrowLeft') {
				if (stack.length) {
					e.preventDefault();
					popLevel();
				}
			} else if (e.key === 'Tab' && presentation === 'modal') {
				// the modal traps Tab inside the surface
				e.preventDefault();
				moveFocus(e.shiftKey ? -1 : 1);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				if (stack.length) {
					popLevel();
				} else {
					onClose?.();
				}
			}
		},
		[moveFocus, focusItemAt, presentation, stack.length, popLevel, onClose]
	);

	// focus the first item on modal open so Escape/arrows work immediately
	React.useEffect(() => {
		if (open && presentation === 'modal') {
			const timer = setTimeout(() => focusItemAt(0), 30);
			return () => clearTimeout(timer);
		}
	}, [open, presentation, focusItemAt]);

	// popover/context menus open without stealing focus, so keyboard must
	// still work before focus enters the surface: Escape pops/closes and
	// arrows pull focus into the menu from anywhere on the page
	React.useEffect(() => {
		if (!open) {
			return;
		}

		const onWindowKeyDown = (e: KeyboardEvent) => {
			const surface = surfaceRef.current;
			if (!surface || surface.contains(document.activeElement)) {
				return;
			}

			if (e.key === 'Escape') {
				e.preventDefault();
				if (stack.length) {
					popLevel();
				} else {
					onClose?.();
				}
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				focusItemAt(stack.length ? 1 : 0);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				focusItemAt(-1);
			}
		};

		window.addEventListener('keydown', onWindowKeyDown);

		return () => {
			window.removeEventListener('keydown', onWindowKeyDown);
		};
	}, [open, stack.length, popLevel, onClose, focusItemAt]);

	const fireAction = React.useCallback(
		(section: ThingContextSection, action: ThingContextAction) => {
			if (action.disabled) {
				return;
			}

			onAction?.({ action, section, path: currentPath });

			if (closeOnAction && !pinned) {
				onClose?.();
			}
		},
		[onAction, currentPath, closeOnAction, pinned, onClose]
	);

	const onItemActivate = React.useCallback(
		(section: ThingContextSection, action: ThingContextAction) => {
			if (action.submenu) {
				pushLevel(action);
				return;
			}

			fireAction(section, action);
		},
		[pushLevel, fireAction]
	);

	// ------------------------------------------------------------------
	// drag (header) + resize (bottom-right grip)
	// ------------------------------------------------------------------

	// one gesture at a time; torn down on pointerup/pointercancel, window
	// blur, and unmount so listeners never leak or leave a stuck drag
	const gestureTeardownRef = React.useRef<(() => void) | null>(null);

	React.useEffect(() => {
		return () => {
			gestureTeardownRef.current?.();
		};
	}, []);

	const startPointerGesture = React.useCallback(
		(e: React.PointerEvent, onMove: (move: PointerEvent) => void) => {
			gestureTeardownRef.current?.();

			const pointerId = e.pointerId;

			const handleMove = (move: PointerEvent) => {
				if (move.pointerId !== pointerId) {
					return;
				}
				onMove(move);
			};

			const teardown = () => {
				window.removeEventListener('pointermove', handleMove);
				window.removeEventListener('pointerup', stop);
				window.removeEventListener('pointercancel', stop);
				window.removeEventListener('blur', teardown);
				gestureTeardownRef.current = null;
			};

			const stop = (ev: PointerEvent) => {
				if (ev.pointerId !== pointerId) {
					return;
				}
				teardown();
			};

			window.addEventListener('pointermove', handleMove);
			window.addEventListener('pointerup', stop);
			window.addEventListener('pointercancel', stop);
			window.addEventListener('blur', teardown);
			gestureTeardownRef.current = teardown;
		},
		[]
	);

	const startDrag = React.useCallback(
		(e: React.PointerEvent) => {
			// buttons in the header (pin/close) stay clickable
			if ((e.target as HTMLElement)?.closest?.('button')) {
				return;
			}

			e.preventDefault();

			const startX = e.clientX;
			const startY = e.clientY;
			const origin = { ...dragOffset };

			startPointerGesture(e, (move) => {
				setDragOffset({ x: origin.x + move.clientX - startX, y: origin.y + move.clientY - startY });
			});
		},
		[dragOffset, startPointerGesture]
	);

	const startResize = React.useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();

			const surface = surfaceRef.current;
			const startX = e.clientX;
			const startY = e.clientY;
			const startWidth = surface?.offsetWidth || menuWidth;
			const startHeight = surface?.offsetHeight || 0;
			// never allow resizing past the viewport
			const maxWidth = Math.min(MAX_MENU_WIDTH, window.innerWidth - CONTEXT_MENU_MARGIN * 2);
			const maxHeight = Math.min(MAX_MENU_HEIGHT, window.innerHeight - CONTEXT_MENU_MARGIN * 2);

			startPointerGesture(e, (move) => {
				setMenuWidth(Math.min(maxWidth, Math.max(MIN_MENU_WIDTH, startWidth + move.clientX - startX)));
				setMenuHeight(Math.min(maxHeight, Math.max(MIN_MENU_HEIGHT, startHeight + move.clientY - startY)));
			});
		},
		[menuWidth, startPointerGesture]
	);

	// ------------------------------------------------------------------
	// rows
	// ------------------------------------------------------------------

	const renderAction = (section: ThingContextSection, action: ThingContextAction) => {
		const isRadio = action.selected !== undefined;

		return (
			<Flex
				key={action.id}
				className={FOCUSABLE_ITEM_CLASS}
				alignItems="center"
				columnGap="9px"
				marginX="6px"
				paddingX="8px"
				paddingY="6px"
				borderRadius="var(--tt-radius-sm, 9px)"
				opacity={action.disabled ? 0.4 : 1}
				color={action.danger ? 'var(--tt-danger, #d6455a)' : 'inherit'}
				background={action.selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
				_hover={{
					background: action.danger ? 'rgba(214, 69, 90, 0.08)' : 'var(--tt-surface-alt, #f5f5f7)'
				}}
				_focusVisible={{
					outline: 'none',
					background: action.danger ? 'rgba(214, 69, 90, 0.08)' : 'var(--tt-surface-alt, #f5f5f7)'
				}}
				transition="background 0.15s ease"
				cursor={action.disabled ? 'not-allowed' : 'pointer'}
				role={isRadio ? 'menuitemradio' : 'menuitem'}
				aria-checked={isRadio ? action.selected : undefined}
				aria-disabled={action.disabled || undefined}
				aria-haspopup={action.submenu ? 'menu' : undefined}
				tabIndex={-1}
				onClick={() => onItemActivate(section, action)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onItemActivate(section, action);
					} else if (e.key === 'ArrowRight' && action.submenu) {
						e.preventDefault();
						pushLevel(action);
					}
				}}
			>
				<Icon name={action.icon} lucide={action.lucide} size="12px"></Icon>
				<Box minWidth={0}>
					<Text fontSize="xs" fontWeight={action.selected ? 600 : 500} noOfLines={1}>
						{action.label}
					</Text>
					{action.hint && (
						<Text fontSize="10px" color="var(--tt-muted, #9a9aa6)" lineHeight="1.3" noOfLines={1}>
							{action.hint}
						</Text>
					)}
				</Box>
				{action.selected && (
					<Box marginLeft="auto">
						<Icon name="check" lucide="check" size="10px"></Icon>
					</Box>
				)}
				{action.kbd && (
					<Text
						marginLeft={action.selected ? '6px' : 'auto'}
						fontFamily="var(--tt-font-mono, monospace)"
						fontSize="10px"
						color="var(--tt-faint, #b6b6c0)"
					>
						{action.kbd}
					</Text>
				)}
				{action.submenu && (
					<Box
						marginLeft={action.kbd || action.selected ? '6px' : 'auto'}
						color="var(--tt-faint, #b6b6c0)"
						fontSize="10px"
					>
						▸
					</Box>
				)}
			</Flex>
		);
	};

	const surface = (
		<Flex
			ref={surfaceRef}
			className="thing-context-menu"
			flexDirection="column"
			width={`${menuWidth}px`}
			height={menuHeight ? `${menuHeight}px` : undefined}
			maxWidth="calc(100vw - 16px)"
			maxHeight={menuHeight ? 'calc(100vh - 16px)' : presentation === 'modal' ? 'min(70vh, 560px)' : 'min(80vh, 480px)'}
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
			position="relative"
			overflow="hidden"
			transform={
				dragOffset.x || dragOffset.y || popoverShift
					? `translate(${dragOffset.x + popoverShift}px, ${dragOffset.y}px)`
					: undefined
			}
			role="menu"
			aria-label={meta?.path ? `Options for ${meta.path}` : 'Thing options'}
			onKeyDown={onSurfaceKeyDown}
			onMouseEnter={onSurfaceMouseEnter}
			onMouseLeave={onSurfaceMouseLeave}
			onContextMenu={(e) => e.preventDefault()}
		>
			{/* header: thing path + type + pin/close; drag handle for the surface */}
			<Flex
				className="thing-context-menu-header"
				alignItems="center"
				columnGap="8px"
				flexShrink={0}
				paddingX="14px"
				paddingTop="10px"
				paddingBottom="8px"
				borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
				cursor="grab"
				sx={{ touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
				userSelect="none"
				title="Drag to move"
				onPointerDown={startDrag}
			>
				<Box minWidth={0}>
					<Flex alignItems="center" columnGap="6px" minWidth={0}>
						<Text
							fontFamily="var(--tt-font-mono, monospace)"
							fontSize="11px"
							color="var(--tt-muted, #9a9aa6)"
							noOfLines={1}
							wordBreak="break-all"
						>
							{meta?.path || 'thingtime'}
						</Text>
						{meta?.zone && meta.zone !== 'thing' && (
							<Text
								flexShrink={0}
								paddingX="5px"
								paddingY="1px"
								background="var(--tt-accent-tint, #fff5fa)"
								borderRadius="var(--tt-radius-xs, 7px)"
								fontFamily="var(--tt-font-mono, monospace)"
								fontSize="9px"
								fontWeight={600}
								letterSpacing="0.08em"
								textTransform="uppercase"
								color="var(--tt-accent, hotpink)"
							>
								{meta.zone}
							</Text>
						)}
					</Flex>
					{meta?.type && (
						<Text
							fontFamily="var(--tt-font-mono, monospace)"
							fontSize="10px"
							letterSpacing="0.08em"
							textTransform="uppercase"
							color="var(--tt-faint, #b6b6c0)"
						>
							{meta.type}
						</Text>
					)}
				</Box>
				<Flex marginLeft="auto" alignItems="center" columnGap="6px">
					{presentation !== 'modal' && onPinnedChange && (
						<Flex
							as="button"
							aria-label={pinned ? 'Unpin menu' : 'Pin menu open'}
							aria-pressed={pinned}
							opacity={pinned ? 1 : 0.45}
							_hover={{ opacity: 1 }}
							transition="opacity 0.15s ease"
							cursor="pointer"
							title={pinned ? 'Unpin menu' : 'Pin menu open'}
							onClick={() => onPinnedChange(!pinned)}
						>
							<Icon name={pinned ? 'pinned' : 'pin'} lucide={pinned ? 'pin-off' : 'pin'} size="11px"></Icon>
						</Flex>
					)}
					{(presentation === 'modal' || onClose) && (
						<Flex
							as="button"
							aria-label="Close menu"
							opacity={0.45}
							_hover={{ opacity: 1 }}
							transition="opacity 0.15s ease"
							cursor="pointer"
							title="Close"
							onClick={() => onClose?.()}
						>
							<Icon name="❌" size="9px"></Icon>
						</Flex>
					)}
				</Flex>
			</Flex>

			{/* back row when drilled below the root level */}
			{currentLevel && (
				<Flex
					className={`thing-context-menu-back ${FOCUSABLE_ITEM_CLASS}`}
					alignItems="center"
					columnGap="7px"
					flexShrink={0}
					paddingX="14px"
					paddingY="7px"
					borderBottom="1px solid var(--tt-border-light, #f0f0f2)"
					background="var(--tt-surface, #fafafb)"
					_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
					_focusVisible={{ outline: 'none', background: 'var(--tt-surface-alt, #f5f5f7)' }}
					transition="background 0.15s ease"
					cursor="pointer"
					role="menuitem"
					aria-label="Back"
					tabIndex={-1}
					onClick={popLevel}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							popLevel();
						}
					}}
				>
					<Text fontSize="12px" color="var(--tt-muted, #9a9aa6)" lineHeight="1">
						‹
					</Text>
					<Text fontSize="xs" fontWeight={600} noOfLines={1}>
						{currentLevel.submenu?.title || currentLevel.label}
					</Text>
					<Text
						marginLeft="auto"
						fontFamily="var(--tt-font-mono, monospace)"
						fontSize="9px"
						letterSpacing="0.08em"
						textTransform="uppercase"
						color="var(--tt-faint, #b6b6c0)"
					>
						Back
					</Text>
				</Flex>
			)}

			{/* the current drill level; scrolls inside the fixed frame */}
			<Flex
				key={levelTick}
				className="thing-context-menu-level"
				flexDirection="column"
				flex="1"
				minHeight={0}
				overflowY="auto"
				paddingTop={currentLevel ? '4px' : '4px'}
				paddingBottom="6px"
				sx={{
					'@keyframes tt-drill-in': {
						from: { opacity: 0.4, transform: 'translateX(6px)' },
						to: { opacity: 1, transform: 'translateX(0)' }
					},
					animation: levelTick ? 'tt-drill-in 140ms ease' : undefined
				}}
			>
				{currentSections.map((section, sectionIdx) => (
					<React.Fragment key={section.id}>
						{sectionIdx > 0 && <Box borderTop="1px solid var(--tt-border-light, #f0f0f2)" marginY="4px" flexShrink={0} />}
						{section.label && (
							<Text
								paddingX="14px"
								paddingTop="4px"
								paddingBottom="2px"
								fontFamily="var(--tt-font-mono, monospace)"
								fontSize="9px"
								fontWeight={600}
								letterSpacing="0.1em"
								textTransform="uppercase"
								color="var(--tt-muted, #9a9aa6)"
							>
								{section.label}
							</Text>
						)}
						{section.actions.map((action) => renderAction(section, action))}
					</React.Fragment>
				))}
			</Flex>

			{/* resize grip */}
			<Box
				className="thing-context-menu-resize"
				aria-hidden
				position="absolute"
				right="1px"
				bottom="1px"
				width="15px"
				height="15px"
				cursor="nwse-resize"
				color="var(--tt-faint, #b6b6c0)"
				sx={{ touchAction: 'none' }}
				title="Drag to resize"
				onPointerDown={startResize}
			>
				<svg viewBox="0 0 14 14" width="14" height="14">
					<path d="M12 6 L6 12 M12 10 L10 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
				</svg>
			</Box>
		</Flex>
	);

	if (!open) {
		return null;
	}

	if (presentation === 'modal') {
		return (
			<Flex
				className="thing-context-menu-scrim"
				position="fixed"
				inset={0}
				alignItems="center"
				justifyContent="center"
				background="rgba(20, 20, 26, 0.35)"
				zIndex={zIndex}
				onClick={(e) => {
					if (e.target === e.currentTarget) {
						onClose?.();
					}
				}}
			>
				{surface}
			</Flex>
		);
	}

	if (presentation === 'context') {
		return (
			<Box position="fixed" top={`${clampedPosition?.y ?? 0}px`} left={`${clampedPosition?.x ?? 0}px`} zIndex={zIndex}>
				{surface}
			</Box>
		);
	}

	// 'popover' — the probe holds the anchor spot inside the trigger's
	// position:relative wrapper; the surface renders through a portal at the
	// probe's viewport position so no ancestor overflow can cut it off. The
	// drag offset / viewport clamp still apply via the surface's transform.
	return (
		<>
			<Box ref={anchorRef} aria-hidden position="absolute" top="100%" left={0} width="0" height="0" />
			{anchorPoint &&
				typeof document !== 'undefined' &&
				createPortal(
					<Box position="fixed" top={`${anchorPoint.y + 4}px`} left={`${anchorPoint.x}px`} zIndex={zIndex}>
						{surface}
					</Box>,
					document.body
				)}
		</>
	);
};
