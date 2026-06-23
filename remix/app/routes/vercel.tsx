import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  Link,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { useLoaderData, useRevalidator } from '@remix-run/react';
import { json } from '@vercel/remix';
import { ExternalLink, Globe2, RefreshCw, Rocket } from 'lucide-react';

import {
  getVercelDeploymentsOverview,
  isVercelStatusEnabled,
  type VercelDeploymentSummary
} from '~/api/utils/vercel/status';

const PAGE_MAX_WIDTH = '920px';

export const loader = async () => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const overview = await getVercelDeploymentsOverview();
  return json(overview);
};

const statusScheme = (state: VercelDeploymentSummary['state']) => {
  if (state === 'ready') return 'green';
  if (state === 'building' || state === 'queued') return 'yellow';
  if (state === 'error') return 'red';
  return 'gray';
};

const statusDot = (state: VercelDeploymentSummary['state']) => {
  if (state === 'ready') return 'green.400';
  if (state === 'building' || state === 'queued') return 'yellow.400';
  if (state === 'error') return 'red.400';
  return 'gray.400';
};

const shortCommit = (sha?: string) => (sha ? sha.slice(0, 7) : 'unknown');

const dateLabel = (iso?: string) => {
  if (!iso) return 'unknown';
  return iso.replace('T', ' ').slice(0, 16) + ' UTC';
};

const DeploymentRow = ({ deployment }: { deployment: VercelDeploymentSummary }) => (
  <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" bg="white" p={{ base: 4, md: 5 }} w="100%" minW={0}>
    <Stack spacing={4}>
      <Flex alignItems={{ base: 'flex-start', md: 'center' }} justifyContent="space-between" gap={3} flexDirection={{ base: 'column', md: 'row' }}>
        <Flex alignItems="center" gap={3} minW={0} w="100%">
          <Box width="10px" height="10px" borderRadius="full" bg={statusDot(deployment.state)} flexShrink={0} />
          <Link
            href={deployment.url}
            isExternal
            color="teal.600"
            fontFamily="mono"
            fontSize={{ base: 'xs', md: 'sm' }}
            overflowWrap="anywhere"
            minW={0}
          >
            {deployment.url}
          </Link>
        </Flex>
        <Flex alignItems="center" gap={2} flexShrink={0}>
          <Badge colorScheme={statusScheme(deployment.state)} borderRadius="md" px={2} py={1}>
            {deployment.state}
          </Badge>
          {deployment.dashboardUrl ? (
            <Button
              as="a"
              href={deployment.dashboardUrl}
              target="_blank"
              rel="noreferrer"
              size="xs"
              variant="outline"
              leftIcon={<Icon as={ExternalLink} boxSize={3.5} />}
            >
              Build
            </Button>
          ) : null}
        </Flex>
      </Flex>

      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={3}>
        <Box>
          <Text color="gray.500" fontSize="xs">
            Branch
          </Text>
          <Text fontFamily="mono" fontSize="sm" overflowWrap="anywhere">
            {deployment.branch || 'unknown'}
          </Text>
        </Box>
        <Box>
          <Text color="gray.500" fontSize="xs">
            Commit
          </Text>
          <Text fontFamily="mono" fontSize="sm">
            {shortCommit(deployment.commitSha)}
          </Text>
        </Box>
        <Box>
          <Text color="gray.500" fontSize="xs">
            Environment
          </Text>
          <Text fontSize="sm">{deployment.environment || 'unknown'}</Text>
        </Box>
        <Box>
          <Text color="gray.500" fontSize="xs">
            Ready
          </Text>
          <Text fontSize="sm">{deployment.readyLabel || dateLabel(deployment.readyAt || deployment.createdAt)}</Text>
        </Box>
      </SimpleGrid>
    </Stack>
  </Box>
);

export default function VercelPage() {
  const overview = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const checking = revalidator.state === 'loading';

  return (
    <Box minH="100vh" w="100%" minW={0} bg="gray.50" pt={{ base: 28, md: 32 }} pb={{ base: 6, md: 10 }} px={{ base: 3, md: 12 }} display="flex" justifyContent="center">
      <Box as="main" data-testid="vercel-shell" maxW={PAGE_MAX_WIDTH} w="100%">
        <Stack spacing={6} alignItems="stretch" w="100%">
          <Flex alignItems="center" justifyContent="center" gap={3} textAlign="center">
            <Icon as={Rocket} boxSize={6} color="teal.500" />
            <Box>
              <Heading size="lg">Vercel</Heading>
              <Text color="gray.600" fontSize="sm" mt={1} fontFamily="mono">
                /api/v1/vercel/deployments
              </Text>
            </Box>
          </Flex>

          <Flex
            alignItems={{ base: 'stretch', md: 'center' }}
            justifyContent="space-between"
            gap={3}
            flexDirection={{ base: 'column', md: 'row' }}
          >
            <Flex gap={2} wrap="wrap" justifyContent={{ base: 'center', md: 'flex-start' }}>
              <Badge colorScheme={overview.configured ? 'green' : 'gray'} px={3} py={1} borderRadius="md">
                {overview.configured ? 'API configured' : 'tokenless'}
              </Badge>
              <Badge colorScheme={overview.hasError ? 'red' : 'teal'} px={3} py={1} borderRadius="md">
                {overview.label}
              </Badge>
              {overview.projectName ? (
                <Badge colorScheme="purple" px={3} py={1} borderRadius="md">
                  {overview.projectName}
                </Badge>
              ) : null}
            </Flex>
            <Button
              leftIcon={<Icon as={RefreshCw} boxSize={4} />}
              colorScheme="teal"
              variant="outline"
              data-testid="vercel-refresh"
              onClick={() => revalidator.revalidate()}
              isLoading={checking}
              loadingText="Refreshing"
              alignSelf={{ base: 'center', md: 'auto' }}
            >
              Refresh
            </Button>
          </Flex>

          {overview.error ? (
            <Box borderWidth="1px" borderColor="red.200" borderRadius="md" bg="red.50" color="red.700" p={4} fontSize="sm">
              {overview.error}
            </Box>
          ) : null}

          {overview.deployments.length ? (
            <Stack spacing={3} w="100%">
              {overview.deployments.map((deployment) => (
                <DeploymentRow key={deployment.url} deployment={deployment} />
              ))}
            </Stack>
          ) : (
            <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" bg="white" p={8} textAlign="center">
              <Icon as={Globe2} boxSize={8} color="gray.400" />
              <Text mt={3} color="gray.600">
                No deployment URLs found.
              </Text>
            </Box>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
