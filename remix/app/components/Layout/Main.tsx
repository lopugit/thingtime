import { Flex } from '@chakra-ui/react';
import { useLocation } from 'react-router';

import { Footer } from '../Nav/Footer';
import { drawerWidthCss, useDrawer, useDrawerLiveWidth, useIsMobileViewport } from '../Nav/Drawer/useDrawer';

// Full-bleed app surfaces own the whole viewport (fixed-height panes with
// their own internal scroll), so the footer and its tail spacer stay off —
// a chat that scrolls the page under the composer is unusable. Matched by
// prefix so /lopu/:chatId deep links stay full-bleed too.
const FULL_BLEED_PATHS = ['/messages', '/lopu'];
const isFullBleedPath = (pathname: string) => FULL_BLEED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

export const Main = (props) => {
	const { loading, open, direction } = useDrawer();
	const { width: drawerWidth, resizing } = useDrawerLiveWidth();
	const isMobile = useIsMobileViewport();
	const { pathname } = useLocation();
	const fullBleed = isFullBleedPath(pathname);

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
				{fullBleed ? null : <Footer></Footer>}
			</Flex>
		</Flex>
	);
};
