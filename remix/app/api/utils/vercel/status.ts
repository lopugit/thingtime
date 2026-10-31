import { PublicError, safeErrorText } from '../errors/safeError';
import { getPersistedBranchStatus, isVercelWebhookConfigured, persistedStatusIsForDeployment } from './webhookStore';

export { isVercelStatusEnabled } from './environment';

export type VercelDeploymentStatus = {
  branch?: string;
  commitSha?: string;
  buildId?: string;
  buildPageUrl?: string;
  buildPhase?: string;
  buildProgress?: number;
  configured: boolean;
  deploymentUrl?: string;
  environment?: string;
  hasError: boolean;
  error?: string;
  label: string;
  lastReadyAt?: string;
  lastReadyLabel?: string;
  lastReadyUrl?: string;
  latestDeploymentUrl?: string;
  state:
    | 'local'
    | 'ready'
    | 'building'
    | 'queued'
    | 'initializing'
    | 'error'
    | 'canceled'
    | 'blocked'
    | 'unknown';
};

export type VercelDeploymentSummary = {
  branch?: string;
  commitSha?: string;
  createdAt?: string;
  dashboardUrl?: string;
  environment?: string;
  id?: string;
  readyAt?: string;
  readyLabel?: string;
  state: VercelDeploymentStatus['state'];
  url: string;
};

export type VercelDeploymentGroup = {
  branch?: string;
  deployments: VercelDeploymentSummary[];
  id: string;
};

export type VercelDeploymentsOverview = {
  branchLimit: number | null;
  configured: boolean;
  deploymentGroups: VercelDeploymentGroup[];
  deploymentHistoryLimit: number;
  deployments: VercelDeploymentSummary[];
  deploymentPageCount: number;
  deploymentScanCount: number;
  deploymentScanLimit: number;
  error?: string;
  fetchedAt: string;
  hasError: boolean;
  label: string;
  projectName?: string;
  source: 'api' | 'local' | 'tokenless';
  totalBranchCount: number;
  uniqueUrlCount: number;
  uniqueBranchCount: number;
};

const DEFAULT_VERCEL_PROJECT_ID = 'prj_ZAX9FhGC2alHMXMwTHX96ql3EQ8v';
const DEFAULT_VERCEL_TEAM_ID = 'team_JsKhM6fVg9uo701feA0fLh9V';
export const MAX_DEPLOYMENT_BRANCH_LIMIT = 100;
export const DEFAULT_DEPLOYMENT_BRANCH_LIMIT: number | null = null;
export const MAX_DEPLOYMENT_HISTORY_LIMIT = 20;
export const DEFAULT_DEPLOYMENT_HISTORY_LIMIT = 1;
const DEFAULT_DEPLOYMENT_API_PAGE_SIZE = 20;
const DEFAULT_DEPLOYMENT_MAX_PAGES = 10;
const VERCEL_DEPLOYMENTS_CACHE_MS = 30000;
const VERCEL_PROJECT_CACHE_MS = 300000;

const deploymentPageCache = new Map<string, { data: any; expiresAt: number }>();
const projectDataCache = new Map<string, { data: any; expiresAt: number }>();

const getCachedJson = (cache: Map<string, { data: any; expiresAt: number }>, key: string) => {
  const cached = cache.get(key);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return cached.data;
};

