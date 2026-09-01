import React from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
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
	Menu,
	MenuButton,
	MenuDivider,
	MenuItem,
	MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
	Progress,
  Select,
  Spinner,
  Switch,
  Stack,
  Text,
  useDisclosure,
  useMediaQuery
} from '@chakra-ui/react';
import {
	FiActivity,
	FiChevronDown,
	FiChevronUp,
	FiClock,
	FiCloud,
	FiEdit3,
	FiExternalLink,
	FiGitBranch,
	FiGithub,
	FiLayers,
	FiPauseCircle,
	FiPlay,
	FiPlus,
	FiRefreshCw,
	FiRotateCcw,
	FiSave,
	FiSearch,
	FiStopCircle,
	FiTrash2,
	FiX
} from 'react-icons/fi';

import { useLopu } from '~/components/Lopu/useLopu';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { resolveFeatureStackSources, sameNumberOrder } from './featureStackDraftCore';
import { featureStackRunOutcome, latestFeatureStackHeartbeat, legacyFeatureStackWorkflowRunId, sortFeatureStackTimeline } from './featureStackRunCore';
import {
	CI_DASHBOARD_LIVE_POLL_INTERVAL_MS,
	CI_DASHBOARD_POLL_INTERVAL_MS,
	CiDashboardSingleFlight,
	ciDashboardRetryDelayMs,
	shouldPollCiDashboard
} from './dashboardPollingCore';
import { featureStackTargetsForSource } from '~/api/utils/ciControl/featureStackRoutingCore';
import {
	featureStackCanPause,
	featureStackCanRestart,
	featureStackCanStop,
	type FeatureStackLifecycleAction
} from '~/api/utils/ciControl/featureStackLifecycleCore';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { ClaudeCredentialWaterfall } from './ClaudeCredentialWaterfall';
import {
	ALL_PULL_REQUEST_STATUS_FILTER_IDS,
	matchesPullRequestStatusFilter,
	normalizePullRequestStatus,
	PULL_REQUEST_STATUS_FILTERS
} from './statusFilterCore';

import type {
  CiAutomationPolicy,
  CiControlResponse,
  CiEntity,
  CiEvent,
  CiExecutionProvider,
  CiPreviewPolicy,
  CiWorkflowKey
} from './types';

const ACTIVE_STATUSES = new Set(['queued', 'requested', 'waiting', 'in_progress', 'pending']);
const CONFLICT_STATUSES = new Set(['conflicting', 'dirty', 'blocked', 'failure', 'failed']);
const READY_STATUSES = new Set(['clean', 'ready', 'success', 'succeeded', 'completed', 'merged']);

const normalizedStatus = normalizePullRequestStatus;

const statusColor = (status: unknown) => {
  const normalized = normalizedStatus(status);
  if (CONFLICT_STATUSES.has(normalized)) return 'red';
  if (ACTIVE_STATUSES.has(normalized)) return 'blue';
  if (READY_STATUSES.has(normalized)) return 'green';
  if (normalized === 'draft' || normalized === 'cancelled' || normalized === 'skipped' || normalized === 'needs-attention') return 'orange';
  return 'gray';
};

