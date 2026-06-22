import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { Link } from '@remix-run/react';

import type { MongoConnectionStatus } from '~/api/utils/mongodb/status';

const STATUS_ENDPOINT = '/api/v1/mongodb/status-data';

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
`;

// Compact MongoDB connection indicator for the footer. Fetches live status
// through the Thingtime API and links out to the full status page.
export const MongoStatus = (props) => {
  const [status, setStatus] = React.useState<MongoConnectionStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    const xhr = new XMLHttpRequest();

    xhr.open('GET', STATUS_ENDPOINT);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onload = () => {
      if (!isMounted) {
        return;
      }

      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(`Status request failed: ${xhr.status}`);
        }

        const data = JSON.parse(xhr.responseText) as MongoConnectionStatus;

        setStatus(data);
        setError(null);
      } catch (err: any) {
        setStatus(null);
        setError(err?.message || String(err));
      }
    };

    xhr.onerror = () => {
      if (isMounted) {
        setStatus(null);
        setError('Status request failed');
      }
    };

    xhr.send();

    return () => {
      isMounted = false;
      xhr.abort();
    };
  }, []);

  // No data yet (initial mount or in-flight request) → neutral "checking" look.
  const checking = !status && !error;

  let color = 'gray.400';
  let label = 'MongoDB: checking…';

  if (error) {
    color = 'gray.400';
    label = 'MongoDB: status unavailable';
  } else if (status) {
    color = status.connected ? 'green.400' : 'gray.400';
    label = status.connected
      ? `MongoDB: connected${typeof status.pingMs === 'number' ? ` (${status.pingMs}ms)` : ''}`
      : 'MongoDB: disconnected';
  }

  const isUnavailable = Boolean(error || (status && !status.connected));

  return (
    <Link to="/mongodb-status" title="View MongoDB connection status">
      <Flex alignItems="center" flexDirection="row" fontSize="xs" columnGap={2} {...props?.chakras}>
        <Box
          width="8px"
          height="8px"
          minWidth="8px"
          borderRadius="full"
          backgroundColor={color}
          border={isUnavailable ? '1px solid' : undefined}
          borderColor={isUnavailable ? 'gray.500' : undefined}
          flexShrink={0}
          sx={checking ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}
        />
        <Text textDecoration="underline">{label}</Text>
      </Flex>
    </Link>
  );
};
