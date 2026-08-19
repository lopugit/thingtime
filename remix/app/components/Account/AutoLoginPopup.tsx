import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useLocation, useNavigate } from 'react-router';

import { AccountHintRow } from './AccountHints';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { isPasskeyCancel, passkeysSupported, useAccountHints, usePasskeyAuth } from '~/hooks/usePasskeys';
import type { AccountHint } from '~/hooks/usePasskeys';

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
	const { loginWithPasskey } = usePasskeyAuth();
	const lopu = useLopu();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	const [dismissed, setDismissed] = React.useState(false);
	const [passkeyBusy, setPasskeyBusy] = React.useState(false);
	// Snooze is browser state — read it after mount so SSR and the first client
	// paint agree, then let the card pop in.
	const [eligible, setEligible] = React.useState(false);
	React.useEffect(() => {
		setEligible(!snoozedNow());
	}, []);

	const suggestions = hints.filter((hint) => !hint.alreadyHere);
	const onHiddenPath = HIDDEN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

	if (user || dismissed || !eligible || onHiddenPath || !suggestions.length) return null;

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
			if (isPasskeyCancel(err)) {
				lopu({
					title: 'Passkey sign-in didn’t complete 🤏',
					description: 'Try again, or continue with your password.',
					status: 'info',
					duration: 5000
				});
			} else {
				lopu({
					title: 'Passkey login failed',
					description: err?.error || 'Try the password instead.',
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
			bottom={[24, 6]}
			right={[4, 24]}
			left={[4, 'auto']}
			zIndex={1800}
			flexDirection="column"
			rowGap={2}
			width={['auto', '360px']}
			maxWidth="calc(100vw - 32px)"
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
