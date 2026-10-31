import React from 'react';
import { Box, Flex, Heading } from '@chakra-ui/react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { SettingsContent } from './SettingsContent';
import { resolveSettingsTab, settingsTabHref } from './settingsTabs';
export const SettingsPage = () => {
	const location = useLocation();
	const { tab: routeTab } = useParams();
	const navigate = useNavigate();
	const tab = resolveSettingsTab(routeTab || new URLSearchParams(location.search).get('tab'), location.hash);
	return (
		<Flex
			justify="center"
			width="100%"
			minH="100vh"
			background="var(--tt-surface, #fafafb)"
			pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
		>
			<Box width="100%" maxW="880px" px={[3, 6]} pt={6} pb={12} minW={0}>
				<Heading size="lg" mb={5}>
					Settings
				</Heading>
				<SettingsContent tab={tab} onTabChange={(next) => navigate(settingsTabHref(next))} />
			</Box>
		</Flex>
	);
};
