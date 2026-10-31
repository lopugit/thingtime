// This bearer secret belongs to this browser's anonymous collection, never to
// a signed-in account. The server stores only its one-way anonymous ID.
export const FOUND_POST_BROWSER_KEY = 'thingtime:anonymous-collection:v1';
export const FOUND_POST_BROWSER_COOKIE = '__Host-tt_found_browser';
export const validFoundPostBrowserToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const ensureFoundPostBrowserIdentity = (): void => {
	if (typeof window === 'undefined') return;
	try {
		let token = window.localStorage.getItem(FOUND_POST_BROWSER_KEY);
		if (!validFoundPostBrowserToken(token)) {
			token = Array.from(window.crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
			window.localStorage.setItem(FOUND_POST_BROWSER_KEY, token);
		}
		document.cookie = `${FOUND_POST_BROWSER_COOKIE}=${token}; Path=/; SameSite=Lax; Max-Age=31536000; Secure`;
	} catch {
		// Storage-disabled browsers retain ordinary secret-link access.
	}
};
