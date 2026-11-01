import type { DeploymentDataEnvironment } from '~/api/utils/deployment/dataEnvironment';

export const SSO_HUB_PRODUCTION = 'https://thingtime.com';
export const SSO_HUB_DEVELOP = 'https://dev.thingtime.com';
export const SSO_HUB_CACHE_KEY = 'tt-sso-hub';

export type SsoHubEnvironment = {
	dataEnvironment?: Pick<DeploymentDataEnvironment, 'kind' | 'authorityOrigin'> | null;
	branch?: string;
	vercelEnv?: string;
};

const validOrigin = (value: unknown): string | null => {
	if (typeof value !== 'string' || !value) return null;
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		return url.origin;
	} catch {
		return null;
	}
};

// An immutable Vercel preview is deployed from a feature branch, not
// `develop`, but it belongs to the development account/session environment.
// Keep the production authority exclusive to a production deploy or `main`.
export const resolveSsoHub = (environment?: SsoHubEnvironment, override?: unknown): string | null => {
	const explicitHub = validOrigin(override);
	if (explicitHub) return explicitHub;

	// New deployments publish their database/authentication authority in
	// root-data. URL tier and Git branch are never consulted when it is present.
	if (environment?.dataEnvironment) {
		const configuredHub = validOrigin(environment.dataEnvironment.authorityOrigin);
		if (configuredHub) return configuredHub;
		if (environment.dataEnvironment.kind === 'production') return SSO_HUB_PRODUCTION;
		if (environment.dataEnvironment.kind === 'development') return SSO_HUB_DEVELOP;
		return null;
	}

	// One release-window fallback for servers that predate the explicit
	// dataEnvironment contract. New bundles negotiate api.capabilities ^1.1.0.
	if (environment?.vercelEnv === 'production' || environment?.branch === 'main') {
		return SSO_HUB_PRODUCTION;
	}
	if (environment?.vercelEnv === 'preview' || environment?.vercelEnv === 'development' || environment?.branch === 'develop') {
		return SSO_HUB_DEVELOP;
	}
	return SSO_HUB_PRODUCTION;
};

export const ssoHubDisplayName = (hub: string | null) => {
	if (!hub) return 'Thingtime';
	return hub === SSO_HUB_DEVELOP ? 'Dev Thingtime' : 'Thingtime';
};
