export const SSO_HUB_PRODUCTION = 'https://thingtime.com';
export const SSO_HUB_DEVELOP = 'https://dev.thingtime.com';
export const SSO_HUB_CACHE_KEY = 'tt-sso-hub';

export type SsoHubEnvironment = {
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
export const resolveSsoHub = (environment?: SsoHubEnvironment, override?: unknown): string => {
	const explicitHub = validOrigin(override);
	if (explicitHub) return explicitHub;

	if (environment?.vercelEnv === 'production' || environment?.branch === 'main') {
		return SSO_HUB_PRODUCTION;
	}
	if (environment?.vercelEnv === 'preview' || environment?.vercelEnv === 'development' || environment?.branch === 'develop') {
		return SSO_HUB_DEVELOP;
	}
	return SSO_HUB_PRODUCTION;
};

export const ssoHubDisplayName = (hub: string) => (hub === SSO_HUB_DEVELOP ? 'Dev Thingtime' : 'Thingtime');
