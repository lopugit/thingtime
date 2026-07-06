import React from 'react';
import {
  Box,
  Button,
  Flex,
  Menu,
  MenuButton,
  MenuItem,
  MenuList
} from '@chakra-ui/react';

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
    (environmentId: StatusEnvironmentId) => {
      setLoadedStoredSelection(true);
      setSelectedEnvironmentId(environmentId);
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
      <Menu placement="bottom-start" isLazy>
        {({ isOpen }) => (
          <>
            <MenuButton
              as={Button}
              data-status-environment-control=""
              aria-label="Status environment"
              title={selectedEnvironment?.title}
              variant="unstyled"
              width="auto"
              minWidth="118px"
              maxWidth="236px"
              height="22px"
              minHeight="22px"
              padding={0}
              paddingInlineStart={0}
              paddingInlineEnd={0}
              display="inline-flex"
              alignItems="center"
              justifyContent="flex-start"
              overflow="hidden"
              color="var(--tt-text, rgba(0, 0, 0, 0.58))"
              backgroundColor={
                isOpen ? 'var(--tt-surface-hover, rgba(160, 174, 192, 0.16))' : 'transparent'
              }
              border="0"
              borderRadius="var(--tt-radius-xs, 6px)"
              boxShadow={
                isOpen
                  ? 'inset 0 0 0 1px color-mix(in srgb, var(--tt-link, #319795) 42%, transparent), 0 0 0 1px color-mix(in srgb, var(--tt-link, #319795) 22%, transparent)'
                  : 'none'
              }
              cursor="pointer"
              fontSize="10px"
              fontWeight="400"
              lineHeight="1"
              textAlign="left"
              transition="background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease"
              _hover={{
                backgroundColor: 'var(--tt-surface-alt, rgba(160, 174, 192, 0.12))',
                boxShadow: 'inset 0 0 0 1px var(--tt-border, rgba(160, 174, 192, 0.35))',
                color: 'var(--tt-ink, rgba(0, 0, 0, 0.86))'
              }}
              _active={{
                backgroundColor: 'var(--tt-surface-hover, rgba(160, 174, 192, 0.16))'
              }}
              _focus={{
                boxShadow: isOpen
                  ? 'inset 0 0 0 1px color-mix(in srgb, var(--tt-link, #319795) 42%, transparent), 0 0 0 1px color-mix(in srgb, var(--tt-link, #319795) 22%, transparent)'
                  : 'none'
              }}
              _focusVisible={{
                backgroundColor: 'var(--tt-surface-hover, rgba(160, 174, 192, 0.16))',
                boxShadow:
                  'inset 0 0 0 1px color-mix(in srgb, var(--tt-link, #319795) 42%, transparent), 0 0 0 1px color-mix(in srgb, var(--tt-link, #319795) 22%, transparent)',
                color: 'var(--tt-ink, rgba(0, 0, 0, 0.9))'
              }}
            >
              <Box
                as="span"
                data-status-environment-label=""
                display="inline-flex"
                alignItems="center"
                width="100%"
                height="22px"
                overflow="hidden"
                whiteSpace="nowrap"
                textOverflow="ellipsis"
                lineHeight="1"
              >
                {selectedEnvironment?.label || 'Current Tab'}
              </Box>
            </MenuButton>
            <MenuList
              minWidth="160px"
              maxWidth="280px"
              paddingY={1}
              borderRadius="var(--tt-radius-xs, 6px)"
              borderColor="var(--tt-border, #ececef)"
              boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
              fontSize="10px"
              lineHeight="20px"
              color="var(--tt-ink, #1A202C)"
            >
              {environments.map((environment) => (
                <MenuItem
                  key={environment.id}
                  minHeight="22px"
                  paddingY={0}
                  paddingInlineStart={2}
                  paddingInlineEnd={2}
                  fontSize="10px"
                  lineHeight="20px"
                  onClick={() => handleEnvironmentChange(environment.id)}
                >
                  {environment.label}
                </MenuItem>
              ))}
            </MenuList>
          </>
        )}
      </Menu>

      <NitroStatus targetOrigin={targetOrigin} />
      <FrontendStatus targetOrigin={targetOrigin} />
      {showDeploymentStatus ? <VercelStatus targetOrigin={targetOrigin} /> : null}
      <MongoStatus targetOrigin={targetOrigin} />
    </Flex>
  );
};
