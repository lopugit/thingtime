import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { supportsWatchApproval, WATCH_QUICK_APPROVAL_REQUIREMENTS } from './watchApprovalCapabilities';

type Viewer = { id: string; username: string; temporary?: boolean };
type PendingWatch = { pairingId: string; userCode: string; device: { name: string }; expiresAt: string };

/** Nothing is approved on receipt. Only the recipient's authenticated session
 * can see a request, and an explicit, labelled button grants Watch access. */
export const WatchPendingApprovals = ({ user: explicitUser, embedded = false }: { user?: Viewer; embedded?: boolean }) => {
	const currentUser = useCurrentUser();
	const user = explicitUser ?? currentUser;
	const [snapshot, setSnapshot] = React.useState<{ accountId: string; requests: PendingWatch[] } | null>(null);
	const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
	const [busy, setBusy] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!user?.id || user.temporary) return;
		const controller = new AbortController();
		let supported = false;
		let polling = false;
		const poll = async () => {
			if (!supported || polling || document.visibilityState !== 'visible') return;
			polling = true;
			try {
				const response = await fetch('/api/v1/watch/pairing?op=pending', { credentials: 'include', signal: controller.signal });
				const body = await response.json();
				if (!controller.signal.aborted && response.ok && body.account?.id === user.id) {
					setSnapshot({ accountId: user.id, requests: Array.isArray(body.requests) ? body.requests : [] });
				} else if (!controller.signal.aborted && response.status === 401) {
					setSnapshot(null);
				}
			} catch {
				/* Keep the last-known requests; next visible poll retries. */
			} finally {
				polling = false;
			}
		};
		void (async () => {
			try {
				const response = await fetch('/.well-known/thingtime-capabilities.json', { signal: controller.signal });
				supported = response.ok && supportsWatchApproval(await response.json(), WATCH_QUICK_APPROVAL_REQUIREMENTS);
				if (!controller.signal.aborted) await poll();
			} catch {
				/* Origins without this feature do not acquire a polling loop. */
			}
		})();
		const timer = window.setInterval(poll, 15_000);
		document.addEventListener('visibilitychange', poll);
		window.addEventListener('focus', poll);
		window.addEventListener('thingtime:watch-approval-offered', poll);
		return () => {
			controller.abort();
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', poll);
			window.removeEventListener('focus', poll);
			window.removeEventListener('thingtime:watch-approval-offered', poll);
		};
	}, [user?.id, user?.temporary]);

	const approve = async (request: PendingWatch) => {
		if (busy) return;
		setBusy(request.pairingId);
		setError(null);
		try {
			const response = await fetch('/api/v1/watch/pairing', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ op: 'approve', pairingId: request.pairingId, userCode: request.userCode })
			});
			const body = await response.json();
			if (!response.ok || !body.ok) throw new Error(body.error || 'Approval failed. Please retry.');
			setDismissed((values) => new Set([...values, request.pairingId]));
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : 'Connection interrupted. Please retry.');
		} finally {
			setBusy(null);
		}
	};

	const requests =
		snapshot?.accountId === user?.id
			? snapshot.requests.filter((request) => !dismissed.has(request.pairingId) && Date.parse(request.expiresAt) > Date.now())
			: [];
	if (!requests.length) return null;
	return (
		<Box
			role="region"
			aria-label="Watch approval requests"
			position={embedded ? 'relative' : 'fixed'}
			bottom={embedded ? undefined : 'calc(80px + env(safe-area-inset-bottom))'}
			right={embedded ? undefined : 3}
			zIndex={embedded ? undefined : 1400}
			width={embedded ? '100%' : '360px'}
			maxWidth="calc(100vw - 24px)"
			maxHeight={embedded ? undefined : '60dvh'}
			overflowY="auto"
			sx={{ '&, & *': { boxSizing: 'border-box' }, '& p': { margin: 0 }, '& button': { border: '1px solid transparent' } }}
		>
			{(embedded ? requests : requests.slice(0, 1)).map((request) => (
				<Flex
					key={request.pairingId}
					direction="column"
					gap={3}
					p={5}
					mb={2}
					background="var(--tt-card, white)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="16px"
					boxShadow="lg"
					minWidth={0}
					boxSizing="border-box"
				>
					<Text fontWeight={800} overflowWrap="anywhere">
						⌚ Approve {request.device.name}?
					</Text>
					<Text fontSize="sm" overflowWrap="anywhere">
						Connect to <strong>@{user?.username}</strong>
					</Text>
					<Text fontFamily="mono" fontSize="28px" letterSpacing=".2em" fontWeight={700}>
						{request.userCode}
					</Text>
					<Text fontSize="sm">
						Only approve a request you just started, with the same code on your Watch. This grants access to notifications and private uploads.
					</Text>
					<Button
						colorScheme="purple"
						minHeight="44px"
						aria-label={`Approve Watch ${request.userCode}`}
						isLoading={busy === request.pairingId}
						isDisabled={!!busy}
						onClick={() => approve(request)}
					>
						Approve Watch
					</Button>
					<Button
						variant="ghost"
						minHeight="44px"
						isDisabled={!!busy}
						onClick={() => setDismissed((values) => new Set([...values, request.pairingId]))}
					>
						Not now
					</Button>
					{error ? (
						<Text role="alert" color="red.500" fontSize="sm">
							{error}
						</Text>
					) : null}
				</Flex>
			))}
		</Box>
	);
};
