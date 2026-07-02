import React from 'react';
import { Flex, Select, Text } from '@chakra-ui/react';

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
      <Flex alignItems="center" columnGap={2}>
        <Text fontSize="10px" opacity={0.5}>
          status
        </Text>
        <Select
          aria-label="Status environment"
          size="xs"
          value={selectedEnvironment?.id || 'current'}
          onChange={(event) => setSelectedEnvironmentId(event.target.value as StatusEnvironmentId)}
          width="142px"
          height="22px"
          fontSize="10px"
          borderColor="rgba(160, 174, 192, 0.45)"
          borderRadius="6px"
          title={selectedEnvironment?.title}
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.label}
            </option>
          ))}
        </Select>
      </Flex>

      <NitroStatus targetOrigin={targetOrigin} />
      <FrontendStatus targetOrigin={targetOrigin} />
      {showDeploymentStatus ? <VercelStatus targetOrigin={targetOrigin} /> : null}
      <MongoStatus targetOrigin={targetOrigin} />
    </Flex>
  );
};
