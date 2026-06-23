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
  state: 'local' | 'ready' | 'building' | 'queued' | 'error' | 'unknown';
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

export type VercelDeploymentsOverview = {
  configured: boolean;
  deployments: VercelDeploymentSummary[];
  error?: string;
  fetchedAt: string;
  hasError: boolean;
  label: string;
  projectName?: string;
  source: 'api' | 'local' | 'tokenless';
  uniqueUrlCount: number;
};

const DEFAULT_VERCEL_PROJECT_ID = 'prj_ZAX9FhGC2alHMXMwTHX96ql3EQ8v';
const DEFAULT_VERCEL_TEAM_ID = 'team_JsKhM6fVg9uo701feA0fLh9V';

export const isVercelStatusEnabled = () => {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.VERCEL_ENV === 'preview' ||
    process.env.VERCEL_TARGET_ENV === 'preview'
  );
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
  if (value === 'QUEUED' || value === 'INITIALIZING') {
    return 'queued';
  }
  if (value === 'ERROR' || value === 'CANCELED') {
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

const getVercelApiHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json'
});

const getVercelDeploymentsPage = async ({
  limit,
  projectId,
  projectName,
  teamId,
  token
}: {
  limit: number;
  projectId?: string;
  projectName?: string;
  teamId?: string;
  token: string;
}) => {
  const url = new URL('https://api.vercel.com/v6/deployments');
  url.searchParams.set('limit', String(limit));

  if (projectId) {
    url.searchParams.set('projectId', projectId);
  } else if (projectName) {
    url.searchParams.set('app', projectName);
  }

  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }

  let response = await fetch(url.toString(), {
    headers: getVercelApiHeaders(token)
  });

  if (response.status === 403 && teamId) {
    url.searchParams.delete('teamId');
    response = await fetch(url.toString(), {
      headers: getVercelApiHeaders(token)
    });
  }

  if (!response.ok) {
    throw new Error(`Vercel API returned ${response.status}`);
  }

  return response.json();
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

  const response = await fetch(projectUrl.toString(), {
    headers: getVercelApiHeaders(token)
  });

  if (!response.ok) {
    return undefined;
  }

  return response.json();
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

  const baseUrl = `https://vercel.com/${ownerSlug}/${projectSlug}/deployments`;
  return deploymentId ? `${baseUrl}/${deploymentId}` : baseUrl;
};

const getDashboardUrlFromDeploymentHost = (url?: string) => {
  const normalized = normaliseUrl(url);

  if (!normalized) {
    return undefined;
  }

  try {
    const host = new URL(normalized).hostname.replace(/\.vercel\.app$/i, '');
    const repoSlug =
      process.env.VERCEL_PROJECT_NAME ||
      process.env.VERCEL_GIT_REPO_SLUG ||
      process.env.VERCEL_GIT_REPO ||
      host.split('-git-')[0] ||
      host.split('-')[0];
    const parts = host.split('-');
    const ownerSlug =
      parts.at(-1) === 'projects' && parts.at(-2)
        ? `${parts.at(-2)}-projects`
        : process.env.VERCEL_DASHBOARD_TEAM_SLUG;

    if (!ownerSlug || !repoSlug) {
      return undefined;
    }

    return `https://vercel.com/${ownerSlug}/${repoSlug}/deployments`;
  } catch {
    return undefined;
  }
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
  return deployments.find((deployment) => normaliseState(
    getStringValue(deployment, 'state') || getStringValue(deployment, 'readyState')
  ) === 'ready');
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
    case 'building':
      return 'Building';
    case 'ready':
      return 'Ready';
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
      process.env.VERCEL_PROJECT_NAME ||
      process.env.VERCEL_GIT_REPO_SLUG ||
      process.env.VERCEL_GIT_REPO;
    const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || DEFAULT_VERCEL_TEAM_ID;

    if (!process.env.VERCEL && !deploymentUrl) {
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

    if (!token) {
      return fallback;
    }

    const data = await getVercelDeploymentsPage({
      limit: 20,
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
        const meta = deployment?.meta || {};
        const gitSource = deployment?.gitSource || {};
        return (
          (commitSha && meta.githubCommitSha === commitSha) ||
          (commitSha && gitSource.sha === commitSha) ||
          (branch && meta.githubCommitRef === branch) ||
          (branch && gitSource.ref === branch)
        );
      }) || deployments[0];

    if (!currentDeployment) {
      return fallback;
    }

    const lastReadyDeployment = getLastReadyDeployment(deployments);
    const state = normaliseState(currentDeployment.state || currentDeployment.readyState);
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
        : state === 'error'
          ? 0
          : (stateProgress ?? undefined);

    const labelState =
      state === 'ready'
        ? 'ready'
        : state === 'building'
          ? 'building'
          : state === 'queued'
            ? 'queued'
            : state === 'error'
              ? 'error'
              : 'unknown';

    return {
      ...fallback,
      buildId: deploymentId,
      buildPageUrl,
      buildPhase: phaseLabel,
      buildProgress: resolvedBuildProgress,
      configured: true,
      hasError: state === 'error',
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
      error: err?.message || String(err),
      hasError: true,
      label: 'Vercel: status unavailable',
      state: 'unknown'
    };
  }
};

