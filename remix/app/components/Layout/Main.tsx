import { Flex } from '@chakra-ui/react';

import { Footer } from '../Nav/Footer';
import { Nav } from '../Nav/Nav';
import { DrawerSystem } from '../Nav/Drawer/DrawerSystem';
import { drawerWidthCss, useDrawer, useDrawerLiveWidth, useIsMobileViewport } from '../Nav/Drawer/useDrawer';

export const Main = (props) => {
	const { loading, open, direction } = useDrawer();
	const { width: drawerWidth, resizing } = useDrawerLiveWidth();
	const isMobile = useIsMobileViewport();

	// viewport-clamped drawer width shared with NavDrawer/Nav
	const shiftCss = drawerWidthCss(drawerWidth);

	// desktop split view: content resizes beside the pinned drawer
	const desktopPad = !isMobile && open ? shiftCss : '0px';

	// mobile: content keeps its size and shifts sideways instead of resizing
	const mobileShift = isMobile && open ? (direction === 'left' ? `translateX(${shiftCss})` : `translateX(calc(-1 * ${shiftCss}))`) : null;

	return (
		<Flex
			className="mainFlexRoot"
			sx={{
				'*': {
					whiteSpace: 'pre-wrap'
				}
			}}
			position="relative"
			// alignItems="center"
			alignItems="flex-start"
			justifyContent="center"
			flexDirection="column"
			overflow="hidden"
			width="100%"
			minH="100vh"
			maxWidth="100vw"
			paddingLeft={direction === 'left' ? desktopPad : undefined}
			paddingRight={direction === 'right' ? desktopPad : undefined}
			// override the global 0.2s-ease padding rule so the split-view edge
			// tracks the drawer's 0.28s ease-out, and follows live resize exactly
			transition={loading || resizing ? 'none' : 'padding 0.28s ease-out'}
		>
			<Nav />
			<Flex
				className="mainShiftContainer"
				flexDirection="column"
				width="100%"
				transform={mobileShift || 'none'}
				transition={loading || resizing ? 'none' : 'transform 0.28s ease-out'}
			>
				<Flex
					className="mainFlexChildrenContainer"
					position="relative"
					// alignItems="center"
					alignItems="flex-start"
					// justifyContent="center"
					justifyContent="flex-start"
					flexDirection="column"
					overflow="hidden"
					width="100%"
					minH="100vh"
					maxWidth="100vw"
				>
					{props.children}
				</Flex>
				<Footer></Footer>
			</Flex>
			<DrawerSystem></DrawerSystem>
		</Flex>
	);
};
