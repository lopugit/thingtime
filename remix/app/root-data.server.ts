import { json } from './api/http';
import { getCurrentUser } from './api/utils/auth/getCurrentUser';
import { Session } from './cookies.server';

export type RootLoaderData = {
  envFromCookie: Record<string, string | undefined>;
  devKitEnv: Record<string, string | undefined>;
  titlePrefix: string;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
};

const getDeploymentBranchName = () => {
  return (
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.THINGTIME_BRANCH_NAME ||
    'git/unknown'
  );
};

const shouldShowDeploymentStatus = () => {
  const vercelEnvironment = process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;

  return (
    process.env.NODE_ENV === 'development' ||
    vercelEnvironment === 'preview' ||
    vercelEnvironment === 'production' ||
    process.env.THINGTIME_SHOW_DEPLOYMENT_STATUS === 'true'
  );
};

export async function loadRootData(request: Request) {
  const cookieHeader = request.headers.get('Cookie');
  const cookie = ((await Session.parse(cookieHeader)) || {}) as Record<string, unknown>;
  const cookiePingCounter = Number(cookie.pingCounter || 0);
  const pingCounter = cookiePingCounter + 1;
  const processEnv: RootLoaderData['envFromCookie'] = {};
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

  for (const key in process.env) {
    if (key.startsWith('THINGTIME_') && !key.includes('PRIVATE')) {
      processEnv[key] = process.env[key];
    }
  }

  processEnv.THINGTIME_BRANCH_NAME = getDeploymentBranchName();
  processEnv.THINGTIME_VERCEL_ENV =
    process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;
  processEnv.THINGTIME_VERCEL_URL = process.env.VERCEL_URL;
  processEnv.THINGTIME_VERCEL_BRANCH_URL = process.env.VERCEL_BRANCH_URL;
  processEnv.THINGTIME_VERCEL_GIT_COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA;
  processEnv.THINGTIME_SHOW_DEPLOYMENT_STATUS = shouldShowDeploymentStatus() ? 'true' : 'false';

  return {
    data: {
      envFromCookie: { ...processEnv },
      devKitEnv,
      titlePrefix,
      user: await getCurrentUser(request)
    } satisfies RootLoaderData,
    headers: {
      'Set-Cookie': await Session.serialize({ ...cookie, pingCounter })
    }
  };
}

export async function rootDataResponse(request: Request) {
  const { data, headers } = await loadRootData(request);
  return json(data, { headers });
}