export const getVercelDeploymentsOverview = async ({
  limit = 100
}: {
  limit?: number;
} = {}): Promise<VercelDeploymentsOverview> => {
  const fetchedAt = new Date().toISOString();
  const token = process.env.VERCEL_API_TOKEN;
  const deploymentUrl = normaliseUrl(process.env.VERCEL_URL);
  const projectId = process.env.VERCEL_PROJECT_ID || DEFAULT_VERCEL_PROJECT_ID;
  const projectName =
    process.env.VERCEL_PROJECT_NAME ||
    process.env.VERCEL_GIT_REPO_SLUG ||
    process.env.VERCEL_GIT_REPO;
  const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || DEFAULT_VERCEL_TEAM_ID;

  const fallbackDeployments: VercelDeploymentSummary[] = deploymentUrl
    ? [
        {
          branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.THINGTIME_BRANCH_NAME,
          commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
          environment: process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV,
          state: (process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV) ? 'ready' : 'unknown',
          url: deploymentUrl
        }
      ]
    : [];

  if (!token) {
    return {
      configured: false,
      deployments: fallbackDeployments,
      fetchedAt,
      hasError: false,
      label: fallbackDeployments.length ? 'Tokenless Vercel deployment' : 'Vercel API token not configured',
      projectName,
      source: fallbackDeployments.length ? 'tokenless' : 'local',
      uniqueUrlCount: fallbackDeployments.length
    };
  }

  try {
    const data = await getVercelDeploymentsPage({
      limit: Math.max(1, Math.min(100, limit)),
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
    const deployments = Array.isArray(data?.deployments) ? data.deployments : [];
    const seenUrls = new Set<string>();

    const deploymentSummaries = deployments.reduce<VercelDeploymentSummary[]>((items, deployment) => {
      const url = normaliseUrl(getStringValue(deployment, 'url'));

      if (!url || seenUrls.has(url)) {
        return items;
      }

      seenUrls.add(url);

      const id = getDeploymentId(deployment);
      const readyAt = getDeploymentReadyAt(deployment);
      const createdAt = getDeploymentCreatedAt(deployment);

      items.push({
        branch: getDeploymentBranch(deployment),
        commitSha: getDeploymentCommitSha(deployment),
        createdAt: createdAt ? new Date(createdAt).toISOString() : undefined,
        dashboardUrl: getProjectDashboardUrl({
          deploymentId: id,
          ownerSlug: dashboardOwnerSlug,
          projectSlug: dashboardProjectSlug
        }),
        environment: getDeploymentEnvironment(deployment),
        id,
        readyAt: readyAt ? new Date(readyAt).toISOString() : undefined,
        readyLabel: formatRelativeTime(readyAt || createdAt),
        state: normaliseState(getStringValue(deployment, 'state') || getStringValue(deployment, 'readyState')),
        url
      });

      return items;
    }, []);

    return {
      configured: true,
      deployments: deploymentSummaries,
      fetchedAt,
      hasError: false,
      label: `${deploymentSummaries.length} unique deployment URL${deploymentSummaries.length === 1 ? '' : 's'}`,
      projectName: getDashboardProjectSlug(projectData, projectName),
      source: 'api',
      uniqueUrlCount: deploymentSummaries.length
    };
  } catch (err: any) {
    return {
      configured: true,
      deployments: fallbackDeployments,
      error: err?.message || String(err),
      fetchedAt,
      hasError: true,
      label: 'Vercel deployments unavailable',
      projectName,
      source: fallbackDeployments.length ? 'tokenless' : 'api',
      uniqueUrlCount: fallbackDeployments.length
    };
  }
};
