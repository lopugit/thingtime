import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  Input,
  Link,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { Check, ChevronDown, ExternalLink, Filter, Globe2, RefreshCw, Rocket } from 'lucide-react';

import type { VercelDeploymentsOverview, VercelDeploymentSummary } from '~/api/utils/vercel/status';

const PAGE_MAX_WIDTH = '920px';
type DeploymentSort = 'created-desc' | 'created-asc' | 'ready-desc' | 'state' | 'branch';
type DeploymentState = VercelDeploymentSummary['state'];

const STATUS_OPTIONS: Array<{ label: string; state: DeploymentState }> = [
  { label: 'Ready', state: 'ready' },
  { label: 'Error', state: 'error' },
  { label: 'Building', state: 'building' },
  { label: 'Queued', state: 'queued' },
  { label: 'Initializing', state: 'initializing' },
  { label: 'Canceled', state: 'canceled' },
  { label: 'Blocked', state: 'blocked' },
];

const SORT_OPTIONS: Array<{ label: string; value: DeploymentSort }> = [
  { label: 'Newest ready', value: 'ready-desc' },
  { label: 'Newest created', value: 'created-desc' },
  { label: 'Oldest created', value: 'created-asc' },
  { label: 'Status', value: 'state' },
  { label: 'Branch', value: 'branch' },
];

const BRANCH_LIMIT_OPTIONS = [
  { label: 'Infinite', value: 'infinite' },
  { label: '100 branches', value: '100' },
  { label: '50 branches', value: '50' },
  { label: '25 branches', value: '25' },
  { label: '10 branches', value: '10' },
  { label: '5 branches', value: '5' }
];

const statusScheme = (state: VercelDeploymentSummary['state']) => {
  if (state === 'ready') return 'green';
  if (state === 'building' || state === 'queued' || state === 'initializing') return 'yellow';
  if (state === 'error' || state === 'blocked') return 'red';
  return 'gray';
};

const statusDot = (state: VercelDeploymentSummary['state']) => {
  if (state === 'ready') return '#50E3C2';
  if (state === 'building') return '#F5A623';
  if (state === 'queued' || state === 'initializing') return '#E5E7EB';
  if (state === 'error' || state === 'blocked') return '#E00';
  if (state === 'canceled') return '#9CA3AF';
  return 'gray.400';
};

const shortCommit = (sha?: string) => (sha ? sha.slice(0, 7) : 'unknown');

const dateLabel = (iso?: string) => {
  if (!iso) return 'unknown';
  return iso.replace('T', ' ').slice(0, 16) + ' UTC';
};

const timestampMs = (iso?: string) => {
  if (!iso) return 0;

  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const stateRank: Record<VercelDeploymentSummary['state'], number> = {
  error: 0,
  blocked: 1,
  building: 2,
  queued: 3,
  initializing: 4,
  ready: 5,
  canceled: 6,
  unknown: 7,
  local: 8
};

const statusLabel = (state: DeploymentState) => {
  return STATUS_OPTIONS.find((option) => option.state === state)?.label || state;
};

const buildStatusOptions = (deployments: VercelDeploymentSummary[]) => {
  const seen = new Set<DeploymentState>(STATUS_OPTIONS.map((option) => option.state));
  const extraStates = deployments
    .map((deployment) => deployment.state)
    .filter((state): state is DeploymentState => {
      if (seen.has(state)) {
        return false;
      }

      seen.add(state);
      return true;
    })
    .map((state) => ({ label: statusLabel(state), state }));

  return [...STATUS_OPTIONS, ...extraStates];
};

const buildDefaultSelectedStates = (deployments: VercelDeploymentSummary[]) => {
  return new Set(
    buildStatusOptions(deployments)
      .map((option) => option.state)
      .filter((state) => state !== 'canceled')
  );
};

const matchesSearch = (deployment: VercelDeploymentSummary, query: string) => {
  if (!query) {
    return true;
  }

  return [
    deployment.branch,
    deployment.commitSha,
    deployment.environment,
    deployment.state,
    deployment.url
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query));
};

