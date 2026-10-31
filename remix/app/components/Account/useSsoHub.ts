import { useRouteLoaderData } from 'react-router';
import { readLocalCache } from '~/hooks/localCache';
import { resolveSsoHub, SSO_HUB_CACHE_KEY, ssoHubDisplayName, type SsoHubEnvironment } from './ssoHub';
import { isFirstPartyPasskeyHost } from './ssoNavigation';

export const useSsoHub = () => {
	const root = useRouteLoaderData('root') as { dataEnvironment?: SsoHubEnvironment['dataEnvironment']; envFromCookie?: { THINGTIME_BRANCH_NAME?: string; THINGTIME_VERCEL_ENV?: string } } | undefined;
	const hub = resolveSsoHub({ dataEnvironment: root?.dataEnvironment, branch: root?.envFromCookie?.THINGTIME_BRANCH_NAME, vercelEnv: root?.envFromCookie?.THINGTIME_VERCEL_ENV }, readLocalCache<string>(SSO_HUB_CACHE_KEY));
	return { hub, name: ssoHubDisplayName(hub), foreign: typeof window !== 'undefined' && !isFirstPartyPasskeyHost(window.location.hostname) };
};
