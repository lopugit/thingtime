import { SystemEnvironment } from './SystemEnvironment';
import React from 'react';
import { Box, Heading, Text } from '@chakra-ui/react';
import { PlatformCredentials } from './PlatformCredentials';
import { IntegrationManager } from './IntegrationManager';

export const SystemVault = ({ cacheIdentity }: { cacheIdentity: string }) => {
	const [collapsed, setCollapsed] = React.useState(false);
	return (
		<Box id="secure-vault" mb={6} scrollMarginTop="100px">
			<Heading size="md" mb={2}>
				Thingtime Secure Vault
			</Heading>
			<Text fontSize="sm" color="var(--tt-muted, #777783)" mb={4}>
				Shared credentials for the Thingtime platform. Existing CI and integration secrets are managed here. Your personal vault stays in Settings.
			</Text>
			<PlatformCredentials cacheIdentity={cacheIdentity} collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
			<IntegrationManager secretsOnly />
			<SystemEnvironment />
		</Box>
	);
};
