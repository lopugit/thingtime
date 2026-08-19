import React from 'react';
import {
	browserSupportsWebAuthn,
	browserSupportsWebAuthnAutofill,
	startAuthentication,
	startRegistration,
	WebAuthnAbortService
} from '@simplewebauthn/browser';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';

// Client half of the WebAuthn ceremonies. The platform integrations the
// feature asks for — macOS/iOS Passwords sheets, 1Password's "Save in
// 1Password?" and passkey popups — are exactly what navigator.credentials
// surfaces when the ceremony is shaped right (discoverable credentials +
// conditional mediation), so this hook stays a thin options→browser→verify
// pipe with no provider-specific code.

export type PasskeyLinkedApp = {
	appKey: string;
	appName: string | null;
	firstUsedAt: string | null;
	lastUsedAt: string | null;
	usageCount: number;
};

export type PasskeyRecord = {
	id: string;
	nickname: string;
	description: string | null;
	providerName: string | null;
	aaguid: string | null;
	deviceType: 'singleDevice' | 'multiDevice' | null;
	backedUp: boolean;
	transports: string[];
	createdAt: string | null;
	lastUsedAt: string | null;
	lastUsedOrigin: string | null;
	revokedAt: string | null;
	linkedApps: PasskeyLinkedApp[];
};

export type AccountHint = {
	user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
	origins: Array<{ origin: string; lastSeenAt: string }>;
	alreadyHere: boolean;
};

// The user closed/ignored the platform sheet (or another ceremony superseded
// this one) — never worth an error toast.
export const isPasskeyCancel = (err: any): boolean => err?.name === 'NotAllowedError' || err?.name === 'AbortError';

export const passkeysSupported = (): boolean => {
	try {
		return typeof window !== 'undefined' && browserSupportsWebAuthn();
	} catch {
		return false;
	}
};

export const usePasskeyAuth = () => {
	const api = useApi();
	// useApi returns a fresh identity per render — the apiRef idiom (see
	// useAccountSwitcher) keeps these callbacks stable so effects that depend
	// on them run once, not per render.
	const apiRef = React.useRef(api);
	apiRef.current = api;

	// Full ceremony: mint options (sets the signed challenge cookie), hand them
	// to the browser/platform sheet, POST the assertion back. `conditional`
	// runs the browser-autofill flavor: it resolves only when the user picks a
	// passkey from the username-field popup (iCloud Keychain / 1Password), so
	// callers await it for the whole life of the login form.
	const loginWithPasskey = React.useCallback(async (opts?: { conditional?: boolean; clientId?: string }) => {
		const minted = await apiRef.current.v1.auth.passkeys.loginOptions();
		if (!minted?.ok) throw minted;
		const assertion = await startAuthentication({
			optionsJSON: minted.options,
			useBrowserAutofill: opts?.conditional === true
		});
		return apiRef.current.v1.auth.passkeys.login({ response: assertion, clientId: opts?.clientId });
	}, []);

	// Password-confirmed registration ceremony. The platform (or 1Password)
	// shows its own "save this passkey" sheet during startRegistration.
	const registerPasskey = React.useCallback(async (opts: { password: string; nickname?: string; description?: string }) => {
		const minted = await apiRef.current.v1.auth.passkeys.registerOptions({ password: opts.password });
		if (!minted?.ok) throw minted;
		const attestation = await startRegistration({ optionsJSON: minted.options });
		return apiRef.current.v1.auth.passkeys.register({
			response: attestation,
			nickname: opts.nickname,
			description: opts.description
		});
	}, []);

	return { loginWithPasskey, registerPasskey };
};

// Conditional-UI (autofill) arm: resolves browser support once, then runs one
// background conditional ceremony for the lifetime of the mounting surface.
// When the user picks a passkey from the field popup, onSuccess fires with the
// login response. Silent on cancel/unsupported — the form works as normal.
export const usePasskeyAutofill = (enabled: boolean, onSuccess: (resp: any) => void) => {
	const { loginWithPasskey } = usePasskeyAuth();
	const onSuccessRef = React.useRef(onSuccess);
	onSuccessRef.current = onSuccess;

	React.useEffect(() => {
		if (!enabled || !passkeysSupported()) return;
		let alive = true;
		browserSupportsWebAuthnAutofill()
			.then((supported) => {
				if (!supported || !alive) return null;
				return loginWithPasskey({ conditional: true }).then((resp) => {
					if (alive && resp?.ok) onSuccessRef.current(resp);
				});
			})
			.catch(() => {
				// cancelled, superseded by a modal ceremony, or unsupported — the
				// password form (and the explicit passkey button) still work
			});
		return () => {
			alive = false;
			// Abort the pending conditional request the moment the login surface
			// goes away (login finished, 2FA step, unmount). A stale WebAuthn
			// request left running after navigation is what lets the browser's
			// cross-device QR sheet (or a password manager popup) surface
			// uninvited later, long after the user logged in.
			WebAuthnAbortService.cancelCeremony();
		};
	}, [enabled, loginWithPasskey]);
};

const HINTS_CACHE_KEY = 'tt-account-hints';

// Cross-deployment auto-login suggestions, optimistic-rendering compliant:
// first paint comes from the synchronous localCache tier, the live answer
// reconciles in the background (and hint death — logging out elsewhere —
// propagates on the next mount).
export const useAccountHints = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const [hints, setHints] = React.useState<AccountHint[]>(() => readLocalCache<AccountHint[]>(HINTS_CACHE_KEY) || []);
	const [loaded, setLoaded] = React.useState(false);

	// One fetch per mount — apiRef (not api) so useApi's per-render identity
	// can't retrigger this into a request loop.
	React.useEffect(() => {
		let alive = true;
		apiRef.current.v1.auth
			.accountHints()
			.then((resp: any) => {
				if (!alive) return;
				if (resp?.ok && Array.isArray(resp.hints)) {
					setHints(resp.hints);
					writeLocalCache(HINTS_CACHE_KEY, resp.hints);
				}
				setLoaded(true);
			})
			.catch(() => {
				if (alive) setLoaded(true);
			});
		return () => {
			alive = false;
		};
	}, []);

	return { hints, loaded };
};
