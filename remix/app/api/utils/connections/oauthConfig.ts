export const oauthCallbackPath = '/api/v1/connections/oauth/callback';

// Deployment-owned redirect, never an arbitrary Host/forwarding header. Local
// development may use a loopback origin; hosted deployments configure the base.
export const oauthRedirectUri = (origin: string): string | null => {
  const configured = process.env.CONNECTIONS_OAUTH_REDIRECT_BASE?.trim();
  try {
    const url = new URL(configured || origin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!configured && !loopback) return null;
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return `${url.origin}${oauthCallbackPath}`;
  } catch {
    return null;
  }
};
