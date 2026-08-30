import React from 'react';
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Checkbox,
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
  Switch,
  Stack,
  Text,
  useDisclosure,
  useMediaQuery
} from '@chakra-ui/react';
import { FiCloud, FiExternalLink, FiGitBranch, FiGithub, FiPlay, FiRefreshCw, FiSearch } from 'react-icons/fi';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { CARD_STYLES } from '~/theme/card';

import type {
  CiAutomationPolicy,
  CiControlResponse,
  CiEntity,
  CiEvent,
  CiExecutionProvider,
  CiWorkflowKey
} from './types';

const ACTIVE_STATUSES = new Set(['queued', 'requested', 'waiting', 'in_progress', 'pending']);
const CONFLICT_STATUSES = new Set(['conflicting', 'dirty', 'blocked', 'failure', 'failed']);
const READY_STATUSES = new Set(['clean', 'ready', 'success', 'succeeded', 'completed', 'merged']);

const normalizedStatus = (value: unknown) => String(value ?? 'unknown').toLowerCase();

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

type StatusTone = 'danger' | 'active' | 'positive' | 'warning' | 'neutral';

const statusTone = (status: unknown): StatusTone => {
  const normalized = normalizedStatus(status);
  if (CONFLICT_STATUSES.has(normalized)) return 'danger';
  if (ACTIVE_STATUSES.has(normalized)) return 'active';
  if (READY_STATUSES.has(normalized)) return 'positive';
  if (normalized === 'draft' || normalized === 'cancelled' || normalized === 'skipped') return 'warning';
  return 'neutral';
};

const STATUS_CHIP_STYLES: Record<StatusTone, { bg: string; color: string }> = {
  danger: { bg: 'rgba(214, 69, 90, 0.12)', color: 'var(--tt-danger, #d6455a)' },
  active: { bg: 'rgba(47, 143, 214, 0.12)', color: 'var(--tt-link, #2f8fd6)' },
  positive: { bg: 'var(--tt-positive-soft, rgba(88, 202, 112, 0.14))', color: 'var(--tt-positive, #2f8f4f)' },
  warning: { bg: 'rgba(255, 188, 72, 0.18)', color: 'var(--tt-warning, #ffbc48)' },
  neutral: { bg: 'var(--tt-surface-alt, #f5f5f7)', color: 'var(--tt-muted, #9a9aa6)' }
};

const STATUS_DOT_COLORS: Record<StatusTone, string> = {
  danger: 'var(--tt-danger, #d6455a)',
  active: 'var(--tt-link, #2f8fd6)',
  positive: 'var(--tt-positive, #2f8f4f)',
  warning: 'var(--tt-warning, #ffbc48)',
  neutral: 'var(--tt-faint, #b6b6c0)'
};

const StatusBadge = ({ status }: { status: unknown }) => {
  const chip = STATUS_CHIP_STYLES[statusTone(status)];
  return (
    <Box
      as="span"
      display="inline-block"
      bg={chip.bg}
      color={chip.color}
      borderRadius="var(--tt-radius-pill, 999px)"
      px={2}
      py="2px"
      fontSize="xs"
      fontWeight={600}
      whiteSpace="nowrap"
    >
      {String(status || 'unknown').replace(/_/g, ' ')}
    </Box>
  );
};

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
    <Text
      fontFamily={MONO}
      fontSize="10px"
      fontWeight={600}
      letterSpacing="0.08em"
      textTransform="uppercase"
      color="var(--tt-muted, #9a9aa6)"
      mb={2}
    >
      {label}
    </Text>
    {children}
  </Box>
);

