import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import type { BasicServiceHealthStatus } from '~/api/utils/health/statusTarget';
import { StatusRefreshButton } from './StatusRefreshButton';
import { getStatusEndpoint, getStatusHref } from './statusEnvironment';

const STATUS_COLORS = {
  unavailable: 'var(--tt-muted, #A0AEC0)',
  ready: 'var(--tt-positive, #48BB78)'
};

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
`;

export const ServiceStatus = ({
  endpoint,
  label,
  linkPath,
  refreshLabel,
  targetOrigin
}: {
  endpoint: string;
  label: string;
  linkPath: string;
  refreshLabel: string;
  targetOrigin?: string;
}) => {
  const [status, setStatus] = React.useState<BasicServiceHealthStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

  React.useEffect(() => {
    let isMounted = true;
    const xhr = new XMLHttpRequest();

    setStatus(null);
    setError(null);

    xhr.open('GET', getStatusEndpoint(endpoint, targetOrigin));
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.onload = () => {
      if (!isMounted) {
        return;
      }

      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(`Status request failed: ${xhr.status}`);
        }

        setStatus(JSON.parse(xhr.responseText) as BasicServiceHealthStatus);
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
  }, [endpoint, refreshTick, targetOrigin]);

  const refreshStatus = React.useCallback(() => {
    setStatus(null);
    setError(null);
    setRefreshTick((tick) => tick + 1);
  }, []);

  const checking = !status && !error;
  const ok = Boolean(status?.ok);
  const color = ok ? STATUS_COLORS.ready : STATUS_COLORS.unavailable;
  const isUnavailable = Boolean(checking || error || !ok);
  const detail =
    status?.responseMs && ok
      ? `${status.label.replace(`${label}:`, '').trim()} ${status.responseMs}ms`
      : status?.label?.replace(`${label}:`, '').trim();
  const text = error
    ? `${label}: status unavailable`
    : status
      ? `${label}: ${detail || (ok ? 'ready' : 'unavailable')}`
      : `${label}: checking...`;

  return (
    <Flex alignItems="center" columnGap={1.5}>
      <Box as="a" href={getStatusHref(targetOrigin, linkPath)} target={targetOrigin ? '_blank' : undefined}>
        <Flex alignItems="center" flexDirection="row" fontSize="xs" columnGap={2}>
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
          <Text textDecoration="underline">{text}</Text>
        </Flex>
      </Box>
      <StatusRefreshButton
        isLoading={checking}
        label={refreshLabel}
        onRefresh={refreshStatus}
      />
    </Flex>
  );
};

export const NitroStatus = ({ targetOrigin }: { targetOrigin?: string }) => {
  return (
    <ServiceStatus
      endpoint="/api/v1/health/nitro"
      label="Nitro API"
      linkPath="/api/v1/health/nitro"
      refreshLabel="Refresh Nitro API status"
      targetOrigin={targetOrigin}
    />
  );
};

export const FrontendStatus = ({ targetOrigin }: { targetOrigin?: string }) => {
  return (
    <ServiceStatus
      endpoint="/api/v1/health/frontend"
      label="Frontend"
      linkPath="/"
      refreshLabel="Refresh frontend status"
      targetOrigin={targetOrigin}
    />
  );
};
