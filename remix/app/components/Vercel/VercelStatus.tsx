import React from 'react';
import { Box, Flex, Progress, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import type { VercelDeploymentStatus } from '~/api/utils/vercel/status';

const STATUS_ENDPOINT = '/api/v1/vercel/status';
const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 60000;
const STATUS_COLORS = {
  unavailable: '#A0AEC0',
  error: '#FC8181',
  ready: '#48BB78',
  active: '#ECC94B',
  local: '#A0AEC0',
};

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
`;

export const VercelStatus = (props) => {
  const [status, setStatus] = React.useState<VercelDeploymentStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    let timeoutId: ReturnType<typeof window.setTimeout> | undefined;
    let xhr: XMLHttpRequest | undefined;

    const requestStatus = () => {
      xhr?.abort();
      xhr = new XMLHttpRequest();

      xhr.open('GET', STATUS_ENDPOINT);
      xhr.setRequestHeader('Accept', 'application/json');

      xhr.onload = () => {
        if (!isMounted) {
          return;
        }

        try {
          if (!xhr || xhr.status < 200 || xhr.status >= 300) {
            throw new Error(`Status request failed: ${xhr?.status}`);
          }

          const nextStatus = JSON.parse(xhr.responseText) as VercelDeploymentStatus;
          const nextState = nextStatus.state;

          setStatus(nextStatus);
          setError(null);

          timeoutId = window.setTimeout(
            requestStatus,
            nextState === 'building' || nextState === 'queued' || nextState === 'unknown'
              ? ACTIVE_POLL_MS
              : IDLE_POLL_MS,
          );
        } catch (err: any) {
          setStatus(null);
          setError(err?.message || String(err));
          timeoutId = window.setTimeout(requestStatus, ACTIVE_POLL_MS);
        }
      };

      xhr.onerror = () => {
        if (isMounted) {
          setStatus(null);
          setError('Status request failed');
          timeoutId = window.setTimeout(requestStatus, ACTIVE_POLL_MS);
        }
      };

      xhr.send();
    };

    requestStatus();

    return () => {
      isMounted = false;
      xhr?.abort();
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const checking = !status && !error;
  const state = status?.state || 'unknown';
  const buildProgress = status?.buildProgress;
  const buildPhase = status?.buildPhase;
  const buildUrl = status?.buildPageUrl || status?.latestDeploymentUrl;
  const isActive = checking || state === 'building' || state === 'queued';
  const hasBuildProgress = typeof buildProgress === 'number' && (isActive || state === 'ready');
  const isUnavailable = Boolean(error || status?.hasError || state === 'unknown');
  const color =
    isUnavailable
      ? STATUS_COLORS.unavailable
      : state === 'error'
        ? STATUS_COLORS.error
      : state === 'ready'
        ? STATUS_COLORS.ready
        : state === 'building' || state === 'queued'
          ? STATUS_COLORS.active
          : state === 'local'
            ? STATUS_COLORS.local
            : STATUS_COLORS.unavailable;
  const lastReadyLabel = status?.lastReadyLabel ? ` last ready ${status.lastReadyLabel}` : '';
  const label = error
    ? 'Vercel: status unavailable'
    : status?.label
      ? `${status.label}${buildPhase && !status.hasError ? ` ${buildPhase}` : ''}${
          typeof buildProgress === 'number' ? ` (${buildProgress}%)` : ''
        }${lastReadyLabel}`
      : 'Vercel: checking...';
  const href = buildUrl || status?.latestDeploymentUrl || status?.deploymentUrl;

  const content = (
    <Flex alignItems="center" flexDirection="row" fontSize="xs" columnGap={2} {...props?.chakras}>
      <Box
        width="8px"
        height="8px"
        minWidth="8px"
        borderRadius="full"
        backgroundColor={color}
        border="1px solid"
        borderColor={isUnavailable ? '#4A5568' : color}
        boxSizing="border-box"
        display="inline-block"
        flexShrink={0}
        sx={isActive ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}
      />
      <Text textDecoration={href ? 'underline' : undefined}>{label}</Text>
    </Flex>
  );

  const progressBar =
    hasBuildProgress ? (
      <Progress size="xs" borderRadius="full" value={buildProgress} max={100} min={0} colorScheme={state === 'error' ? 'red' : 'yellow'} />
    ) : null;

  if (!href) {
    return content;
  }

  return (
    <Box as="a" href={href} target="_blank" title="View Vercel deployment status">
      <Flex direction="column" rowGap={1}>
        {content}
        {progressBar}
      </Flex>
    </Box>
  );
};
