export type StatusEnvironmentId =
  | 'current'
  | 'branch'
  | 'local'
  | 'development'
  | 'staging'
  | 'production';

export type StatusEnvironmentTarget = {
  id: StatusEnvironmentId;
  label: string;
  origin?: string;
  title: string;
};

const normaliseOrigin = (value?: string | null) => {
  const raw = value?.trim();

  if (!raw) {
    return undefined;
  }

  try {
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw);
    const withProtocol = /^https?:\/\//i.test(raw)
      ? raw
      : localHost
        ? `http://${raw}`
        : `https://${raw}`;
    return new URL(withProtocol).origin;
  } catch {
    return undefined;
  }
};

const getFirstOrigin = (env: Record<string, string | undefined>, keys: string[]) => {
  for (const key of keys) {
    const origin = normaliseOrigin(env[key]);

    if (origin) {
      return origin;
    }
  }

  return undefined;
};

const getHostPrefix = (origin?: string) => {
  if (!origin) {
    return '[TAB]';
  }

  try {
    const host = new URL(origin).hostname;

    if (host === 'localhost' || host === '127.0.0.1') return '[LC]';
    if (host.endsWith('.vercel.app')) return '[VC]';
    if (host.endsWith('.ts.net')) return '[TS]';
    if (host === 'thingtime.com') return '[PROD]';
  } catch {
    // Fall through to the generic branch prefix.
  }

  return '[ENV]';
};

const getBranchLabel = (branchName?: string, origin?: string) => {
  const trimmed = branchName?.trim();
  const safeBranch = trimmed && trimmed !== 'git/unknown' ? trimmed : 'Branch';

  return `${getHostPrefix(origin)} ${safeBranch}`;
};

export const getStatusEnvironmentTargets = ({
  currentOrigin,
  envFromCookie
}: {
  currentOrigin?: string;
  envFromCookie: Record<string, string | undefined>;
}): StatusEnvironmentTarget[] => {
  const normalizedCurrentOrigin = normaliseOrigin(currentOrigin);
  const branchOrigin = normaliseOrigin(envFromCookie.THINGTIME_VERCEL_BRANCH_URL);
  const branchName = envFromCookie.THINGTIME_BRANCH_NAME;
  const currentHost = (() => {
    try {
      return normalizedCurrentOrigin ? new URL(normalizedCurrentOrigin).hostname : undefined;
    } catch {
      return undefined;
    }
  })();
  const currentIsVercel = Boolean(currentHost?.endsWith('.vercel.app'));
  const resolvedBranchOrigin = branchOrigin || (currentIsVercel ? normalizedCurrentOrigin : undefined);
  const branchTarget = resolvedBranchOrigin
    ? [
        {
          id: 'branch' as const,
          label: getBranchLabel(branchName, resolvedBranchOrigin),
          origin: resolvedBranchOrigin,
          title: branchName
            ? `Checks the current branch deployment (${branchName})`
            : 'Checks the current branch deployment'
        }
      ]
    : [];

  return [
    {
      id: 'current',
      label: 'Current Tab',
      origin: normalizedCurrentOrigin,
      title: 'Checks the URL loaded in this browser tab'
    },
    ...branchTarget,
    {
      id: 'local',
      label: 'Local',
      origin: getFirstOrigin(envFromCookie, ['THINGTIME_LOCAL_STATUS_ORIGIN']) || 'http://localhost:9999',
      title: 'Checks the local Vite/Nitro development URL'
    },
    {
      id: 'development',
      label: 'Development',
      origin:
        getFirstOrigin(envFromCookie, [
          'THINGTIME_DEVELOPMENT_STATUS_ORIGIN',
          'THINGTIME_DEV_STATUS_ORIGIN'
        ]) || branchOrigin || 'https://dev.thingtime.com',
      title: 'Checks the configured development URL'
    },
    {
      id: 'staging',
      label: 'Staging',
      origin:
        getFirstOrigin(envFromCookie, [
          'THINGTIME_STAGING_STATUS_ORIGIN',
          'THINGTIME_STAGE_STATUS_ORIGIN'
        ]) || 'https://staging.thingtime.com',
      title: 'Checks the configured staging URL'
    },
    {
      id: 'production',
      label: 'Prod',
      origin:
        getFirstOrigin(envFromCookie, [
          'THINGTIME_PRODUCTION_STATUS_ORIGIN',
          'THINGTIME_PROD_STATUS_ORIGIN'
        ]) || 'https://thingtime.com',
      title: 'Checks the production URL'
    }
  ];
};

export const getDefaultStatusEnvironmentId = ({
  currentOrigin,
  envFromCookie
}: {
  currentOrigin?: string;
  envFromCookie: Record<string, string | undefined>;
}): StatusEnvironmentId => {
  const normalizedCurrentOrigin = normaliseOrigin(currentOrigin);
  const environments = getStatusEnvironmentTargets({ currentOrigin, envFromCookie });

  if (
    environments.some(
      (environment) =>
        environment.id === 'current' &&
        environment.origin === normalizedCurrentOrigin
    )
  ) {
    return 'current';
  }

  return environments[0]?.id || 'current';
};

export const getStatusEndpoint = (path: string, targetOrigin?: string) => {
  if (!targetOrigin) {
    return path;
  }

  const params = new URLSearchParams({ targetOrigin });
  return `${path}?${params.toString()}`;
};

export const getStatusHref = (targetOrigin: string | undefined, path: string) => {
  if (!targetOrigin) {
    return path;
  }

  return `${targetOrigin}${path}`;
};
