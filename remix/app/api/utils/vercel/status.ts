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
  latestDeploymentUrl?: string;
  state: 'local' | 'ready' | 'building' | 'queued' | 'error' | 'unknown';
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
  const repoOwner = process.env.VERCEL_GIT_REPO_OWNER;
  const repoSlug = process.env.VERCEL_GIT_REPO_SLUG || process.env.VERCEL_GIT_REPO;

  const dashboardPath =
    repoOwner && repoSlug
      ? `https://vercel.com/${repoOwner}/${repoSlug}/deployments`
      : branchUrl
        ? `${branchUrl}/_/` // safe fallback anchor near deployment host
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
    const projectId = process.env.VERCEL_PROJECT_ID;
    const projectName = process.env.VERCEL_PROJECT_NAME;
    const teamId = process.env.VERCEL_TEAM_ID;

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

    if (!token || (!projectId && !projectName)) {
      return fallback;
    }

    const url = new URL('https://api.vercel.com/v6/deployments');
    url.searchParams.set('limit', '20');

    if (projectId) {
      url.searchParams.set('projectId', projectId);
    } else if (projectName) {
      url.searchParams.set('app', projectName);
    }

    if (teamId) {
      url.searchParams.set('teamId', teamId);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Vercel API returned ${response.status}`);
    }

    const data = await response.json();
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
      (projectName && deploymentId
        ? `https://vercel.com/${deploymentMeta.orgName || 'team'}/${projectName}/deployments/${deploymentId}`
        : undefined);

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
      hasError: state === 'error',
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

    return {
      ...getTokenlessFallback({
        branch,
        commitSha,
        deploymentUrl,
        environment: fallbackEnvironment
      }),
      error: err?.message || String(err),
      hasError: true,
      label: 'Vercel: status unavailable',
      state: 'unknown'
    };
  }
};
