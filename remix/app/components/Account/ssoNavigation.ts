import { safeAuthReturnPath } from '../../utils/authReturn';

export const SSO_RETURN_KEY = 'tt-sso-return';
const STATE = /^[a-f0-9-]{36}$/i;
const MAX_AGE = 10 * 60_000;

export const isFirstPartyPasskeyHost = (hostname: string) =>
	hostname === 'thingtime.com' || hostname.endsWith('.thingtime.com') || hostname === 'localhost' || hostname === '127.0.0.1';

export const ssoReturnUrl = (origin: string, state: string, result: { code?: string; cancelled?: boolean }): string | null => {
	try {
		const url = new URL(origin);
		if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || !STATE.test(state)) return null;
		url.pathname = '/login';
		url.hash = new URLSearchParams({ 'tt-sso-state': state, ...(result.code ? { 'tt-sso-code': result.code } : { 'tt-sso-cancelled': '1' }) }).toString();
		return url.href;
	} catch { return null; }
};

export const beginSsoRedirect = (hub: string, location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash' | 'assign'>, storage: Storage) => {
	// Keep only the route: invitation/auth tokens in query or fragment must not
	// be copied into persistent return state.
	const state = crypto.randomUUID();
	storage.setItem(SSO_RETURN_KEY, JSON.stringify({ state, origin: location.origin, returnTo: safeAuthReturnPath(location.pathname) || '/', createdAt: Date.now() }));
	location.assign(`${hub}/authorize?${new URLSearchParams({ self: '1', origin: location.origin, redirect: '1', state })}`);
};

export const consumeSsoReturn = (origin: string, hash: string, storage: Storage, now = Date.now()) => {
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const state = params.get('tt-sso-state');
	if (!state) return null;
	const raw = storage.getItem(SSO_RETURN_KEY);
	if (!raw) return null;
	let pending;
	try { pending = JSON.parse(raw); } catch { return null; }
	if (!STATE.test(state) || state !== pending.state || pending.origin !== origin || !Number.isFinite(pending.createdAt) || now < pending.createdAt || now - pending.createdAt > MAX_AGE) return null;
	storage.removeItem(SSO_RETURN_KEY);
	const code = params.get('tt-sso-code');
	const returnTo = safeAuthReturnPath(pending.returnTo) || '/';
	return { code: code && code.length <= 2048 ? code : null, returnTo };
};