export const normaliseDeploymentBranchLimit = (value?: number | string | null): number | null => {
  if (value === undefined || value === null) {
    return DEFAULT_DEPLOYMENT_BRANCH_LIMIT;
  }

  const text = typeof value === 'string' ? value.trim().toLowerCase() : String(value);

  if (!text || text === 'all' || text === 'infinite' || text === 'infinity' || text === 'unlimited') {
    return DEFAULT_DEPLOYMENT_BRANCH_LIMIT;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(text, 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEPLOYMENT_BRANCH_LIMIT;
  }

  return Math.max(1, Math.min(MAX_DEPLOYMENT_BRANCH_LIMIT, Math.floor(parsed)));
};

export const normaliseDeploymentHistoryLimit = (value?: number | string | null): number => {
  if (value === undefined || value === null) {
    return DEFAULT_DEPLOYMENT_HISTORY_LIMIT;
  }

  const text = typeof value === 'string' ? value.trim().toLowerCase() : String(value);

  if (text === 'all' || text === 'infinite' || text === 'infinity' || text === 'unlimited') {
    return MAX_DEPLOYMENT_HISTORY_LIMIT;
  }

  if (!text) {
    return DEFAULT_DEPLOYMENT_HISTORY_LIMIT;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(text, 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEPLOYMENT_HISTORY_LIMIT;
  }

  return Math.max(1, Math.min(MAX_DEPLOYMENT_HISTORY_LIMIT, Math.floor(parsed)));
};

const setCachedJson = (
  cache: Map<string, { data: any; expiresAt: number }>,
  key: string,
  data: any,
  ttlMs: number
) => {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
};

const normaliseUrl = (url?: string) => {
  if (!url) {
    return undefined;
  }

  return url.startsWith('http') ? url : `https://${url}`;
};

const normaliseState = (state?: string): VercelDeploymentStatus['state'] => {
  const value = state?.toUpperCase();

  if (value === 'READY') {
    return 'ready';
  }
  if (value === 'BUILDING') {
    return 'building';
  }
  if (value === 'QUEUED') {
    return 'queued';
  }
  if (value === 'INITIALIZING') {
    return 'initializing';
  }
  if (value === 'CANCELED' || value === 'CANCELLED') {
    return 'canceled';
  }
  if (value === 'BLOCKED') {
    return 'blocked';
  }
  if (value === 'ERROR') {
    return 'error';
  }

  return 'unknown';
};

const clampPercent = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
};

const normaliseProgress = (value?: unknown): number | undefined => {
  if (typeof value === 'number') {
    return clampPercent(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return clampPercent(parsed);
  }

  return undefined;
};

const getObjectValue = (value: unknown, key: string): unknown => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
};

const getStringValue = (value: unknown, key: string): string | undefined => {
  const nested = getObjectValue(value, key);
  return typeof nested === 'string' && nested ? nested : undefined;
};

const LIVE_STATUS_DEPLOYMENT_STATES = new Set<VercelDeploymentStatus['state']>([
  'ready',
  'building',
  'queued',
  'initializing',
  'error',
  'blocked',
]);

const getDeploymentState = (deployment: unknown) => {
  return normaliseState(
    getStringValue(deployment, 'state') || getStringValue(deployment, 'readyState')
  );
};

const isLiveStatusDeployment = (deployment: unknown) => {
  return LIVE_STATUS_DEPLOYMENT_STATES.has(getDeploymentState(deployment));
};

const getVercelApiHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json'
});

const getVercelDeploymentsPage = async ({
  limit,
  until,
  projectId,
  projectName,
  teamId,
  token
}: {
  limit: number;
  until?: string;
  projectId?: string;
  projectName?: string;
  teamId?: string;
  token: string;
}) => {
  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('limit', String(limit));

  if (until) {
    url.searchParams.set('until', until);
  }

  if (projectId) {
    url.searchParams.set('projectId', projectId);
  } else if (projectName) {
    url.searchParams.set('app', projectName);
  }

  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }

  const initialCacheKey = url.toString();
  const cached = getCachedJson(deploymentPageCache, initialCacheKey);

  if (cached) {
    return cached;
  }

  let response = await fetch(url.toString(), {
    headers: getVercelApiHeaders(token)
  });

  if (response.status === 403 && teamId) {
    url.searchParams.delete('teamId');
    const teamlessCacheKey = url.toString();
    const cachedTeamless = getCachedJson(deploymentPageCache, teamlessCacheKey);

    if (cachedTeamless) {
      return cachedTeamless;
    }

    response = await fetch(url.toString(), {
      headers: getVercelApiHeaders(token)
    });
  }

  if (!response.ok) {
    throw new PublicError(`Vercel API returned ${response.status}`);
  }

  const data = await response.json();

  setCachedJson(deploymentPageCache, initialCacheKey, data, VERCEL_DEPLOYMENTS_CACHE_MS);
  setCachedJson(deploymentPageCache, url.toString(), data, VERCEL_DEPLOYMENTS_CACHE_MS);

  return data;
};

const getVercelDeploymentsPages = async ({
  maxPages,
  pageSize,
  projectId,
  projectName,
  teamId,
  token
}: {
  maxPages: number;
  pageSize: number;
  projectId?: string;
  projectName?: string;
  teamId?: string;
  token: string;
}) => {
  const deployments: unknown[] = [];
  const seenCursors = new Set<string>();
  let until: string | undefined;
  let pageCount = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const data = await getVercelDeploymentsPage({
      limit: pageSize,
      projectId,
      projectName,
      teamId,
      token,
      until
    });
    const pageDeployments = Array.isArray(data?.deployments) ? data.deployments : [];
    const nextCursor = getObjectValue(getObjectValue(data, 'pagination'), 'next');

    deployments.push(...pageDeployments);
    pageCount += 1;

    if (!nextCursor || pageDeployments.length === 0) {
      break;
    }

    until = String(nextCursor);

    if (seenCursors.has(until)) {
      break;
    }

    seenCursors.add(until);
  }

  return {
    deployments,
    pageCount
  };
};

const getDashboardOwnerSlug = (value: unknown): string | undefined => {
  return (
    getStringValue(getObjectValue(value, 'account'), 'slug') ||
    getStringValue(getObjectValue(value, 'team'), 'slug') ||
    getStringValue(getObjectValue(value, 'owner'), 'slug') ||
    getStringValue(value, 'orgName') ||
    getStringValue(value, 'accountSlug') ||
    process.env.VERCEL_DASHBOARD_TEAM_SLUG ||
    process.env.VERCEL_TEAM_SLUG ||
    process.env.VERCEL_ORG_SLUG
  );
};

