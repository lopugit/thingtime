import React from 'react';
import { Box, Center } from '@chakra-ui/react';
import { PanelLeft } from 'lucide-react';

import { DrawerContent } from './DrawerContent';
import { DRAWER_POPUP_Z, DRAWER_TRIGGER_Z, useDrawer, useIsMobileViewport } from './useDrawer';

// The single drawer trigger button, fixed to the top left of the screen on
// both mobile and desktop. On desktop, hovering it previews the drawer
// contents in a floating popup (no click needed); clicking pins the drawer
// open as a split view.

const POPUP_OPEN_DELAY_MS = 160;
const POPUP_CLOSE_DELAY_MS = 260;

export const DrawerTrigger = () => {
	const { open, toggleOpen } = useDrawer();
	const isMobile = useIsMobileViewport();

	const [popupOpen, setPopupOpen] = React.useState(false);

	const openTimerRef = React.useRef<any>(null);
	const closeTimerRef = React.useRef<any>(null);

	const clearTimers = React.useCallback(() => {
		clearTimeout(openTimerRef.current);
		clearTimeout(closeTimerRef.current);
	}, []);

	React.useEffect(() => {
		return () => {
			clearTimers();
		};
	}, [clearTimers]);

	// the popup is a closed-drawer preview; once pinned open it is redundant
	React.useEffect(() => {
		if (open || isMobile) {
			setPopupOpen(false);
		}
	}, [open, isMobile]);

	const scheduleClose = React.useCallback(() => {
		clearTimeout(closeTimerRef.current);
		closeTimerRef.current = setTimeout(() => {
			setPopupOpen(false);
		}, POPUP_CLOSE_DELAY_MS);
	}, []);

	const onTriggerMouseEnter = React.useCallback(() => {
		if (isMobile || open) {
			return;
		}

		clearTimeout(closeTimerRef.current);
		clearTimeout(openTimerRef.current);
		openTimerRef.current = setTimeout(() => {
			setPopupOpen(true);
		}, POPUP_OPEN_DELAY_MS);
	}, [isMobile, open]);

	const onTriggerMouseLeave = React.useCallback(() => {
		clearTimeout(openTimerRef.current);
		scheduleClose();
	}, [scheduleClose]);

	const onPopupMouseEnter = React.useCallback(() => {
		clearTimeout(closeTimerRef.current);
	}, []);

	const onClick = React.useCallback(() => {
		clearTimers();
		setPopupOpen(false);
		toggleOpen();
	}, [clearTimers, toggleOpen]);

	return (
		<>
			<Center
				className="drawerTrigger"
				as="button"
				type="button"
				position="fixed"
				zIndex={DRAWER_TRIGGER_Z}
				top="calc(var(--thingtime-safe-area-top) + 8px)"
				left="calc(var(--thingtime-electron-titlebar-left-inset, 0px) + 8px)"
				width="36px"
				height="36px"
				borderRadius="8px"
				background="transparent"
				_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
				opacity={0.75}
				transition="background 0.2s ease-out, opacity 0.2s ease-out"
				cursor="pointer"
				title={open ? 'Close menu' : 'Open menu'}
				aria-label={open ? 'Close menu' : 'Open menu'}
				sx={{
					WebkitTapHighlightColor: 'transparent',
					touchAction: 'manipulation'
				}}
				onClick={onClick}
				onMouseEnter={onTriggerMouseEnter}
				onMouseLeave={onTriggerMouseLeave}
			>
				<PanelLeft size={16} strokeWidth={1.9} />
			</Center>

			{/* desktop hover preview of the drawer contents */}
			{!isMobile && popupOpen && !open && (
				<Box
					className="drawerHoverPopup"
					position="fixed"
					zIndex={DRAWER_POPUP_Z}
					top="calc(var(--thingtime-safe-area-top) + var(--thingtime-electron-titlebar-height, 0px) + 10px)"
					left="10px"
					width="300px"
					maxWidth="86vw"
					maxHeight="72vh"
					display="flex"
					background="var(--tt-card, #ffffff)"
					border="1px solid"
					borderColor="var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-lg, 16px)"
					boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
					overflow="hidden"
					onMouseEnter={onPopupMouseEnter}
					onMouseLeave={scheduleClose}
				>
					<DrawerContent variant="popup" onNavigate={() => setPopupOpen(false)}></DrawerContent>
				</Box>
			)}
		</>
	);
};
