import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { PlatformCredentials } from './PlatformCredentials';
import { IntegrationManager } from './IntegrationManager';
import { SystemEnvironment } from './SystemEnvironment';

export const SystemVault = ({ cacheIdentity, category }: { cacheIdentity: string; category: 'ai-providers' | 'platform' }) => {
	const [collapsed, setCollapsed] = React.useState(true);
	return (
		<Flex direction="column" gap={4} mb={4} minW={0}>
			{category === 'ai-providers' ? (
				<Box id="secure-vault" scrollMarginTop="100px">
					<PlatformCredentials cacheIdentity={cacheIdentity} collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
				</Box>
			) : (
				<>
					<IntegrationManager secretsOnly />
					<SystemEnvironment />
				</>
			)}
		</Flex>
	);
};