const getDashboardProjectSlug = (projectData: unknown, fallbackProjectName?: string) => {
  return getStringValue(projectData, 'name') || getStringValue(projectData, 'slug') || fallbackProjectName;
};

const getVercelProjectData = async ({
  projectId,
  projectName,
  teamId,
  token
}: {
  projectId?: string;
  projectName?: string;
  teamId?: string;
  token: string;
}) => {
  const idOrName = projectId || projectName;

  if (!idOrName) {
    return undefined;
  }

  const projectUrl = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(idOrName)}`);

  if (teamId) {
    projectUrl.searchParams.set('teamId', teamId);
  }

  const cacheKey = projectUrl.toString();
  const cached = getCachedJson(projectDataCache, cacheKey);

  if (cached) {
    return cached;
  }

  const response = await fetch(projectUrl.toString(), {
    headers: getVercelApiHeaders(token)
  });

  if (!response.ok) {
    return undefined;
  }

  const data = await response.json();

  setCachedJson(projectDataCache, cacheKey, data, VERCEL_PROJECT_CACHE_MS);

  return data;
};

const getProjectDashboardUrl = ({
  deploymentId,
  ownerSlug,
  projectSlug
}: {
  deploymentId?: string;
  ownerSlug?: string;
  projectSlug?: string;
}) => {
  if (!ownerSlug || !projectSlug) {
    return undefined;
  }

  const baseUrl = `https://vercel.com/${ownerSlug}/${projectSlug}`;
  return deploymentId ? `${baseUrl}/${deploymentId}` : `${baseUrl}/deployments`;
};

const appendDeploymentIdToDashboardUrl = (dashboardUrl?: string, deploymentId?: string) => {
  if (!dashboardUrl || !deploymentId) {
    return dashboardUrl;
  }

  const cleanDashboardUrl = dashboardUrl.replace(/\/$/, '');

  if (cleanDashboardUrl.endsWith(`/${deploymentId}`)) {
    return cleanDashboardUrl;
  }

  const deploymentsIndex = cleanDashboardUrl.indexOf('/deployments');

  if (deploymentsIndex >= 0) {
    return `${cleanDashboardUrl.slice(0, deploymentsIndex)}/${deploymentId}`;
  }

  return `${cleanDashboardUrl}/${deploymentId}`;
};

const getOwnerSlugFromDeploymentHost = (host: string) => {
  const parts = host.split('-');

  return parts.at(-1) === 'projects' && parts.at(-2)
    ? `${parts.at(-2)}-projects`
    : process.env.VERCEL_DASHBOARD_TEAM_SLUG;
};

const getProjectSlugFromDeploymentHost = (host: string, ownerSlug?: string) => {
  if (host.includes('-git-')) {
    return host.split('-git-')[0];
  }

  const withoutOwner =
    ownerSlug && host.endsWith(`-${ownerSlug}`)
      ? host.slice(0, -(ownerSlug.length + 1))
      : host;
  const parts = withoutOwner.split('-').filter(Boolean);

  if (parts.length > 1) {
    return parts.slice(0, -1).join('-');
  }

  return withoutOwner || undefined;
};

const getDashboardUrlFromDeploymentHost = (url?: string, deploymentId?: string) => {
  const normalized = normaliseUrl(url);

  if (!normalized) {
    return undefined;
  }

  try {
    const host = new URL(normalized).hostname.replace(/\.vercel\.app$/i, '');
    const ownerSlug = getOwnerSlugFromDeploymentHost(host);
    const projectSlug =
      process.env.VERCEL_GIT_REPO_SLUG ||
      process.env.VERCEL_GIT_REPO ||
      getProjectSlugFromDeploymentHost(host, ownerSlug);

    if (!ownerSlug || !projectSlug) {
      return undefined;
    }

    return getProjectDashboardUrl({
      deploymentId,
      ownerSlug,
      projectSlug
    });
  } catch {
    return undefined;
  }
};

const getDeploymentDashboardUrl = ({
  deploymentId,
  deploymentUrl,
  ownerSlug,
  projectSlug
}: {
  deploymentId?: string;
  deploymentUrl?: string;
  ownerSlug?: string;
  projectSlug?: string;
}) => {
  const projectDashboardUrl = getProjectDashboardUrl({
    deploymentId,
    ownerSlug,
    projectSlug
  });

  if (projectDashboardUrl) {
    return projectDashboardUrl;
  }

  return appendDeploymentIdToDashboardUrl(
    getDashboardUrlFromDeploymentHost(deploymentUrl, deploymentId),
    deploymentId
  );
};

const getTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return value > 100000000000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const parsedNumber = Number(value);

    if (!Number.isNaN(parsedNumber)) {
      return parsedNumber > 100000000000 ? parsedNumber : parsedNumber * 1000;
    }

    const parsedDate = Date.parse(value);
    return Number.isNaN(parsedDate) ? undefined : parsedDate;
  }

  return undefined;
};

const getDeploymentReadyAt = (deployment: unknown) => {
  return (
    getTimestamp(getObjectValue(deployment, 'ready')) ||
    getTimestamp(getObjectValue(deployment, 'readyAt')) ||
    getTimestamp(getObjectValue(deployment, 'buildingAt')) ||
    getTimestamp(getObjectValue(deployment, 'createdAt'))
  );
};

const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) {
    return undefined;
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const suffix = diffMs < 0 ? ' from now' : '';
  const units: Array<[string, number]> = [
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000],
    ['s', 1000],
  ];

  for (const [unit, ms] of units) {
    if (absMs >= ms || unit === 's') {
      return `${Math.max(0, Math.round(absMs / ms))}${unit}${suffix}`;
    }
  }

  return undefined;
};

const getLastReadyDeployment = (deployments: unknown[]) => {
  return deployments.find((deployment) => getDeploymentState(deployment) === 'ready');
};

const isMatchingDeployment = ({
  branch,
  commitSha,
  deployment,
}: {
  branch?: string;
  commitSha?: string;
  deployment: unknown;
}) => {
  const meta = getObjectValue(deployment, 'meta') || {};
  const gitSource = getObjectValue(deployment, 'gitSource') || {};

  return (
    (commitSha && getStringValue(meta, 'githubCommitSha') === commitSha) ||
    (commitSha && getStringValue(gitSource, 'sha') === commitSha) ||
    (branch && getStringValue(meta, 'githubCommitRef') === branch) ||
    (branch && getStringValue(gitSource, 'ref') === branch)
  );
};

const getDeploymentId = (deployment: unknown) => {
  return getStringValue(deployment, 'uid') || getStringValue(deployment, 'id');
};

const getDeploymentBranch = (deployment: unknown) => {
  const meta = getObjectValue(deployment, 'meta');
  const gitSource = getObjectValue(deployment, 'gitSource');

  return (
    getStringValue(meta, 'githubCommitRef') ||
    getStringValue(gitSource, 'ref') ||
    getStringValue(deployment, 'target')
  );
};

const getDeploymentCommitSha = (deployment: unknown) => {
  const meta = getObjectValue(deployment, 'meta');
  const gitSource = getObjectValue(deployment, 'gitSource');

  return getStringValue(meta, 'githubCommitSha') || getStringValue(gitSource, 'sha');
};

const getDeploymentEnvironment = (deployment: unknown) => {
  return getStringValue(deployment, 'target') || getStringValue(deployment, 'type');
};

const getDeploymentCreatedAt = (deployment: unknown) => {
  return (
    getTimestamp(getObjectValue(deployment, 'createdAt')) ||
    getTimestamp(getObjectValue(deployment, 'created')) ||
    getTimestamp(getObjectValue(deployment, 'buildingAt'))
  );
};

const getDeploymentSummaryTimestamp = (deployment: VercelDeploymentSummary) => {
  const createdAt = getTimestamp(deployment.createdAt);
  const readyAt = getTimestamp(deployment.readyAt);

  return createdAt || readyAt || 0;
};

const getBranchDeploymentKey = (deployment: VercelDeploymentSummary) => {
  const branch = deployment.branch?.trim().toLowerCase();

  return branch || `url:${deployment.url}`;
};

export const groupVercelDeployments = ({
  deployments,
  branchLimit = DEFAULT_DEPLOYMENT_BRANCH_LIMIT,
  historyLimit = DEFAULT_DEPLOYMENT_HISTORY_LIMIT
}: {
  deployments: VercelDeploymentSummary[];
  branchLimit?: number | string | null;
  historyLimit?: number | string | null;
}): VercelDeploymentGroup[] => {
  const resolvedBranchLimit = normaliseDeploymentBranchLimit(branchLimit);
  const resolvedHistoryLimit = normaliseDeploymentHistoryLimit(historyLimit);
  const groups: VercelDeploymentGroup[] = [];
  const groupsByID = new Map<string, VercelDeploymentGroup>();
  const seenDeployments = new Set<string>();
  const sortedDeployments = [...deployments]
    .sort((left, right) => getDeploymentSummaryTimestamp(right) - getDeploymentSummaryTimestamp(left));

  for (const deployment of sortedDeployments) {
    const deploymentKey = deployment.id?.trim() || deployment.url;

    if (seenDeployments.has(deploymentKey)) {
      continue;
    }

    seenDeployments.add(deploymentKey);

    const groupID = getBranchDeploymentKey(deployment);
    let group = groupsByID.get(groupID);

    if (!group) {
      if (resolvedBranchLimit !== null && groups.length >= resolvedBranchLimit) {
        continue;
      }

      group = {
        branch: deployment.branch,
        deployments: [],
        id: groupID
      };
      groupsByID.set(groupID, group);
      groups.push(group);
    }

    if (group.deployments.length < resolvedHistoryLimit) {
      group.deployments.push(deployment);
    }
  }

  return groups;
};

