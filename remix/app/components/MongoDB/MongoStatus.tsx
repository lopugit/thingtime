import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import type { MongoConnectionStatus } from '~/api/utils/mongodb/status';
import { StatusRefreshButton } from '~/components/Status/StatusRefreshButton';
import { getStatusEndpoint, getStatusHref } from '~/components/Status/statusEnvironment';

const STATUS_ENDPOINT = '/api/v1/health/mongodb';
const STATUS_COLORS = {
  unavailable: 'var(--tt-muted, #A0AEC0)',
  ready: 'var(--tt-positive, #48BB78)',
};

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
`;

// Compact MongoDB connection indicator for the footer. Fetches live status
// through the Thingtime API and links out to the full status page.
export const MongoStatus = (props: { chakras?: Record<string, unknown>; targetOrigin?: string }) => {
  const [status, setStatus] = React.useState<MongoConnectionStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    let isMounted = true;

    const xhr = new XMLHttpRequest();

    setStatus(null);
    setError(null);

    xhr.open('GET', getStatusEndpoint(STATUS_ENDPOINT, props.targetOrigin));
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
  }, [props.targetOrigin, refreshTick]);

  const refreshStatus = React.useCallback(() => {
    setStatus(null);
    setError(null);
    setRefreshTick((tick) => tick + 1);
  }, []);

  // No data yet (initial mount or in-flight request) → neutral "checking" look.
  const checking = !status && !error;

  let color = STATUS_COLORS.unavailable;
  let label = 'MongoDB: checking…';

  if (error) {
    color = STATUS_COLORS.unavailable;
    label = 'MongoDB: status unavailable';
  } else if (status) {
    color = status.connected ? STATUS_COLORS.ready : STATUS_COLORS.unavailable;
    label = status.connected
      ? `MongoDB: connected${typeof status.pingMs === 'number' ? ` (${status.pingMs}ms)` : ''}`
      : 'MongoDB: disconnected';
  }

  const isUnavailable = Boolean(checking || error || (status && !status.connected));

  return (
    <Flex alignItems="center" columnGap={1.5}>
      <Box
        as="a"
        href={getStatusHref(props.targetOrigin, '/mongodb-status')}
        target={props.targetOrigin ? '_blank' : undefined}
        title="View MongoDB connection status"
      >
        <Flex alignItems="center" flexDirection="row" fontSize="xs" columnGap={2} {...props?.chakras}>
          <Box
            width="8px"
            height="8px"
            minWidth="8px"
            borderRadius="full"
            backgroundColor={color}
            border="1px solid"
            borderColor={isUnavailable ? 'var(--tt-text, #4A5568)' : color}
            boxSizing="border-box"
            display="inline-block"
            flexShrink={0}
            sx={checking ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}
          />
          <Text textDecoration="underline">{label}</Text>
        </Flex>
      </Box>
      <StatusRefreshButton
        isLoading={checking}
        label="Refresh MongoDB status"
        onRefresh={refreshStatus}
      />
    </Flex>
  );
};
