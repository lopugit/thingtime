import React from 'react';
import { Box, Flex, Progress, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import type { VercelDeploymentStatus } from '~/api/utils/vercel/status';

const STATUS_ENDPOINT = '/api/v1/vercel/status';

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

        setStatus(JSON.parse(xhr.responseText) as VercelDeploymentStatus);
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

  const checking = !status && !error;
  const state = status?.state || 'unknown';
  const buildProgress = status?.buildProgress;
  const buildPhase = status?.buildPhase;
  const buildUrl = status?.buildPageUrl || status?.latestDeploymentUrl;
  const hasBuildProgress = typeof buildProgress === 'number' && state !== 'ready' && state !== 'error';
  const isUnavailable = Boolean(error || status?.hasError || state === 'unknown');
  const color =
    isUnavailable
      ? 'gray.400'
      : state === 'error'
        ? 'red.400'
      : state === 'ready'
        ? 'green.400'
        : state === 'building' || state === 'queued'
          ? 'yellow.400'
          : state === 'local'
            ? 'gray.400'
            : 'gray.400';
  const label = error
    ? 'Vercel: status unavailable'
    : status?.label
      ? `${status.label}${buildPhase && !status.hasError ? ` ${buildPhase}` : ''}${
          typeof buildProgress === 'number' ? ` (${buildProgress}%)` : ''
        }`
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
        border={isUnavailable ? '1px solid' : undefined}
        borderColor={isUnavailable ? 'gray.500' : undefined}
        flexShrink={0}
        sx={checking || state === 'building' || state === 'queued' ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}
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