const sortDeployments = (deployments: VercelDeploymentSummary[], sort: DeploymentSort) => {
  return [...deployments].sort((left, right) => {
    if (sort === 'created-asc') {
      return timestampMs(left.createdAt) - timestampMs(right.createdAt);
    }

    if (sort === 'ready-desc') {
      return timestampMs(right.readyAt || right.createdAt) - timestampMs(left.readyAt || left.createdAt);
    }

    if (sort === 'state') {
      return stateRank[left.state] - stateRank[right.state] || timestampMs(right.createdAt) - timestampMs(left.createdAt);
    }

    if (sort === 'branch') {
      return (left.branch || '').localeCompare(right.branch || '') || timestampMs(right.createdAt) - timestampMs(left.createdAt);
    }

    return timestampMs(right.createdAt) - timestampMs(left.createdAt);
  });
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
          <Button
            as="a"
            href={deployment.url}
            target="_blank"
            rel="noreferrer"
            size="xs"
            variant="outline"
            leftIcon={<Icon as={ExternalLink} boxSize={3.5} />}
          >
            Preview
          </Button>
          {deployment.dashboardUrl ? (
            <Button
              as="a"
              href={deployment.dashboardUrl}
              target="_blank"
              rel="noreferrer"
              size="xs"
              variant="outline"
              leftIcon={<Icon as={Rocket} boxSize={3.5} />}
            >
              Deployment
            </Button>
          ) : null}
        </Flex>
      </Flex>

      <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} spacing={3}>
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
            Created
          </Text>
          <Text fontSize="sm">{dateLabel(deployment.createdAt)}</Text>
        </Box>
        <Box>
          <Text color="gray.500" fontSize="xs">
            Ready
          </Text>
          <Text fontSize="sm">
            {deployment.readyLabel
              ? `${deployment.readyLabel} (${dateLabel(deployment.readyAt || deployment.createdAt)})`
              : dateLabel(deployment.readyAt || deployment.createdAt)}
          </Text>
        </Box>
      </SimpleGrid>
    </Stack>
  </Box>
);

