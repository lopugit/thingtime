import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import type { VercelDeploymentStatus } from '~/api/utils/vercel/status';
import { StatusRefreshButton } from '~/components/Status/StatusRefreshButton';

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

const getStatusText = (label?: string) => {
  return label?.replace(/^Vercel:\s*/i, '').trim();
};

const getDisplayPhase = (phase?: string, state?: VercelDeploymentStatus['state']) => {
  const normalizedPhase = phase?.trim();
  const normalizedKey = normalizedPhase?.toLowerCase();

  if (!normalizedPhase) {
    return undefined;
  }

  if (
    normalizedKey === state ||
    (state === 'ready' && (normalizedKey === 'ready' || normalizedKey === 'staged')) ||
    (state === 'building' && normalizedKey === 'building') ||
    (state === 'queued' && normalizedKey === 'queued')
  ) {
    return undefined;
  }

  return normalizedPhase;
};

const getProgressLeft = (progress: number) => {
  return `${Math.max(0, Math.min(100, progress))}%`;
};

export const VercelStatus = (props) => {
  const [status, setStatus] = React.useState<VercelDeploymentStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);

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
  }, [refreshTick]);

  const refreshStatus = React.useCallback(() => {
    setStatus(null);
    setError(null);
    setRefreshTick((tick) => tick + 1);
  }, []);

  const checking = !status && !error;
  const state = status?.state || 'unknown';
  const buildProgress = status?.buildProgress;
  const buildPhase = status?.buildPhase;
  const buildUrl = status?.buildPageUrl || status?.latestDeploymentUrl;
  const isActive = checking || state === 'building' || state === 'queued';
  const hasBuildProgress = typeof buildProgress === 'number' && (isActive || state === 'error');
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
  const statusText = getStatusText(status?.label);
  const displayPhase = getDisplayPhase(buildPhase, state);
  const percentageLabel = hasBuildProgress ? `${buildProgress}%` : '';
  const ageLabel = status?.lastReadyLabel && state === 'ready' ? status.lastReadyLabel : '';
  const label = error
    ? 'Vercel: status unavailable'
    : status?.label
      ? ['Vercel:', statusText, displayPhase, percentageLabel, ageLabel].filter(Boolean).join(' ')
      : 'Vercel: checking...';
  const href = buildUrl || status?.latestDeploymentUrl || status?.deploymentUrl;

  const statusContent = (
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

  const refreshButton = (
    <StatusRefreshButton
      isLoading={checking}
      label="Refresh Vercel status"
      onRefresh={refreshStatus}
    />
  );

  const content = (
    <Flex alignItems="center" columnGap={1.5}>
      {href ? (
        <Box as="a" href={href} target="_blank" title="View Vercel deployment status">
          {statusContent}
        </Box>
      ) : (
        statusContent
      )}
      {refreshButton}
    </Flex>
  );

  const progressBar = hasBuildProgress ? (
    <Box
      aria-label={`Vercel build progress ${buildProgress}%`}
      role="progressbar"
      aria-valuenow={buildProgress}
      aria-valuemin={0}
      aria-valuemax={100}
      position="relative"
      width="56px"
      height="3px"
      borderRadius="full"
      backgroundColor="rgba(237, 242, 247, 0.9)"
      boxShadow="inset 0 0 0 1px rgba(160, 174, 192, 0.4)"
      overflow="visible"
      marginLeft="16px"
    >
      <Box
        position="absolute"
        top={0}
        left={0}
        height="100%"
        width={getProgressLeft(buildProgress)}
        borderRadius="full"
        backgroundColor={state === 'error' ? STATUS_COLORS.error : STATUS_COLORS.active}
      />
      {state === 'error' ? (
        <Text
          as="span"
          position="absolute"
          left={`calc(${getProgressLeft(buildProgress)} - 3px)`}
          top="-6px"
          color={STATUS_COLORS.error}
          fontSize="8px"
          fontWeight="bold"
          lineHeight="1"
          textDecoration="none"
        >
          x
        </Text>
      ) : null}
    </Box>
  ) : null;

  if (!href) {
    return (
      <Flex direction="column" rowGap={0.5}>
        {content}
        {progressBar}
      </Flex>
    );
  }

  return (
    <Flex direction="column" rowGap={0.5}>
      {content}
      {progressBar}
    </Flex>
  );
};
