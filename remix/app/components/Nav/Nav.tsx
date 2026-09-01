import React from 'react';
import { Box, Center, Flex } from '@chakra-ui/react';
import { Command, Search } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';

import { CommanderV2 } from '../Commander/CommanderV2';
import { toggleQuickSwitcher } from '../QuickSwitcher/QuickSwitcher';
import { Icon } from '../Icon/Icon';
import { NotificationsBell } from './NotificationsBell';
import { drawerWidthCss, useDrawer, useDrawerLiveWidth, useIsMobileViewport } from './Drawer/useDrawer';
import { useThingtime } from '../Thingtime/useThingtime';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';
import { motionOK, partyConfetti } from '~/eggs/eggs';
import { getUserDisplayName } from '~/utils/userIdentity';

// 🥚 Easter egg: rapid 7-click streak on the nav 🦄 makes it gallop.
const GALLOP_STREAK = 7;
const STREAK_WINDOW_MS = 1500;

const useUnicornGallop = () => {
	const lopu = useLopu();
	const count = React.useRef(0);
	const last = React.useRef(0);
	const [galloping, setGalloping] = React.useState(false);

	const onLogoClick = React.useCallback(() => {
		const now = Date.now();
		count.current = now - last.current < STREAK_WINDOW_MS ? count.current + 1 : 1;
		last.current = now;
		if (count.current >= GALLOP_STREAK) {
			count.current = 0;
			if (motionOK()) {
				setGalloping(true);
				window.setTimeout(() => setGalloping(false), 1100);
			}
			partyConfetti(4);
			lopu({
				title: 'You found the gallop 🦄💨',
				description: 'Seven clicks of pure curiosity. Ride on, explorer.',
				status: 'success'
			});
		}
	}, [lopu]);

	return { onLogoClick, galloping };
};

export const Nav = (props) => {
	const { thingtime } = useThingtime();

	const user = useCurrentUser();
	const claimedUser = user?.temporary ? null : user;

	const { loading, open, direction, openSearch } = useDrawer();
	const { width: drawerWidth, resizing } = useDrawerLiveWidth();
	const isMobile = useIsMobileViewport();

	const { onLogoClick, galloping } = useUnicornGallop();
	const gallopSx = galloping ? { animation: 'tt-gallop 1.1s ease-in-out' } : undefined;

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

	const onElectronSearchClick = React.useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			openSearch();
		},
		[openSearch]
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
					background="color-mix(in srgb, var(--tt-card, #ffffff) 78%, transparent)"
					borderBottom="1px solid var(--tt-border, #ececef)"
					sx={{
						backdropFilter: 'blur(14px)',
						WebkitBackdropFilter: 'blur(14px)',
						'html.thingtime-native-webview &': {
							background: 'var(--tt-card, white)',
							isolation: 'isolate',
							position: 'fixed',
							top: 'var(--thingtime-safe-area-top, 0px)'
						}
					}}
				>
				<Flex
					className="thingtimeTopNavInner"
					as="nav"
					position="relative"
					alignItems="center"
					justifyContent="center"
					flexDirection="row"
					width="100%"
					maxWidth="100%"
					marginY={1}
					paddingLeft="18px"
					paddingRight="18px"
					paddingY="14px"
					// bg='white'
					// boxShadow={'0px 0px 10px rgba(0,0,0,0.1)'}
				>
					<Center
						className="nav-left-section"
						display={['none', 'flex']}
						height="100%"
						marginRight="auto"
						columnGap={2}
						// leave room for the fixed drawer trigger button at the top
						// left of the screen — needed unless the drawer is pinned
						// on the left (then the nav starts right of the trigger)
						paddingLeft={direction === 'left' && desktopOpen ? 0 : 'var(--thingtime-electron-titlebar-nav-start, 34px)'}
					>
						<Center className="electron-titlebar-home-button" transform="scaleX(-100%)" cursor="pointer" onClick={onLogoClick} sx={gallopSx}>
							<Link to="/">
								<Icon size="12px" name="🦄"></Icon>
							</Link>
						</Center>
						<Center
							className="electron-titlebar-search-button"
							as="button"
							type="button"
							display="none"
							width="34px"
							height="34px"
							borderRadius="8px"
							opacity={0.74}
							cursor="pointer"
							title="Search"
							aria-label="Search"
							_hover={{ opacity: 1, background: 'var(--tt-surface-hover, #ececee)' }}
							sx={{
								WebkitTapHighlightColor: 'transparent',
								touchAction: 'manipulation',
								'html.thingtime-electron-desktop &': {
									display: 'flex'
								}
							}}
							onClick={onElectronSearchClick}
						>
							<Search size={16} strokeWidth={1.9} />
						</Center>
					</Center>
					<CommanderV2 global id="nav" rainbow={false}></CommanderV2>
					{/* relative + above the commander host (zIndex 9999): the centered
				search pill is absolutely positioned, and long usernames (and now
				the bell) can extend under it — these controls must stay tappable */}
				<Center
					className="nav-right-section"
					columnGap={[3, 8]}
					height="100%"
					marginLeft="auto"
					position="relative"
					zIndex={10000}
				>
						{/* ⌘K quick switcher trigger — the touch/mobile way in (desktop
						has the chord); sits by the search pill, styled like the other
						nav icon buttons */}
						<Center
							className="nav-quick-switcher-button"
							as="button"
							type="button"
							cursor="pointer"
							opacity={0.55}
							aria-label="Quick switcher (⌘K)"
							title="Quick switcher (⌘K)"
							_hover={{ opacity: 1 }}
							sx={{
								WebkitTapHighlightColor: 'transparent',
								touchAction: 'manipulation'
							}}
							onClick={(event: React.MouseEvent) => {
								event.preventDefault();
								event.stopPropagation();
								toggleQuickSwitcher();
							}}
						>
							<Command size={14} strokeWidth={1.9} />
						</Center>
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
						{claimedUser && (
							<Center>
								<NotificationsBell />
							</Center>
						)}
						<Center cursor="pointer">
							{claimedUser ? (
								<Link to="/profile">
									<Flex flexDir={'row'} gap={2} alignItems="center">
										<Box fontSize="xs" fontWeight="600">
											{getUserDisplayName(claimedUser)}
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
						<Center display={['flex', 'none']} cursor="pointer" onClick={onLogoClick} sx={gallopSx}>
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