const EmptyLine = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
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
            <Heading size="sm" lineHeight="1.35" noOfLines={2} color="var(--tt-ink, #16161a)">
              {feature.title || pr?.title || 'Untitled feature'}
            </Heading>
            <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" mt={1}>
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

      <Box borderTop="1px solid var(--tt-border-light, #f0f0f2)" />

      <DetailSection label="Topology">
        {pr ? (
          <Flex align="center" gap={2} wrap="wrap" fontSize="sm">
            <Text
              as="span"
              fontFamily={MONO}
              fontSize="xs"
              px={2}
              py="2px"
              borderRadius="var(--tt-radius-xs, 7px)"
              bg="var(--tt-surface-alt, #f5f5f7)"
              color="var(--tt-text, #5a5a66)"
              maxW="100%"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
            >
              {headRef}
            </Text>
            <Text color="var(--tt-faint, #b6b6c0)">→</Text>
            <Text
              as="span"
              fontFamily={MONO}
              fontSize="xs"
              px={2}
              py="2px"
              borderRadius="var(--tt-radius-xs, 7px)"
              bg="var(--tt-accent-tint, #fff5fa)"
              color="var(--tt-accent, hotpink)"
              whiteSpace="nowrap"
            >
              PR #{String(pr.number ?? pr.externalId ?? '')}
            </Text>
            <Text color="var(--tt-faint, #b6b6c0)">→</Text>
            <Text
              as="span"
              fontFamily={MONO}
              fontSize="xs"
              px={2}
              py="2px"
              borderRadius="var(--tt-radius-xs, 7px)"
              bg="var(--tt-surface-alt, #f5f5f7)"
              color="var(--tt-text, #5a5a66)"
              whiteSpace="nowrap"
            >
              {baseRef}
            </Text>
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
                    <Text fontWeight="600" noOfLines={1} color="var(--tt-ink, #16161a)">{run.title || 'Workflow run'}</Text>
                  )}
                  <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">{relativeTime(entityTime(run))}</Text>
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
                  <Box mt="5px" width="8px" height="8px" borderRadius="50%" bg={STATUS_DOT_COLORS[statusTone(event.statusTo)]} />
                  {index < Math.min(events.length, 8) - 1 ? <Box flex="1" width="1px" bg="var(--tt-border-light, #f0f0f2)" /> : null}
                </Flex>
                <Box pb={3} minW={0}>
                  <Text fontSize="sm" fontWeight="600" noOfLines={1} color="var(--tt-ink, #16161a)">
                    {event.action || event.eventType || 'Status updated'}
                  </Text>
                  <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
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
  executionProvider: CiExecutionProvider;
  onSubmit: (workflow: CiWorkflowKey, ref: string, inputs: Record<string, unknown>) => Promise<void>;
};

