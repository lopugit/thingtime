import { json } from './api/http';
import { getDeploymentDataEnvironment, type DeploymentDataEnvironment } from './api/utils/deployment/dataEnvironment';
import { getCurrentUser } from './api/utils/auth/getCurrentUser';
import { isVercelStatusEnabled } from './api/utils/vercel/environment';
import { Session } from './cookies.server';

export type RootLoaderData = {
	envFromCookie: Record<string, string | undefined>;
	/** Public, non-secret database/authentication authority for this deployment. */
	dataEnvironment: DeploymentDataEnvironment | null;
	devKitEnv: Record<string, string | undefined>;
  titlePrefix: string;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
};

// Browser-visible configuration is fail-closed: only these public status
// origins may cross the server/client boundary. Never infer safety from an env
// prefix or a denylist — Thingtime's integration secrets intentionally share
// the THINGTIME_ prefix and must remain server-only.
const PUBLIC_THINGTIME_ENV_KEYS = [
  'THINGTIME_PRODUCTION_STATUS_ORIGIN',
  'THINGTIME_PROD_STATUS_ORIGIN',
  'THINGTIME_DEVELOPMENT_STATUS_ORIGIN',
  'THINGTIME_DEV_STATUS_ORIGIN',
  'THINGTIME_STAGING_STATUS_ORIGIN',
  'THINGTIME_STAGE_STATUS_ORIGIN',
  'THINGTIME_LOCAL_STATUS_ORIGIN'
] as const;

const getDeploymentBranchName = () => {
  return (
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.THINGTIME_BRANCH_NAME ||
    'git/unknown'
  );
};

export async function loadRootData(request: Request) {
  const cookieHeader = request.headers.get('Cookie');
  const cookie = ((await Session.parse(cookieHeader)) || {}) as Record<string, unknown>;
  const cookiePingCounter = Number(cookie.pingCounter || 0);
  const pingCounter = cookiePingCounter + 1;
  const processEnv: RootLoaderData['envFromCookie'] = Object.fromEntries(
    PUBLIC_THINGTIME_ENV_KEYS.flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]]
    )
  );
  const url = new URL(request.url);
  const devKitEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ...Object.fromEntries(url.searchParams)
  };
  const titlePrefix = (() => {
    if (url.hostname === 'thingtime.com') return '';
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return '[LC]';
    if (url.hostname.endsWith('.vercel.app')) return '[VC]';
    if (url.hostname.endsWith('.ts.net')) return '[TS]';
    return process.env.NODE_ENV === 'development' ? '[LC]' : '[DEV]';
  })();

  processEnv.THINGTIME_BRANCH_NAME = getDeploymentBranchName();
  processEnv.THINGTIME_VERCEL_ENV =
    process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;
  processEnv.THINGTIME_VERCEL_URL = process.env.VERCEL_URL;
  processEnv.THINGTIME_VERCEL_BRANCH_URL = process.env.VERCEL_BRANCH_URL;
  processEnv.THINGTIME_VERCEL_GIT_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA;
  processEnv.THINGTIME_SHOW_DEPLOYMENT_STATUS = isVercelStatusEnabled() ? 'true' : 'false';

  return {
		data: {
			envFromCookie: { ...processEnv },
			dataEnvironment: getDeploymentDataEnvironment(),
			devKitEnv,
      titlePrefix,
      user: await getCurrentUser(request)
    } satisfies RootLoaderData,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'Pragma': 'no-cache',
      'Set-Cookie': await Session.serialize({ ...cookie, pingCounter }),
      'Vary': 'Cookie'
    }
  };
}

export async function rootDataResponse(request: Request) {
  const { data, headers } = await loadRootData(request);
  return json(data, { headers });
}
