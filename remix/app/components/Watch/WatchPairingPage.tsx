import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';

import { Login } from '~/components/Login/Login';
import { Register } from '~/components/Login/Register';

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

export const WatchPairingPage = () => {
	const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
	const pairingId = (params.get('pairing') || '').trim();
	const userCode = (params.get('code') || '').trim();
	const [pairing, setPairing] = React.useState<Pairing | null>(null);
	const [user, setUser] = React.useState<User | null>(null);
	const [checked, setChecked] = React.useState(false);
	const [mode, setMode] = React.useState<'login' | 'register'>('login');
	const [busy, setBusy] = React.useState(false);
	const [done, setDone] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const alreadyApproved = pairing?.approved && !done;

	const load = React.useCallback(async () => {
		setError(null);
		const [pairingResponse, authResponse] = await Promise.all([
			fetchJson(`/api/v1/watch/pairing?pairing=${encodeURIComponent(pairingId)}&code=${encodeURIComponent(userCode)}`),
			fetchJson('/api/v1/auth/me')
		]);
		if (pairingResponse.body?.ok) setPairing(pairingResponse.body);
		else setError(pairingResponse.body?.error || 'This Watch pairing link is invalid.');
		if (authResponse.body?.user && !authResponse.body.user.temporary) setUser(authResponse.body.user);
		setChecked(true);
	}, [pairingId, userCode]);

	React.useEffect(() => { void load(); }, [load]);

	const approve = async () => {
		if (!user || busy) return;
		setBusy(true);
		setError(null);
		const response = await fetchJson('/api/v1/watch/pairing', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ op: 'approve', pairingId, userCode })
		});
		if (response.body?.ok) setDone(true);
		else setError(response.body?.error || 'Thingtime could not approve this Watch.');
		setBusy(false);
	};

	const card = {
		width: '420px', maxWidth: '100%', background: 'var(--tt-card, #fff)', border: '1px solid var(--tt-border, #ececef)',
		borderRadius: '20px', boxShadow: '0 24px 60px -28px rgba(20,20,40,.28)', padding: 8
	};

	return (
		<Flex alignItems="center" background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" padding={4}>
			{!checked ? (
				<Flex direction="column" gap={3} sx={card}><Text fontWeight={700}>Apple Watch</Text><Text color="var(--tt-muted)">Checking this pairing link…</Text></Flex>
			) : error && !pairing ? (
				<Flex direction="column" gap={4} sx={card}><Text fontSize="20px" fontWeight={700}>Pairing needs attention</Text><Text color="var(--tt-muted)">{error}</Text><Button onClick={load}>Retry</Button></Flex>
			) : !user ? (
				<Flex direction="column" gap={3} width="420px" maxWidth="100%">
					<Flex direction="column" gap={1} sx={{ ...card, width: '100%', padding: 5 }}><Text fontWeight={700}>Connect {pairing?.device.name || 'Apple Watch'}</Text><Text color="var(--tt-muted)" fontSize="13px">Sign in to choose the Thingtime account for this Watch.</Text></Flex>
					{mode === 'login' ? <Login embedded onSuccess={setUser} onSwitchMode={() => setMode('register')} /> : <Register embedded onSuccess={setUser} onSwitchMode={() => setMode('login')} />}
				</Flex>
			) : (
				<Flex direction="column" gap={4} sx={card}>
					<Text color="var(--tt-muted)" fontFamily="mono" fontSize="11px" fontWeight={700} letterSpacing=".12em" textTransform="uppercase">Thingtime · Apple Watch</Text>
					<Text as="h1" fontSize="22px" fontWeight={800}>{done || pairing?.approved ? 'Watch connected ✨' : `Connect ${pairing?.device.name || 'Apple Watch'}?`}</Text>
					<Text color="var(--tt-muted)" fontSize="14px">
						{done
							? `Return to the Watch. It will finish signing in as @${user.username}.`
							: alreadyApproved
								? 'This pairing was already approved. Return to the Watch to finish connecting the approved account.'
								: `This gives the Watch direct, revocable access to notifications and private Thing uploads for @${user.username}.`}
					</Text>
					{error ? <Box color="var(--tt-danger, #d3455b)" fontSize="13px">{error}</Box> : null}
					{!done && !pairing?.approved ? <Button background="var(--tt-text, #1c1c22)" color="white" isLoading={busy} onClick={approve}>Connect as @{user.username}</Button> : null}
				</Flex>
			)}
		</Flex>
	);
};
