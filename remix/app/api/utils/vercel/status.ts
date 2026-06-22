export type VercelDeploymentStatus = {
  branch?: string;
  commitSha?: string;
  configured: boolean;
  deploymentUrl?: string;
  environment?: string;
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

export const getVercelDeploymentStatus = async (): Promise<VercelDeploymentStatus> => {
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
      configured: false,
      environment: 'local',
      label: 'Vercel: local',
      state: 'local'
    };
  }

  const fallback: VercelDeploymentStatus = {
    branch,
    commitSha,
    configured: Boolean(token && (projectId || projectName)),
    deploymentUrl,
    environment,
    label: `Vercel: ${environment || 'deployment'} ready`,
    state: 'ready'
  };

  if (!token || (!projectId && !projectName)) {
    return fallback;
  }

  try {
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
      latestDeploymentUrl,
      label: `Vercel: ${labelState}`,
      state
    };
  } catch (err: any) {
    return {
      ...fallback,
      error: err?.message || String(err),
      label: 'Vercel: status unavailable',
      state: 'unknown'
    };
  }
};
