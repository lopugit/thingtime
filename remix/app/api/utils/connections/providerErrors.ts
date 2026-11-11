// Provider error bodies are untrusted and may contain credentials or account
// data. Select fixed copy from a closed vocabulary; never interpolate values.
export const safeProviderError = (url: string, status: number, data: unknown): string | null => {
  let target: URL;
  try { target = new URL(url); } catch { return null; }
  if (target.protocol !== 'https:' || target.port || target.username || target.password) return null;
  const error = (data as any)?.error;
  if (!error || typeof error !== 'object') return null;
  if (target.hostname === 'www.googleapis.com' && target.pathname.startsWith('/youtube/v3/')) {
    const reasons = [
      ...(Array.isArray(error.errors) ? error.errors.slice(0, 16).map((entry: any) => entry?.reason) : []),
      ...(Array.isArray(error.details) ? error.details.slice(0, 16).map((entry: any) => entry?.reason) : [])
    ];
    if (status === 403 && reasons.some(reason => reason === 'SERVICE_DISABLED' || reason === 'accessNotConfigured'))
      return 'Enable YouTube Data API v3 in the Google Cloud project that owns this connection’s OAuth client.';
    if (status === 403 && reasons.some(reason => reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'))
      return 'YouTube has not granted the required permission. Reconnect and approve YouTube read access.';
    if ((status === 403 || status === 429) && reasons.some(reason => reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded'))
      return 'YouTube API quota or rate limit reached. Retry after the limit resets.';
    if (status === 401) return 'YouTube authorization is invalid or expired. Reconnect this account.';
  }
  if (target.hostname === 'graph.facebook.com' && /^\/v\d+\.\d+\//.test(target.pathname)) {
    if (status !== 400 && status !== 401 && status !== 403) return null;
    if (error.code === 190) return 'Facebook authorization is invalid or expired. Reconnect this account.';
    if (error.code === 10 || error.code === 200) return 'Facebook denied this operation. Check the app’s posts permission and account access.';
    if (error.code === 100) return 'Facebook rejected the feed request or a requested field. Check the integration’s Graph API request.';
  }
  return null;
};
