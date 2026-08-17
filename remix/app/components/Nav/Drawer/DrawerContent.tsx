import React from 'react';
import { Box, Center, Flex, Image, Text } from '@chakra-ui/react';
import { useLocation, useMatches, useNavigate } from 'react-router';
import { ChevronDown, Search } from 'lucide-react';

import { Icon } from '../../Icon/Icon';
import { RAINBOW } from '~/theme/rainbow';
import { ROOT_THING_PATH, buildThingModeUrl, parseThingMode, parseThingPath } from '../../Thingtime/thingRoute';
import { EditorDrawerSection } from './EditorDrawerSection';
import { ReorderableList } from './ReorderableList';
import { applyDrawerOrdering, buildDrawerSubSections, drawerMenuItems, filterDrawerItemsByAuth } from './drawerMenu';
import { useDrawer, useIsMobileViewport } from './useDrawer';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { MessengerUnreadBadge } from '../../Messenger/MessengerNotifications';
import { LOGIN_TO_CLAIM_LABEL, getUserDisplayName } from '~/utils/userIdentity';

// Shared drawer inner content, used by both the pinned NavDrawer panel and
// the desktop hover popup.
// variant 'panel' = the real drawer; variant 'popup' = hover preview.
// onNavigate fires after actions that should dismiss the containing surface
// (sub-item navigation, search, avatar) — the parent decides what closing means.

interface DrawerContentProps {
	variant: 'panel' | 'popup';
	onNavigate?: () => void;
}

export const UserAvatarCircle = (props: { size?: string; fontSize?: string }) => {
	const user = useCurrentUser();

	// a set avatar always wins — the rainbow initial is only the fallback
	if (user?.avatarUrl) {
		return (
			<Image
				src={user.avatarUrl}
				alt={getUserDisplayName(user)}
				width={props?.size || '28px'}
				height={props?.size || '28px'}
				borderRadius="999px"
				objectFit="cover"
				flexShrink={0}
				border="1px solid var(--tt-border, #ececef)"
			/>
		);
	}

	const initial = user ? getUserDisplayName(user).trim().charAt(0).toUpperCase() : '?';

	return (
		<Center
			flexShrink={0}
			width={props?.size || '28px'}
			height={props?.size || '28px'}
			borderRadius="999px"
			background={user ? RAINBOW : 'var(--tt-surface-alt, #f5f5f7)'}
			color="white"
			fontSize={props?.fontSize || 'xs'}
			fontWeight={700}
		>
			{user ? initial : <Icon name="rainbow" size={props?.fontSize || '12px'}></Icon>}
		</Center>
	);
};

