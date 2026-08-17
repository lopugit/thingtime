import React from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Heading,
  IconButton,
  Input,
  Link,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Stack,
  Text,
  useDisclosure,
  useMediaQuery
} from '@chakra-ui/react';
import { FiExternalLink, FiGitBranch, FiPlay, FiRefreshCw, FiSearch } from 'react-icons/fi';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

import type { CiControlResponse, CiEntity, CiEvent, CiWorkflowKey } from './types';

const ACTIVE_STATUSES = new Set(['queued', 'requested', 'waiting', 'in_progress', 'pending']);
const CONFLICT_STATUSES = new Set(['conflicting', 'dirty', 'blocked', 'failure', 'failed']);
const READY_STATUSES = new Set(['clean', 'ready', 'success', 'succeeded', 'completed', 'merged']);

const normalizedStatus = (value: unknown) => String(value ?? 'unknown').toLowerCase();

const statusColor = (status: unknown) => {
  const normalized = normalizedStatus(status);
  if (CONFLICT_STATUSES.has(normalized)) return 'red';
  if (ACTIVE_STATUSES.has(normalized)) return 'blue';
  if (READY_STATUSES.has(normalized)) return 'green';
  if (normalized === 'draft' || normalized === 'cancelled' || normalized === 'skipped') return 'orange';
  return 'gray';
};

const StatusBadge = ({ status }: { status: unknown }) => (
  <Badge colorScheme={statusColor(status)} borderRadius="999px" px={2} py="2px" textTransform="none">
    {String(status || 'unknown').replaceAll('_', ' ')}
  </Badge>
);

const parseTime = (value: unknown) => {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

const formatTime = (value: unknown) => {
  const date = parseTime(value);
  return date ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};

const relativeTime = (value: unknown) => {
  const date = parseTime(value);
  if (!date) return 'No events yet';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
};

const entityTime = (entity: CiEntity | null | undefined) =>
  entity?.sourceUpdatedAt ?? entity?.updatedAt ?? entity?.createdAt ?? null;

const matchesEntity = (entity: CiEntity, pr: CiEntity | null) => {
  if (!pr) return false;
  const headRef = String(pr.headRef ?? '');
  const headSha = String(pr.headSha ?? '');
  return (
    (headRef && String(entity.headRef ?? entity.ref ?? '') === headRef) ||
    (headSha && String(entity.headSha ?? entity.sha ?? '') === headSha)
  );
};

const selectPrimaryPr = (feature: CiEntity | null, pullRequests: CiEntity[]) => {
  if (!feature) return null;
  const related = pullRequests.filter((pr) => pr.parentId === feature.id);
  return related.sort((left, right) => {
    const leftPromotion = left.sourcePrNumber ? 1 : 0;
    const rightPromotion = right.sourcePrNumber ? 1 : 0;
    return rightPromotion - leftPromotion || Number(right.number ?? 0) - Number(left.number ?? 0);
  })[0] ?? null;
};

const DetailSection = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <Box>
    <Text fontSize="10px" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" opacity={0.48} mb={2}>
      {label}
    </Text>
    {children}
  </Box>
);

const EmptyLine = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize="sm" opacity={0.58}>
    {children}
  </Text>
);

type DetailProps = {
  feature: CiEntity | null;
  pr: CiEntity | null;
  runs: CiEntity[];
  previews: CiEntity[];
  events: CiEvent[];
  canDispatch: boolean;
  onDispatch: (workflow: CiWorkflowKey, pr?: CiEntity | null) => void;
};

