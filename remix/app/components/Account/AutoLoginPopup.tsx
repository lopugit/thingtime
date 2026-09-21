import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';

import { AccountHintRow } from './AccountHints';
import { useSsoHub } from './useSsoHub';
import { beginSsoRedirect, consumeSsoReturn } from './ssoNavigation';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { isPasskeyCancel, passkeyErrorMessage, passkeysSupported, useAccountHints, usePasskeyAuth } from '~/hooks/usePasskeys';
import type { AccountHint } from '~/hooks/usePasskeys';

// The first-party surface for cross-origin sign-in (the /authorize?self=1
// popup + FedCM IdP live there). Deployments inside the *.thingtime.com
// cookie family never need it — hints work directly.
//
// ENVIRONMENT-AWARE: feature previews belong to the development authority,
// even though their Git branch is not literally `develop`. Users may override
// this only with a valid origin in localStorage `tt-sso-hub`.

// The auto-login popup: when this browser is signed out HERE but has live
// Thingtime sessions on OTHER deployments (tt_hints → /api/v1/auth/
// account-hints), offer those accounts. Picking one routes to /login with the
// username prefilled (password re-entry is deliberate — a hint is a
// suggestion, never a credential); the 🔑 button runs the passkey ceremony in
// place. Non-blocking corner card, never on the auth pages themselves, and
// "Not now" snoozes it for a day.

const SNOOZE_KEY = 'tt-autologin-snooze';
const SNOOZE_MS = 1000 * 60 * 60 * 24;

const snoozedNow = () => {
	try {
		const until = Number(window.localStorage.getItem(SNOOZE_KEY));
		return Number.isFinite(until) && until > Date.now();
	} catch {
		return false;
	}
};

const HIDDEN_PATHS = ['/login', '/register', '/authorize', '/reset-password'];

