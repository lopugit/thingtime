import React from 'react';
import { Box, Flex, Select } from '@chakra-ui/react';

import { MongoStatus } from '../MongoDB/MongoStatus';
import { VercelStatus } from '../Vercel/VercelStatus';
import { FrontendStatus, NitroStatus } from './ServiceStatus';
import {
  getStatusEnvironmentTargets,
  type StatusEnvironmentId
} from './statusEnvironment';

const STORAGE_KEY = 'thingtime.footerStatusEnvironment';

export const FooterStatusPanel = ({
  envFromCookie,
  showDeploymentStatus
}: {
  envFromCookie: Record<string, string | undefined>;
  showDeploymentStatus: boolean;
}) => {
  const [currentOrigin, setCurrentOrigin] = React.useState('');
  const [selectedEnvironmentId, setSelectedEnvironmentId] =
    React.useState<StatusEnvironmentId>('current');

  React.useEffect(() => {
    setCurrentOrigin(window.location.origin);

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as StatusEnvironmentId | null;

      if (stored) {
        setSelectedEnvironmentId(stored);
      }
    } catch {
      // localStorage is optional for this tiny footer preference.
    }
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, selectedEnvironmentId);
    } catch {
      // localStorage is optional for this tiny footer preference.
    }
  }, [selectedEnvironmentId]);

  const environments = React.useMemo(() => {
    return getStatusEnvironmentTargets({
      currentOrigin,
      envFromCookie
    });
  }, [currentOrigin, envFromCookie]);
  const selectedEnvironment =
    environments.find((environment) => environment.id === selectedEnvironmentId) ||
    environments[0];
  const targetOrigin = selectedEnvironment?.origin;

  return (
    <Flex flexDirection="column" rowGap={2} alignItems="flex-start">
      <Box
        data-status-environment-control=""
        width="auto"
        minWidth="108px"
        height="22px"
        backgroundColor="transparent"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="transparent"
        borderRadius="6px"
        transition="background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease"
        _hover={{
          backgroundColor: 'rgba(160, 174, 192, 0.12)',
          borderColor: 'rgba(160, 174, 192, 0.35)'
        }}
        _focusWithin={{
          backgroundColor: 'rgba(160, 174, 192, 0.16)',
          borderColor: 'rgba(49, 151, 149, 0.42)',
          boxShadow: '0 0 0 1px rgba(49, 151, 149, 0.22)'
        }}
      >
        <Select
          aria-label="Status environment"
          icon={<span />}
          iconSize="0"
          variant="unstyled"
          size="xs"
          value={selectedEnvironment?.id || 'current'}
          onChange={(event) => setSelectedEnvironmentId(event.target.value as StatusEnvironmentId)}
          width="100%"
          minWidth="inherit"
          height="20px"
          paddingInlineStart={4}
          paddingInlineEnd={1}
          fontSize="10px"
          lineHeight="20px"
          color="rgba(0, 0, 0, 0.58)"
          backgroundColor="transparent"
          border="0"
          borderRadius="5px"
          boxShadow="none"
          cursor="pointer"
          title={selectedEnvironment?.title}
          _hover={{
            color: 'rgba(0, 0, 0, 0.86)'
          }}
          _focus={{
            boxShadow: 'none',
            color: 'rgba(0, 0, 0, 0.9)'
          }}
          sx={{
            appearance: 'none',
            backgroundImage: 'none',
            '&::-ms-expand': {
              display: 'none'
            },
            '& option': {
              color: '#1A202C'
            }
          }}
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.label}
            </option>
          ))}
        </Select>
      </Box>

      <NitroStatus targetOrigin={targetOrigin} />
      <FrontendStatus targetOrigin={targetOrigin} />
      {showDeploymentStatus ? <VercelStatus targetOrigin={targetOrigin} /> : null}
      <MongoStatus targetOrigin={targetOrigin} />
    </Flex>
  );
};