const FeatureDetail = ({ feature, pr, runs, previews, events, canDispatch, onDispatch }: DetailProps) => {
  if (!feature) return <EmptyLine>Select a feature to inspect its topology and status history.</EmptyLine>;
  const headRef = String(pr?.headRef ?? '—');
  const baseRef = String(pr?.baseRef ?? '—');
  const preview = previews[0] ?? null;

  return (
    <Stack spacing={5}>
      <Box>
        <Flex align="flex-start" justify="space-between" gap={3}>
          <Box minW={0}>
            <Heading size="sm" lineHeight="1.35" noOfLines={2}>
              {feature.title || pr?.title || 'Untitled feature'}
            </Heading>
            <Text fontSize="xs" opacity={0.55} mt={1}>
              {feature.repository || pr?.repository || 'Repository unavailable'}
            </Text>
          </Box>
          <StatusBadge status={pr?.status ?? feature.status} />
        </Flex>
        <Flex gap={2} mt={4} wrap="wrap">
          {pr?.url ? (
            <Button as={Link} href={String(pr.url)} isExternal size="xs" rightIcon={<FiExternalLink />} variant="outline">
              PR #{String(pr.number ?? pr.externalId ?? '')}
            </Button>
          ) : null}
          {preview?.url ? (
            <Button as={Link} href={String(preview.url)} isExternal size="xs" rightIcon={<FiExternalLink />} variant="outline">
              Open preview
            </Button>
          ) : null}
          {pr ? (
            <Button
              size="xs"
              leftIcon={<FiPlay />}
              colorScheme={CONFLICT_STATUSES.has(normalizedStatus(pr.status)) ? 'purple' : 'gray'}
              onClick={() => onDispatch('resolve-conflicts', pr)}
              isDisabled={!canDispatch}
            >
              Retry resolver
            </Button>
          ) : null}
          {pr ? (
            <Button size="xs" variant="ghost" onClick={() => onDispatch('rebase-stack', pr)} isDisabled={!canDispatch}>
              Rebase stack…
            </Button>
          ) : null}
        </Flex>
      </Box>

      <Divider />

      <DetailSection label="Topology">
        {pr ? (
          <Flex align="center" gap={2} wrap="wrap" fontSize="sm">
            <Badge variant="subtle" colorScheme="gray" maxW="100%" overflow="hidden" textOverflow="ellipsis">
              {headRef}
            </Badge>
            <Text opacity={0.42}>→</Text>
            <Badge variant="subtle" colorScheme="purple">
              PR #{String(pr.number ?? pr.externalId ?? '')}
            </Badge>
            <Text opacity={0.42}>→</Text>
            <Badge variant="subtle" colorScheme="gray">
              {baseRef}
            </Badge>
          </Flex>
        ) : (
          <EmptyLine>No pull request is linked to this feature yet.</EmptyLine>
        )}
      </DetailSection>

      <DetailSection label="Recent Actions">
        {runs.length ? (
          <Stack spacing={2}>
            {runs.slice(0, 4).map((run) => (
              <Flex key={run.id} align="center" justify="space-between" gap={3} fontSize="sm">
                <Box minW={0}>
                  {run.url ? (
                    <Link href={String(run.url)} isExternal fontWeight="600" noOfLines={1}>
                      {run.title || `Run ${String(run.runNumber ?? run.externalId ?? '')}`}
                    </Link>
                  ) : (
                    <Text fontWeight="600" noOfLines={1}>{run.title || 'Workflow run'}</Text>
                  )}
                  <Text fontSize="xs" opacity={0.5}>{relativeTime(entityTime(run))}</Text>
                </Box>
                <StatusBadge status={run.conclusion ?? run.status} />
              </Flex>
            ))}
          </Stack>
        ) : (
          <EmptyLine>No recent run is linked to this branch yet.</EmptyLine>
        )}
      </DetailSection>

      <DetailSection label="Status History">
        {events.length ? (
          <Stack spacing={0}>
            {events.slice(0, 8).map((event, index) => (
              <Flex key={event.id} gap={3} minH="54px">
                <Flex direction="column" align="center" width="12px" flex="0 0 12px">
                  <Box mt="5px" width="8px" height="8px" borderRadius="50%" bg={`${statusColor(event.statusTo)}.400`} />
                  {index < Math.min(events.length, 8) - 1 ? <Box flex="1" width="1px" bg="var(--tt-border, #e7e7eb)" /> : null}
                </Flex>
                <Box pb={3} minW={0}>
                  <Text fontSize="sm" fontWeight="600" noOfLines={1}>
                    {event.action || event.eventType || 'Status updated'}
                  </Text>
                  <Text fontSize="xs" opacity={0.56}>
                    {event.statusFrom && event.statusTo ? `${event.statusFrom} → ${event.statusTo} · ` : ''}
                    {formatTime(event.occurredAt ?? entityTime(event))}
                  </Text>
                </Box>
              </Flex>
            ))}
          </Stack>
        ) : (
          <EmptyLine>History will appear as signed webhook deliveries arrive.</EmptyLine>
        )}
      </DetailSection>
    </Stack>
  );
};

