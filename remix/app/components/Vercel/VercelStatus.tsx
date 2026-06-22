import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';

import type { VercelDeploymentStatus } from '~/api/utils/vercel/status';

const STATUS_ENDPOINT = '/api/v1/vercel/status-data';

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
  const color =
    error || state === 'error'
      ? 'red.400'
      : state === 'ready'
        ? 'green.400'
        : state === 'building' || state === 'queued'
          ? 'yellow.400'
          : state === 'local'
            ? 'gray.400'
            : 'gray.400';
  const label = error ? 'Vercel: status unavailable' : status?.label || 'Vercel: checking...';
  const href = status?.latestDeploymentUrl || status?.deploymentUrl;

  const content = (
    <Flex alignItems="center" flexDirection="row" fontSize="xs" columnGap={2} {...props?.chakras}>
      <Box
        width="8px"
        height="8px"
        borderRadius="full"
        backgroundColor={color}
        flexShrink={0}
        sx={checking || state === 'building' || state === 'queued' ? { animation: `${pulse} 1.2s ease-in-out infinite` } : undefined}
      />
      <Text textDecoration={href ? 'underline' : undefined}>{label}</Text>
    </Flex>
  );

  if (!href) {
    return content;
  }

  return (
    <Box as="a" href={href} target="_blank" title="View Vercel deployment status">
      {content}
    </Box>
  );
};
