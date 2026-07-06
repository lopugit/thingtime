import React from 'react';
import { Box } from '@chakra-ui/react';

import { DrawerTrigger } from './DrawerTrigger';
import { NavDrawer } from './NavDrawer';
import { UserSettingsModal } from './UserSettingsModal';
import { AccountModalProvider, DRAWER_Z, useDrawer, useIsMobileViewport } from './useDrawer';

// Hosts the whole drawer nav system (panel, trigger + hover popup, settings
// modal, mobile scrim) and owns the cross-cutting behaviours: body scroll
// lock while the mobile drawer is open and escape-to-close on mobile.
// The settings modal state lives in AccountModalProvider (ephemeral React
// state, never persisted), so the inner component sits inside the provider.

const DrawerSystemInner = () => {
	const { open, setOpen, accountModalOpen } = useDrawer();
	const isMobile = useIsMobileViewport();

	// freeze the shifted page while the mobile drawer is open
	React.useEffect(() => {
		if (!isMobile || !open) {
			return;
		}

		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		return () => {
			document.body.style.overflow = previous;
		};
	}, [isMobile, open]);

	// escape closes the mobile drawer (desktop split view is persistent UI);
	// suspended while the settings surface is open so surfaces peel one at a
	// time — the modal's own Escape handler closes just the modal
	React.useEffect(() => {
		if (!isMobile || !open || accountModalOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === 'Escape') {
				setOpen(false);
			}
		};

		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isMobile, open, accountModalOpen, setOpen]);

	const onNavigate = React.useCallback(() => {
		if (isMobile) {
			setOpen(false);
		}
	}, [isMobile, setOpen]);

	return (
		<>
			{/* tap-away scrim over the shifted page on mobile */}
			{isMobile && open && (
				<Box
					className="drawerScrim"
					position="fixed"
					zIndex={DRAWER_Z - 1}
					top={0}
					right={0}
					bottom={0}
					left={0}
					background="transparent"
					onClick={() => setOpen(false)}
				></Box>
			)}
			<NavDrawer onNavigate={onNavigate}></NavDrawer>
			<DrawerTrigger></DrawerTrigger>
			<UserSettingsModal></UserSettingsModal>
		</>
	);
};

export const DrawerSystem = () => {
	return (
		<AccountModalProvider>
			<DrawerSystemInner></DrawerSystemInner>
		</AccountModalProvider>
	);
};
