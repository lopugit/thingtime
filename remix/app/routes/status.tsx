import { Box, Button, Container, Divider, Flex, Heading, Text, Badge, Link, Progress } from '@chakra-ui/react';
import { json } from '@vercel/remix';
import { useLoaderData, useRevalidator } from '@remix-run/react';

import { getVercelDeploymentStatus, isVercelStatusEnabled } from '~/api/utils/vercel/status';

export const loader = async () => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const status = await getVercelDeploymentStatus();
  return json(status);
};

const value = (raw?: string | null) => raw || '—';

export default function StatusPage() {
  const status = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const badgeScheme =
    status.state === 'ready'
      ? 'green'
      : status.state === 'building' || status.state === 'queued'
        ? 'yellow'
        : status.state === 'local'
          ? 'gray'
          : 'red';
  const buildProgress = typeof status.buildProgress === 'number' ? status.buildProgress : 0;
  const buildProgressText =
    status.buildProgress === undefined || Number.isNaN(status.buildProgress)
      ? '—'
      : `${status.buildProgress}%`;
  const checking = revalidator.state === 'loading';

  return (
    <Container maxWidth="container.md" py={24}>
      <Flex flexDirection="column" gap={6}>
        <Flex alignItems="center" gap={3}>
          <Box
            width="14px"
            height="14px"
            borderRadius="full"
            bg={status.state === 'ready' ? 'green.400' : status.state === 'building' || status.state === 'queued' ? 'yellow.400' : status.state === 'local' ? 'gray.500' : 'red.400'}
          />
          <Heading size="lg">Vercel Deployment Status</Heading>
        </Flex>

        <Flex alignItems="center" gap={3}>
          <Badge colorScheme={badgeScheme} px={3} py={1} borderRadius="md">
            {status.label}
          </Badge>
          <Text color="gray.500" fontSize="sm">
            Sourced from server endpoint <Text as="span" fontFamily="mono">/api/v1/vercel/status</Text>
          </Text>
        </Flex>

        <Divider />

        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Branch
          </Text>
          <Text fontFamily="mono" fontSize="sm">{value(status.branch)}</Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Commit
          </Text>
          <Text fontFamily="mono" fontSize="sm">{value(status.commitSha)}</Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Environment
          </Text>
          <Text fontSize="sm">{value(status.environment)}</Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Deployment URL
          </Text>
          <Text fontFamily="mono" fontSize="sm" textAlign="right" maxW="65%">
            {status.deploymentUrl ? (
              <Link href={status.deploymentUrl} color="teal.500" isExternal>
                {status.deploymentUrl}
              </Link>
            ) : (
              '—'
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Latest Deployment URL
          </Text>
          <Text fontFamily="mono" fontSize="sm" textAlign="right" maxW="65%">
            {status.latestDeploymentUrl ? (
              <Link href={status.latestDeploymentUrl} color="teal.500" isExternal>
                {status.latestDeploymentUrl}
              </Link>
            ) : (
              '—'
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Build page
          </Text>
          <Text fontFamily="mono" fontSize="sm" textAlign="right" maxW="65%">
            {status.buildPageUrl ? (
              <Link href={status.buildPageUrl} color="teal.500" isExternal>
                Open build info
              </Link>
            ) : (
              '—'
            )}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Build phase
          </Text>
          <Text fontFamily="mono" fontSize="sm" textAlign="right">
            {value(status.buildPhase)}
          </Text>
        </Flex>
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Build progress
          </Text>
          <Text fontFamily="mono" fontSize="sm" textAlign="right">
            {buildProgressText}
          </Text>
        </Flex>
        {status.state === 'building' || status.state === 'queued' ? <Progress value={buildProgress} size="sm" max={100} min={0} isIndeterminate={status.buildProgress === undefined} /> : null}
        <Flex justify="space-between">
          <Text color="gray.500" fontSize="sm">
            Vercel API configured
          </Text>
          <Text fontSize="sm">{status.configured ? 'yes' : 'no'}</Text>
        </Flex>
        {status.error ? (
          <Text color="red.400" fontSize="sm" whiteSpace="pre-wrap">
            {status.error}
          </Text>
        ) : null}

        <Divider />

        <Button size="sm" width="fit-content" onClick={() => revalidator.revalidate()} isLoading={checking} loadingText="Re-checking…">
          Re-check deployment status
        </Button>
      </Flex>
    </Container>
  );
}
