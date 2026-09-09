import React from 'react';
import { Flex, Switch, Text } from '@chakra-ui/react';
import { useDrawer } from '~/components/Nav/Drawer/useDrawer';
import { drawerItemClosesOnClick, drawerMenuItems, filterDrawerItemsByAuth } from '~/components/Nav/Drawer/drawerMenu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
export function DrawerItemSettings() {
	const user = useCurrentUser();
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
					{filterDrawerItemsByAuth(drawerMenuItems, !!user, !!user?.isAdmin).map((top) => (
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
							{filterDrawerItemsByAuth(top.children || [], !!user, !!user?.isAdmin).map((child) => (
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