const WORKFLOW_LABELS: Record<CiWorkflowKey, string> = {
  'resolve-conflicts': 'Resolve PR conflicts',
  'rebase-stack': 'Rebase PR or stack',
  'promote-features': 'Promote features to main',
  'promote-develop': 'Refresh develop → main PR',
  'sync-main': 'Sync main into develop',
  'web-ci': 'Run web CI',
  'electron-release': 'Build Electron release'
};

const defaultWorkflowRef = (workflow: CiWorkflowKey) =>
  workflow === 'electron-release' || workflow === 'sync-main' ? 'main' : 'develop';

type DispatchModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialWorkflow: CiWorkflowKey;
  initialPr: CiEntity | null;
  isSubmitting: boolean;
  onSubmit: (workflow: CiWorkflowKey, ref: string, inputs: Record<string, unknown>) => Promise<void>;
};

const DispatchModal = ({ isOpen, onClose, initialWorkflow, initialPr, isSubmitting, onSubmit }: DispatchModalProps) => {
  const [workflow, setWorkflow] = React.useState<CiWorkflowKey>(initialWorkflow);
  const [prNumber, setPrNumber] = React.useState(String(initialPr?.number ?? initialPr?.externalId ?? ''));
  const [confirmed, setConfirmed] = React.useState(false);
  const entryRef = defaultWorkflowRef(workflow);

  React.useEffect(() => {
    if (!isOpen) return;
    setWorkflow(initialWorkflow);
    setPrNumber(String(initialPr?.number ?? initialPr?.externalId ?? ''));
    setConfirmed(false);
  }, [initialPr, initialWorkflow, isOpen]);

  const requiresPr = workflow === 'resolve-conflicts' || workflow === 'rebase-stack';
  const sensitive = workflow === 'rebase-stack' || workflow === 'electron-release';
  const submit = async () => {
    const inputs: Record<string, unknown> = {};
    if (requiresPr && prNumber.trim()) inputs.pr_number = prNumber.trim();
    if (workflow === 'rebase-stack') inputs.cascade = true;
    if (workflow === 'promote-features') inputs.dry_run = false;
    await onSubmit(workflow, entryRef, inputs);
  };

  return (
    <Modal isOpen={isOpen} onClose={isSubmitting ? () => {} : onClose} isCentered size="lg">
      <ModalOverlay />
      <ModalContent mx={3}>
        <ModalHeader>Dispatch trusted workflow</ModalHeader>
        <ModalCloseButton isDisabled={isSubmitting} />
        <ModalBody>
          <Stack spacing={4}>
            <Alert status="info" borderRadius="md" fontSize="sm">
              <AlertIcon />
              The thin product-branch listener dispatches the implementation pinned to the protected github-actions branch.
            </Alert>
            <FormControl>
              <FormLabel fontSize="sm">Workflow</FormLabel>
              <Select
                value={workflow}
                onChange={(event) => {
                  const next = event.target.value as CiWorkflowKey;
                  setWorkflow(next);
                  setConfirmed(false);
                }}
              >
                {(Object.keys(WORKFLOW_LABELS) as CiWorkflowKey[]).map((key) => (
                  <option key={key} value={key}>{WORKFLOW_LABELS[key]}</option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel fontSize="sm">Workflow entry ref</FormLabel>
              <Input value={entryRef} isReadOnly bg="var(--tt-surface-alt, #f6f6f8)" />
              <Text mt={1} fontSize="xs" opacity={0.56}>
                Fixed server-side so arbitrary feature-branch workflow YAML can never run. The implementation is pinned to github-actions.
              </Text>
            </FormControl>
            {requiresPr ? (
              <FormControl>
                <FormLabel fontSize="sm">Pull request number</FormLabel>
                <Input inputMode="numeric" value={prNumber} onChange={(event) => setPrNumber(event.target.value.replace(/\D/g, ''))} />
              </FormControl>
            ) : null}
            {sensitive ? (
              <Checkbox isChecked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} alignItems="flex-start">
                <Text fontSize="sm">
                  I understand this may update a branch with force-with-lease or create a release artifact.
                </Text>
              </Checkbox>
            ) : null}
          </Stack>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>Cancel</Button>
          <Button
            colorScheme={sensitive ? 'orange' : 'purple'}
            leftIcon={<FiPlay />}
            onClick={submit}
            isLoading={isSubmitting}
            isDisabled={(requiresPr && !prNumber.trim()) || (sensitive && !confirmed)}
          >
            Dispatch
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export const CIControlDashboard = ({ cacheIdentity }: { cacheIdentity: string }) => {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopu = useLopu();
  const cacheKey = `tt-admin-ci-control-v1:${cacheIdentity}`;
  const [response, setResponse] = React.useState<CiControlResponse | null>(() => readLocalCache<CiControlResponse>(cacheKey));
  const [loading, setLoading] = React.useState(!response);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [selectedFeatureId, setSelectedFeatureId] = React.useState<string | null>(response?.dashboard.features[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);
  const [isMobile] = useMediaQuery('(max-width: 61.99em)', { ssr: true, fallback: false });
  const dispatchDisclosure = useDisclosure();
  const [dispatchWorkflow, setDispatchWorkflow] = React.useState<CiWorkflowKey>('resolve-conflicts');
  const [dispatchPr, setDispatchPr] = React.useState<CiEntity | null>(null);
  const [dispatching, setDispatching] = React.useState(false);

  const load = React.useCallback(async (options?: { signal?: AbortSignal; foreground?: boolean }) => {
    if (options?.foreground) setRefreshing(true);
    try {
      const next = await apiRef.current.v1.admin.ciControl({ limit: 250 }, { signal: options?.signal });
      if (!next?.ok) throw new Error('CI snapshot unavailable');
      setResponse(next);
      writeLocalCache(cacheKey, next);
      setLoadFailed(false);
      setSelectedFeatureId((current) =>
        current && next.dashboard.features.some((feature: CiEntity) => feature.id === current)
          ? current
          : next.dashboard.features[0]?.id ?? null
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setLoadFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  React.useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);

  const dashboard = response?.dashboard ?? null;
  const integration = response?.integration ?? null;
  const features = React.useMemo(() => {
    if (!dashboard) return [];
    const needle = query.trim().toLowerCase();
    return dashboard.features.filter((feature) => {
      const pr = selectPrimaryPr(feature, dashboard.pullRequests);
      const searchable = [feature.title, feature.externalId, pr?.title, pr?.number, pr?.headRef, pr?.baseRef]
        .map((value) => String(value ?? '').toLowerCase())
        .join(' ');
      if (needle && !searchable.includes(needle)) return false;
      const status = normalizedStatus(pr?.status ?? feature.status);
      if (filter === 'attention') return CONFLICT_STATUSES.has(status) || status === 'unknown';
      if (filter === 'ready') return READY_STATUSES.has(status);
      if (filter === 'active') {
        return dashboard.workflowRuns.some((run) => matchesEntity(run, pr) && ACTIVE_STATUSES.has(normalizedStatus(run.status)));
      }
      return true;
    });
  }, [dashboard, filter, query]);

  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) ?? features[0] ?? null;
  const selectedPr = dashboard ? selectPrimaryPr(selectedFeature, dashboard.pullRequests) : null;
  const selectedRuns = dashboard
    ? dashboard.workflowRuns.filter((run) => matchesEntity(run, selectedPr)).slice(0, 10)
    : [];
  const selectedPreviews = dashboard
    ? dashboard.previews.filter((preview) => matchesEntity(preview, selectedPr)).slice(0, 5)
    : [];
  const relatedIds = new Set([
    selectedFeature?.id,
    selectedPr?.id,
    ...selectedRuns.map((run) => run.id),
    ...selectedPreviews.map((preview) => preview.id)
  ].filter(Boolean));
  const selectedEvents = dashboard
    ? dashboard.events
        .filter((event) => event.parentId && relatedIds.has(event.parentId))
        .sort((left, right) => (parseTime(right.occurredAt ?? entityTime(right))?.getTime() ?? 0) - (parseTime(left.occurredAt ?? entityTime(left))?.getTime() ?? 0))
    : [];

  const selectFeature = (feature: CiEntity) => {
    setSelectedFeatureId(feature.id);
    if (isMobile) setMobileDetailOpen(true);
  };

  const openDispatch = (workflow: CiWorkflowKey, pr: CiEntity | null = selectedPr) => {
    setDispatchWorkflow(workflow);
    setDispatchPr(pr);
    dispatchDisclosure.onOpen();
  };

  const submitDispatch = async (workflow: CiWorkflowKey, ref: string, inputs: Record<string, unknown>) => {
    setDispatching(true);
    try {
      const result = await apiRef.current.v1.admin.dispatchCiWorkflow({ workflow, ref, inputs });
      if (!result?.ok) throw new Error('Dispatch rejected');
      dispatchDisclosure.onClose();
      lopu({
        title: `${WORKFLOW_LABELS[workflow]} queued 🙌`,
        description: 'GitHub accepted the trusted dispatch. Status will update here as webhook events arrive.',
        status: 'success',
        duration: 7000
      });
      window.setTimeout(() => load(), 1500);
    } catch {
      lopu({
        title: 'The workflow could not be dispatched',
        description: 'Nothing was changed. Check the GitHub App integration, then try again.',
        status: 'error'
      });
    } finally {
      setDispatching(false);
    }
  };

  const reconcile = async () => {
    if (!integration?.githubAppConfigured || refreshing) return;
    setRefreshing(true);
    try {
      const result = await apiRef.current.v1.admin.reconcileCiControl();
      if (!result?.ok) throw new Error('Reconciliation rejected');
      await load();
      lopu({
        title: 'CI control data reconciled ✨',
        description: 'Branches, pull requests, Actions runs, and deployments now match GitHub.',
        status: 'success',
        duration: 6000
      });
    } catch {
      lopu({
        title: 'GitHub reconciliation did not complete',
        description: 'Existing status history was preserved. Check the GitHub App integration and try again.',
        status: 'error'
      });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !response) {
    return (
      <Flex minH="280px" align="center" justify="center" gap={3}>
        <Spinner size="sm" />
        <Text fontSize="sm" opacity={0.62}>Loading CI control data…</Text>
      </Flex>
    );
  }

  return (
    <Box>
      <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', md: 'row' }} mb={5}>
        <Box>
          <Heading size="md">CI Control</Heading>
          <Text mt={1} fontSize="sm" opacity={0.62}>
            Features, branches, pull requests, automation, previews, and status history in one place.
          </Text>
        </Box>
        <Flex gap={2} wrap="wrap">
          <Button size="sm" variant="outline" leftIcon={<FiRefreshCw />} onClick={() => load({ foreground: true })} isLoading={refreshing}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={reconcile}
            isDisabled={!integration?.githubAppConfigured}
            title={integration?.githubAppConfigured ? 'Reconcile from GitHub' : 'Configure the GitHub App first'}
          >
            Reconcile
          </Button>
          <Button
            size="sm"
            colorScheme="purple"
            leftIcon={<FiPlay />}
            onClick={() => openDispatch('promote-features', null)}
            isDisabled={!integration?.githubAppConfigured}
          >
            Dispatch…
          </Button>
        </Flex>
      </Flex>

      {loadFailed ? (
        <Alert status="warning" mb={4} borderRadius="md" fontSize="sm">
          <AlertIcon />
          Live refresh failed. Last-known cached state remains visible and will retry automatically.
        </Alert>
      ) : null}

      <Flex
        border="1px solid var(--tt-border, #e7e7eb)"
        borderRadius="var(--tt-radius-md, 12px)"
        bg="var(--tt-card, #fff)"
        px={4}
        py={3}
        gap={{ base: 3, md: 6 }}
        wrap="wrap"
        mb={4}
      >
        {[
          ['Open PRs', dashboard?.stats.openPullRequests ?? 0],
          ['Conflicts', dashboard?.stats.conflicting ?? 0],
          ['Active runs', dashboard?.stats.activeRuns ?? 0],
          ['Ready previews', dashboard?.stats.readyPreviews ?? 0]
        ].map(([label, value]) => (
          <Box key={String(label)} minW="88px">
            <Text fontSize="10px" fontWeight="700" textTransform="uppercase" letterSpacing="0.06em" opacity={0.45}>{label}</Text>
            <Text fontSize="xl" fontWeight="700">{value}</Text>
          </Box>
        ))}
        <Box ml={{ base: 0, md: 'auto' }} minW="190px">
          <Flex gap={1.5} wrap="wrap" justify={{ base: 'flex-start', md: 'flex-end' }}>
            <Badge colorScheme={integration?.githubAppConfigured ? 'green' : 'gray'}>GitHub App</Badge>
            <Badge colorScheme={integration?.githubWebhookConfigured ? 'green' : 'gray'}>GitHub webhook</Badge>
            <Badge colorScheme={integration?.vercelWebhookConfigured ? 'green' : 'gray'}>Vercel webhook</Badge>
          </Flex>
          <Text textAlign={{ base: 'left', md: 'right' }} mt={1} fontSize="xs" opacity={0.5}>
            Last event {relativeTime(dashboard?.freshness.latestEventAt)}
          </Text>
        </Box>
      </Flex>

      <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1.65fr) minmax(320px, 0.85fr)' }} gap={4}>
        <Box border="1px solid var(--tt-border, #e7e7eb)" borderRadius="var(--tt-radius-md, 12px)" bg="var(--tt-card, #fff)" overflow="hidden">
          <Flex p={3} gap={2} borderBottom="1px solid var(--tt-border, #e7e7eb)" direction={{ base: 'column', sm: 'row' }}>
            <Flex align="center" gap={2} flex="1" border="1px solid var(--tt-border, #e7e7eb)" borderRadius="md" px={3}>
              <FiSearch opacity={0.45} />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} variant="unstyled" placeholder="Search features, PRs, or branches" py={2} />
            </Flex>
            <Select width={{ base: '100%', sm: '160px' }} value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="attention">Needs attention</option>
              <option value="active">Running</option>
              <option value="ready">Ready</option>
            </Select>
          </Flex>
          <Grid
            display={{ base: 'none', md: 'grid' }}
            templateColumns="minmax(0, 1.6fr) minmax(150px, .8fr) 110px 110px"
            gap={3}
            px={4}
            py={2}
            fontSize="10px"
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="0.06em"
            opacity={0.45}
          >
            <Text>Feature</Text><Text>Branch</Text><Text>Status</Text><Text>Updated</Text>
          </Grid>
          <Box maxH={{ base: 'none', lg: '720px' }} overflowY={{ base: 'visible', lg: 'auto' }}>
            {features.map((feature) => {
              const pr = dashboard ? selectPrimaryPr(feature, dashboard.pullRequests) : null;
              const selected = feature.id === selectedFeature?.id;
              return (
                <Grid
                  as="button"
                  type="button"
                  key={feature.id}
                  width="100%"
                  templateColumns={{ base: 'minmax(0, 1fr) auto', md: 'minmax(0, 1.6fr) minmax(150px, .8fr) 110px 110px' }}
                  gap={3}
                  alignItems="center"
                  textAlign="left"
                  px={4}
                  py={3}
                  borderTop="1px solid var(--tt-border, #eeeeF1)"
                  bg={selected ? 'var(--tt-surface-alt, #f6f6f8)' : 'transparent'}
                  _hover={{ bg: 'var(--tt-surface-alt, #f6f6f8)' }}
                  _focusVisible={{ outline: '2px solid var(--tt-accent, #7c5cff)', outlineOffset: '-2px' }}
                  onClick={() => selectFeature(feature)}
                  aria-pressed={selected}
                >
                  <Box minW={0}>
                    <Flex align="center" gap={2} minW={0}>
                      {pr?.number ? <Badge variant="subtle">#{String(pr.number)}</Badge> : null}
                      <Text fontSize="sm" fontWeight="650" noOfLines={1}>{feature.title || pr?.title || 'Untitled feature'}</Text>
                    </Flex>
                    <Text display={{ base: 'block', md: 'none' }} mt={1} fontSize="xs" opacity={0.52} noOfLines={1}>
                      {String(pr?.headRef ?? feature.externalId ?? 'No branch linked')}
                    </Text>
                  </Box>
                  <Text display={{ base: 'none', md: 'block' }} fontSize="xs" opacity={0.62} noOfLines={1}>{String(pr?.headRef ?? '—')}</Text>
                  <Box><StatusBadge status={pr?.status ?? feature.status} /></Box>
                  <Text display={{ base: 'none', md: 'block' }} fontSize="xs" opacity={0.52}>{relativeTime(entityTime(pr ?? feature))}</Text>
                </Grid>
              );
            })}
            {!features.length ? (
              <Box p={8} textAlign="center">
                <FiGitBranch style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <Text fontSize="sm" opacity={0.58}>No features match this view.</Text>
              </Box>
            ) : null}
          </Box>
        </Box>

        <Box
          display={{ base: 'none', lg: 'block' }}
          border="1px solid var(--tt-border, #e7e7eb)"
          borderRadius="var(--tt-radius-md, 12px)"
          bg="var(--tt-card, #fff)"
          p={5}
          alignSelf="start"
          position="sticky"
          top="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 12px)"
          maxH="calc(100vh - var(--tt-nav-clearance, 54px) - 42px)"
          overflowY="auto"
        >
          <FeatureDetail
            feature={selectedFeature}
            pr={selectedPr}
            runs={selectedRuns}
            previews={selectedPreviews}
            events={selectedEvents}
            canDispatch={Boolean(integration?.githubAppConfigured)}
            onDispatch={openDispatch}
          />
        </Box>
      </Grid>

      <Drawer isOpen={mobileDetailOpen} placement="bottom" onClose={() => setMobileDetailOpen(false)} size="full">
        <DrawerOverlay />
        <DrawerContent
          height="min(86dvh, 760px)"
          maxH="86dvh"
          borderTopRadius="18px"
          bg="var(--tt-card, #fff)"
          color="var(--tt-ink, #17171c)"
        >
          <DrawerCloseButton />
          <DrawerHeader borderBottom="1px solid var(--tt-border, #e7e7eb)" fontSize="sm">Feature details</DrawerHeader>
          <DrawerBody py={5} pb="calc(24px + env(safe-area-inset-bottom))">
            <FeatureDetail
              feature={selectedFeature}
              pr={selectedPr}
              runs={selectedRuns}
              previews={selectedPreviews}
              events={selectedEvents}
              canDispatch={Boolean(integration?.githubAppConfigured)}
              onDispatch={openDispatch}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      <DispatchModal
        isOpen={dispatchDisclosure.isOpen}
        onClose={dispatchDisclosure.onClose}
        initialWorkflow={dispatchWorkflow}
        initialPr={dispatchPr}
        isSubmitting={dispatching}
        onSubmit={submitDispatch}
      />
    </Box>
  );
};
