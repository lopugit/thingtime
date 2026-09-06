import React from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Text } from '@chakra-ui/react';

import { Login } from '~/components/Login/Login';
import { Register } from '~/components/Login/Register';
import { WatchPendingApprovals } from './WatchPendingApprovals';
import { WatchCodeField } from './WatchCodeField';
import { supportsWatchApproval, WATCH_CODE_ENTRY_REQUIREMENTS } from './watchApprovalCapabilities';

type Pairing = { device: { name: string; model?: string | null }; expiresAt: string; approved: boolean };
type User = { id: string; username: string; temporary?: boolean };

const fetchJson = async (url: string, init: RequestInit = {}) => {
	try {
		const response = await fetch(url, { credentials: 'include', ...init, headers: { Accept: 'application/json', ...(init.headers || {}) } });
		return { status: response.status, body: await response.json().catch(() => ({ ok: false, error: 'Unexpected response' })) };
	} catch {
		return { status: 0, body: { ok: false, error: 'Could not reach Thingtime. Check your connection and retry.' } };
	}
};

const checkPairingSupport = async () => {
	const response = await fetchJson('/.well-known/thingtime-capabilities.json');
	return response.status === 200 && supportsWatchApproval(response.body, WATCH_CODE_ENTRY_REQUIREMENTS);
};
const unsupportedMessage =
	'This Thingtime domain does not support Watch code entry yet. Use the same supported domain selected on your Watch, or check again after it is updated.';

