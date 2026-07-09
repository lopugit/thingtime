import React from 'react';
import { Box } from '@chakra-ui/react';

import { DrawerContent } from './DrawerContent';
import { DRAWER_VIEWPORT_GUTTER, DRAWER_Z, clampDrawerWidth, dispatchDrawerLiveWidth, drawerWidthCss, useDrawer } from './useDrawer';

// The pinned drawer panel: flush with the top/bottom/opening edge of the
// viewport (top 0, bottom 0, left or right 0 per settings.drawer.opens.direction),
// no opposite offset — just a width. The inner edge is a hover-to-reveal
// drag handle that resizes the drawer; the final width persists to
// thingtime.settings.drawer.width.

interface NavDrawerProps {
	onNavigate?: () => void;
}

export const NavDrawer = (props: NavDrawerProps) => {
	const { loading, open, direction, width, setWidth } = useDrawer();

	const [liveWidth, setLiveWidth] = React.useState<number | null>(null);
	const resizeSessionRef = React.useRef<any>(null);

	const shownWidth = liveWidth ?? width;

	const endResize = React.useCallback(() => {
		const session = resizeSessionRef.current;

		if (!session) {
			return;
		}

		window.removeEventListener('pointermove', session.onPointerMove);
		window.removeEventListener('pointerup', session.onPointerUp);
		window.removeEventListener('pointercancel', session.onPointerUp);

		try {
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
		} catch {
			// nothing
		}

		resizeSessionRef.current = null;

		if (typeof session.lastWidth === 'number') {
			setWidth(session.lastWidth);
		}

		// deliberately keep liveWidth (and the broadcast) alive here — the
		// setWidth above lands via the setThingtime queue a render later, and
		// dropping the live value now would paint one frame at the pre-drag width
	}, [setWidth]);

	// clear the live override only once the queued width write has landed
	React.useEffect(() => {
		if (liveWidth !== null && !resizeSessionRef.current && width === liveWidth) {
			setLiveWidth(null);
			dispatchDrawerLiveWidth(null);
		}
	}, [width, liveWidth]);

	// unmount-only cleanup (endResize identity changes with thingtime, so the
	// cleanup must not be keyed on it or it would fire mid-drag)
	const endResizeRef = React.useRef(endResize);
	endResizeRef.current = endResize;

	React.useEffect(() => {
		return () => {
			endResizeRef.current();
			dispatchDrawerLiveWidth(null);
		};
	}, []);

	const onHandlePointerDown = React.useCallback(
		(event: React.PointerEvent) => {
			if (resizeSessionRef.current) {
				return;
			}

			if (event.pointerType === 'mouse' && event.button !== 0) {
				return;
			}

			event.preventDefault();

			const session: any = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startWidth: width,
				lastWidth: width
			};

			session.onPointerMove = (e: PointerEvent) => {
				if (e.pointerId !== session.pointerId) {
					return;
				}

				const dx = e.clientX - session.startX;
				let next = clampDrawerWidth(direction === 'left' ? session.startWidth + dx : session.startWidth - dx);

				try {
					// don't let a drag persist a width the current viewport can't show
					next = Math.min(next, Math.max(DRAWER_VIEWPORT_GUTTER * 2, window.innerWidth - DRAWER_VIEWPORT_GUTTER));
				} catch {
					// nothing
				}

				session.lastWidth = next;
				setLiveWidth(next);
				dispatchDrawerLiveWidth(next);
			};

			session.onPointerUp = (e: PointerEvent) => {
				if (e.pointerId !== session.pointerId) {
					return;
				}

				endResize();
			};

			resizeSessionRef.current = session;

			try {
				document.body.style.userSelect = 'none';
				document.body.style.cursor = 'col-resize';
			} catch {
				// nothing
			}

			window.addEventListener('pointermove', session.onPointerMove);
			window.addEventListener('pointerup', session.onPointerUp);
			window.addEventListener('pointercancel', session.onPointerUp);
		},
		[width, direction, endResize]
	);

	const resizing = liveWidth !== null;

	const closedTransform = direction === 'left' ? 'translateX(-102%)' : 'translateX(102%)';

	return (
		<Box
			className="navDrawer"
			position="fixed"
			zIndex={DRAWER_Z}
			top={0}
			bottom={0}
			left={direction === 'left' ? 0 : undefined}
			right={direction === 'right' ? 0 : undefined}
			width={drawerWidthCss(shownWidth)}
			background="var(--tt-card, #ffffff)"
			borderRight={direction === 'left' ? '1px solid' : undefined}
			borderLeft={direction === 'right' ? '1px solid' : undefined}
			borderColor="var(--tt-border, #ececef)"
			boxShadow={open ? 'var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))' : 'none'}
			transform={open ? 'translateX(0)' : closedTransform}
			// while closed the off-screen panel must not be focusable/tabbable;
			// the visibility delay lets the slide-out animation finish first
			visibility={open ? 'visible' : 'hidden'}
			transition={
				loading || resizing
					? 'none'
					: `transform 0.28s ease-out, box-shadow 0.28s ease-out${open ? '' : ', visibility 0s linear 0.28s'}`
			}
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--thingtime-electron-titlebar-height, 0px))"
			paddingBottom="var(--thingtime-safe-area-bottom)"
			display="flex"
			flexDirection="column"
			aria-hidden={!open}
		>
			<DrawerContent variant="panel" onNavigate={props?.onNavigate}></DrawerContent>

			{/* invisible resize handle on the inner edge; the subtle bar only
			    appears while hovering it */}
			<Box
				className="navDrawerResizeHandle"
				position="absolute"
				top={0}
				bottom={0}
				right={direction === 'left' ? '-4px' : undefined}
				left={direction === 'right' ? '-4px' : undefined}
				width="8px"
				cursor="col-resize"
				sx={{
					touchAction: 'none',
					'&::after': {
						content: '""',
						position: 'absolute',
						top: 0,
						bottom: 0,
						left: '3px',
						width: '2px',
						background: 'rgba(0,0,0,0.18)',
						opacity: resizing ? 1 : 0,
						transition: 'opacity 0.2s ease-out'
					},
					'&:hover::after': {
						opacity: 1
					}
				}}
				onPointerDown={onHandlePointerDown}
			></Box>
		</Box>
	);
};
