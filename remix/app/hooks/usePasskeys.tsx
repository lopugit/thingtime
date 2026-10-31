import React from 'react';
import {
	browserSupportsWebAuthn,
	browserSupportsWebAuthnAutofill,
} from '@simplewebauthn/browser';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { authenticatePasskey, createPasskey, passkeyCeremonies } from './passkeyCeremony';
import { ensurePasskeyCapabilities } from './passkeyCapabilities';
export { passkeyErrorMessage } from './passkeyCeremony';

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
		return typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.credentials) && browserSupportsWebAuthn();
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

	const owner = React.useRef({});
	React.useEffect(() => {
		const currentOwner = owner.current;
		return () => passkeyCeremonies.cancel(currentOwner);
	}, []);

	const cancelPasskey = React.useCallback(() => passkeyCeremonies.cancel(owner.current), []);
	const loginWithPasskey = React.useCallback((opts?: { conditional?: boolean; clientId?: string; signal?: AbortSignal }) =>
		passkeyCeremonies.run(owner.current, opts?.conditional === true, async (signal) => {
			await ensurePasskeyCapabilities('login', signal);
			const minted = await apiRef.current.v1.auth.passkeys.loginOptions({ signal });
			signal.throwIfAborted();
			if (!minted?.ok) throw minted;
			const assertion = await authenticatePasskey(minted.options, signal, opts?.conditional === true);
			signal.throwIfAborted();
			try {
				return await apiRef.current.v1.auth.passkeys.login({ response: assertion, clientId: opts?.clientId, signal });
			} catch (error: any) {
				throw Object.assign(error instanceof Error ? error : { ...error }, { passkeyStage: 'verify' });
			}
		}, opts?.signal), []);

	const registerPasskey = React.useCallback((opts: { password: string; nickname?: string; description?: string }) =>
		passkeyCeremonies.run(owner.current, false, async (signal) => {
			await ensurePasskeyCapabilities('registration', signal);
			const minted = await apiRef.current.v1.auth.passkeys.registerOptions({ password: opts.password, signal });
			signal.throwIfAborted();
			if (!minted?.ok) throw minted;
			const attestation = await createPasskey(minted.options, signal);
			signal.throwIfAborted();
			return apiRef.current.v1.auth.passkeys.register({ response: attestation, nickname: opts.nickname, description: opts.description, signal });
		}), []);

	return { loginWithPasskey, registerPasskey, cancelPasskey };
};

// Conditional-UI (autofill) arm: resolves browser support once, then runs one
// background conditional ceremony for the lifetime of the mounting surface.
// When the user picks a passkey from the field popup, onSuccess fires with the
// login response. Silent on cancel/unsupported — the form works as normal.
export const usePasskeyAutofill = (enabled: boolean, onSuccess: (resp: any) => void, onError?: (error: any) => void) => {
	const { loginWithPasskey } = usePasskeyAuth();
	const onSuccessRef = React.useRef(onSuccess);
	onSuccessRef.current = onSuccess;
	const onErrorRef = React.useRef(onError);
	onErrorRef.current = onError;

	React.useEffect(() => {
		if (!enabled || !passkeysSupported()) return;
		let alive = true;
		const controller = new AbortController();
		browserSupportsWebAuthnAutofill()
			.then((supported) => {
				if (!supported || !alive) return null;
				return loginWithPasskey({ conditional: true, signal: controller.signal }).then((resp) => {
					if (alive && resp?.ok) onSuccessRef.current(resp);
				});
			})
			.catch((error) => {
				if (alive && error?.passkeyStage === 'verify' && !isPasskeyCancel(error)) onErrorRef.current?.(error);
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
			controller.abort();
		};
	}, [enabled, loginWithPasskey]);
};

const HINTS_CACHE_KEY = 'tt-account-hints';
const MAX_FEDERATED_ORIGINS = 4;

// The federated fan-out: for pointers the local deployment couldn't vouch for
// (a different-database environment), ask each origin's own
// /account-hints/resolve — same-site credentialed fetch, so the shared
// tt_hints cookie arrives and each environment answers only for its own
// sessions. The user's browser assembles the full picture.
const fetchFederatedHints = async (origins: string[]): Promise<AccountHint[]> => {
	const targets = origins.slice(0, MAX_FEDERATED_ORIGINS);
	const settled = await Promise.all(
		targets.map(async (origin) => {
			try {
				const response = await fetch(`${origin}/api/v1/auth/account-hints/resolve`, {
					credentials: 'include',
					headers: { Accept: 'application/json' }
				});
				const body = await response.json();
				return body?.ok && Array.isArray(body.hints) ? (body.hints as AccountHint[]) : [];
			} catch {
				return []; // that environment is down or cross-site — skip it
			}
		})
	);
	return settled.flat();
};

const mergeHints = (local: AccountHint[], federated: AccountHint[]): AccountHint[] => {
	const byUser = new Map<string, AccountHint>();
	for (const hint of local) byUser.set(hint.user.id, hint);
	for (const hint of federated) {
		const existing = byUser.get(hint.user.id);
		if (existing) existing.origins = [...existing.origins, ...hint.origins];
		else byUser.set(hint.user.id, hint);
	}
	return [...byUser.values()];
};

// Cross-deployment auto-login suggestions, optimistic-rendering compliant:
// first paint comes from the synchronous localCache tier, the live answer
// reconciles in the background (and hint death — logging out elsewhere —
// propagates on the next mount). Foreign-database environments are resolved
// by federated per-origin fetches and merged in as they answer.
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
			.then(async (resp: any) => {
				if (!alive || !resp?.ok || !Array.isArray(resp.hints)) return;
				setHints(resp.hints);
				writeLocalCache(HINTS_CACHE_KEY, resp.hints);
				if (Array.isArray(resp.unresolved) && resp.unresolved.length) {
					const federated = await fetchFederatedHints(resp.unresolved);
					if (!alive || !federated.length) return;
					const merged = mergeHints(resp.hints, federated);
					setHints(merged);
					writeLocalCache(HINTS_CACHE_KEY, merged);
				}
			})
			.catch(() => {})
			.finally(() => {
				if (alive) setLoaded(true);
			});
		return () => {
			alive = false;
		};
	}, []);

	return { hints, loaded };
};