const StatusBadge = ({ status }: { status: unknown }) => (
  <Badge colorScheme={statusColor(status)} borderRadius="999px" px={2} py="2px" textTransform="none">
    {String(status || 'unknown').replace(/_/g, ' ')}
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

const entityTime = (entity: CiEntity | null | undefined) => entity?.sourceUpdatedAt ?? entity?.updatedAt ?? entity?.createdAt ?? null;

const matchesEntity = (entity: CiEntity, pr: CiEntity | null) => {
  if (!pr) return false;
  const headRef = String(pr.headRef ?? '');
  const headSha = String(pr.headSha ?? '');
	return (headRef && String(entity.headRef ?? entity.ref ?? '') === headRef) || (headSha && String(entity.headSha ?? entity.sha ?? '') === headSha);
};

const selectPrimaryPr = (feature: CiEntity | null, pullRequests: CiEntity[]) => {
  if (!feature) return null;
  const related = pullRequests.filter((pr) => pr.parentId === feature.id);
	return (
		related.sort((left, right) => {
    const leftPromotion = left.sourcePrNumber ? 1 : 0;
    const rightPromotion = right.sourcePrNumber ? 1 : 0;
    return rightPromotion - leftPromotion || Number(right.number ?? 0) - Number(left.number ?? 0);
		})[0] ?? null
	);
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
  previewPolicy: CiPreviewPolicy | null;
  previewBuilderMissing: string[];
  savingPreviewEnvironment: 'develop' | 'production' | null;
  canDispatch: boolean;
  onDispatch: (workflow: CiWorkflowKey, pr?: CiEntity | null) => void;
  onTogglePreview: (environment: 'develop' | 'production', enabled: boolean) => void;
};

const FeatureDetail = ({
  feature,
  pr,
  runs,
  previews,
  events,
  previewPolicy,
  previewBuilderMissing,
  savingPreviewEnvironment,
  canDispatch,
  onDispatch,
  onTogglePreview
}: DetailProps) => {
  if (!feature) return <EmptyLine>Select a feature to inspect its topology and status history.</EmptyLine>;
  const headRef = String(pr?.headRef ?? '—');
  const baseRef = String(pr?.baseRef ?? '—');
  const previewFor = (environment: 'develop' | 'production') =>
    previews.find((preview) => String(preview.previewEnvironment ?? '') === environment) ?? null;
  const preview = previews[0] ?? null;
  const productionBuilderReady = previewBuilderMissing.every((name) => name === 'VERCEL_CUSTOM_ENVIRONMENT_ID');
  const developBuilderReady = previewBuilderMissing.length === 0;
  const previewEnableAllowed = Boolean(pr && !['draft', 'merged', 'closed'].includes(normalizedStatus(pr.status)));

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

      <DetailSection label="Opt-in preview environments">
        {pr ? (
          <Stack spacing={2}>
            {(['develop', 'production'] as const).map((environment) => {
              const enabled = previewPolicy?.[environment] === true;
              const environmentPreview = previewFor(environment);
              const ready = environment === 'develop' ? developBuilderReady : productionBuilderReady;
              const label = environment === 'develop' ? 'Develop environment' : 'Production / main environment';
              return (
                <Box
                  key={environment}
                  border="1px solid"
                  borderColor={environment === 'production' && enabled ? 'orange.300' : 'var(--tt-border, #e7e7eb)'}
                  borderRadius="10px"
                  p={3}
                  bg={environment === 'production' && enabled ? 'orange.50' : 'transparent'}
                >
                  <Flex align="flex-start" justify="space-between" gap={3}>
                    <Box minW={0}>
                      <Text fontSize="sm" fontWeight="700">
                        {label}
                      </Text>
                      <Text fontSize="xs" opacity={0.58} mt={1}>
                        {environment === 'develop'
                          ? 'Builds this exact PR SHA with the develop Custom Environment.'
                          : 'Uses production values for this trusted PR, but never assigns the production domain.'}
                      </Text>
                    </Box>
                    <Switch
                      colorScheme={environment === 'production' ? 'orange' : 'green'}
                      isChecked={enabled}
                      isDisabled={savingPreviewEnvironment !== null || (!enabled && (!ready || !previewEnableAllowed))}
                      onChange={(event) => onTogglePreview(environment, event.target.checked)}
                      aria-label={`${enabled ? 'Disable' : 'Enable'} ${label} preview`}
                    />
                  </Flex>
                  <Flex align="center" gap={2} wrap="wrap" mt={2}>
                    {savingPreviewEnvironment === environment ? <Spinner size="xs" /> : null}
                    {environmentPreview ? <StatusBadge status={environmentPreview.status} /> : null}
                    {environmentPreview?.url ? (
                      <Link href={String(environmentPreview.url)} isExternal fontSize="xs" fontWeight="700">
                        Open {environment} preview <FiExternalLink style={{ display: 'inline' }} />
                      </Link>
                    ) : enabled ? (
                      <Text fontSize="xs" opacity={0.58}>Build queued; signed Vercel updates appear here.</Text>
                    ) : !ready ? (
                      <Text fontSize="xs" color="orange.600">Preview builder setup is incomplete.</Text>
                    ) : null}
                  </Flex>
                </Box>
              );
            })}
            <Text fontSize="xs" opacity={0.5}>
              Both environments can be enabled together. New PR commits rebuild every enabled environment at the exact new SHA.
            </Text>
          </Stack>
        ) : (
          <EmptyLine>Select a pull request to configure previews.</EmptyLine>
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
										<Text fontWeight="600" noOfLines={1}>
											{run.title || 'Workflow run'}
										</Text>
                  )}
									<Text fontSize="xs" opacity={0.5}>
										{relativeTime(entityTime(run))}
									</Text>
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
  'feature-stack': 'Merge Feature Stack',
  'resolve-conflicts': 'Resolve PR conflicts',
  'rebase-stack': 'Rebase PR or stack',
  'promote-features': 'Promote features to main',
  'promote-develop': 'Refresh develop → main PR',
  'sync-main': 'Sync main into develop',
  'web-ci': 'Run web CI',
  'electron-release': 'Build Electron release'
};

const defaultWorkflowRef = (workflow: CiWorkflowKey) => (workflow === 'electron-release' || workflow === 'sync-main' ? 'main' : 'develop');

type DispatchModalProps = {
  isOpen: boolean;
  onClose: () => void;
  initialWorkflow: CiWorkflowKey;
  initialPr: CiEntity | null;
  isSubmitting: boolean;
  executionProvider: CiExecutionProvider;
  onSubmit: (workflow: CiWorkflowKey, ref: string, inputs: Record<string, unknown>) => Promise<void>;
};

const DispatchModal = ({ isOpen, onClose, initialWorkflow, initialPr, isSubmitting, executionProvider, onSubmit }: DispatchModalProps) => {
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
								{(Object.keys(WORKFLOW_LABELS) as CiWorkflowKey[])
									.filter((key) => key !== 'feature-stack')
									.map((key) => (
										<option key={key} value={key}>
											{WORKFLOW_LABELS[key]}
										</option>
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
								<Text fontSize="sm">I understand this may update a branch with force-with-lease or create a release artifact.</Text>
              </Checkbox>
            ) : null}
          </Stack>
        </ModalBody>
        <ModalFooter gap={2}>
					<Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>
						Cancel
					</Button>
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

type FeatureStackDraft = {
	id: string | null;
  name: string;
  selectedFeatureIds: string[];
	pendingSourcePrNumbers?: number[];
  targets: string[];
	autoDecideBranches: boolean;
};

type SavedFeatureStack = {
	id: string;
	name: string;
	sourcePrNumbers: number[];
	targets: string[];
	autoDecideBranches: boolean;
	status: string;
	lastDispatchId: string | null;
	lastRunAt: string | null;
	runs: SavedFeatureStackRun[];
	createdAt: string;
	updatedAt: string;
};

type SavedFeatureStackRun = {
	id: string;
	runId: string | null;
	status: string;
	title: string;
	url: string | null;
	workflowRunId: number | null;
	startedAt: string;
	completedAt: string | null;
	linkCheckedAt?: string | null;
};

type FeatureStackTargetProgress = {
	target: string;
	status: string;
	url?: string | null;
	updatedAt?: string | null;
};

type FeatureStackLiveLine = {
	key: string;
	at: string | null;
	message: string;
	url?: string | null;
};

type FeatureStackLiveSnapshot = {
	live: boolean;
	needsAttention: boolean;
	state: string;
	percent: number;
	summary: string;
	finishLabel: string;
	timeZone: string;
	lines: FeatureStackLiveLine[];
	runs: SavedFeatureStackRun[];
};

type FeatureStackComposerProps = {
  name: string;
  selected: { feature: CiEntity; pr: CiEntity }[];
	pendingSourcePrNumbers: number[];
  targets: string[];
  branchOptions: string[];
	autoDecideBranches: boolean;
	activeStackId: string | null;
	savedStacks: SavedFeatureStack[];
	progressByStack: Map<string, FeatureStackTargetProgress[]>;
	liveSnapshot: FeatureStackLiveSnapshot | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isSubmitting: boolean;
	isSaving: boolean;
	lifecycleBusy: { id: string; action: FeatureStackLifecycleAction } | null;
  canDispatch: boolean;
  onNameChange: (value: string) => void;
  onRemove: (featureId: string) => void;
  onAddTarget: (target: string) => void;
  onRemoveTarget: (target: string) => void;
	onAutoDecideChange: (value: boolean) => void;
	onNew: () => void;
	onLoad: (stack: SavedFeatureStack) => void;
	onSave: () => void;
	onDelete: (id: string) => void;
	onLifecycle: (stack: SavedFeatureStack, action: FeatureStackLifecycleAction) => void;
  onSubmit: () => void;
};

const FeatureStackComposer = ({
  name,
  selected,
	pendingSourcePrNumbers,
  targets,
  branchOptions,
	autoDecideBranches,
	activeStackId,
	savedStacks,
	progressByStack,
	liveSnapshot,
  collapsed,
  onToggleCollapsed,
  isSubmitting,
	isSaving,
	lifecycleBusy,
  canDispatch,
  onNameChange,
  onRemove,
  onAddTarget,
  onRemoveTarget,
	onAutoDecideChange,
	onNew,
	onLoad,
	onSave,
	onDelete,
	onLifecycle,
  onSubmit
}: FeatureStackComposerProps) => {
  const availableTargets = branchOptions.filter((branch) => !targets.includes(branch));
	const selectedCount = selected.length + pendingSourcePrNumbers.length;
	const ready = selected.length >= 1 && targets.length >= 1 && name.trim().length > 0;
	const activeSavedStack = savedStacks.find((stack) => stack.id === activeStackId) ?? null;
	const requiresRestart = activeSavedStack ? ['paused', 'stopped'].includes(activeSavedStack.status.toLowerCase()) : false;
  return (
		<Box border="1px solid var(--tt-border, #e7e7eb)" borderRadius="var(--tt-radius-md, 12px)" bg="var(--tt-card, #fff)" mb={4} overflow="hidden">
      <Flex px={4} py={3} align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', md: 'row' }}>
        <Button
          variant="unstyled"
          height="auto"
          textAlign="left"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="feature-stack-section"
        >
          <Flex align="center" gap={2}>
            <FiLayers />
            <Heading size="sm">Feature Stack</Heading>
						<Badge colorScheme={selectedCount >= 1 ? 'purple' : 'gray'}>{selectedCount} selected</Badge>
          </Flex>
          <Text mt={1} fontSize="xs" opacity={0.6}>
						{autoDecideBranches
							? 'Select feature PRs below in merge order, then route them into each compatible chosen target in one verified Lopu batch.'
							: 'Select feature PRs below in merge order, then combine them into every chosen target in one verified Lopu batch.'}
          </Text>
        </Button>
				<Flex gap={2} wrap="wrap">
					<IconButton
						aria-label={collapsed ? 'Expand Feature Stack' : 'Collapse Feature Stack'}
						aria-expanded={!collapsed}
						aria-controls="feature-stack-section"
						icon={collapsed ? <FiChevronDown /> : <FiChevronUp />}
						size="sm"
						variant="ghost"
						onClick={onToggleCollapsed}
					/>
					<Button size="sm" variant="outline" leftIcon={<FiPlus />} onClick={onNew} isDisabled={isSubmitting || isSaving}>
						New
					</Button>
					<Button size="sm" variant="outline" leftIcon={<FiSave />} onClick={onSave} isLoading={isSaving} isDisabled={!ready || isSubmitting}>
						Save
					</Button>
					{activeStackId ? (
						<IconButton
							aria-label="Archive saved Feature Stack"
							size="sm"
							variant="ghost"
							colorScheme="red"
							icon={<FiTrash2 />}
							onClick={() => onDelete(activeStackId)}
							isDisabled={isSubmitting || isSaving}
						/>
					) : null}
        <Button
          size="sm"
          colorScheme="purple"
          leftIcon={<FiPlay />}
          onClick={onSubmit}
          isLoading={isSubmitting}
						isDisabled={!canDispatch || !ready || isSaving || requiresRestart}
						title={requiresRestart ? 'Use Restart to begin a fresh run for this paused or stopped stack' : undefined}
          flex="0 0 auto"
        >
						Save &amp; merge
					</Button>
				</Flex>
			</Flex>
			<Collapse in={!collapsed} animateOpacity>
			<Box id="feature-stack-section">
			{savedStacks.length ? (
				<Box px={4} py={3} borderTop="1px solid var(--tt-border, #e7e7eb)" bg="var(--tt-surface-alt, #fafafa)">
					<Text fontSize="10px" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" opacity={0.5} mb={2}>
						Saved stacks
					</Text>
					<Flex gap={2} wrap="wrap" align="stretch">
						{savedStacks.map((stack) => {
							const progress = progressByStack.get(stack.id) ?? [];
							const busy = lifecycleBusy?.id === stack.id;
							const lifecycleOverridesTarget = ['paused', 'stopped'].includes(stack.status.toLowerCase());
							return (
								<Box
									key={stack.id}
									border="1px solid"
									borderColor={activeStackId === stack.id ? 'purple.400' : 'var(--tt-border, #e7e7eb)'}
									borderRadius="md"
									bg={activeStackId === stack.id ? 'purple.50' : 'var(--tt-card, #fff)'}
									minW={{ base: '100%', md: '260px' }}
								>
									<Button
										variant="unstyled"
										height="auto"
										width="100%"
										px={3}
										pt={2.5}
										pb={2}
										textAlign="left"
										onClick={() => onLoad(stack)}
										leftIcon={<FiEdit3 />}
									>
										<Box minW={0}>
											<Text fontSize="xs" fontWeight="700" noOfLines={1}>{stack.name}</Text>
										<Flex gap={1} mt={1} wrap="wrap">
											{stack.targets.map((target) => {
												const targetProgress = progress.find((item) => item.target === target);
												return (
												<Badge
													key={target}
													colorScheme={statusColor(lifecycleOverridesTarget ? stack.status : targetProgress?.status ?? stack.status)}
													textTransform="none"
												>
													{target}: {lifecycleOverridesTarget ? stack.status : targetProgress?.status ?? stack.status}
													</Badge>
												);
											})}
										</Flex>
										</Box>
									</Button>
									<Flex borderTop="1px solid var(--tt-border, #e7e7eb)" px={2} py={1.5} gap={1} justify="flex-end">
										<IconButton
											aria-label={`Pause ${stack.name}`}
											title="Pause: cancel current compute and preserve this stack for Restart"
											icon={<FiPauseCircle />}
											size="xs"
											variant="ghost"
											isLoading={busy && lifecycleBusy?.action === 'pause'}
											isDisabled={busy || !featureStackCanPause(stack.status)}
											onClick={() => onLifecycle(stack, 'pause')}
										/>
										<IconButton
											aria-label={`Stop ${stack.name}`}
											title="Stop: cancel current compute and keep the saved definition and history"
											icon={<FiStopCircle />}
											size="xs"
											variant="ghost"
											colorScheme="red"
											isLoading={busy && lifecycleBusy?.action === 'stop'}
											isDisabled={busy || !featureStackCanStop(stack.status)}
											onClick={() => onLifecycle(stack, 'stop')}
										/>
										<IconButton
											aria-label={`Restart ${stack.name}`}
											title="Restart: cancel any active compute and begin a fresh immutable run"
											icon={<FiRotateCcw />}
											size="xs"
											variant="ghost"
											colorScheme="purple"
											isLoading={busy && lifecycleBusy?.action === 'restart'}
											isDisabled={busy || !featureStackCanRestart(stack.status)}
											onClick={() => onLifecycle(stack, 'restart')}
										/>
									</Flex>
								</Box>
							);
						})}
      </Flex>
				</Box>
			) : null}
      <Grid
        templateColumns={{ base: '1fr', lg: 'minmax(210px, .65fr) minmax(0, 1.35fr) minmax(210px, .8fr)' }}
        gap={4}
        px={4}
        py={4}
        borderTop="1px solid var(--tt-border, #e7e7eb)"
      >
        <FormControl>
          <FormLabel fontSize="xs">Stack name</FormLabel>
					<Input size="sm" value={name} maxLength={80} onChange={(event) => onNameChange(event.target.value)} placeholder="Search + Messenger" />
        </FormControl>
        <FormControl>
          <FormLabel fontSize="xs">Ordered feature list</FormLabel>
					<Box
						height={{ base: '220px', lg: '280px' }}
						overflowY="auto"
						overscrollBehavior="contain"
						pr={1}
						aria-label="Ordered Feature Stack pull requests"
					>
						<Stack spacing={1.5} minH="100%">
            {selected.map(({ feature, pr }, index) => (
              <Flex key={feature.id} align="center" gap={2} minW={0}>
								<Badge borderRadius="999px" minW="22px" textAlign="center">
									{index + 1}
								</Badge>
                <Text fontSize="xs" fontWeight="600" noOfLines={1} flex="1">
                  #{String(pr.number)} {String(feature.title ?? pr.title ?? pr.headRef ?? '')}
                </Text>
                <IconButton
                  aria-label={`Remove PR #${String(pr.number)} from Feature Stack`}
                  icon={<FiX />}
                  size="xs"
                  variant="ghost"
                  onClick={() => onRemove(feature.id)}
                />
              </Flex>
            ))}
						{pendingSourcePrNumbers.map((prNumber, index) => (
							<Flex key={`pending-pr-${prNumber}`} align="center" gap={2} minW={0} opacity={0.68}>
								<Badge borderRadius="999px" minW="22px" textAlign="center">
									{selected.length + index + 1}
								</Badge>
								<Text fontSize="xs" fontWeight="600" noOfLines={1} flex="1">
									#{prNumber} · restoring from the live repository snapshot…
								</Text>
							</Flex>
						))}
						{selectedCount === 0 ? <EmptyLine>Use the checkboxes below to add one or more features.</EmptyLine> : null}
          </Stack>
					</Box>
        </FormControl>
        <FormControl>
          <FormLabel fontSize="xs">Target branches</FormLabel>
          <Select
            size="sm"
            value=""
            icon={<FiPlus />}
            onChange={(event) => event.target.value && onAddTarget(event.target.value)}
						isDisabled={availableTargets.length === 0}
          >
            <option value="">Add target…</option>
						{availableTargets.map((branch) => (
							<option key={branch} value={branch}>
								{branch}
							</option>
						))}
          </Select>
          <Flex mt={2} gap={1.5} wrap="wrap">
            {targets.map((target) => (
              <Button key={target} size="xs" variant="outline" rightIcon={<FiX />} onClick={() => onRemoveTarget(target)}>
                {target}
              </Button>
            ))}
          </Flex>
        </FormControl>
      </Grid>
			{liveSnapshot ? (
				<Box px={4} py={4} borderTop="1px solid var(--tt-border, #e7e7eb)" bg="var(--tt-surface-alt, #fafafa)">
					<Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={2} direction={{ base: 'column', md: 'row' }}>
						<Flex align="center" gap={2}>
							<FiActivity />
							<Heading size="xs">Live merge stream</Heading>
							<Badge colorScheme={liveSnapshot.needsAttention ? 'orange' : liveSnapshot.live ? 'green' : 'gray'}>
								{liveSnapshot.live ? 'Live' : liveSnapshot.needsAttention ? 'Needs attention' : 'Latest run'}
							</Badge>
						</Flex>
						<Flex align="center" gap={1.5} fontSize="xs" opacity={0.68}>
							<FiClock />
							<Text>
								{liveSnapshot.finishLabel} · {liveSnapshot.timeZone}
							</Text>
						</Flex>
					</Flex>
					<Text fontSize="xs" mt={2} opacity={0.68}>
						{liveSnapshot.summary}
					</Text>
					<Progress
						value={liveSnapshot.percent}
						size="sm"
						colorScheme="purple"
						borderRadius="999px"
						mt={3}
						aria-label={`${liveSnapshot.percent}% complete`}
					/>
					<Box
						role="log"
						aria-live="polite"
						mt={3}
						maxH="240px"
						overflowY="auto"
						overscrollBehavior="contain"
						bg="#0b0d12"
						color="#e7eaf0"
						borderRadius="md"
						px={3}
						py={2.5}
						fontFamily="mono"
						fontSize="11px"
					>
						<Stack spacing={1.5}>
							{liveSnapshot.lines.map((line) => (
								<Flex key={line.key} gap={2} align="baseline">
									<Text color="#8b93a7" flex="0 0 auto">
										{line.at ? formatTime(line.at) : '—'}
									</Text>
									{line.url ? (
										<Link href={line.url} isExternal color="#b9a7ff">
											{line.message}
										</Link>
									) : (
										<Text>{line.message}</Text>
									)}
								</Flex>
							))}
						</Stack>
					</Box>
					<Box mt={4} pt={4} borderTop="1px solid var(--tt-border, #e7e7eb)">
						<Flex align="center" gap={2} mb={2}>
							<FiGithub />
							<Heading size="xs">Stack run status</Heading>
							<StatusBadge status={liveSnapshot.state} />
						</Flex>
						{liveSnapshot.needsAttention ? (
							<Alert status="warning" borderRadius="md" py={2} mb={3} fontSize="xs">
								<AlertIcon />
								The controller finished before any target branch PR was published. Open the GitHub run for its job-level result, then run this saved stack again after the workflow fix is deployed.
							</Alert>
						) : null}
						<Stack spacing={2}>
							{liveSnapshot.runs.map((run, index) => (
								<Flex
									key={run.id}
									align={{ base: 'flex-start', md: 'center' }}
									justify="space-between"
									gap={2}
									direction={{ base: 'column', md: 'row' }}
									px={3}
									py={2}
									border="1px solid var(--tt-border, #e7e7eb)"
									borderRadius="md"
									bg="var(--tt-card, #fff)"
								>
									<Box minW={0}>
										<Flex align="center" gap={2} wrap="wrap">
											<Text fontSize="xs" fontWeight="700">{index === 0 ? 'Current run' : `Historical run ${index + 1}`}</Text>
											<StatusBadge status={run.status} />
										</Flex>
										<Text fontSize="xs" opacity={0.62} noOfLines={1} mt={1}>
											{formatTime(run.startedAt)}{run.completedAt ? ` · finished ${formatTime(run.completedAt)}` : ''}
										</Text>
									</Box>
									{run.url ? (
										<Button as={Link} href={run.url} isExternal size="xs" variant="outline" rightIcon={<FiExternalLink />} flex="0 0 auto">
											Open GitHub run
										</Button>
									) : (
										<Text fontSize="xs" opacity={0.5}>GitHub link pending</Text>
									)}
								</Flex>
							))}
						</Stack>
					</Box>
				</Box>
			) : null}
      <Flex px={4} py={3} borderTop="1px solid var(--tt-border, #e7e7eb)" align="flex-start" gap={3} direction={{ base: 'column', md: 'row' }}>
				<Checkbox isChecked={autoDecideBranches} onChange={(event) => onAutoDecideChange(event.target.checked)} alignItems="flex-start">
          <Text fontSize="xs">
						<strong>Auto decide branches</strong> — route each live PR only to compatible selected targets from its base branch. Develop features may
						flow to develop and main; github-actions and main PRs stay isolated to their own branch.
          </Text>
        </Checkbox>
        <Text ml={{ base: 0, md: 'auto' }} fontSize="xs" opacity={0.54} flex="0 0 auto">
					One or more features · one or more targets
        </Text>
      </Flex>
			</Box>
			</Collapse>
    </Box>
  );
};

type AutomationProvidersProps = {
  policies: CiAutomationPolicy[];
  vercelRunnerReady: boolean;
  vercelRunnerMissing: string[];
  savingWorkflow: CiWorkflowKey | null;
  onChange: (workflow: CiWorkflowKey, executionProvider: CiExecutionProvider, enabled: boolean) => Promise<void>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const LOPU_REPOSITORY_WORKFLOWS = new Set<CiWorkflowKey>([
  'feature-stack',
  'resolve-conflicts',
  'rebase-stack',
  'promote-features',
  'promote-develop',
  'sync-main'
]);

const lopuPolicyTitle = (policy: CiAutomationPolicy): string => {
  const operation = policy.title.replace(/^Merge /, '').replace(/^Resolve /, '').replace(/^Refresh /, '').replace(/^Sync /, '');
  return policy.key === 'feature-stack' ? 'Lopu Feature Stack' : `Lopu PR manager — ${operation}`;
};

const AutomationProviders = ({
  policies,
  vercelRunnerReady,
  vercelRunnerMissing,
  savingWorkflow,
  onChange,
  collapsed,
  onToggleCollapsed
}: AutomationProvidersProps) => {
  const managerPolicies = policies.filter((policy) => LOPU_REPOSITORY_WORKFLOWS.has(policy.key));
  const supportingPolicies = policies.filter((policy) => !LOPU_REPOSITORY_WORKFLOWS.has(policy.key));

  const renderPolicy = (policy: CiAutomationPolicy) => {
    const saving = savingWorkflow === policy.key;
    const provider = policy.executionProvider;
    const title = LOPU_REPOSITORY_WORKFLOWS.has(policy.key) ? lopuPolicyTitle(policy) : policy.title;

    return (
      <Grid
        key={policy.key}
        templateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(220px, 1fr) minmax(230px, .8fr) auto' }}
        gap={3}
        alignItems="center"
        px={4}
        py={3}
        borderTop="1px solid var(--tt-border, #eeeeF1)"
        opacity={policy.enabled ? 1 : 0.58}
      >
        <Box minW={0}>
          <Text fontSize="sm" fontWeight="650">
            {title}
          </Text>
          <Text mt="2px" fontSize="xs" opacity={0.55} noOfLines={2}>
            {policy.summary}
          </Text>
        </Box>
        <Select
          size="sm"
          value={provider}
          isDisabled={saving || !policy.enabled}
          onChange={(event) => onChange(policy.key, event.target.value as CiExecutionProvider, policy.enabled)}
          aria-label={`${title} execution provider`}
        >
          <option value="github-actions">GitHub-hosted compute</option>
          <option value="vercel-sandbox" disabled={!policy.vercelSupported || !vercelRunnerReady}>
            Vercel Sandbox compute{!policy.vercelSupported ? ' (unsupported)' : !vercelRunnerReady ? ' (setup needed)' : ''}
          </option>
        </Select>
        <Flex align="center" justify={{ base: 'space-between', md: 'flex-end' }} gap={2} minW="138px">
          <Flex align="center" gap={1.5} fontSize="xs" opacity={0.6}>
            {provider === 'vercel-sandbox' ? <FiCloud /> : <FiGithub />}
            <Text>{provider === 'vercel-sandbox' ? 'Lopu · Vercel' : 'Lopu · GitHub'}</Text>
          </Flex>
          <Switch
            size="sm"
            isChecked={policy.enabled}
            isDisabled={saving}
            onChange={(event) => onChange(policy.key, provider, event.target.checked)}
            aria-label={`${policy.enabled ? 'Disable' : 'Enable'} ${title}`}
          />
        </Flex>
      </Grid>
    );
  };

  return (
	<Box border="1px solid var(--tt-border, #e7e7eb)" borderRadius="var(--tt-radius-md, 12px)" bg="var(--tt-card, #fff)" mb={4} overflow="hidden">
    <Flex
      as="button"
      type="button"
      width="100%"
      textAlign="left"
      px={4}
      py={3}
      align={{ base: 'flex-start', md: 'center' }}
      justify="space-between"
      gap={3}
      direction={{ base: 'column', md: 'row' }}
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      aria-controls="lopu-automation-compute-section"
    >
      <Box>
        <Flex align="center" gap={2} flexWrap="wrap">
          <Heading size="sm">Lopu automation compute</Heading>
          <Badge colorScheme="purple">Single manager</Badge>
        </Flex>
        <Text mt={1} fontSize="xs" opacity={0.58}>
          Repository-management events enter through the one Lopu PR manager on github-actions. These settings choose where each protected operation
          executes; they do not create separate public workflows.
        </Text>
      </Box>
      <Flex align="center" gap={2} flex="0 0 auto">
        <Badge colorScheme={vercelRunnerReady ? 'green' : 'orange'}>
          {vercelRunnerReady ? 'Vercel runner ready' : 'Vercel runner needs setup'}
        </Badge>
        {collapsed ? <FiChevronDown /> : <FiChevronUp />}
      </Flex>
    </Flex>
    <Collapse in={!collapsed} animateOpacity>
    <Box id="lopu-automation-compute-section">
    {!vercelRunnerReady && (
      <Text px={4} pb={3} mt={-1} fontSize="xs" color="orange.700" overflowWrap="anywhere">
				Setup needed: {vercelRunnerMissing.join(', ') || 'server-side Vercel provider configuration'}. GitHub-hosted Actions remains active until
				every dependency is ready.
      </Text>
    )}
    <Stack spacing={0} borderTop="1px solid var(--tt-border, #e7e7eb)">
      <Box px={4} py={2.5} bg="var(--tt-surface-alt, #fafafa)">
        <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.04em">
          One Lopu repository manager
        </Text>
        <Text fontSize="xs" opacity={0.58} mt={0.5}>
          Feature stacks, conflict repair, rebases, promotions, and branch sync are operation lanes inside the same protected manager.
        </Text>
      </Box>
      {managerPolicies.map(renderPolicy)}
      {supportingPolicies.length ? (
        <>
          <Box px={4} py={2.5} bg="var(--tt-surface-alt, #fafafa)" borderTop="1px solid var(--tt-border, #eeeeF1)">
            <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.04em">
              Supporting build pipelines
            </Text>
            <Text fontSize="xs" opacity={0.58} mt={0.5}>
              Build and release jobs stay visible here but are not competing repository managers.
            </Text>
          </Box>
          {supportingPolicies.map(renderPolicy)}
        </>
      ) : null}
    </Stack>
    </Box>
    </Collapse>
  </Box>
  );
};

export const CIControlDashboard = ({ cacheIdentity }: { cacheIdentity: string }) => {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopu = useLopu();
  const cacheKey = `tt-admin-ci-control-v1:${cacheIdentity}`;
  const stackCacheKey = `tt-admin-ci-feature-stack-v1:${cacheIdentity}`;
  const sectionCacheKey = `tt-admin-ci-collapsed-sections-v1:${cacheIdentity}`;
  const initialStackDraft = React.useMemo(
		() =>
			readLocalCache<FeatureStackDraft>(stackCacheKey) ?? {
				id: null,
      name: 'Feature Stack',
				selectedFeatureIds: [],
				pendingSourcePrNumbers: [],
				targets: ['develop', 'main'],
				autoDecideBranches: true
    },
    [stackCacheKey]
  );
  const [response, setResponse] = React.useState<CiControlResponse | null>(() => readLocalCache<CiControlResponse>(cacheKey));
  const [loading, setLoading] = React.useState(!response);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
	const [nextRetryAt, setNextRetryAt] = React.useState<number | null>(null);
	const loadSingleFlightRef = React.useRef(new CiDashboardSingleFlight());
	const loadFailureCountRef = React.useRef(0);
	const nextRetryAtRef = React.useRef(0);
  const [query, setQuery] = React.useState('');
	const [statusFilters, setStatusFilters] = React.useState<string[]>(() => [...ALL_PULL_REQUEST_STATUS_FILTER_IDS]);
  const [selectedFeatureId, setSelectedFeatureId] = React.useState<string | null>(response?.dashboard.features[0]?.id ?? null);
  const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);
  const [isMobile] = useMediaQuery('(max-width: 61.99em)', { ssr: true, fallback: false });
  const dispatchDisclosure = useDisclosure();
  const [dispatchWorkflow, setDispatchWorkflow] = React.useState<CiWorkflowKey>('resolve-conflicts');
  const [dispatchPr, setDispatchPr] = React.useState<CiEntity | null>(null);
  const [dispatching, setDispatching] = React.useState(false);
  const [featureStackDispatching, setFeatureStackDispatching] = React.useState(false);
	const [featureStackSaving, setFeatureStackSaving] = React.useState(false);
	const [featureStackLifecycleBusy, setFeatureStackLifecycleBusy] = React.useState<{
		id: string;
		action: FeatureStackLifecycleAction;
	} | null>(null);
  const [savingWorkflow, setSavingWorkflow] = React.useState<CiWorkflowKey | null>(null);
  const [savingPreviewEnvironment, setSavingPreviewEnvironment] = React.useState<'develop' | 'production' | null>(null);
	const [savedFeatureStacks, setSavedFeatureStacks] = React.useState<SavedFeatureStack[]>([]);
	const [featureStackEvents, setFeatureStackEvents] = React.useState<CiEvent[]>([]);
	const [activeFeatureStackId, setActiveFeatureStackId] = React.useState<string | null>(initialStackDraft.id ?? null);
  const [featureStackName, setFeatureStackName] = React.useState(initialStackDraft.name);
  const [featureStackIds, setFeatureStackIds] = React.useState(initialStackDraft.selectedFeatureIds);
	const [pendingFeatureStackPrNumbers, setPendingFeatureStackPrNumbers] = React.useState(
		initialStackDraft.pendingSourcePrNumbers ?? []
	);
  const [featureStackTargets, setFeatureStackTargets] = React.useState(initialStackDraft.targets);
	const [featureStackAutoDecide, setFeatureStackAutoDecide] = React.useState(initialStackDraft.autoDecideBranches !== false);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(
    () => new Set(readLocalCache<string[]>(sectionCacheKey) ?? [])
  );

  const toggleSection = React.useCallback(
    (section: string) => {
      setCollapsedSections((current) => {
        const next = new Set(current);
        if (next.has(section)) next.delete(section);
        else next.add(section);
        writeLocalCache(sectionCacheKey, [...next]);
        return next;
      });
    },
    [sectionCacheKey]
  );

  React.useEffect(() => {
    writeLocalCache(stackCacheKey, {
			id: activeFeatureStackId,
      name: featureStackName,
      selectedFeatureIds: featureStackIds,
			pendingSourcePrNumbers: pendingFeatureStackPrNumbers,
			targets: featureStackTargets,
			autoDecideBranches: featureStackAutoDecide
    } satisfies FeatureStackDraft);
	}, [
		activeFeatureStackId,
		featureStackAutoDecide,
		featureStackIds,
		featureStackName,
		featureStackTargets,
		pendingFeatureStackPrNumbers,
		stackCacheKey
	]);

	const loadSavedFeatureStacks = React.useCallback(async (options?: { signal?: AbortSignal }) => {
		const next = await apiRef.current.v1.admin.ciFeatureStacks(options);
		if (next?.ok && Array.isArray(next.stacks)) {
			setSavedFeatureStacks(next.stacks);
			setFeatureStackEvents(Array.isArray(next.events) ? next.events : []);
		}
	}, []);

	const load = React.useCallback(
		(options?: { signal?: AbortSignal; foreground?: boolean }): Promise<void> => {
			const foreground = options?.foreground === true;
			if (!shouldPollCiDashboard(Date.now(), nextRetryAtRef.current, foreground)) return Promise.resolve();
			const inFlight = loadSingleFlightRef.current.peek();
			if (inFlight) {
				if (!foreground) return inFlight;
				setRefreshing(true);
				return inFlight.finally(() => setRefreshing(false));
			}
			if (foreground) setRefreshing(true);
			return loadSingleFlightRef.current.run(async () => {
				try {
					const next = await apiRef.current.v1.admin.ciControl({ limit: 0 }, { signal: options?.signal });
					if (!next?.ok) throw new Error('CI snapshot unavailable');
					setResponse(next);
					writeLocalCache(cacheKey, next);
					loadFailureCountRef.current = 0;
					nextRetryAtRef.current = 0;
					setNextRetryAt(null);
					setLoadFailed(false);
					setSelectedFeatureId((current) =>
						current && next.dashboard.features.some((feature: CiEntity) => feature.id === current)
							? current
							: next.dashboard.features[0]?.id ?? null
					);
				} catch (error) {
					if (error instanceof Error && error.name === 'AbortError') return;
					loadFailureCountRef.current += 1;
					const retryAt = Date.now() + ciDashboardRetryDelayMs(loadFailureCountRef.current, error);
					nextRetryAtRef.current = retryAt;
					setNextRetryAt(retryAt);
					setLoadFailed(true);
				} finally {
					setLoading(false);
					if (foreground) setRefreshing(false);
				}
			});
		},
		[cacheKey]
	);

  React.useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
		loadSavedFeatureStacks({ signal: controller.signal }).catch(() => undefined);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, CI_DASHBOARD_POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
	}, [load, loadSavedFeatureStacks]);

  const dashboard = response?.dashboard ?? null;
  const integration = response?.integration ?? null;
  const policies = dashboard?.automations ?? [];
	const awaitingInitialReconcile = Boolean(dashboard && dashboard.features.length === 0 && integration?.githubAppConfigured);
	const setupRequired = Boolean(dashboard && dashboard.features.length === 0 && !integration?.githubAppConfigured);
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
			return matchesPullRequestStatusFilter(pr?.status ?? feature.status, statusFilters);
    });
	}, [dashboard, query, statusFilters]);

  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) ?? features[0] ?? null;
  const selectedPr = dashboard ? selectPrimaryPr(selectedFeature, dashboard.pullRequests) : null;
  const selectedPreviewPolicy =
    dashboard && selectedPr
      ? (dashboard.previewPolicies ?? []).find((policy) => policy.prNumber === Number(selectedPr.number)) ?? null
      : null;
  const featureStackSelection = React.useMemo(() => {
    if (!dashboard) return [];
    const byId = new Map(dashboard.features.map((feature) => [feature.id, feature]));
    return featureStackIds.flatMap((featureId) => {
      const feature = byId.get(featureId);
      const pr = feature ? selectPrimaryPr(feature, dashboard.pullRequests) : null;
			return feature && pr && Number.isSafeInteger(Number(pr.number)) && pr.headRef && pr.headSha ? [{ feature, pr }] : [];
    });
  }, [dashboard, featureStackIds]);
	const featureStackSourceRefs = React.useMemo(() => new Set(featureStackSelection.map(({ pr }) => String(pr.headRef))), [featureStackSelection]);
  const featureStackBranchOptions = React.useMemo(() => {
    if (!dashboard) return [];
    return dashboard.branches
      .map((branch) => String(branch.ref ?? branch.title ?? branch.externalId ?? ''))
      .filter((branch) => branch && !featureStackSourceRefs.has(branch))
      .sort((left, right) => {
				const priority = (value: string) => (value === 'develop' ? 0 : value === 'main' ? 1 : 2);
        return priority(left) - priority(right) || left.localeCompare(right);
      });
  }, [dashboard, featureStackSourceRefs]);
	const featureStackProgress = React.useMemo(() => {
		const progress = new Map<string, FeatureStackTargetProgress[]>();
		if (!dashboard) return progress;
		for (const stack of savedFeatureStacks) {
			const sourceBases = stack.sourcePrNumbers.flatMap((number) => {
				const source = dashboard.pullRequests.find((candidate) => Number(candidate.number) === number);
				return source?.baseRef ? [String(source.baseRef)] : [];
			});
			const compatibleTargets = new Set(sourceBases.flatMap((base) => featureStackTargetsForSource(base, stack.targets, stack.autoDecideBranches)));
			progress.set(
				stack.id,
				stack.targets.flatMap((target) => {
					const safeTarget = target.replace(/[/_]/g, '-').replace(/[^A-Za-z0-9.-]/g, '');
					const headRef = `lopu/feature-stack-${stack.id}-to-${safeTarget}`;
					const pr = dashboard.pullRequests.find((candidate) => String(candidate.headRef ?? '') === headRef);
					if (pr) {
						return [
							{
								target,
								status: String(pr.status ?? pr.state ?? 'running'),
								url: typeof pr.url === 'string' ? pr.url : null,
								updatedAt: entityTime(pr) ? String(entityTime(pr)) : null
							}
						];
					}
					return stack.autoDecideBranches && sourceBases.length && !compatibleTargets.has(target) ? [{ target, status: 'skipped' }] : [];
				})
			);
		}
		return progress;
	}, [dashboard, savedFeatureStacks]);
	const activeSavedFeatureStack = savedFeatureStacks.find((stack) => stack.id === activeFeatureStackId) ?? null;
	const featureStackLiveSnapshot = React.useMemo<FeatureStackLiveSnapshot | null>(() => {
		if (!dashboard || !activeSavedFeatureStack?.lastRunAt) return null;
		const stack = activeSavedFeatureStack;
		const startedAt = parseTime(stack.lastRunAt);
		if (!startedAt) return null;
		const targetProgress = featureStackProgress.get(stack.id) ?? [];
		const targetRows = stack.targets.map((target) => targetProgress.find((entry) => entry.target === target) ?? { target, status: 'waiting' });
		const activeTargets = targetRows.filter((entry) => normalizedStatus(entry.status) !== 'skipped');
		const terminalStatuses = new Set(['merged', 'closed', 'completed', 'success', 'succeeded', 'failure', 'failed', 'cancelled']);
		const completedTargets = activeTargets.filter((entry) => terminalStatuses.has(normalizedStatus(entry.status))).length;
		const dispatch = dashboard.dispatches.find((candidate) => candidate.id === stack.lastDispatchId) ?? null;
		const dispatchEvents = [
			...new Map(
				[...featureStackEvents, ...dashboard.events]
					.filter((event) => event.parentId === stack.lastDispatchId)
					.map((event) => [event.id, event])
			).values()
		];
		const heartbeat = latestFeatureStackHeartbeat(dispatchEvents);
		const topLevelRuns = dashboard.workflowRuns.filter(
			(candidate) => String(candidate.entityType ?? '') !== 'job' && normalizedStatus(candidate.event) === 'workflow_dispatch'
		);
		const allJobs = dashboard.workflowRuns.filter((candidate) => String(candidate.entityType ?? '') === 'job');
		const storedRuns = stack.runs ?? [];
		const currentStoredRun = storedRuns.find((candidate) => candidate.id === stack.lastDispatchId) ?? storedRuns[0] ?? null;
		const linkedRunId = currentStoredRun?.workflowRunId ?? null;
		const legacyRunId = linkedRunId
			? null
			: legacyFeatureStackWorkflowRunId({
					startedAt: stack.lastRunAt,
					runs: topLevelRuns,
					jobs: allJobs
			  });
		const exactRunId = linkedRunId ?? legacyRunId;
		const run = exactRunId ? topLevelRuns.find((candidate) => Number(candidate.runId) === exactRunId) ?? null : null;
		const jobs = run?.runId
			? allJobs
					.filter((candidate) => Number(candidate.runId) === Number(run.runId))
					.sort((left, right) => (parseTime(left.startedAt)?.getTime() ?? 0) - (parseTime(right.startedAt)?.getTime() ?? 0))
			: [];
		const completedJobs = jobs.filter((job) => terminalStatuses.has(normalizedStatus(job.status))).length;
		const allTargetsFinished = activeTargets.length > 0 && completedTargets === activeTargets.length;
		const runStatus = run?.status ?? currentStoredRun?.status ?? dispatch?.status ?? stack.status;
		const hasPublishedTarget = activeTargets.some((entry) => Boolean(entry.url));
		const outcome = featureStackRunOutcome({
			runStatus,
			allTargetsFinished,
			hasPublishedTarget,
			dispatchAccepted: Boolean(dispatch || currentStoredRun || stack.status === 'running')
		});
		let percent = dispatch ? 18 : 8;
		if (run) percent = Math.max(percent, terminalStatuses.has(normalizedStatus(run.status)) ? 65 : 30);
		if (jobs.length) percent = Math.max(percent, 30 + Math.round((completedJobs / jobs.length) * 35));
		if (activeTargets.length) percent = Math.max(percent, 30 + Math.round((completedTargets / activeTargets.length) * 70));
		if (heartbeat) percent = Math.max(percent, heartbeat.progressPercent);
		if (allTargetsFinished) percent = 100;
		percent = Math.min(100, Math.max(5, percent));
		const startedMs = startedAt.getTime();
		const estimatedMinutes = Math.max(8, stack.sourcePrNumbers.length * 2 + Math.max(1, activeTargets.length) * 4);
		const baselineFinish = new Date(startedMs + estimatedMinutes * 60_000);
		const heartbeatFinish = heartbeat?.expectedFinishAt ? parseTime(heartbeat.expectedFinishAt) : null;
		const expectedFinish = heartbeatFinish && heartbeatFinish.getTime() > Date.now()
			? heartbeatFinish
			: baselineFinish.getTime() > Date.now()
				? baselineFinish
				: new Date(Date.now() + Math.max(2, activeTargets.length * 2) * 60_000);
		const latestFinishedAt = [run?.completedAt, ...targetRows.map((entry) => entry.updatedAt)]
			.map(parseTime)
			.filter((date): date is Date => Boolean(date))
			.sort((left, right) => right.getTime() - left.getTime())[0];
		const timeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
		const lines = sortFeatureStackTimeline<FeatureStackLiveLine>([
			{
				key: 'queued',
				at: stack.lastRunAt,
				message: `Queued ${stack.sourcePrNumbers.length} selected PR${stack.sourcePrNumbers.length === 1 ? '' : 's'} for ${
					activeTargets.length || stack.targets.length
				} compatible target${(activeTargets.length || stack.targets.length) === 1 ? '' : 's'}.`
			},
			...dispatchEvents.map((event) => {
				const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : null;
				const isProgress = event.eventType === 'feature_stack_progress';
				return {
					key: `event:${event.id}`,
					at: String(event.occurredAt ?? entityTime(event) ?? stack.lastRunAt),
					message: isProgress && typeof data?.message === 'string'
						? data.message
						: `Dispatch ${String(event.statusTo ?? event.action ?? event.status ?? 'updated').replace(/_/g, ' ')}.`,
					url: isProgress && typeof data?.workflowRunUrl === 'string' ? data.workflowRunUrl : null
				};
			}),
			...(run
				? [
						{
							key: `run:${run.id}`,
							at: String(run.startedAt ?? entityTime(run) ?? stack.lastRunAt),
							message: `${String(run.title ?? 'Lopu controller')} — ${String(run.status ?? 'running').replace(/_/g, ' ')}.`,
							url: typeof run.url === 'string' ? run.url : null
						}
				  ]
				: []),
			...jobs.map((job) => ({
				key: `job:${job.id}`,
				at: String(job.completedAt ?? job.startedAt ?? entityTime(job) ?? stack.lastRunAt),
				message: `${String(job.title ?? 'Workflow job')} — ${String(job.status ?? 'running').replace(/_/g, ' ')}.`,
				url: typeof job.url === 'string' ? job.url : null
			})),
			...targetRows.map((entry) => ({
				key: `target:${entry.target}`,
				at: entry.updatedAt ?? stack.lastRunAt,
				message:
					normalizedStatus(entry.status) === 'skipped'
						? `${entry.target}: skipped — no compatible selected PR.`
						: `${entry.target}: ${
								normalizedStatus(entry.status) === 'waiting'
									? 'waiting for Lopu to publish the verified stack PR'
									: String(entry.status).replace(/_/g, ' ')
						  }.`,
				url: entry.url
			}))
		]);
		const historicalRuns = storedRuns
			.map((storedRun) => {
				const resolvedRunId = storedRun.workflowRunId ?? (storedRun.id === stack.lastDispatchId ? legacyRunId : null);
				const entity = resolvedRunId ? topLevelRuns.find((candidate) => Number(candidate.runId) === resolvedRunId) ?? null : null;
				return {
					...storedRun,
					status: String(entity?.status ?? storedRun.status),
					title: String(entity?.title ?? storedRun.title),
					url: typeof entity?.url === 'string' ? entity.url : storedRun.url,
					workflowRunId: resolvedRunId,
					startedAt: String(entity?.startedAt ?? storedRun.startedAt),
					completedAt: entity?.completedAt ? String(entity.completedAt) : storedRun.completedAt
				};
			})
			.sort((left, right) => (parseTime(right.startedAt)?.getTime() ?? 0) - (parseTime(left.startedAt)?.getTime() ?? 0));
		return {
			live: outcome.live,
			needsAttention: outcome.needsAttention,
			state: outcome.state,
			percent,
			summary: outcome.needsAttention
				? `${percent}% · controller completed but 0/${activeTargets.length || stack.targets.length} target branch PRs were published`
				: outcome.live && heartbeat
					? `${percent}% · ${heartbeat.message}`
				: `${percent}% · ${completedTargets}/${activeTargets.length || stack.targets.length} target branches finished · ${completedJobs}/${jobs.length} visible workflow jobs finished`,
			finishLabel:
				allTargetsFinished && latestFinishedAt
					? `Finished ${timeFormatter.format(latestFinishedAt)}`
					: outcome.needsAttention || (!outcome.live && latestFinishedAt)
						? `Stopped ${timeFormatter.format(latestFinishedAt ?? startedAt)}`
						: `Estimated finish ${timeFormatter.format(expectedFinish)}`,
			timeZone,
			lines,
			runs: historicalRuns
		};
	}, [activeSavedFeatureStack, dashboard, featureStackEvents, featureStackProgress]);

	React.useEffect(() => {
		if (!featureStackLiveSnapshot?.live) return;
		let inFlight = false;
		const interval = window.setInterval(() => {
			if (inFlight || document.visibilityState !== 'visible') return;
			inFlight = true;
			Promise.allSettled([load(), loadSavedFeatureStacks()]).finally(() => {
				inFlight = false;
			});
		}, CI_DASHBOARD_LIVE_POLL_INTERVAL_MS);
		return () => window.clearInterval(interval);
	}, [featureStackLiveSnapshot?.live, load, loadSavedFeatureStacks]);
	React.useEffect(() => {
		if (!activeFeatureStackId || dashboard?.features.length || pendingFeatureStackPrNumbers.length) return;
		const activeSavedStack = savedFeatureStacks.find((stack) => stack.id === activeFeatureStackId);
		if (!activeSavedStack?.sourcePrNumbers.length) return;
		setFeatureStackIds([]);
		setPendingFeatureStackPrNumbers(activeSavedStack.sourcePrNumbers);
	}, [activeFeatureStackId, dashboard?.features.length, pendingFeatureStackPrNumbers.length, savedFeatureStacks]);
  React.useEffect(() => {
    if (!dashboard || dashboard.features.length === 0) return;
    const valid = new Set(dashboard.features.map((feature) => feature.id));
    setFeatureStackIds((current) => current.filter((id) => valid.has(id)));
  }, [dashboard]);
	React.useEffect(() => {
		if (!dashboard || dashboard.features.length === 0 || pendingFeatureStackPrNumbers.length === 0) return;
		const resolved = resolveFeatureStackSources(pendingFeatureStackPrNumbers, dashboard.pullRequests);
		if (resolved.selectedFeatureIds.length) {
			setFeatureStackIds((current) => [
				...current,
				...resolved.selectedFeatureIds.filter((id) => !current.includes(id))
			]);
		}
		setPendingFeatureStackPrNumbers((current) =>
			sameNumberOrder(current, resolved.pendingSourcePrNumbers) ? current : resolved.pendingSourcePrNumbers
		);
	}, [dashboard, pendingFeatureStackPrNumbers]);
	const selectedRuns = dashboard ? dashboard.workflowRuns.filter((run) => matchesEntity(run, selectedPr)).slice(0, 10) : [];
	const selectedPreviews = dashboard ? dashboard.previews.filter((preview) => matchesEntity(preview, selectedPr)).slice(0, 5) : [];
	const relatedIds = new Set(
		[selectedFeature?.id, selectedPr?.id, ...selectedRuns.map((run) => run.id), ...selectedPreviews.map((preview) => preview.id)].filter(Boolean)
	);
  const selectedEvents = dashboard
    ? dashboard.events
        .filter((event) => event.parentId && relatedIds.has(event.parentId))
				.sort(
					(left, right) =>
						(parseTime(right.occurredAt ?? entityTime(right))?.getTime() ?? 0) - (parseTime(left.occurredAt ?? entityTime(left))?.getTime() ?? 0)
				)
    : [];

  const toggleFeatureStack = (feature: CiEntity, pr: CiEntity | null) => {
    if (!pr?.number || !pr.headRef || !pr.headSha) return;
		setFeatureStackIds((current) => (current.includes(feature.id) ? current.filter((id) => id !== feature.id) : [...current, feature.id]));
	};

	const loadFeatureStackDraft = (stack: SavedFeatureStack) => {
		setActiveFeatureStackId(stack.id);
		setFeatureStackName(stack.name);
		setFeatureStackTargets(stack.targets);
		setFeatureStackAutoDecide(stack.autoDecideBranches);
		if (dashboard?.features.length) {
			const resolved = resolveFeatureStackSources(stack.sourcePrNumbers, dashboard.pullRequests);
			setFeatureStackIds(resolved.selectedFeatureIds);
			setPendingFeatureStackPrNumbers(resolved.pendingSourcePrNumbers);
		} else {
			setFeatureStackIds([]);
			setPendingFeatureStackPrNumbers(stack.sourcePrNumbers);
		}
	};

	const newFeatureStackDraft = () => {
		setActiveFeatureStackId(null);
		setFeatureStackName('Feature Stack');
		setFeatureStackIds([]);
		setPendingFeatureStackPrNumbers([]);
		setFeatureStackTargets(['develop', 'main']);
		setFeatureStackAutoDecide(true);
	};

	const saveCurrentFeatureStack = async () => {
		if (featureStackSaving || featureStackSelection.length < 1 || featureStackTargets.length < 1 || !featureStackName.trim()) return null;
		setFeatureStackSaving(true);
		try {
			await requireThingtimeCapability('api.admin-ci-feature-stacks', '1.0.0');
			const result = await apiRef.current.v1.admin.mutateCiFeatureStack({
				action: 'save',
				...(activeFeatureStackId ? { id: activeFeatureStackId } : {}),
				name: featureStackName.trim(),
				sourcePrNumbers: featureStackSelection.map(({ pr }) => Number(pr.number)),
				targets: featureStackTargets,
				autoDecideBranches: featureStackAutoDecide
			});
			if (!result?.ok || !result.stack?.id) throw new Error(result?.error || 'Feature Stack save failed.');
			setSavedFeatureStacks(result.stacks ?? []);
			setActiveFeatureStackId(result.stack.id);
			return result.stack as SavedFeatureStack;
		} finally {
			setFeatureStackSaving(false);
		}
	};

	const deleteFeatureStack = async (id: string) => {
		if (!window.confirm('Archive this saved Feature Stack? Existing merge runs and pull requests are preserved.')) return;
		setFeatureStackSaving(true);
		try {
			const result = await apiRef.current.v1.admin.mutateCiFeatureStack({ action: 'delete', id });
			if (!result?.ok) throw new Error(result?.error || 'Feature Stack archive failed.');
			setSavedFeatureStacks(result.stacks ?? []);
			if (activeFeatureStackId === id) newFeatureStackDraft();
		} catch (error: any) {
			lopu({ title: 'The Feature Stack was not archived', description: error?.message || 'Nothing was changed.', status: 'error' });
		} finally {
			setFeatureStackSaving(false);
		}
  };

	const changeFeatureStackLifecycle = async (stack: SavedFeatureStack, action: FeatureStackLifecycleAction) => {
		if (featureStackLifecycleBusy) return;
		if (
			action === 'stop' &&
			!window.confirm(`Stop “${stack.name}”?\n\nCurrent compute will be cancelled. The saved stack and its run history will remain available.`)
		) {
			return;
		}
		if (
			action === 'restart' &&
			featureStackCanPause(stack.status) &&
			!window.confirm(`Restart “${stack.name}”?\n\nIts current compute will be cancelled before a fresh immutable run starts.`)
		) {
			return;
		}
		setFeatureStackLifecycleBusy({ id: stack.id, action });
		try {
			await requireThingtimeCapability('api.admin-ci-feature-stacks', '1.3.0');
			const result = await apiRef.current.v1.admin.mutateCiFeatureStack({ action, id: stack.id });
			if (!result?.ok) throw new Error(result?.error || `Feature Stack ${action} failed.`);
			setSavedFeatureStacks(result.stacks ?? []);
			lopu({
				title: action === 'restart' ? 'Feature Stack restarted 🙌' : action === 'pause' ? 'Feature Stack paused' : 'Feature Stack stopped',
				description:
					action === 'restart'
						? 'Lopu accepted a fresh immutable run. Live progress and the new GitHub run link will appear here.'
						: 'Current compute was cancelled when still active. The saved definition and complete run history were preserved.',
				status: 'success',
				duration: 7000
			});
			window.setTimeout(() => {
				void Promise.allSettled([load(), loadSavedFeatureStacks()]);
			}, 1500);
		} catch (error: any) {
			lopu({
				title: `The Feature Stack was not ${action === 'restart' ? 'restarted' : action === 'pause' ? 'paused' : 'stopped'}`,
				description: error?.message || 'Nothing was changed.',
				status: 'error'
			});
		} finally {
			setFeatureStackLifecycleBusy(null);
		}
	};

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
      const policy = policies.find((candidate) => candidate.key === workflow);
      lopu({
        title: `${WORKFLOW_LABELS[workflow]} queued 🙌`,
        description:
          policy?.executionProvider === 'vercel-sandbox'
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

  const submitFeatureStack = async () => {
		if (featureStackDispatching || featureStackSelection.length < 1 || featureStackTargets.length < 1) return;
    setFeatureStackDispatching(true);
    try {
			await requireThingtimeCapability('api.admin-ci-dispatch', '2.1.0');
			await requireThingtimeCapability('api.admin-ci-feature-stacks', '1.3.0');
			const saved = await saveCurrentFeatureStack();
			if (!saved) throw new Error('Feature Stack save failed');
			const result = await apiRef.current.v1.admin.mutateCiFeatureStack({ action: 'run', id: saved.id });
      if (!result?.ok) throw new Error('Feature Stack dispatch rejected');
			setSavedFeatureStacks(result.stacks ?? []);
      lopu({
        title: 'Feature Stack queued 😍🙌',
				description: `Lopu is routing ${featureStackSelection.length} feature${
					featureStackSelection.length === 1 ? '' : 's'
				} into ${featureStackTargets.join(
					', '
				)}. Each target gets only compatible PRs and merges after its verified stack PR passes branch protection.`,
        status: 'success',
        duration: 8000
      });
      window.setTimeout(() => load(), 1500);
		} catch (error: any) {
      lopu({
        title: 'The Feature Stack was not queued',
				description: error?.message || 'Nothing was changed. Reconcile GitHub, confirm every selected PR is still open and current, then try again.',
        status: 'error'
      });
    } finally {
      setFeatureStackDispatching(false);
    }
  };

	const updateAutomation = async (workflow: CiWorkflowKey, executionProvider: CiExecutionProvider, enabled: boolean) => {
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

  const togglePreviewEnvironment = async (environment: 'develop' | 'production', enabled: boolean) => {
    const prNumber = Number(selectedPr?.number);
    if (savingPreviewEnvironment || !Number.isSafeInteger(prNumber) || prNumber < 1) return;
    if (
      environment === 'production' &&
      enabled &&
      !window.confirm(
        `Enable a production-environment preview for PR #${prNumber}?\n\nThis trusted branch will run with production environment values. Its immutable Vercel URL will not replace or alias thingtime.com.`
      )
    ) {
      return;
    }
    setSavingPreviewEnvironment(environment);
    try {
      await requireThingtimeCapability('api.admin-ci-previews', '1.0.0');
      const result = await apiRef.current.v1.admin.setCiPreviewPolicy({
        prNumber,
        environment,
        enabled,
        ...(environment === 'production' && enabled ? { acknowledgeProductionData: true } : {})
      });
      if (!result?.ok) throw new Error(result?.error || 'Preview policy rejected');
      await load();
      lopu({
        title: enabled ? `${environment === 'production' ? 'Production' : 'Develop'} preview queued 🙌` : `${environment === 'production' ? 'Production' : 'Develop'} preview disabled`,
        description: enabled
          ? `PR #${prNumber} is building at its exact current SHA. Signed Vercel progress will update here automatically.`
          : `Only Thingtime-owned ${environment} preview deployments for PR #${prNumber} were removed.`,
        status: 'success',
        duration: 7000
      });
    } catch (error: any) {
      lopu({
        title: 'The preview setting was not changed',
        description: error?.message || 'The previous preview policy remains active.',
        status: 'error'
      });
    } finally {
      setSavingPreviewEnvironment(null);
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
				<Text fontSize="sm" opacity={0.62}>
					Loading CI control data…
				</Text>
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
          Live refresh failed. Last-known cached state remains visible and will retry
				{nextRetryAt
					? ` after ${new Date(nextRetryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
					: ' automatically'}.
        </Alert>
      ) : null}

      {setupRequired || awaitingInitialReconcile ? (
        <Alert status={setupRequired ? 'warning' : 'info'} mb={4} borderRadius="md" alignItems="flex-start">
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
						<Text fontSize="10px" fontWeight="700" textTransform="uppercase" letterSpacing="0.06em" opacity={0.45}>
							{label}
						</Text>
						<Text fontSize="xl" fontWeight="700">
							{value}
						</Text>
          </Box>
        ))}
        <Box ml={{ base: 0, md: 'auto' }} minW="190px">
          <Flex gap={1.5} wrap="wrap" justify={{ base: 'flex-start', md: 'flex-end' }}>
            <Badge colorScheme={integration?.githubAppConfigured ? 'green' : 'gray'}>GitHub App</Badge>
            <Badge colorScheme={integration?.githubWebhookConfigured ? 'green' : 'gray'}>GitHub webhook</Badge>
            <Badge colorScheme={integration?.vercelWebhookConfigured ? 'green' : 'gray'}>Vercel webhook</Badge>
            <Badge colorScheme={integration?.providerRouterConfigured ? 'green' : 'gray'}>Provider router</Badge>
            <Badge colorScheme={integration?.vercelRunnerReady ? 'green' : 'gray'}>Vercel runner</Badge>
          </Flex>
          <Text textAlign={{ base: 'left', md: 'right' }} mt={1} fontSize="xs" opacity={0.5}>
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
        collapsed={collapsedSections.has('automation')}
        onToggleCollapsed={() => toggleSection('automation')}
      />

      <ClaudeCredentialWaterfall
        cacheIdentity={cacheIdentity}
        collapsed={collapsedSections.has('credentials')}
        onToggleCollapsed={() => toggleSection('credentials')}
      />

      <FeatureStackComposer
        name={featureStackName}
        selected={featureStackSelection}
				pendingSourcePrNumbers={pendingFeatureStackPrNumbers}
        targets={featureStackTargets}
        branchOptions={featureStackBranchOptions}
				autoDecideBranches={featureStackAutoDecide}
				activeStackId={activeFeatureStackId}
				savedStacks={savedFeatureStacks}
				progressByStack={featureStackProgress}
				liveSnapshot={featureStackLiveSnapshot}
        collapsed={collapsedSections.has('feature-stack')}
        onToggleCollapsed={() => toggleSection('feature-stack')}
        isSubmitting={featureStackDispatching}
				isSaving={featureStackSaving}
				lifecycleBusy={featureStackLifecycleBusy}
        canDispatch={Boolean(integration?.githubAppConfigured && policies.find((policy) => policy.key === 'feature-stack')?.enabled)}
        onNameChange={(value) => {
          setFeatureStackName(value);
        }}
        onRemove={(featureId) => {
          setFeatureStackIds((current) => current.filter((id) => id !== featureId));
        }}
        onAddTarget={(target) => {
					setFeatureStackTargets((current) => (!current.includes(target) ? [...current, target] : current));
        }}
        onRemoveTarget={(target) => {
          setFeatureStackTargets((current) => current.filter((candidate) => candidate !== target));
        }}
				onAutoDecideChange={setFeatureStackAutoDecide}
				onNew={newFeatureStackDraft}
				onLoad={loadFeatureStackDraft}
				onSave={() => {
					saveCurrentFeatureStack()
						.then(
							(saved) =>
								saved &&
								lopu({
									title: 'Feature Stack saved ✨',
									description: 'You can edit it or run it whenever you are ready.',
									status: 'success',
									duration: 5000
								})
						)
						.catch((error: any) =>
							lopu({ title: 'The Feature Stack was not saved', description: error?.message || 'Nothing was changed.', status: 'error' })
						);
				}}
				onDelete={deleteFeatureStack}
				onLifecycle={changeFeatureStackLifecycle}
        onSubmit={submitFeatureStack}
      />

      <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1.65fr) minmax(320px, 0.85fr)' }} gap={4}>
        <Box border="1px solid var(--tt-border, #e7e7eb)" borderRadius="var(--tt-radius-md, 12px)" bg="var(--tt-card, #fff)" overflow="hidden">
          <Flex p={3} gap={2} borderBottom="1px solid var(--tt-border, #e7e7eb)" direction={{ base: 'column', sm: 'row' }}>
            <Flex align="center" gap={2} flex="1" border="1px solid var(--tt-border, #e7e7eb)" borderRadius="md" px={3}>
              <FiSearch opacity={0.45} />
							<Input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								variant="unstyled"
								placeholder="Search features, PRs, or branches"
								py={2}
							/>
            </Flex>
						<Menu closeOnSelect={false}>
							<MenuButton
								as={Button}
								variant="outline"
								width={{ base: '100%', sm: '190px' }}
								rightIcon={<FiChevronDown />}
								textAlign="left"
								aria-label="Filter features by pull request status"
							>
								{statusFilters.length === PULL_REQUEST_STATUS_FILTERS.length
									? 'All statuses'
									: statusFilters.length === 1
									? PULL_REQUEST_STATUS_FILTERS.find((option) => option.id === statusFilters[0])?.label ?? '1 status'
									: `${statusFilters.length} statuses`}
							</MenuButton>
							<MenuList minW="240px" zIndex={20}>
								<MenuItem
									onClick={() =>
										setStatusFilters(statusFilters.length === PULL_REQUEST_STATUS_FILTERS.length ? [] : [...ALL_PULL_REQUEST_STATUS_FILTER_IDS])
									}
								>
									<Checkbox pointerEvents="none" isChecked={statusFilters.length === PULL_REQUEST_STATUS_FILTERS.length} mr={3}>
										All statuses
									</Checkbox>
								</MenuItem>
								<MenuDivider />
								{PULL_REQUEST_STATUS_FILTERS.map((option) => (
									<MenuItem
										key={option.id}
										onClick={() =>
											setStatusFilters((current) =>
												current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id]
											)
										}
									>
										<Checkbox pointerEvents="none" isChecked={statusFilters.includes(option.id)} mr={3}>
											<Flex align="center" gap={2}>
												<Badge colorScheme={option.color} borderRadius="999px">
													&nbsp;
												</Badge>
												{option.label}
											</Flex>
										</Checkbox>
									</MenuItem>
								))}
							</MenuList>
						</Menu>
          </Flex>
          <Grid
            display={{ base: 'none', md: 'grid' }}
            templateColumns="36px minmax(0, 1.6fr) minmax(150px, .8fr) 110px 110px"
            gap={3}
            px={4}
            py={2}
            fontSize="10px"
            fontWeight="700"
            textTransform="uppercase"
            letterSpacing="0.06em"
            opacity={0.45}
          >
						<Text aria-hidden="true">Add</Text>
						<Text>Feature</Text>
						<Text>Branch</Text>
						<Text>Status</Text>
						<Text>Updated</Text>
          </Grid>
					<Box
						height={{ base: '60vh', lg: 'min(720px, calc(100vh - 180px))' }}
						minH={{ base: '360px', lg: '480px' }}
						overflowY="auto"
						overscrollBehavior="contain"
					>
            {features.map((feature) => {
              const pr = dashboard ? selectPrimaryPr(feature, dashboard.pullRequests) : null;
              const selected = feature.id === selectedFeature?.id;
              return (
                <Grid
                  key={feature.id}
                  width="100%"
                  templateColumns={{ base: '36px minmax(0, 1fr)', md: '36px minmax(0, 1.6fr) minmax(150px, .8fr) 110px 110px' }}
                  columnGap={3}
                  rowGap={{ base: 1, md: 3 }}
                  alignItems="center"
                  px={4}
                  py={3}
                  borderTop="1px solid var(--tt-border, #eeeeF1)"
                  bg={selected ? 'var(--tt-surface-alt, #f6f6f8)' : 'transparent'}
                  _hover={{ bg: 'var(--tt-surface-alt, #f6f6f8)' }}
                >
                  <Checkbox
                    gridColumn={{ base: '1', md: 'auto' }}
                    gridRow={{ base: '1 / span 3', md: 'auto' }}
                    alignSelf={{ base: 'start', md: 'center' }}
                    mt={{ base: 1, md: 0 }}
                    isChecked={featureStackIds.includes(feature.id)}
                    isDisabled={!pr?.number || !pr.headRef || !pr.headSha}
                    onChange={() => toggleFeatureStack(feature, pr)}
                    aria-label={pr?.number ? `Add PR #${String(pr.number)} to Feature Stack` : 'Feature has no selectable pull request'}
                  />
                  <Button
                    variant="unstyled"
                    height="auto"
                    minW={0}
                    width="100%"
                    gridColumn={{ base: '2', md: 'auto' }}
                    gridRow={{ base: '1', md: 'auto' }}
                    textAlign="left"
                    justifyContent="flex-start"
                    onClick={() => selectFeature(feature)}
                    aria-pressed={selected}
                  >
                    <Box minW={0}>
                    <Flex align="center" gap={2} minW={0}>
                      {pr?.number ? <Badge variant="subtle">#{String(pr.number)}</Badge> : null}
												<Text fontSize="sm" fontWeight="650" noOfLines={1}>
													{feature.title || pr?.title || 'Untitled feature'}
												</Text>
                    </Flex>
                    </Box>
                  </Button>
									<Text gridColumn={{ base: '2', md: 'auto' }} gridRow={{ base: '2', md: 'auto' }} fontSize="xs" opacity={0.62} noOfLines={1}>
										{String(pr?.headRef ?? '—')}
									</Text>
									<Box gridColumn={{ base: '2', md: 'auto' }} gridRow={{ base: '3', md: 'auto' }}>
										<StatusBadge status={pr?.status ?? feature.status} />
									</Box>
									<Text display={{ base: 'none', md: 'block' }} fontSize="xs" opacity={0.52}>
										{relativeTime(entityTime(pr ?? feature))}
									</Text>
                </Grid>
              );
            })}
            {!features.length ? (
              <Box p={8} textAlign="center">
                <FiGitBranch style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <Text fontSize="sm" opacity={0.58}>
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
            previewPolicy={selectedPreviewPolicy}
            previewBuilderMissing={integration?.previewBuilderMissing ?? []}
            savingPreviewEnvironment={savingPreviewEnvironment}
            canDispatch={Boolean(integration?.githubAppConfigured)}
            onDispatch={openDispatch}
            onTogglePreview={togglePreviewEnvironment}
          />
        </Box>
      </Grid>

      <Drawer isOpen={mobileDetailOpen} placement="bottom" onClose={() => setMobileDetailOpen(false)} size="full">
        <DrawerOverlay />
				<DrawerContent height="min(86dvh, 760px)" maxH="86dvh" borderTopRadius="18px" bg="var(--tt-card, #fff)" color="var(--tt-ink, #17171c)">
          <DrawerCloseButton />
					<DrawerHeader borderBottom="1px solid var(--tt-border, #e7e7eb)" fontSize="sm">
						Feature details
					</DrawerHeader>
          <DrawerBody py={5} pb="calc(24px + env(safe-area-inset-bottom))">
            <FeatureDetail
              feature={selectedFeature}
              pr={selectedPr}
              runs={selectedRuns}
              previews={selectedPreviews}
              events={selectedEvents}
              previewPolicy={selectedPreviewPolicy}
              previewBuilderMissing={integration?.previewBuilderMissing ?? []}
              savingPreviewEnvironment={savingPreviewEnvironment}
              canDispatch={Boolean(integration?.githubAppConfigured)}
              onDispatch={openDispatch}
              onTogglePreview={togglePreviewEnvironment}
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
