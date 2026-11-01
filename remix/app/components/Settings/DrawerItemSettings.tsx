import React from 'react';
import { Flex, Switch, Text } from '@chakra-ui/react';
import { useDrawer } from '~/components/Nav/Drawer/useDrawer';
import { drawerItemClosesOnClick, drawerMenuItems, filterDrawerItemsByAuth, filterDrawerTopItems } from '~/components/Nav/Drawer/drawerMenu';
import { useMarketingPublications } from '~/components/Marketing/marketingPublicationsStore';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { isKeyPublished } from '~/marketing/publishingCore';
export function DrawerItemSettings() {
	const user = useCurrentUser();
	// the "Close after click" list mirrors the drawer, so it needs the same
	// publish state DrawerContent reads — without it every publication-gated
	// item (Marketing) fails closed here and a visitor can no longer configure
	// a section they can actually see. It must also use the drawer's own pair
	// of filters (filterDrawerTopItems for the sections, filterDrawerItemsByAuth
	// for their children): a top-level section is listed as soon as ANY child is
	// visible, so gating it on its own key would hide Marketing here while the
	// drawer still shows it (published `category:landing`, unpublished `hub`).
	const { publications } = useMarketingPublications();
	const isPublished = React.useCallback((key: string) => isKeyPublished(publications, key), [publications]);
	const { closeOnClick, setCloseOnClickFor } = useDrawer();
	return (
		<>
			{/* per-item dismiss: navigating items default ON; off keeps the
				drawer open for that item (submenu browsing) */}
			<Flex flexDirection="column" paddingY={2}>
				<Text fontSize="sm">Close after click</Text>
				<Text fontSize="xs" opacity={0.55}>
					Which menu items close the drawer when clicked (desktop and mobile)
				</Text>
				<Flex flexDirection="column" paddingTop={2}>
					{filterDrawerTopItems(drawerMenuItems, !!user, !!user?.isAdmin, isPublished).map((top) => (
						<React.Fragment key={top.id}>
							<Flex alignItems="center" columnGap={4} paddingY={1}>
								<Text fontSize="sm">
									{top.icon} {top.label}
								</Text>
								<Switch
									size="sm"
									marginLeft="auto"
									isChecked={drawerItemClosesOnClick(closeOnClick, top.id)}
									onChange={(event) => setCloseOnClickFor(top.id, event.target.checked)}
								></Switch>
							</Flex>
							{filterDrawerItemsByAuth(top.children || [], !!user, !!user?.isAdmin, isPublished).map((child) => (
								<Flex key={child.id} alignItems="center" columnGap={4} paddingY={0.5} paddingLeft={4}>
									<Text fontSize="xs" opacity={0.8}>
										{child.icon} {child.label}
									</Text>
									<Switch
										size="sm"
										marginLeft="auto"
										isChecked={drawerItemClosesOnClick(closeOnClick, child.id)}
										onChange={(event) => setCloseOnClickFor(child.id, event.target.checked)}
									></Switch>
								</Flex>
							))}
						</React.Fragment>
					))}
				</Flex>
			</Flex>
		</>
	);
}
