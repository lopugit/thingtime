import React from 'react';
import { Box, Flex, Select } from '@chakra-ui/react';

import { MongoStatus } from '../MongoDB/MongoStatus';
import { VercelStatus } from '../Vercel/VercelStatus';
import { FrontendStatus, NitroStatus } from './ServiceStatus';
import {
  getDefaultStatusEnvironmentId,
  getStatusEnvironmentTargets,
  type StatusEnvironmentId
} from './statusEnvironment';

const STORAGE_KEY = 'thingtime.footerStatusEnvironment.v2';

type StoredEnvironmentSelection = {
  id?: StatusEnvironmentId;
  origin?: string;
};

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
  const [loadedStoredSelection, setLoadedStoredSelection] = React.useState(false);

  React.useEffect(() => {
    setCurrentOrigin(window.location.origin);
  }, []);

  const environments = React.useMemo(() => {
    return getStatusEnvironmentTargets({
      currentOrigin,
      envFromCookie
    });
  }, [currentOrigin, envFromCookie]);
  const defaultEnvironmentId = React.useMemo(() => {
    return getDefaultStatusEnvironmentId({
      currentOrigin,
      envFromCookie
    });
  }, [currentOrigin, envFromCookie]);

  React.useEffect(() => {
    if (!currentOrigin || loadedStoredSelection) {
      return;
    }

    let nextEnvironmentId = defaultEnvironmentId;

    try {
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) || 'null'
      ) as StoredEnvironmentSelection | null;
      const storedIsValidForThisOrigin =
        stored?.origin === currentOrigin &&
        environments.some((environment) => environment.id === stored.id);

      if (storedIsValidForThisOrigin && stored?.id) {
        nextEnvironmentId = stored.id;
      }
    } catch {
      // localStorage is optional for this tiny footer preference.
    }

    setSelectedEnvironmentId(nextEnvironmentId);
    setLoadedStoredSelection(true);
  }, [currentOrigin, defaultEnvironmentId, environments, loadedStoredSelection]);

  React.useEffect(() => {
    if (
      environments.length > 0 &&
      !environments.some((environment) => environment.id === selectedEnvironmentId)
    ) {
      setSelectedEnvironmentId(defaultEnvironmentId);
    }
  }, [defaultEnvironmentId, environments, selectedEnvironmentId]);

  const handleEnvironmentChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      setLoadedStoredSelection(true);
      setSelectedEnvironmentId(event.target.value as StatusEnvironmentId);
    },
    []
  );

  React.useEffect(() => {
    if (!loadedStoredSelection || !currentOrigin) {
      return;
    }

    try {
      const stored: StoredEnvironmentSelection = {
        id: selectedEnvironmentId,
        origin: currentOrigin
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // localStorage is optional for this tiny footer preference.
    }
  }, [currentOrigin, loadedStoredSelection, selectedEnvironmentId]);
  const selectedEnvironment =
    environments.find((environment) => environment.id === selectedEnvironmentId) ||
    environments[0];
  const targetOrigin = selectedEnvironment?.origin;

  return (
    <Flex flexDirection="column" rowGap={2} alignItems="flex-start">
      <Box
        data-status-environment-control=""
        width="auto"
        minWidth="118px"
        maxWidth="236px"
        height="22px"
        marginLeft="16px"
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
          onChange={handleEnvironmentChange}
          width="100%"
          minWidth="inherit"
          maxWidth="inherit"
          height="20px"
          paddingInlineStart={0}
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
            '& > option': {
              color: '#1A202C'
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