export default function VercelPage() {
  const overview = useLoaderData() as VercelDeploymentsOverview;
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const checking = revalidator.state === 'loading';
  const [search, setSearch] = React.useState('');
  const [selectedStates, setSelectedStates] = React.useState<Set<DeploymentState>>(
    () => buildDefaultSelectedStates(overview.deployments)
  );
  const [statusSelectionTouched, setStatusSelectionTouched] = React.useState(false);
  const [sort, setSort] = React.useState<DeploymentSort>('ready-desc');

  const statusOptions = React.useMemo(() => {
    return buildStatusOptions(overview.deployments);
  }, [overview.deployments]);

  React.useEffect(() => {
    setSelectedStates((current) => {
      if (!statusSelectionTouched) {
        return buildDefaultSelectedStates(overview.deployments);
      }

      let changed = false;
      const next = new Set(current);

      for (const option of statusOptions) {
        if (option.state !== 'canceled' && !next.has(option.state)) {
          next.add(option.state);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [overview.deployments, statusOptions, statusSelectionTouched]);

  const visibleDeployments = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = overview.deployments.filter((deployment) => {
      return selectedStates.has(deployment.state) && matchesSearch(deployment, query);
    });

    return sortDeployments(filtered, sort);
  }, [overview.deployments, search, selectedStates, sort]);

  const selectedStatusCount = statusOptions.filter((option) => selectedStates.has(option.state)).length;
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label || 'Sort';
  const branchLimitValue = overview.branchLimit === null ? 'infinite' : String(overview.branchLimit);
  const branchLimitLabel = overview.branchLimit === null ? 'infinite' : `${overview.branchLimit} branches`;
  const setBranchLimit = React.useCallback((limit: string) => {
    const nextSearchParams = new URLSearchParams(searchParams);

    if (limit === 'infinite') {
      nextSearchParams.delete('branches');
    } else {
      nextSearchParams.set('branches', limit);
    }

    setSearchParams(nextSearchParams);
  }, [searchParams, setSearchParams]);
  const toggleStatus = React.useCallback((state: DeploymentState) => {
    setStatusSelectionTouched(true);
    setSelectedStates((current) => {
      const next = new Set(current);

      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }

      return next;
    });
  }, []);

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
            alignItems="center"
            justifyContent="center"
            gap={3}
            flexDirection="column"
            textAlign="center"
          >
            <Flex gap={2} wrap="wrap" justifyContent="center">
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
              alignSelf="center"
            >
              Refresh
            </Button>
          </Flex>

          <Stack spacing={2} alignItems="center" data-testid="vercel-filter-toolbar">
            <Flex alignItems="center" justifyContent="center" gap={2} wrap="wrap">
              <Popover placement="bottom-start">
              <PopoverTrigger>
                <Button
                  size="sm"
                  variant={search ? 'solid' : 'outline'}
                  colorScheme={search ? 'teal' : 'gray'}
                  leftIcon={<Icon as={Filter} boxSize={3.5} />}
                  data-testid="vercel-filter-trigger"
                >
                  {search ? 'Filtered' : 'Filter'}
                </Button>
              </PopoverTrigger>
              <PopoverContent w={{ base: 'calc(100vw - 32px)', sm: '320px' }} borderColor="gray.200">
                <PopoverArrow />
                <PopoverBody>
                  <Stack spacing={2}>
                    <Text fontSize="xs" color="gray.500">
                      Filter deployments
                    </Text>
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.currentTarget.value)}
                      placeholder="Branch, URL, commit..."
                      size="sm"
                      data-testid="vercel-filter-input"
                    />
                    {search ? (
                      <Button size="xs" variant="ghost" alignSelf="flex-start" onClick={() => setSearch('')}>
                        Clear
                      </Button>
                    ) : null}
                  </Stack>
                </PopoverBody>
              </PopoverContent>
            </Popover>
              <Popover placement="bottom-start">
              <PopoverTrigger>
                <Button
                  size="sm"
                  variant="outline"
                  rightIcon={<Icon as={ChevronDown} boxSize={4} />}
                  data-testid="vercel-state-filter"
                >
                  <Flex alignItems="center" gap={2}>
                    <Flex alignItems="center" gap="2px">
                      {statusOptions.slice(0, 4).map((option) => (
                        <Box
                          key={option.state}
                          width="8px"
                          height="8px"
                          borderRadius="full"
                          bg={statusDot(option.state)}
                          opacity={selectedStates.has(option.state) ? 1 : 0.25}
                        />
                      ))}
                    </Flex>
                    <Text>Status</Text>
                    <Badge borderRadius="full" colorScheme="gray">
                      {selectedStatusCount}/{statusOptions.length}
                    </Badge>
                  </Flex>
                </Button>
              </PopoverTrigger>
              <PopoverContent w="260px" borderColor="gray.200" boxShadow="xl">
                <PopoverArrow />
                <PopoverBody py={3}>
                  <Stack spacing={1}>
                    {statusOptions.map((option) => {
                      const selected = selectedStates.has(option.state);

                      return (
                        <Flex
                          as="button"
                          type="button"
                          key={option.state}
                          onClick={() => toggleStatus(option.state)}
                          alignItems="center"
                          gap={3}
                          width="100%"
                          px={2}
                          py={2}
                          borderRadius="md"
                          textAlign="left"
                          _hover={{ bg: 'gray.50' }}
                        >
                          <Flex
                            alignItems="center"
                            justifyContent="center"
                            width="18px"
                            height="18px"
                            borderRadius="md"
                            bg={selected ? '#111827' : '#FFFFFF'}
                            borderWidth="1px"
                            borderColor={selected ? '#111827' : '#A1A1AA'}
                            flexShrink={0}
                          >
                            {selected ? <Icon as={Check} boxSize={3} color="#FFFFFF" strokeWidth={3} /> : null}
                          </Flex>
                          <Flex alignItems="center" gap={2}>
                            <Box width="10px" height="10px" borderRadius="full" bg={statusDot(option.state)} />
                            <Text>{option.label}</Text>
                          </Flex>
                        </Flex>
                      );
                    })}
                  </Stack>
                </PopoverBody>
              </PopoverContent>
            </Popover>
              <Popover placement="bottom-start">
              <PopoverTrigger>
                <Button
                  size="sm"
                  variant="outline"
                  rightIcon={<Icon as={ChevronDown} boxSize={4} />}
                  data-testid="vercel-sort"
                >
                  {sortLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent w="230px" borderColor="gray.200" boxShadow="xl">
                <PopoverArrow />
                <PopoverBody py={3}>
                  <Stack spacing={1}>
                    {SORT_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        justifyContent="flex-start"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSort(option.value)}
                        leftIcon={
                          <Flex width="18px" justifyContent="center">
                            {sort === option.value ? <Icon as={Check} boxSize={3.5} /> : null}
                          </Flex>
                        }
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Stack>
                </PopoverBody>
              </PopoverContent>
              </Popover>
            </Flex>
            <Flex alignItems="center" justifyContent="center" gap={3} wrap="wrap" color="#71717A" fontSize="11px">
              <Text color="gray.600" fontSize="xs">
                {visibleDeployments.length}/{overview.deployments.length}
              </Text>
              <Text>branches counted: {overview.totalBranchCount}</Text>
              <Text>
                scanned {overview.deploymentScanCount} deployments across {overview.deploymentPageCount}{" "}
                {overview.deploymentPageCount === 1 ? "page" : "pages"}
              </Text>
              <Popover placement="bottom-end">
              <PopoverTrigger>
                <Button
                  size="xs"
                  variant="ghost"
                  color="#71717A"
                  fontSize="11px"
                  fontWeight="normal"
                  height="auto"
                  minH="0"
                  px={1.5}
                  py={0.5}
                  rightIcon={<Icon as={ChevronDown} boxSize={3} />}
                  data-testid="vercel-branch-limit"
                >
                  branches: {branchLimitLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent w="190px" borderColor="gray.200" boxShadow="lg">
                <PopoverArrow />
                <PopoverBody py={2}>
                  <Stack spacing={1}>
                    {BRANCH_LIMIT_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        justifyContent="flex-start"
                        variant="ghost"
                        size="xs"
                        onClick={() => setBranchLimit(option.value)}
                        leftIcon={
                          <Flex width="16px" justifyContent="center">
                            {branchLimitValue === option.value ? <Icon as={Check} boxSize={3} /> : null}
                          </Flex>
                        }
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Stack>
                </PopoverBody>
              </PopoverContent>
              </Popover>
            </Flex>
          </Stack>

          {overview.error ? (
            <Box borderWidth="1px" borderColor="red.200" borderRadius="md" bg="red.50" color="red.700" p={4} fontSize="sm">
              {overview.error}
            </Box>
          ) : null}

          {visibleDeployments.length ? (
            <Stack spacing={3} w="100%">
              {visibleDeployments.map((deployment) => (
                <DeploymentRow key={deployment.url} deployment={deployment} />
              ))}
            </Stack>
          ) : (
            <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" bg="white" p={8} textAlign="center">
              <Icon as={Globe2} boxSize={8} color="gray.400" />
              <Text mt={3} color="gray.600">
                {overview.deployments.length ? 'No deployments match the current filters.' : 'No deployment URLs found.'}
              </Text>
            </Box>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