export const WatchPairingPage = () => {
	const [link] = React.useState(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''));
	const [pairingId, setPairingId] = React.useState((link.get('pairing') || '').trim());
	const [userCode, setUserCode] = React.useState(() =>
		(link.get('code') || (typeof window !== 'undefined' && /^\/pair\/(\d{4})\/?$/.exec(window.location.pathname)?.[1]) || '').trim().toUpperCase()
	);
	const [pairing, setPairing] = React.useState<Pairing | null>(null);
	const [user, setUser] = React.useState<User | null>(null);
	const [checked, setChecked] = React.useState(false);
	const [mode, setMode] = React.useState<'login' | 'register'>('login');
	const [busy, setBusy] = React.useState(false);
	const [done, setDone] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const domain = typeof window !== 'undefined' ? window.location.host : '';

	React.useEffect(() => {
		let cancelled = false;
		const load = async () => {
			const id = link.get('pairing');
			const code = link.get('code');
			const [authResponse, supported] = await Promise.all([fetchJson('/api/v1/auth/me'), checkPairingSupport()]);
			const pairingResponse =
				supported && id && code ? await fetchJson(`/api/v1/watch/pairing?pairing=${encodeURIComponent(id)}&code=${encodeURIComponent(code)}`) : null;
			if (cancelled) return;
			if (authResponse.body?.user && !authResponse.body.user.temporary) setUser(authResponse.body.user);
			if (!supported) setError(unsupportedMessage);
			else if (pairingResponse?.body?.ok) setPairing(pairingResponse.body);
			else if (pairingResponse) setError(pairingResponse.body?.error || 'This Watch code has expired. Create a new code on your Watch.');
			setChecked(true);
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [link]);

	const submit = async (op: 'lookup' | 'approve') => {
		if (!user || busy) return;
		setBusy(true);
		setError(null);
		if (!(await checkPairingSupport())) {
			setError(unsupportedMessage);
			setBusy(false);
			return;
		}
		const response = await fetchJson('/api/v1/watch/pairing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ op, pairingId, userCode })
		});
		if (response.body?.ok) {
			if (op === 'lookup') {
				setPairing(response.body);
				setPairingId(response.body.pairingId);
			} else setDone(true);
		} else {
			if (response.status === 401) setUser(null);
			setError(response.body?.error || 'Thingtime could not check this Watch. Please retry.');
		}
		setBusy(false);
	};

	const resetCode = () => {
		setPairing(null);
		setPairingId('');
		setUserCode('');
		setDone(false);
		setError(null);
	};

	return (
		<Flex
			alignItems="center"
			background="var(--tt-surface, #fafafb)"
			justifyContent="center"
			minHeight="100vh"
			padding={{ base: 4, md: 8 }}
			sx={{
				'@supports (min-height: 100dvh)': { minHeight: '100dvh' },
				'&, & *': { boxSizing: 'border-box' },
				'& p, & h1': { margin: 0 },
				'& button': { border: '1px solid transparent' },
				'& form': { minWidth: 0, width: '100%' }
			}}
		>
			<Flex direction="column" gap={4} width="440px" maxWidth="100%" minWidth={0}>
				{user && !done && !pairing ? <WatchPendingApprovals user={user} embedded /> : null}
				<Flex
					direction="column"
					gap={4}
					background="var(--tt-card, #fff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="20px"
					padding={{ base: 5, md: 8 }}
					minWidth={0}
				>
					<Text fontSize="32px" aria-hidden>
						⌚
					</Text>
					<Text as="h1" fontSize="24px" lineHeight="1.25" fontWeight={800}>
						{done || pairing?.approved ? 'Watch approved ✨' : 'Connect your Apple Watch'}
					</Text>
					<Text color="var(--tt-muted)" fontSize="13px" overflowWrap="anywhere">
						{domain}
					</Text>
					{!checked ? (
						<Text role="status">Checking your sign-in…</Text>
					) : !user ? (
						<Text>Sign in here on your phone or computer, then enter the approval code shown on your Watch. Keep the Watch app open.</Text>
					) : done || pairing?.approved ? (
						<Text role="status">
							{done ? `Approved for @${user.username}. ` : 'This code was already approved. '}Return to the Watch to finish connecting. Tap Check
							approval on the Watch if it is still waiting.
						</Text>
					) : pairing ? (
						<>
							<Text overflowWrap="anywhere">
								Connect {pairing.device.name || 'Apple Watch'} to <strong>@{user.username}</strong>?
							</Text>
							<Text fontFamily="mono" fontSize="24px" fontWeight={700} letterSpacing=".1em">
								{userCode}
							</Text>
							<Text color="var(--tt-muted)" fontSize="14px">
								Only approve if this code matches your Watch. It gives the Watch revocable access to your notifications and private Thing uploads.
							</Text>
							<Button
								colorScheme="purple"
								minHeight="44px"
								height="auto"
								py={3}
								whiteSpace="normal"
								overflowWrap="anywhere"
								isLoading={busy}
								onClick={() => submit('approve')}
							>
								Connect as @{user.username}
							</Button>
						</>
					) : (
						<Box
							as="form"
							onSubmit={(event: React.FormEvent) => {
								event.preventDefault();
								void submit('lookup');
							}}
						>
							<Text mb={4} fontSize="14px" overflowWrap="anywhere">
								Signed in as <strong>@{user.username}</strong>
							</Text>
							<FormControl>
								<FormLabel htmlFor="watch-code">Approval code</FormLabel>
								<WatchCodeField value={userCode} onChange={setUserCode} />
							</FormControl>
							<Text id="watch-code-help" color="var(--tt-muted)" fontSize="13px" mt={3} mb={5}>
								Enter your Watch’s four-digit code. Codes last five minutes. Use the same domain selected on the Watch. Older eight-character codes
								also work.
							</Text>
							<Button
								type="submit"
								width="100%"
								minHeight="44px"
								colorScheme="purple"
								isLoading={busy}
								isDisabled={!/^(?:\d{4}|[A-Z0-9]{8})$/.test(userCode)}
							>
								Review Watch
							</Button>
						</Box>
					)}
					{error ? (
						<Text role="alert" color="var(--tt-danger, #d3455b)" fontSize="14px">
							{error}
						</Text>
					) : null}
					{(pairing || error) && !done ? (
						<Button variant="ghost" minHeight="44px" whiteSpace="normal" isDisabled={busy} onClick={resetCode}>
							Enter a different code
						</Button>
					) : null}
				</Flex>
				{checked && !user ? (
					mode === 'login' ? (
						<Login embedded onSuccess={setUser} onSwitchMode={() => setMode('register')} />
					) : (
						<Register embedded onSuccess={setUser} onSwitchMode={() => setMode('login')} />
					)
				) : null}
			</Flex>
		</Flex>
	);
};