const getBuildProgressFromChecks = (checks: unknown): { progress?: number; phase?: string } => {
  if (!Array.isArray(checks)) {
    return {};
  }

  let activePhases: string[] = [];
  let completeCount = 0;
  let totalCount = 0;

  for (const rawCheck of checks) {
    if (typeof rawCheck !== 'object' || rawCheck === null) {
      continue;
    }

    const check = rawCheck as Record<string, unknown>;
    const name = typeof check.name === 'string' ? check.name : undefined;
    const state = String(check.state || check.status || '').toUpperCase();

    if (!name) {
      continue;
    }

    totalCount += 1;

    if (state === 'ERROR' || state === 'FAILED' || state === 'CANCELLED') {
      completeCount = -1;
      activePhases = ['Error'];
      continue;
    }

    if (state === 'READY' || state === 'DONE' || state === 'SUCCEEDED' || state === 'COMPLETED') {
      completeCount += 1;
      continue;
    }

    if (state === 'IN_PROGRESS' || state === 'RUNNING' || state === 'BUILDING' || state === 'PROCESSING' || state === 'PENDING') {
      activePhases.push(name);
    }
  }

  if (totalCount === 0) {
    return {};
  }

  if (completeCount < 0) {
    return {
      phase: activePhases[0] || 'Error',
      progress: 0
    };
  }

  const percentage = totalCount === 0 ? undefined : clampPercent((completeCount / totalCount) * 100);
  const inProgressPhase = activePhases[0] || 'Build in progress';

  return {
    phase: inProgressPhase,
    progress: percentage
  };
};

const formatBuildPhase = (phase?: string, state?: VercelDeploymentStatus['state']) => {
  if (phase) {
    return phase;
  }

  switch (state) {
    case 'queued':
      return 'Queued';
    case 'initializing':
      return 'Initializing';
    case 'building':
      return 'Building';
    case 'ready':
      return 'Ready';
    case 'canceled':
      return 'Canceled';
    case 'blocked':
      return 'Blocked';
    case 'error':
      return 'Error';
    case 'local':
      return 'Local';
    default:
      return 'Unknown';
  }
};

const getTokenlessFallback = ({
  branch,
  commitSha,
  deploymentUrl,
  environment
}: {
  branch?: string;
  commitSha?: string;
  deploymentUrl?: string;
  environment?: string;
}): VercelDeploymentStatus => {
  const branchUrl = normaliseUrl(process.env.VERCEL_BRANCH_URL);
  const repoSlug = process.env.VERCEL_GIT_REPO_SLUG || process.env.VERCEL_GIT_REPO;
  const teamSlug =
    process.env.VERCEL_DASHBOARD_TEAM_SLUG ||
    process.env.VERCEL_TEAM_SLUG ||
    process.env.VERCEL_ORG_SLUG;
  const hostDashboardUrl = getDashboardUrlFromDeploymentHost(branchUrl || deploymentUrl);

  const dashboardPath =
    teamSlug && repoSlug
      ? `https://vercel.com/${teamSlug}/${repoSlug}/deployments`
      : hostDashboardUrl
        ? hostDashboardUrl
      : branchUrl
        ? branchUrl
        : deploymentUrl;

  return {
    branch,
    commitSha,
    buildPageUrl: dashboardPath,
    buildPhase: 'Tokenless dashboard view',
    configured: false,
    deploymentUrl,
    environment,
    hasError: false,
    latestDeploymentUrl: branchUrl || deploymentUrl,
    label: `Vercel: ${environment || 'deployment'} (tokenless)`,
    state: environment ? 'ready' : 'unknown'
  };
};