export const DrawerContent = (props: DrawerContentProps) => {
	const { variant, onNavigate } = props;

	const {
		loading,
		open,
		setOpen,
		direction,
		topLevelLimit,
		topLevelLimitIsUnlimited,
		ordering,
		setOrderingFor,
		closesOnClick,
		selectedItem,
		setSelectedItem,
		collapsedGroups,
		toggleGroupCollapsed,
		setAccountModalOpen,
		openSearch
	} = useDrawer();

	const user = useCurrentUser();
	const isMobile = useIsMobileViewport();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const matches = useMatches();

	// true when the current page is the catch-all thing route (it's the only
	// route with a '*' param), so mode switches know whether a thing path is
	// on screen to preserve
	const onThingRoute = React.useMemo(() => {
		const lastMatch = matches[matches.length - 1];
		return typeof lastMatch?.params?.['*'] === 'string';
	}, [matches]);

	const [showAllTop, setShowAllTop] = React.useState(false);

	// collapse the "More" section again whenever the drawer closes
	React.useEffect(() => {
		if (variant === 'panel' && !open) {
			setShowAllTop(false);
		}
	}, [variant, open]);

	const orderedTopItems = React.useMemo(() => {
		const defaultIds = drawerMenuItems.map((item) => item.id);
		const orderedIds = applyDrawerOrdering(defaultIds, ordering?.toplevel);

		return orderedIds.map((id) => drawerMenuItems.find((item) => item.id === id)).filter(Boolean);
	}, [ordering?.toplevel]);

	const visibleTopItems = React.useMemo(() => {
		const finiteTopLevelLimit = typeof topLevelLimit === 'number' ? topLevelLimit : orderedTopItems.length;

		if (topLevelLimitIsUnlimited || showAllTop) {
			return orderedTopItems;
		}

		return orderedTopItems.slice(0, finiteTopLevelLimit);
	}, [orderedTopItems, showAllTop, topLevelLimit, topLevelLimitIsUnlimited]);

	const hiddenTopCount =
		topLevelLimitIsUnlimited || typeof topLevelLimit !== 'number'
			? 0
			: Math.max(0, orderedTopItems.length - topLevelLimit);

	const selectedTopItem = React.useMemo(() => {
		return orderedTopItems.find((item) => item.id === selectedItem) || orderedTopItems[0];
	}, [orderedTopItems, selectedItem]);

	// mirrors the selection ahead of the setThingtime queue: updated eagerly at
	// click time so the pathname-sync effect never reverts a fresh manual pick
	const selectedItemRef = React.useRef(selectedItem);
	selectedItemRef.current = selectedItem;

	// keep the selected top-level item in sync with wherever the user actually
	// navigates. Only the always-mounted panel does this, and only while the
	// drawer is open — every write serializes the whole thingtime tree to
	// localforage, so a hidden drawer must not persist on route changes. The
	// `open` dep re-runs the sync the moment the drawer opens.
	React.useEffect(() => {
		if (variant !== 'panel' || loading || !open) {
			return;
		}

		const routeMatchesItem = (item) => {
			if (!item) {
				return false;
			}
			if (item.to === pathname || item.children?.some((child) => child.to === pathname)) {
				return true;
			}
			const prefixes = [item.to, ...(item.children?.map((child) => child.to) || [])].filter((to) => to && to !== '/');
			return prefixes.some((prefix) => pathname.startsWith(prefix));
		};

		// routes can live under multiple top-level items (e.g. /branding under
		// both home and branding) — if the intended selection already contains
		// the route, don't fight the user's pick with a first-match scan
		const current = orderedTopItems.find((item) => item.id === selectedItemRef.current);
		if (routeMatchesItem(current)) {
			return;
		}

		let matchId = null;

		orderedTopItems.forEach((item) => {
			if (matchId) {
				return;
			}
			if (item.to === pathname || item.children?.some((child) => child.to === pathname)) {
				matchId = item.id;
			}
		});

		if (!matchId) {
			orderedTopItems.forEach((item) => {
				if (matchId) {
					return;
				}
				const prefixes = [item.to, ...(item.children?.map((child) => child.to) || [])].filter((to) => to && to !== '/');
				if (prefixes.some((prefix) => pathname.startsWith(prefix))) {
					matchId = item.id;
				}
			});
		}

		if (matchId && matchId !== selectedItemRef.current) {
			selectedItemRef.current = matchId;
			setSelectedItem(matchId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pathname, loading, variant, open]);

	const subItems = React.useMemo(() => {
		const children = filterDrawerItemsByAuth(selectedTopItem?.children || [], !!user, !!user?.isAdmin);
		const defaultIds = children.map((item) => item.id);
		const orderedIds = applyDrawerOrdering(defaultIds, ordering?.[selectedTopItem?.id]);

		return orderedIds.map((id) => children.find((item) => item.id === id)).filter(Boolean);
	}, [selectedTopItem, ordering, user]);

	const subSections = React.useMemo(() => {
		return buildDrawerSubSections(subItems);
	}, [subItems]);

	// A navigating menu click dismisses the containing surface on BOTH
	// viewports: onNavigate covers the popup preview + mobile panel, and
	// setOpen(false) closes the pinned desktop panel too. Search stays on its
	// own path (openSearch honours the "Search closes drawer" setting).
	const dismissAfterNavigate = React.useCallback(() => {
		onNavigate?.();
		setOpen(false);
	}, [onNavigate, setOpen]);

	const onTopItemClick = React.useCallback(
		(item) => {
			selectedItemRef.current = item.id;
			setSelectedItem(item.id);
			if (item.to) {
				navigate(item.to);
				// unless the item's "close after click" setting is off — turning
				// it off restores the old explore-the-submenu behaviour per item
				if (closesOnClick(item.id)) {
					dismissAfterNavigate();
				}
			}
			// items without a destination only select — the surface stays open
		},
		[setSelectedItem, navigate, closesOnClick, dismissAfterNavigate]
	);

	const onSubItemClick = React.useCallback(
		(item) => {
			if (item.mode) {
				// mode items switch the mode for the thing path currently on
				// screen instead of opening the mode prefix as a thing path;
				// clicking the active non-view mode toggles back to view
				const currentMode = onThingRoute ? parseThingMode(pathname) : null;
				const thingPath = onThingRoute ? parseThingPath(pathname) : ROOT_THING_PATH;
				const nextMode = item.mode === currentMode && item.mode !== 'view' ? 'view' : item.mode;

				navigate(buildThingModeUrl(nextMode, thingPath));
			} else if (item.to) {
				navigate(item.to);
			}
			if (closesOnClick(item.id)) {
				dismissAfterNavigate();
			}
		},
		[navigate, dismissAfterNavigate, onThingRoute, pathname, closesOnClick]
	);

	const onTopReorder = React.useCallback(
		(newVisibleIds: string[]) => {
			const allIds = orderedTopItems.map((item) => item.id);
			const hiddenIds = allIds.filter((id) => !newVisibleIds.includes(id));

			setOrderingFor('toplevel', [...newVisibleIds, ...hiddenIds]);
		},
		[orderedTopItems, setOrderingFor]
	);

	const onSubSectionReorder = React.useCallback(
		(sectionGroup: string | null, newSectionIds: string[]) => {
			const flat = subSections.flatMap((section) => {
				if (section.group === sectionGroup) {
					return newSectionIds;
				}
				return section.items.map((item) => item.id);
			});

			setOrderingFor(selectedTopItem?.id, flat);
		},
		[subSections, selectedTopItem, setOrderingFor]
	);

	// whole-section reorder: section order IS the flat item order (sections are
	// grouped by first appearance), so persisting the sections' items
	// concatenated in the new order reuses the existing per-top-item ordering
	const sectionKeyOf = (group: string | null) => group ?? '__ungrouped__';
	const onGroupSectionReorder = React.useCallback(
		(newSectionKeys: string[]) => {
			const byKey = new Map(subSections.map((section) => [sectionKeyOf(section.group), section]));
			const flat = newSectionKeys.flatMap((key) => byKey.get(key)?.items.map((item) => item.id) || []);

			setOrderingFor(selectedTopItem?.id, flat);
		},
		[subSections, selectedTopItem, setOrderingFor]
	);

	const onSearchClick = React.useCallback(
		(event?: React.MouseEvent) => {
			// this same native click bubbles to document where the Commander's
			// ClickAwayListener runs closeCommander, which skips defaultPrevented events
			event?.preventDefault?.();
			openSearch();
			// panel: DrawerSystem closes only on mobile, where the scrim + page
			// shift would bury the nav commander; searchClosesDrawer stays the
			// desktop split-view preference. popup: dismisses the hover preview.
			onNavigate?.();
		},
		[openSearch, onNavigate]
	);

	const onBrandClick = React.useCallback(() => {
		navigate('/');
		dismissAfterNavigate();
	}, [navigate, dismissAfterNavigate]);

	const openSettingsModal = React.useCallback(() => {
		setAccountModalOpen(true);
		if (variant === 'popup') {
			onNavigate?.();
		}
	}, [setAccountModalOpen, variant, onNavigate]);

	// avatar + name go to the profile page; logged out there is no profile, so
	// the row opens the settings modal (it hosts the account switcher / log in)
	const onAccountRowClick = React.useCallback(() => {
		if (user) {
			navigate('/profile');
			dismissAfterNavigate();
			return;
		}
		openSettingsModal();
	}, [user, navigate, dismissAfterNavigate, openSettingsModal]);

	const onSettingsClick = React.useCallback(
		(event: React.MouseEvent) => {
			event.stopPropagation();
			openSettingsModal();
		},
		[openSettingsModal]
	);

	const isActivePath = React.useCallback(
		(to?: string) => {
			return !!to && to === pathname;
		},
		[pathname]
	);

	const topRow = (item) => {
		const selected = selectedTopItem?.id === item.id;

		return (
			<Flex
				alignItems="center"
				columnGap={2}
				marginX={2}
				paddingX={3}
				paddingY="7px"
				borderRadius="var(--tt-radius-sm, 9px)"
				background={selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
				_hover={{ background: selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-surface-hover, #ececee)' }}
				transition="background 0.15s ease"
				cursor="pointer"
				onClick={() => onTopItemClick(item)}
			>
				<Icon name={item.icon} size="13px"></Icon>
				<Text fontSize="sm" fontWeight={selected ? 600 : 400}>
					{item.label}
					{item.id === 'messages' ? <MessengerUnreadBadge /> : null}
				</Text>
			</Flex>
		);
	};

	const subRow = (item) => {
		const active = item.mode ? onThingRoute && parseThingMode(pathname) === item.mode : isActivePath(item.to);

		return (
			<Flex
				alignItems="center"
				columnGap={2}
				marginX={2}
				paddingX={3}
				paddingY="6px"
				paddingLeft={item.group ? 6 : 3}
				borderRadius="var(--tt-radius-sm, 9px)"
				background={active ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
				_hover={{ background: active ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-surface-hover, #ececee)' }}
				transition="background 0.15s ease"
				cursor="pointer"
				onClick={() => onSubItemClick(item)}
			>
				{item.icon && <Icon name={item.icon} size="11px" chakras={{ opacity: 0.85 }}></Icon>}
				<Text fontSize="xs" fontWeight={active ? 600 : 400}>
					{item.label}
				</Text>
			</Flex>
		);
	};

	// the fixed trigger button floats over the panel header when the drawer
	// opens from the left — reserve room so the brand row is not covered
	const headerPaddingLeft =
		variant === 'panel' && direction === 'left' ? 'calc(var(--thingtime-electron-titlebar-left-inset, 0px) + 52px)' : '16px';

	return (
		<Flex className="drawerContent" flexDirection="column" width="100%" height="100%" minHeight={0}>
			{/* header: brand + search (top right) */}
			<Flex
				className="drawerContentHeader"
				alignItems="center"
				flexShrink={0}
				paddingLeft={headerPaddingLeft}
				paddingRight="12px"
				paddingTop="12px"
				paddingBottom="8px"
			>
				<Flex
					as="button"
					type="button"
					alignItems="center"
					columnGap={2}
					minWidth={0}
					marginLeft="-8px"
					paddingX={2}
					paddingY="4px"
					borderRadius="var(--tt-radius-sm, 9px)"
					_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
					transition="background 0.15s ease"
					cursor="pointer"
					title="Home"
					onClick={onBrandClick}
				>
					<Icon name="unicorn" size="13px"></Icon>
					<Text fontSize="sm" fontWeight={600} whiteSpace="nowrap">
						Thingtime
					</Text>
				</Flex>
				<Center
					as="button"
					type="button"
					marginLeft="auto"
					width="30px"
					height="30px"
					borderRadius="var(--tt-radius-sm, 9px)"
					opacity={0.6}
					_hover={{ opacity: 1, background: 'var(--tt-surface-hover, #ececee)' }}
					transition="background 0.15s ease, opacity 0.15s ease"
					cursor="pointer"
					title="Search"
					onClick={onSearchClick}
				>
					<Search size={15} strokeWidth={2} />
				</Center>
			</Flex>

			{/* scrollable menus */}
			<Box className="drawerMenuScroll" flex={1} minHeight={0} overflowY="auto" paddingBottom={2}>
				{/* top-level items (limited, with faint More) */}
				<Flex flexDirection="column" rowGap="1px" paddingTop={1}>
					<ReorderableList
						items={visibleTopItems.map((item) => ({
							id: item.id,
							node: topRow(item)
						}))}
						onReorder={onTopReorder}
					/>
					{hiddenTopCount > 0 && (
						<Flex
							as="button"
							type="button"
							alignItems="center"
							columnGap={1}
							marginX={2}
							paddingX={3}
							paddingY="5px"
							borderRadius="var(--tt-radius-sm, 9px)"
							opacity={0.45}
							_hover={{ opacity: 0.85, background: 'var(--tt-surface-hover, #ececee)' }}
							transition="background 0.15s ease, opacity 0.15s ease"
							cursor="pointer"
							onClick={() => setShowAllTop((prev) => !prev)}
						>
							<Box as="span" transform={showAllTop ? 'rotate(180deg)' : 'none'} transition="transform 0.2s ease-out" display="inline-flex">
								<ChevronDown size={13} strokeWidth={2} />
							</Box>
							<Text fontSize="xs">{showAllTop ? 'Less' : `More (${hiddenTopCount})`}</Text>
						</Flex>
					)}
				</Flex>

				{/* second-level menu for the selected top-level item */}
				{!!subItems.length && (
					<>
						<Text
							paddingX={5}
							paddingTop={5}
							paddingBottom={1}
							fontFamily="mono"
							fontSize="10px"
							fontWeight={600}
							letterSpacing="0.08em"
							textTransform="uppercase"
							color="var(--tt-muted, #9a9aa6)"
						>
							{selectedTopItem?.label}
						</Text>
						<Flex flexDirection="column" rowGap="1px">
							{/* sections are themselves reorderable — but only when the drag
							starts from a group header (the handle), so the nested per-item
							lists keep sole ownership of drags that start on their rows */}
							<ReorderableList
								key={`${selectedTopItem?.id}-sections`}
								shouldStartDrag={(event) =>
									Boolean((event.target as Element | null)?.closest?.('[data-drawer-group-handle]'))
								}
								onReorder={onGroupSectionReorder}
								items={subSections.map((section) => {
									if (!section.group) {
										return {
											id: '__ungrouped__',
											node: (
												<ReorderableList
													items={section.items.map((item) => ({
														id: item.id,
														node: subRow(item)
													}))}
													onReorder={(idsInSection) => onSubSectionReorder(null, idsInSection)}
												/>
											)
										};
									}

									const groupKey = `${selectedTopItem?.id}:${section.group}`;
									const collapsed = !!collapsedGroups?.[groupKey];

									return {
										id: section.group,
										node: (
											<>
												<Flex
													data-drawer-group-handle
													title="Click to collapse · hold to drag"
													alignItems="center"
													columnGap={1}
													marginX={2}
													paddingX={3}
													paddingY="5px"
													borderRadius="var(--tt-radius-sm, 9px)"
													opacity={0.7}
													_hover={{ opacity: 1, background: 'var(--tt-surface-hover, #ececee)' }}
													transition="background 0.15s ease, opacity 0.15s ease"
													cursor="pointer"
													onClick={() => toggleGroupCollapsed(groupKey)}
												>
													<Box
														as="span"
														display="inline-flex"
														transform={collapsed ? 'rotate(-90deg)' : 'none'}
														transition="transform 0.2s ease-out"
													>
														<ChevronDown size={12} strokeWidth={2} />
													</Box>
													<Text
														fontFamily="mono"
														fontSize="10px"
														fontWeight={600}
														letterSpacing="0.08em"
														textTransform="uppercase"
														color="var(--tt-muted, #9a9aa6)"
													>
														{section.group}
													</Text>
												</Flex>
												{!collapsed && (
													<ReorderableList
														items={section.items.map((item) => ({
															id: item.id,
															node: subRow(item)
														}))}
														onReorder={(idsInSection) => onSubSectionReorder(section.group, idsInSection)}
													/>
												)}
											</>
										)
									};
								})}
							/>
						</Flex>
					</>
				)}

				{/* editor window/config management, shown with the Things menu */}
				{selectedTopItem?.id === 'things' && <EditorDrawerSection onNavigate={dismissAfterNavigate} />}
			</Box>

			{/* sticky account footer: avatar + name open the profile page, the
			gear keeps opening the settings modal */}
			<Flex
				className="drawerAccountFooter"
				alignItems="center"
				flexShrink={0}
				columnGap={2}
				paddingX={3}
				paddingY="10px"
				borderTop="1px solid"
				borderColor="var(--tt-border, #ececef)"
				background="var(--tt-card, #ffffff)"
				_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
				transition="background 0.15s ease"
				cursor="pointer"
				title={user ? 'Your profile' : 'Log in'}
				onClick={onAccountRowClick}
			>
				<UserAvatarCircle></UserAvatarCircle>
				{!isMobile && (
					<Text fontSize="xs" fontWeight={600} noOfLines={1}>
						{user ? (user.temporary ? LOGIN_TO_CLAIM_LABEL : getUserDisplayName(user)) : 'Log in'}
					</Text>
				)}
				<Center
					as="button"
					type="button"
					marginLeft="auto"
					width="26px"
					height="26px"
					borderRadius="var(--tt-radius-sm, 9px)"
					opacity={0.4}
					_hover={{ opacity: 1, background: 'var(--tt-surface-alt, #f5f5f7)' }}
					transition="background 0.15s ease, opacity 0.15s ease"
					cursor="pointer"
					aria-label="Settings"
					title="Settings"
					onClick={onSettingsClick}
				>
					<Icon name="gear" size="11px"></Icon>
				</Center>
			</Flex>
		</Flex>
	);
};
