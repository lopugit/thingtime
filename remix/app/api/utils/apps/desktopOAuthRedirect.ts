// Browser-safe RFC 8252 loopback callback handling. Keep this module free of
// Node-only imports so the first-party consent page and the token endpoint use
// the exact same validation and callback construction rules.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);
const PKCE_S256_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export type DesktopRedirect = {
  uri: string;
  origin: string;
};

export const normalizeDesktopRedirectUri = (value: unknown): DesktopRedirect | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:') return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (!url.port) return null;

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;

  return { uri: url.toString(), origin: url.origin };
};

export const normalizeDesktopState = (value: unknown): string | null =>
  typeof value === 'string' && value.length >= 16 && value.length <= 512 ? value : null;

export const normalizePkceChallenge = (value: unknown, method: unknown): string | null => {
  if (method !== 'S256' || typeof value !== 'string') return null;
  return PKCE_S256_CHALLENGE_RE.test(value) ? value : null;
};

export const appendDesktopAuthorizationResult = (
  redirectUri: string,
  result: { code?: string; error?: string; errorDescription?: string; state?: string }
): string => {
  const url = new URL(redirectUri);
  if (result.code) url.searchParams.set('code', result.code);
  if (result.error) url.searchParams.set('error', result.error);
  if (result.errorDescription) url.searchParams.set('error_description', result.errorDescription);
  if (result.state) url.searchParams.set('state', result.state);
  return url.toString();
};