export const getVercelDeploymentStatus = async (): Promise<VercelDeploymentStatus> => {
  try {
    const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.THINGTIME_BRANCH_NAME;
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
    const deploymentUrl = normaliseUrl(process.env.VERCEL_URL);
    const environment = process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;
    const token = process.env.VERCEL_API_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID || DEFAULT_VERCEL_PROJECT_ID;
    const projectName =
      process.env.VERCEL_GIT_REPO_SLUG ||
      process.env.VERCEL_GIT_REPO;
    const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || DEFAULT_VERCEL_TEAM_ID;

    if (!token && !process.env.VERCEL && !deploymentUrl) {
      return {
        branch,
        commitSha,
        hasError: false,
        configured: false,
        environment: 'local',
        label: 'Vercel: local',
        state: 'local'
      };
    }

    const fallback = getTokenlessFallback({
      branch,
      commitSha,
      environment,
      deploymentUrl
    });

    // Webhook-fed fast path (TODO item 5): once Vercel pushes deployment
    // events to /api/v1/vercel/webhook, terminal states are served from the
    // persisted doc without spending Vercel API calls — a ready deployment
    // stays ready until the next webhook event says otherwise. Mid-build
    // states still fall through to the live poll for phase/progress detail.
    //
    // A failure is only served from the store when the entry provably belongs
    // to THIS deployment. One branch can have concurrent sibling deployments
    // sharing the single stored slot, and a sibling's `ready` is harmless while
    // a sibling's `error`/`canceled` would paint a healthy instance red — and
    // this feeds /api/v1/health/vercel, so it would also report the deployment
    // as failed — until the next event for that branch arrives. Unproven
    // failures fall through to the live poll: exactly the pre-webhook path.
    if (isVercelWebhookConfigured()) {
      const persisted = await getPersistedBranchStatus(branch);
      const isFailureState = persisted?.state === 'error' || persisted?.state === 'canceled';
      const servable =
        persisted?.state === 'ready' ||
        (isFailureState && persistedStatusIsForDeployment(persisted, { commitSha, deploymentUrl }));
      if (persisted && servable) {
        const lastReadyAtMs = persisted.lastReadyAt ? Date.parse(persisted.lastReadyAt) : undefined;
        return {
          ...fallback,
          buildId: persisted.deploymentId,
          buildPageUrl: persisted.inspectorUrl || fallback.buildPageUrl,
          buildPhase: undefined,
          buildProgress: persisted.state === 'ready' ? 100 : 0,
          configured: true,
          environment: persisted.environment || environment,
          // Mongo persists undefined as null — normalise so ready states don't
          // serialise an error:null field
          error: persisted.error || undefined,
          hasError: persisted.state === 'error',
          lastReadyAt: persisted.lastReadyAt,
          lastReadyLabel: formatRelativeTime(Number.isFinite(lastReadyAtMs) ? lastReadyAtMs : undefined),
          lastReadyUrl: persisted.lastReadyUrl || persisted.deploymentUrl,
          latestDeploymentUrl: persisted.deploymentUrl || fallback.latestDeploymentUrl,
          label: `Vercel: ${persisted.state}`,
          state: persisted.state
        };
      }
    }

    if (!token) {
      return fallback;
    }

    const data = await getVercelDeploymentsPage({
      limit: DEFAULT_DEPLOYMENT_API_PAGE_SIZE,
      projectId,
      projectName,
      teamId,
      token
    });
    const projectData = await getVercelProjectData({
      projectId,
      projectName,
      teamId,
      token
    });
    const deployments = Array.isArray(data?.deployments) ? data.deployments : [];
    const currentDeployment =
      deployments.find((deployment) => {
        return (
          isLiveStatusDeployment(deployment) &&
          isMatchingDeployment({
            branch,
            commitSha,
            deployment
          })
        );
      }) || deployments.find(isLiveStatusDeployment);

    if (!currentDeployment) {
      return fallback;
    }

    const lastReadyDeployment = getLastReadyDeployment(deployments);
    const state = getDeploymentState(currentDeployment);
    const latestDeploymentUrl = normaliseUrl(currentDeployment.url);
    const deploymentId =
      (typeof currentDeployment.uid === 'string' && currentDeployment.uid) ||
      (typeof currentDeployment.id === 'string' && currentDeployment.id) ||
      undefined;

    const deploymentMeta =
      typeof currentDeployment.meta === 'object' && currentDeployment.meta !== null
        ? (currentDeployment.meta as Record<string, unknown>)
        : {};
    const dashboardOwnerSlug =
      getDashboardOwnerSlug(projectData) ||
      getDashboardOwnerSlug(deploymentMeta) ||
      getDashboardOwnerSlug(currentDeployment);
    const dashboardProjectSlug = getDashboardProjectSlug(projectData, projectName);
    const dashboardUrl = getProjectDashboardUrl({
      ownerSlug: dashboardOwnerSlug,
      projectSlug: dashboardProjectSlug
    }) || getDashboardUrlFromDeploymentHost(process.env.VERCEL_BRANCH_URL || deploymentUrl);
    const lastReadyAt = getDeploymentReadyAt(lastReadyDeployment);
    const lastReadyDeploymentId =
      (typeof getObjectValue(lastReadyDeployment, 'uid') === 'string' && getObjectValue(lastReadyDeployment, 'uid')) ||
      (typeof getObjectValue(lastReadyDeployment, 'id') === 'string' && getObjectValue(lastReadyDeployment, 'id')) ||
      undefined;
    const lastReadyUrl =
      normaliseUrl(getStringValue(lastReadyDeployment, 'url')) ||
      getProjectDashboardUrl({
        deploymentId: typeof lastReadyDeploymentId === 'string' ? lastReadyDeploymentId : undefined,
        ownerSlug: dashboardOwnerSlug,
        projectSlug: dashboardProjectSlug
      }) ||
      dashboardUrl;

    const checksFromDeployment = currentDeployment.checks || currentDeployment.builds;
    const checksProgress = getBuildProgressFromChecks(checksFromDeployment);

    const readySubstate = typeof currentDeployment.readySubstate === 'string' ? currentDeployment.readySubstate : undefined;
    const stateProgress =
      checksProgress.progress ??
      normaliseProgress(currentDeployment.progress) ??
      normaliseProgress(currentDeployment.progressPercent);

    const phaseLabel =
      readySubstate ||
      checksProgress.phase ||
      formatBuildPhase(undefined, state);

    const buildPageUrl =
      normaliseUrl(typeof currentDeployment.inspectorUrl === 'string' ? currentDeployment.inspectorUrl : '') ||
      getProjectDashboardUrl({
        deploymentId,
        ownerSlug: dashboardOwnerSlug,
        projectSlug: dashboardProjectSlug
      }) ||
      dashboardUrl;

    const resolvedBuildProgress =
      state === 'ready'
        ? 100
        : state === 'error' || state === 'blocked'
          ? 0
          : (stateProgress ?? undefined);

    const labelState = state === 'local' ? 'unknown' : state;

    return {
      ...fallback,
      buildId: deploymentId,
      buildPageUrl,
      buildPhase: phaseLabel,
      buildProgress: resolvedBuildProgress,
      configured: true,
      hasError: state === 'error' || state === 'blocked',
      lastReadyAt: lastReadyAt ? new Date(lastReadyAt).toISOString() : undefined,
      lastReadyLabel: formatRelativeTime(lastReadyAt),
      lastReadyUrl,
      latestDeploymentUrl,
      label: `Vercel: ${labelState}`,
      state
    };
  } catch (err: any) {
    const fallbackEnvironment =
      process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || 'deployment';
    const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.THINGTIME_BRANCH_NAME;
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
    const deploymentUrl = normaliseUrl(process.env.VERCEL_URL);
    const fallbackDashboardUrl = getDashboardUrlFromDeploymentHost(process.env.VERCEL_BRANCH_URL || deploymentUrl);

    return {
      ...getTokenlessFallback({
        branch,
        commitSha,
        deploymentUrl,
        environment: fallbackEnvironment
      }),
      buildPhase: undefined,
      buildPageUrl: fallbackDashboardUrl,
      error: safeErrorText(err, 'vercel status', 'Vercel status unavailable'),
      hasError: true,
      label: 'Vercel: status unavailable',
      state: 'unknown'
    };
  }
};

