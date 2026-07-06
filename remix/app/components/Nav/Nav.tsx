import React from 'react';
import { Box, Center, Flex } from '@chakra-ui/react';
import { PanelLeft } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';

import { CommanderV2 } from '../Commander/CommanderV2';
import { Icon } from '../Icon/Icon';
import { drawerWidthCss, useDrawer, useDrawerLiveWidth, useIsMobileViewport } from './Drawer/useDrawer';
import { useThingtime } from '../Thingtime/useThingtime';
import { useCurrentUser } from '~/hooks/useCurrentUser';

const BRANCH_NAME = typeof process !== 'undefined' && process.env?.THINGTIME_BRANCH_NAME ? process.env.THINGTIME_BRANCH_NAME : 'git/unknown';

console.log('BRANCH_NAME:', BRANCH_NAME);

export const Nav = (props) => {
	const { thingtime } = useThingtime();

	const user = useCurrentUser();

	const { loading, open, toggleOpen, direction } = useDrawer();
	const { width: drawerWidth, resizing } = useDrawerLiveWidth();
	const isMobile = useIsMobileViewport();

	const { pathname } = useLocation();

	const navigate = useNavigate();

	// follow the drawer: desktop split view offsets the fixed nav, mobile
	// shifts it along with the page content (content never resizes there);
	// widths go through the shared viewport-clamped CSS expression
	const drawerCssWidth = drawerWidthCss(drawerWidth);
	const desktopOpen = !isMobile && open;
	const mobileOpen = isMobile && open;

	const inEditorMode = React.useMemo(() => {
		if (pathname.slice(0, 7) === '/editor') {
			return true;
		}

		return false;
	}, [pathname]);

	const inEditMode = React.useMemo(() => {
		if (pathname.slice(0, 5) === '/edit') {
			return true;
		}

		return false;
	}, [pathname]);

	const editorToggleable = React.useMemo(() => {
		if (pathname.slice(0, 7) === '/things') {
			return true;
		} else if (pathname.slice(0, 5) === '/edit') {
			return true;
		}

		if (thingtime.get('thingtimeUrlPageVisible')) {
			return true;
		}

		return false;
	}, [pathname, thingtime]);

	const toggleEdit = React.useCallback(
		(e) => {
			// if first characters of pathname are /things replace with /edit
			// or if first characters of pathname are /edit replace with /things
			if (pathname.slice(0, 7) === '/things') {
				const newPathname = pathname.replace('/things', '/edit');
				navigate(newPathname);
			} else if (pathname.slice(0, 7) === '/editor') {
				const newPathname = pathname.replace('/editor', '/things');
				navigate(newPathname);
			} else if (pathname.slice(0, 5) === '/edit') {
				const newPathname = pathname.replace('/edit', '/things');
				navigate(newPathname);
			} else if (thingtime.get('thingtimeUrlPageVisible')) {
				const newPathname = pathname.replace('/', '/edit/');
				navigate(newPathname);
			}
		},
		[pathname, navigate, thingtime]
	);

	const toggleEditor = React.useCallback(
		(e) => {
			// if first characters of pathname are /things replace with /edit
			// or if first characters of pathname are /edit replace with /things
			if (pathname.slice(0, 7) === '/editor') {
				const newPathname = pathname.replace('/editor', '/edit');
				navigate(newPathname);
			} else if (pathname.slice(0, 5) === '/edit') {
				const newPathname = pathname.replace('/edit', '/editor');
				navigate(newPathname);
			}
		},
		[pathname, navigate]
	);

	return (
		<>
			<Box
				className="thingtimeTopNav"
				position="fixed"
				zIndex={9999}
				top="var(--thingtime-safe-area-top, 0px)"
				right={direction === 'right' && desktopOpen ? drawerCssWidth : 0}
				left={direction === 'left' && desktopOpen ? drawerCssWidth : 0}
				transform={
					mobileOpen ? (direction === 'left' ? `translateX(${drawerCssWidth})` : `translateX(calc(-1 * ${drawerCssWidth}))`) : 'none'
					}
					transition={loading || resizing ? 'none' : 'left 0.28s ease-out, right 0.28s ease-out, transform 0.28s ease-out'}
					sx={{
						'html.thingtime-native-webview &': {
							background: 'white',
							isolation: 'isolate',
							position: 'fixed',
							top: 'var(--thingtime-safe-area-top, 0px)'
						}
					}}
				>
				<Flex
					as="nav"
					position="relative"
					alignItems="center"
					justifyContent="center"
					flexDirection="row"
					width="100%"
					maxWidth="100%"
					marginY={1}
					paddingX="18px"
					paddingY="14px"
					// bg='white'
					// boxShadow={'0px 0px 10px rgba(0,0,0,0.1)'}
				>
					<Center
						className="nav-native-drawer-button"
						as="button"
						type="button"
						position="absolute"
						left={0}
						top={0}
						bottom={0}
						width="56px"
						display="none"
						cursor="pointer"
						opacity={0.75}
						aria-label={open ? 'Close menu' : 'Open menu'}
						title={open ? 'Close menu' : 'Open menu'}
						sx={{
							WebkitTapHighlightColor: 'transparent',
							touchAction: 'manipulation',
							'html.thingtime-native-webview &': {
								display: 'flex'
							}
						}}
						onClick={toggleOpen}
					>
						<PanelLeft size={16} strokeWidth={1.9} />
					</Center>
					<Center
						className="nav-left-section"
						display={['none', 'flex']}
						height="100%"
						marginRight="auto"
						// leave room for the fixed drawer trigger button at the top
						// left of the screen — needed unless the drawer is pinned
						// on the left (then the nav starts right of the trigger)
						paddingLeft={direction === 'left' && desktopOpen ? 0 : '34px'}
					>
						<Center transform="scaleX(-100%)" cursor="pointer">
							<Link to="/">
								<Icon size="12px" name="🦄"></Icon>
							</Link>
						</Center>
					</Center>
					<CommanderV2 global id="nav" rainbow={false}></CommanderV2>
					<Center className="nav-right-section" columnGap={[3, 8]} height="100%" marginLeft="auto">
						{inEditMode && (
							<Center
								// transform="scaleX(-100%)"
								cursor="pointer"
								onClick={toggleEditor}
							>
								<Icon
									chakras={{
										opacity: inEditorMode ? 1 : 0.3
									}}
									size="12px"
									name="👀"
								></Icon>
							</Center>
						)}
						{editorToggleable && (
							<Center transform="scaleX(-100%)" cursor="pointer" onClick={toggleEdit}>
								<Icon
									chakras={{
										opacity: inEditMode ? 1 : 0.3
									}}
									size="12px"
									name="🎨"
								></Icon>
							</Center>
						)}
						<Center cursor="pointer">
							{user ? (
								<Link to="/profile">
									<Flex flexDir={'row'} gap={2} alignItems="center">
										<Box fontSize="xs" fontWeight="600">
											{user.displayName || user.username}
										</Box>
										<Icon transform={['', 'scaleX(-100%)']} size="12px" name="🌈"></Icon>
									</Flex>
								</Link>
							) : (
								<Link to="/login">
									<Flex flexDir={'row'} gap={2}>
										<Box fontSize="xs" opacity={0.5}>
											Login
										</Box>
										<Icon transform={['', 'scaleX(-100%)']} size="12px" name="🌈"></Icon>
									</Flex>
								</Link>
							)}
						</Center>
						<Center display={['flex', 'none']} cursor="pointer">
							<Link to="/">
								<Icon size="12px" name="🦄"></Icon>
							</Link>
						</Center>
					</Center>
				</Flex>
			</Box>
		</>
	);
};
