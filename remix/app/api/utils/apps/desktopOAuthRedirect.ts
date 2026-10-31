// Browser-safe RFC 8252 loopback callback handling. Keep this module free of
// Node-only imports so the first-party consent page and the token endpoint use
// the exact same validation and callback construction rules.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);
const PKCE_S256_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const NATIVE_SCHEME_RE = /^[a-z][a-z0-9+.-]{2,127}$/;

export type DesktopRedirect = {
	uri: string;
	origin: string;
	native?: true;
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

	if (url.username || url.password || url.search || url.hash) return null;
	if (url.protocol !== 'http:') {
		// Native callbacks use one exact registered reverse-domain URI. PKCE and
		// the callback registration protect the public-client handoff.
		const scheme = url.protocol.slice(0, -1);
		if (!NATIVE_SCHEME_RE.test(scheme) || !scheme.includes('.')) return null;
		if (url.port || url.hostname !== 'oauth' || url.pathname !== '/callback') return null;
		return { uri: url.toString(), origin: url.toString(), native: true };
	}
	if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
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