export const AutoLoginPopup = () => {
	const user = useCurrentUser();
	const { hints } = useAccountHints();
	const { loginWithPasskey, cancelPasskey } = usePasskeyAuth();
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	const [dismissed, setDismissed] = React.useState(false);
	const [passkeyBusy, setPasskeyBusy] = React.useState(false);
	const [ssoBusy, setSsoBusy] = React.useState(false);
	React.useEffect(() => {
		if (dismissed || user?.id || HIDDEN_PATHS.some((path) => pathname.startsWith(path))) cancelPasskey();
	}, [dismissed, user?.id, pathname, cancelPasskey]);
	// Snooze is browser state — read it after mount so SSR and the first client
	// paint agree, then let the card pop in.
	const [eligible, setEligible] = React.useState(false);
	React.useEffect(() => {
		setEligible(!snoozedNow());
	}, []);

	const { hub: ssoHub, name: ssoHubName, foreign: foreignOrigin } = useSsoHub();
	const ssoHubRef = React.useRef(ssoHub);
	ssoHubRef.current = ssoHub;
	// FedCM is DESIGNED for auto-prompt on load: on foreign origins the
	// browser itself renders "Continue as …" with the user's thingtime.com
	// accounts — the auto-login popup, in browser chrome, on any domain. The
	// browser applies its own dismissal cooldowns, so this never nags; when it
	// can't run (unsupported, no hub, no accounts, cooling down) the card with
	// the manual button below is the fallback.
	const autoFedcmTried = React.useRef(false);
	const redeemRef = React.useRef<((code: string) => Promise<boolean>) | null>(null);
	React.useEffect(() => {
		if (HIDDEN_PATHS.some(path => pathname.startsWith(path)) || !foreignOrigin || !ssoHubRef.current || user || !eligible || dismissed || autoFedcmTried.current) return;
		if (typeof (window as any).IdentityCredential === 'undefined') return;
		autoFedcmTried.current = true;
		(async () => {
			try {
				const credential: any = await (navigator.credentials as any).get({
					identity: {
						providers: [
							{ configURL: `${ssoHubRef.current}/api/v1/fedcm/config`, clientId: 'thingtime-self', nonce: crypto.randomUUID() }
						]
					}
				});
				if (credential?.token) await redeemRef.current?.(credential.token);
			} catch {
				// dismissed / cooldown / no accounts — the manual card remains
			}
		})();
	}, [foreignOrigin, user, eligible, dismissed, pathname]);

	const redeemSsoCode = React.useCallback(
		async (code: string) => {
			try {
				const resp = await apiRef.current.v1.auth.ssoSession({ code });
				if (resp?.ok) {
					setDismissed(true);
					lopu({ title: `Welcome back, ${resp.user?.username || 'friend'}! ✨`, status: 'success', duration: 5000 });
					return true;
				}
			} catch (err: any) {
				lopu({
					title: 'Sign-in didn’t complete',
					description: err?.error || 'Try again in a moment.',
					status: 'error',
					duration: 6000
				});
			}
			return false;
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[lopu]
	);
	redeemRef.current = redeemSsoCode;
	React.useEffect(() => {
		if (!window.location.hash.includes('tt-sso-state=')) return;
		let result;
		try { result = consumeSsoReturn(window.location.origin, window.location.hash, window.sessionStorage); } catch { return; }
		// Remove the short-lived code before other navigation or a reload.
		window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
		if (result?.code) void redeemSsoCode(result.code).then((ok) => { if (ok) navigate(result.returnTo, { replace: true }); });
	}, [redeemSsoCode, navigate]);

	const signInViaHub = () => {
		if (ssoBusy || !ssoHub) return;
		setSsoBusy(true);
		try {
			beginSsoRedirect(ssoHub, window.location, window.sessionStorage);
		} catch {
			setSsoBusy(false);
			lopu({ title: 'Could not open sign-in', description: 'Open this page in Safari or Chrome and try again.', status: 'info' });
		}
	};

	const suggestions = hints.filter((hint) => !hint.alreadyHere);
	const onHiddenPath = HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

	if (user || dismissed || !eligible || onHiddenPath) return null;

	if (foreignOrigin) {
		return (
			<Flex
				position="fixed"
				bottom={['calc(var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 160px)', 6]}
				right={[4, 24]}
				left={[4, 'auto']}
				zIndex={1800}
				flexDirection="column"
				rowGap={2}
				width={['auto', '360px']}
				maxWidth="calc(100vw - 32px)"
				maxHeight={['calc(100dvh - 176px - var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)))', 'calc(100dvh - 48px)']}
				overflowY="auto"
				background="var(--tt-card, #ffffff)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-lg, 16px)"
				boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
				padding={4}
			>
				<Text fontSize="sm" fontWeight="700" color="var(--tt-ink, #16161a)">
					Use your Thingtime account ✨
				</Text>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
					{ssoHub
						? `This preview lives outside thingtime.com, so browser cookies can’t show account hints here. Open ${ssoHubName} to choose your signed-in account.`
						: 'This deployment has no compatible data authority configured yet.'}
				</Text>
				<Button size="sm" onClick={signInViaHub} isDisabled={!ssoHub} isLoading={ssoBusy} loadingText="Waiting for Thingtime…">
					Continue with {ssoHubName} 🌈
				</Button>
				<Flex justifyContent="flex-end">
					<Button
						size="xs"
						variant="ghost"
						color="var(--tt-muted, #9a9aa6)"
						onClick={() => {
							setDismissed(true);
							try {
								window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
							} catch {
								// storage unavailable — dismissal still holds for this page
							}
						}}
					>
						Not now
					</Button>
				</Flex>
			</Flex>
		);
	}

	if (!suggestions.length) return null;

	const snooze = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
		} catch {
			// storage unavailable — dismissal still holds for this page
		}
	};

	const pick = (hint: AccountHint) => {
		setDismissed(true);
		navigate(`/login?u=${encodeURIComponent(hint.user.username)}`);
	};

	const passkey = async (hint: AccountHint) => {
		if (passkeyBusy) return;
		setPasskeyBusy(true);
		try {
			const resp = await loginWithPasskey();
			if (resp?.ok) {
				setDismissed(true);
				lopu({ title: `Welcome back, ${resp.user?.username || hint.user.username}! ✨`, status: 'success', duration: 5000 });
			}
		} catch (err: any) {
			// explicit click → even a cancel/failed cross-device handoff gets
			// feedback (the browser reports both with the same error)
			if (err?.name === 'AbortError') return;
			if (isPasskeyCancel(err)) {
				lopu({
					title: 'Passkey sign-in didn’t complete 🤏',
					description: passkeyErrorMessage(err),
					status: 'info',
					duration: 5000
				});
			} else {
				lopu({
					title: 'Passkey login failed',
					description: passkeyErrorMessage(err),
					status: 'error',
					duration: 6000
				});
			}
		} finally {
			setPasskeyBusy(false);
		}
	};

	return (
		<Flex
			position="fixed"
			// clear of the bottom-right floating bubbles (DevKit/notifications):
			// lifted on mobile, shifted left of them on desktop
			bottom={['calc(var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 160px)', 6]}
			right={[4, 24]}
			left={[4, 'auto']}
			zIndex={1800}
			flexDirection="column"
			rowGap={2}
			width={['auto', '360px']}
			maxWidth="calc(100vw - 32px)"
			maxHeight={['calc(100dvh - 176px - var(--thingtime-safe-area-bottom, env(safe-area-inset-bottom, 0px)))', 'calc(100dvh - 48px)']}
			overflowY="auto"
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-lg, 16px)"
			boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
			padding={4}
		>
			<Flex alignItems="baseline" justifyContent="space-between" columnGap={3}>
				<Text fontSize="sm" fontWeight="700" color="var(--tt-ink, #16161a)">
					Continue as… ✨
				</Text>
				<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
					signed in elsewhere on Thingtime
				</Text>
			</Flex>
			<Flex flexDirection="column">
				{suggestions.slice(0, 4).map((hint) => (
					<AccountHintRow
						key={hint.user.id}
						hint={hint}
						onPick={pick}
						onPasskey={passkeysSupported() ? passkey : null}
					/>
				))}
			</Flex>
			<Flex justifyContent="flex-end">
				<Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" onClick={snooze}>
					Not now
				</Button>
			</Flex>
		</Flex>
	);
};
