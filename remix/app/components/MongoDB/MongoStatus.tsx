import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { Link, useFetcher } from '@remix-run/react';

import type { MongoConnectionStatus } from '~/api/utils/mongodb/status';

const STATUS_ENDPOINT = '/api/v1/mongodb/status';

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
`;

// Compact MongoDB connection indicator for the footer. Fetches live status
// through the Thingtime API and links out to the full status page.
export const MongoStatus = (props) => {
  const fetcher = useFetcher<MongoConnectionStatus>();

  // Load status once on mount (footer renders on every page).
  React.useEffect(() => {
    if (fetcher.state === 'idle' && !fetcher.data) {
      fetcher.load(STATUS_ENDPOINT);
    }
  }, [fetcher]);

  const status = fetcher.data;
  // No data yet (initial mount or in-flight request) → neutral "checking" look.
  const checking = !status;

  let color = 'gray.400';
  let label = 'MongoDB: checking…';

  if (status) {
    color = status.connected ? 'green.400' : 'red.400';
    label = status.connected
      ? `MongoDB: connected${typeof status.pingMs === 'number' ? ` (${status.pingMs}ms)` : ''}`
      : 'MongoDB: disconnected';
  }

  return (
    <Link to="/mongodb-status" title="View MongoDB connection status">
      <Flex alignItems="center" flexDirection="row" fontSize="xs" columnGap={2} {...props?.chakras}>
        <Box
          width="8px"
          height="8px"
          borderRadius="full"
          backgroundColor={color}
          flexShrink={0}
          sx={checking ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}
        />
        <Text textDecoration="underline">{label}</Text>
      </Flex>
    </Link>
  );
};