const DispatchModal = ({
  isOpen,
  onClose,
  initialWorkflow,
  initialPr,
  isSubmitting,
  executionProvider,
  onSubmit
}: DispatchModalProps) => {
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
            <Alert status="info" borderRadius="var(--tt-radius-md, 12px)" fontSize="sm">
              <AlertIcon />
              {executionProvider === 'vercel-sandbox'
                ? 'Vercel Workflow will provision an isolated Sandbox runner, then GitHub will execute the exact protected workflow on that Vercel compute.'
                : 'The thin product-branch listener dispatches the implementation pinned to the protected github-actions branch.'}
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
              <Input value={entryRef} isReadOnly fontFamily={MONO} bg="var(--tt-surface-alt, #f5f5f7)" />
              <Text mt={1} fontSize="xs" color="var(--tt-muted, #9a9aa6)">
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

type AutomationProvidersProps = {
  policies: CiAutomationPolicy[];
  vercelRunnerReady: boolean;
  vercelRunnerMissing: string[];
  savingWorkflow: CiWorkflowKey | null;
  onChange: (workflow: CiWorkflowKey, executionProvider: CiExecutionProvider, enabled: boolean) => Promise<void>;
};

const AutomationProviders = ({
  policies,
  vercelRunnerReady,
  vercelRunnerMissing,
  savingWorkflow,
  onChange
}: AutomationProvidersProps) => (
  <Box {...CARD_STYLES} mb={4} overflow="hidden">
    <Flex px={4} py={3} align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
      <Box>
        <Heading size="sm" color="var(--tt-ink, #16161a)">Automation compute</Heading>
        <Text mt={1} fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          The workflow stays pinned to github-actions; this chooses whether its jobs run on GitHub-hosted compute or an isolated Vercel Sandbox runner.
        </Text>
      </Box>
      <Box
        as="span"
        flex="0 0 auto"
        px={2}
        py="2px"
        borderRadius="var(--tt-radius-pill, 999px)"
        fontSize="xs"
        fontWeight={600}
        whiteSpace="nowrap"
        bg={vercelRunnerReady ? 'var(--tt-positive-soft, rgba(88, 202, 112, 0.14))' : 'rgba(255, 188, 72, 0.18)'}
        color={vercelRunnerReady ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-warning, #ffbc48)'}
      >
        {vercelRunnerReady ? 'Vercel runner ready' : 'Vercel runner needs setup'}
      </Box>
    </Flex>
    {!vercelRunnerReady && (
      <Text px={4} pb={3} mt={-1} fontSize="xs" color="var(--tt-text, #5a5a66)" overflowWrap="anywhere">
        Setup needed: {vercelRunnerMissing.join(', ') || 'server-side Vercel provider configuration'}.
        {' '}GitHub-hosted Actions remains active until every dependency is ready.
      </Text>
    )}
    <Stack spacing={0} borderTop="1px solid var(--tt-border, #ececef)">
      {policies.map((policy) => {
        const saving = savingWorkflow === policy.key;
        const provider = policy.executionProvider;
        return (
          <Grid
            key={policy.key}
            templateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(220px, 1fr) minmax(230px, .8fr) auto' }}
            gap={3}
            alignItems="center"
            px={4}
            py={3}
            borderTop="1px solid var(--tt-border-light, #f0f0f2)"
            _first={{ borderTop: 0 }}
            opacity={policy.enabled ? 1 : 0.58}
          >
            <Box minW={0}>
              <Text fontSize="sm" fontWeight="650" color="var(--tt-ink, #16161a)">{policy.title}</Text>
              <Text mt="2px" fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={2}>{policy.summary}</Text>
            </Box>
            <Select
              size="sm"
              value={provider}
              isDisabled={saving || !policy.enabled}
              onChange={(event) => onChange(policy.key, event.target.value as CiExecutionProvider, policy.enabled)}
              aria-label={`${policy.title} execution provider`}
            >
              <option value="github-actions">GitHub Actions hosted</option>
              <option value="vercel-sandbox" disabled={!policy.vercelSupported || !vercelRunnerReady}>
                Vercel Workflow + Sandbox{!policy.vercelSupported ? ' (unsupported)' : !vercelRunnerReady ? ' (setup needed)' : ''}
              </option>
            </Select>
            <Flex align="center" justify={{ base: 'space-between', md: 'flex-end' }} gap={2} minW="116px">
              <Flex align="center" gap={1.5} fontSize="xs" color="var(--tt-muted, #9a9aa6)">
                {provider === 'vercel-sandbox' ? <FiCloud /> : <FiGithub />}
                <Text>{provider === 'vercel-sandbox' ? 'Vercel' : 'GitHub'}</Text>
              </Flex>
              <Switch
                size="sm"
                isChecked={policy.enabled}
                isDisabled={saving}
                onChange={(event) => onChange(policy.key, provider, event.target.checked)}
                aria-label={`${policy.enabled ? 'Disable' : 'Enable'} ${policy.title}`}
              />
            </Flex>
          </Grid>
        );
      })}
    </Stack>
  </Box>
);

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
  const [savingWorkflow, setSavingWorkflow] = React.useState<CiWorkflowKey | null>(null);

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
  const policies = dashboard?.automations ?? [];
  const awaitingInitialReconcile = Boolean(
    dashboard && dashboard.features.length === 0 && integration?.githubAppConfigured
  );
  const setupRequired = Boolean(
    dashboard && dashboard.features.length === 0 && !integration?.githubAppConfigured
  );
  const selectedDispatchPolicy = policies.find((policy) => policy.key === dispatchWorkflow) ?? null;
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
        description:
          selectedDispatchPolicy?.executionProvider === 'vercel-sandbox'
            ? 'Vercel Workflow is provisioning an isolated runner for the protected GitHub workflow. Status will update here automatically.'
            : 'GitHub accepted the trusted dispatch. Status will update here as webhook events arrive.',
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

  const updateAutomation = async (
    workflow: CiWorkflowKey,
    executionProvider: CiExecutionProvider,
    enabled: boolean
  ) => {
    if (savingWorkflow) return;
    setSavingWorkflow(workflow);
    try {
      const result = await apiRef.current.v1.admin.setCiAutomationPolicy({ workflow, executionProvider, enabled });
      if (!result?.ok) throw new Error('Automation policy rejected');
      await load();
      lopu({
        title: `${WORKFLOW_LABELS[workflow]} updated ✨`,
        description: enabled
          ? `New runs will use ${executionProvider === 'vercel-sandbox' ? 'Vercel Workflow + Sandbox' : 'GitHub-hosted Actions'}.`
          : 'Automatic and manual dispatches are disabled until you turn this automation back on.',
        status: 'success',
        duration: 6000
      });
    } catch {
      lopu({
        title: 'The execution provider was not changed',
        description: 'The previous automation policy is still active. Check the GitHub App and Vercel runner setup, then try again.',
        status: 'error'
      });
    } finally {
      setSavingWorkflow(null);
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
        <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">Loading CI control data…</Text>
      </Flex>
    );
  }

  return (
    <Box>
      <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', md: 'row' }} mb={5}>
        <Box>
          <Heading size="md" color="var(--tt-ink, #16161a)">CI Control</Heading>
          <Text mt={1} fontSize="sm" color="var(--tt-text, #5a5a66)">
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
            leftIcon={<FiPlay />}
            onClick={() => openDispatch('promote-features', null)}
            isDisabled={!integration?.githubAppConfigured}
          >
            Dispatch…
          </Button>
        </Flex>
      </Flex>

      {loadFailed ? (
        <Alert status="warning" mb={4} borderRadius="var(--tt-radius-md, 12px)" fontSize="sm">
          <AlertIcon />
          Live refresh failed. Last-known cached state remains visible and will retry automatically.
        </Alert>
      ) : null}

      {setupRequired || awaitingInitialReconcile ? (
        <Alert status={setupRequired ? 'warning' : 'info'} mb={4} borderRadius="var(--tt-radius-md, 12px)" alignItems="flex-start">
          <AlertIcon mt="2px" />
          <Box>
            <Text fontSize="sm" fontWeight="650">
              {setupRequired ? 'Connect GitHub to populate CI Control' : 'Run the first GitHub reconciliation'}
            </Text>
            <Text mt={1} fontSize="xs" opacity={0.72}>
              {setupRequired
                ? 'Configure and install the Thingtime GitHub App, add the signed webhooks, then return here and run Reconcile once.'
                : 'The integration is ready, but no repository state has been imported yet. Click Reconcile to load existing branches, pull requests, Actions runs, deployments, and previews; webhooks will keep them current afterward.'}
            </Text>
          </Box>
        </Alert>
      ) : null}

      <Flex
        {...CARD_STYLES}
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
            <Text
              fontFamily={MONO}
              fontSize="10px"
              fontWeight={600}
              textTransform="uppercase"
              letterSpacing="0.06em"
              color="var(--tt-muted, #9a9aa6)"
            >
              {label}
            </Text>
            <Text fontSize="xl" fontWeight="700" color="var(--tt-ink, #16161a)">{value}</Text>
          </Box>
        ))}
        <Box ml={{ base: 0, md: 'auto' }} minW="190px">
          <Flex gap={2.5} rowGap={1} wrap="wrap" justify={{ base: 'flex-start', md: 'flex-end' }}>
            {[
              ['GitHub App', Boolean(integration?.githubAppConfigured)] as const,
              ['GitHub webhook', Boolean(integration?.githubWebhookConfigured)] as const,
              ['Vercel webhook', Boolean(integration?.vercelWebhookConfigured)] as const,
              ['Provider router', Boolean(integration?.providerRouterConfigured)] as const,
              ['Vercel runner', Boolean(integration?.vercelRunnerReady)] as const
            ].map(([label, ready]) => (
              <Flex key={label} align="center" gap={1.5}>
                <Box
                  width="7px"
                  height="7px"
                  borderRadius="full"
                  flexShrink={0}
                  bg={ready ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-faint, #b6b6c0)'}
                />
                <Text
                  fontFamily={MONO}
                  fontSize="10px"
                  fontWeight={600}
                  letterSpacing="0.06em"
                  textTransform="uppercase"
                  color="var(--tt-muted, #9a9aa6)"
                  whiteSpace="nowrap"
                >
                  {label}
                </Text>
              </Flex>
            ))}
          </Flex>
          <Text textAlign={{ base: 'left', md: 'right' }} mt={1} fontSize="xs" color="var(--tt-muted, #9a9aa6)">
            Last event {relativeTime(dashboard?.freshness.latestEventAt)}
          </Text>
        </Box>
      </Flex>

      <AutomationProviders
        policies={policies}
        vercelRunnerReady={Boolean(integration?.vercelRunnerReady)}
        vercelRunnerMissing={integration?.vercelRunnerMissing ?? []}
        savingWorkflow={savingWorkflow}
        onChange={updateAutomation}
      />

      <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1.65fr) minmax(320px, 0.85fr)' }} gap={4}>
        <Box {...CARD_STYLES} overflow="hidden">
          <Flex p={3} gap={2} borderBottom="1px solid var(--tt-border, #ececef)" direction={{ base: 'column', sm: 'row' }}>
            <Flex align="center" gap={2} flex="1" border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-sm, 9px)" px={3}>
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
            fontFamily={MONO}
            fontSize="10px"
            fontWeight={600}
            textTransform="uppercase"
            letterSpacing="0.06em"
            color="var(--tt-muted, #9a9aa6)"
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
                  borderTop="1px solid var(--tt-border-light, #f0f0f2)"
                  bg={selected ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                  _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
                  _focusVisible={{ outline: '2px solid var(--tt-accent, hotpink)', outlineOffset: '-2px' }}
                  onClick={() => selectFeature(feature)}
                  aria-pressed={selected}
                >
                  <Box minW={0}>
                    <Flex align="center" gap={2} minW={0}>
                      {pr?.number ? (
                        <Text
                          as="span"
                          fontFamily={MONO}
                          fontSize="xs"
                          px={1.5}
                          borderRadius="var(--tt-radius-xs, 7px)"
                          bg="var(--tt-accent-tint, #fff5fa)"
                          color="var(--tt-accent, hotpink)"
                          flexShrink={0}
                        >
                          #{String(pr.number)}
                        </Text>
                      ) : null}
                      <Text fontSize="sm" fontWeight="650" noOfLines={1} color="var(--tt-ink, #16161a)">{feature.title || pr?.title || 'Untitled feature'}</Text>
                    </Flex>
                    <Text display={{ base: 'block', md: 'none' }} mt={1} fontFamily={MONO} fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>
                      {String(pr?.headRef ?? feature.externalId ?? 'No branch linked')}
                    </Text>
                  </Box>
                  <Text display={{ base: 'none', md: 'block' }} fontFamily={MONO} fontSize="xs" color="var(--tt-muted, #9a9aa6)" noOfLines={1}>{String(pr?.headRef ?? '—')}</Text>
                  <Box><StatusBadge status={pr?.status ?? feature.status} /></Box>
                  <Text display={{ base: 'none', md: 'block' }} fontSize="xs" color="var(--tt-muted, #9a9aa6)">{relativeTime(entityTime(pr ?? feature))}</Text>
                </Grid>
              );
            })}
            {!features.length ? (
              <Box p={8} textAlign="center">
                <FiGitBranch style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
                  {dashboard?.features.length
                    ? 'No features match this search or status filter.'
                    : setupRequired
                      ? 'Repository data will appear here after GitHub setup and the first Reconcile.'
                      : 'Repository data will appear here after the first Reconcile.'}
                </Text>
              </Box>
            ) : null}
          </Box>
        </Box>

        <Box
          display={{ base: 'none', lg: 'block' }}
          {...CARD_STYLES}
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
          borderTopRadius="var(--tt-radius-xl, 20px)"
          bg="var(--tt-card, #ffffff)"
          color="var(--tt-ink, #16161a)"
        >
          <DrawerCloseButton />
          <DrawerHeader borderBottom="1px solid var(--tt-border, #ececef)" fontSize="sm">Feature details</DrawerHeader>
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
        executionProvider={selectedDispatchPolicy?.executionProvider ?? 'github-actions'}
        onSubmit={submitDispatch}
      />
    </Box>
  );
};