export const getVercelDeploymentsOverview = async ({
  historyLimit = DEFAULT_DEPLOYMENT_HISTORY_LIMIT,
  limit = DEFAULT_DEPLOYMENT_BRANCH_LIMIT,
  maxPages = DEFAULT_DEPLOYMENT_MAX_PAGES,
  pageSize = DEFAULT_DEPLOYMENT_API_PAGE_SIZE
}: {
  historyLimit?: number | string | null;
  limit?: number | string | null;
  maxPages?: number;
  pageSize?: number;
} = {}): Promise<VercelDeploymentsOverview> => {
  const branchLimit = normaliseDeploymentBranchLimit(limit);
  const deploymentHistoryLimit = normaliseDeploymentHistoryLimit(historyLimit);
  const fetchedAt = new Date().toISOString();
  const token = process.env.VERCEL_API_TOKEN;
  const deploymentUrl = normaliseUrl(process.env.VERCEL_URL);
  const projectId = process.env.VERCEL_PROJECT_ID || DEFAULT_VERCEL_PROJECT_ID;
  const projectName =
    process.env.VERCEL_GIT_REPO_SLUG ||
    process.env.VERCEL_GIT_REPO;
  const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || DEFAULT_VERCEL_TEAM_ID;

  const fallbackDeployments: VercelDeploymentSummary[] = deploymentUrl
    ? [
        {
          branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.THINGTIME_BRANCH_NAME,
          createdAt: fetchedAt,
          commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
          environment: process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV,
          state: (process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV) ? 'ready' : 'unknown',
          url: deploymentUrl
        }
      ]
    : [];

  if (!token) {
    const deploymentGroups = groupVercelDeployments({
      branchLimit,
      deployments: fallbackDeployments,
      historyLimit: deploymentHistoryLimit
    });

    return {
      branchLimit,
      configured: false,
      deploymentGroups,
      deploymentHistoryLimit,
      deployments: fallbackDeployments,
      deploymentPageCount: 0,
      deploymentScanCount: fallbackDeployments.length,
      deploymentScanLimit: fallbackDeployments.length,
      fetchedAt,
      hasError: false,
      label: fallbackDeployments.length ? 'Tokenless Vercel deployment' : 'Vercel API token not configured',
      projectName,
      source: fallbackDeployments.length ? 'tokenless' : 'local',
      totalBranchCount: fallbackDeployments.length,
      uniqueBranchCount: fallbackDeployments.length,
      uniqueUrlCount: fallbackDeployments.length
    };
  }

  try {
    const apiPageSize = Math.max(1, Math.min(100, pageSize));
    const apiMaxPages = Math.max(1, Math.min(10, maxPages));
    const data = await getVercelDeploymentsPages({
      maxPages: apiMaxPages,
      pageSize: apiPageSize,
      projectId,
      projectName,
      teamId,
      token
    });
    const projectData = await getVercelProjectData({
      projectId,
      projectName,
      teamId,
      token
    });
    const dashboardOwnerSlug = getDashboardOwnerSlug(projectData);
    const dashboardProjectSlug = getDashboardProjectSlug(projectData, projectName);
    const deployments = data.deployments;
    const allDeploymentSummaries = deployments.reduce<VercelDeploymentSummary[]>((items, deployment) => {
      const url = normaliseUrl(getStringValue(deployment, 'url'));

      if (!url) {
        return items;
      }

      const id = getDeploymentId(deployment);
      const readyAt = getDeploymentReadyAt(deployment);
      const createdAt = getDeploymentCreatedAt(deployment);

      const deploymentMeta = getObjectValue(deployment, 'meta');
      const deploymentOwnerSlug =
        dashboardOwnerSlug ||
        getDashboardOwnerSlug(deploymentMeta) ||
        getDashboardOwnerSlug(deployment);
      const deploymentProjectSlug =
        dashboardProjectSlug ||
        getDashboardProjectSlug(getObjectValue(deployment, 'project'), projectName) ||
        getStringValue(deployment, 'name') ||
        projectName;

      items.push({
        branch: getDeploymentBranch(deployment),
        commitSha: getDeploymentCommitSha(deployment),
        createdAt: createdAt ? new Date(createdAt).toISOString() : undefined,
        dashboardUrl: getDeploymentDashboardUrl({
          deploymentUrl: url,
          deploymentId: id,
          ownerSlug: deploymentOwnerSlug,
          projectSlug: deploymentProjectSlug
        }),
        environment: getDeploymentEnvironment(deployment),
        id,
        readyAt: readyAt ? new Date(readyAt).toISOString() : undefined,
        readyLabel: formatRelativeTime(readyAt || createdAt),
        state: normaliseState(getStringValue(deployment, 'state') || getStringValue(deployment, 'readyState')),
        url
      });

      return items;
    }, [])
      .sort((left, right) => getDeploymentSummaryTimestamp(right) - getDeploymentSummaryTimestamp(left));

    const allDeploymentGroups = groupVercelDeployments({
      deployments: allDeploymentSummaries,
      historyLimit: deploymentHistoryLimit
    });
    const deploymentGroups = branchLimit === null
      ? allDeploymentGroups
      : allDeploymentGroups.slice(0, branchLimit);
    const deploymentSummaries = deploymentGroups
      .map((group) => group.deployments[0])
      .filter((deployment): deployment is VercelDeploymentSummary => Boolean(deployment));
    const totalBranchCount = allDeploymentGroups.length;
    const uniqueUrlCount = new Set(
      allDeploymentGroups
        .map((group) => group.deployments[0]?.url)
        .filter((url): url is string => Boolean(url))
    ).size;

    return {
      branchLimit,
      configured: true,
      deploymentGroups,
      deploymentHistoryLimit,
      deployments: deploymentSummaries,
      deploymentPageCount: data.pageCount,
      deploymentScanCount: deployments.length,
      deploymentScanLimit: apiMaxPages * apiPageSize,
      fetchedAt,
      hasError: false,
      label: `${deploymentSummaries.length} branch deployment${deploymentSummaries.length === 1 ? '' : 's'}`,
      projectName: getDashboardProjectSlug(projectData, projectName),
      source: 'api',
      totalBranchCount,
      uniqueBranchCount: totalBranchCount,
      uniqueUrlCount
    };
  } catch (err: any) {
    const deploymentGroups = groupVercelDeployments({
      branchLimit,
      deployments: fallbackDeployments,
      historyLimit: deploymentHistoryLimit
    });

    return {
      branchLimit,
      configured: true,
      deploymentGroups,
      deploymentHistoryLimit,
      deployments: fallbackDeployments,
      deploymentPageCount: 0,
      deploymentScanCount: fallbackDeployments.length,
      deploymentScanLimit: fallbackDeployments.length,
      error: safeErrorText(err, 'vercel deployments overview', 'Vercel deployments unavailable'),
      fetchedAt,
      hasError: true,
      label: 'Vercel deployments unavailable',
      projectName,
      source: fallbackDeployments.length ? 'tokenless' : 'api',
      totalBranchCount: fallbackDeployments.length,
      uniqueBranchCount: fallbackDeployments.length,
      uniqueUrlCount: fallbackDeployments.length
    };
  }
};
