import type { CiExecutionProvider } from './automationPolicy';

type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export const VERCEL_PROVIDER_REQUIRED_ENV = [
  'THINGTIME_GITHUB_APP_ID',
  'THINGTIME_GITHUB_APP_INSTALLATION_ID',
  'THINGTIME_GITHUB_APP_PRIVATE_KEY',
  'THINGTIME_CI_ROUTER_SECRET'
] as const;

const configured = (value: string | undefined) => Boolean(value?.trim());

export const ciProviderReadiness = (env: ProviderEnvironment = process.env) => {
  const githubAppConfigured = Boolean(
    configured(env.THINGTIME_GITHUB_APP_ID) &&
      configured(env.THINGTIME_GITHUB_APP_INSTALLATION_ID) &&
      configured(env.THINGTIME_GITHUB_APP_PRIVATE_KEY)
  );
  const providerRouterConfigured = configured(env.THINGTIME_CI_ROUTER_SECRET);
  const vercelRuntimeConfigured = Boolean(
    configured(env.VERCEL_OIDC_TOKEN) ||
      env.VERCEL === '1' ||
      (configured(env.VERCEL_TOKEN) && configured(env.VERCEL_PROJECT_ID) && configured(env.VERCEL_TEAM_ID))
  );
  const missing = [
    ...VERCEL_PROVIDER_REQUIRED_ENV.filter((key) => !configured(env[key])),
    ...(vercelRuntimeConfigured ? [] : ['VERCEL_OIDC_TOKEN or VERCEL_TOKEN/VERCEL_PROJECT_ID/VERCEL_TEAM_ID'])
  ];

  return {
    githubAppConfigured,
    providerRouterConfigured,
    vercelRuntimeConfigured,
    vercelRunnerReady: githubAppConfigured && providerRouterConfigured && vercelRuntimeConfigured,
    missing
  };
};

export const validateCiExecutionProvider = (
  executionProvider: CiExecutionProvider,
  env: ProviderEnvironment = process.env
): { ok: true } | { ok: false; error: string; missing: string[] } => {
  if (executionProvider !== 'vercel-sandbox') return { ok: true };
  const readiness = ciProviderReadiness(env);
  if (readiness.vercelRunnerReady) return { ok: true };
  return {
    ok: false,
    error: 'Vercel Sandbox is not ready. Complete the GitHub App, provider router, and Vercel runtime setup first.',
    missing: readiness.missing
  };
};
