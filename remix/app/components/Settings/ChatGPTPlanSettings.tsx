import React from 'react';
import {
	Badge,
	Box,
	Button,
	Flex,
	Link,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	Text
} from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { ChatGPTPlanTransfer } from './ChatGPTPlanTransfer';

const ENDPOINT = '/api/v1/ai/chatgpt-plan';
const USAGE = 'https://chatgpt.com/settings/usage';
const CAPABILITY = 'api.ai-chatgpt-plan';
const ATTEMPT_LIFETIME = 10 * 60 * 1000;
type Account = { id: string; label: string; email?: string; connected: boolean; model: string; models: { slug: string; displayName: string }[] };
type Attempt = { id: string; status: 'pending' | 'connecting' | 'connected' | 'cancelled' | 'failed'; error?: string };
type Snapshot = { available: boolean; accounts: Account[]; attempts: Attempt[]; canAuthorize: boolean; storageMode?: string };
type Pending = { id: string; url: string; expiresAt: number; status: 'pending' | 'connecting' };
// Only public account metadata is cached; authorization URLs and tokens never persist.
const snapshots = new Map<string, Snapshot>();
const acknowledged = new Set<string>();
const fieldStyles = {
	background: 'var(--tt-surface-alt, #f5f5f7)',
	border: '1px solid var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

function safeAuthorizationUrl(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Sign-in could not be prepared. Please try again.');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Sign-in could not be prepared. Please try again.');
	}
	if (
		url.origin !== 'https://auth.openai.com' ||
		url.pathname !== '/api/accounts/authorize' ||
		url.username ||
		url.password ||
		url.hash ||
		['id_token_hint', 'access_token', 'refresh_token', 'id_token'].some((name) => url.searchParams.has(name))
	)
		throw new Error('Sign-in could not be prepared securely. Please try again.');
	return url.toString();
}
function planFailure(status: number, code?: string) {
	if (status === 401) return 'Sign in to Thingtime again before managing ChatGPT accounts.';
	if (status === 403) return 'This Thingtime account cannot manage that connection. Refresh and try again.';
	if (status === 429) return 'Too many requests. Wait a moment and try again.';
	if (code === 'plan_permission_missing') return 'ChatGPT plan permission was not granted. Continue with ChatGPT to enable it.';
	return 'The ChatGPT connection could not be updated. Check that the local runtime is running, then try again.';
}

export const ChatGPTPlanSettings = () => {
	const user = useCurrentUser();
	const origin = typeof window === 'undefined' ? '' : window.location.origin;
	const scope = user && !user.temporary && user.accountKind !== 'service' ? `${origin}:${user.id}` : '';
	const currentScope = React.useRef(scope);
	currentScope.current = scope;
	return scope && user ? (
		<ChatGPTPlanScope key={scope} ownerId={user.id} origin={origin} scope={scope} currentScope={currentScope} />
	) : (
		<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4}>
			<Text fontWeight={700} fontSize="sm">
				ChatGPT plan
			</Text>
			<Text fontSize="sm" mt={2}>
				Sign in to your personal Thingtime account to connect a ChatGPT plan.
			</Text>
		</Box>
	);
};

const ChatGPTPlanScope = ({
	ownerId,
	origin,
	scope,
	currentScope
}: {
	ownerId: string;
	origin: string;
	scope: string;
	currentScope: React.MutableRefObject<string>;
}) => {
	const lopu = useLopu();
	const [snapshot, setSnapshot] = React.useState<Snapshot | null>(() => snapshots.get(scope) ?? null);
	const [error, setError] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [pending, setPending] = React.useState<Pending | null>(null);
	const [welcome, setWelcome] = React.useState(false);
	const live = React.useRef(true);
	const generation = React.useRef(0);
	const readSequence = React.useRef(0);
	const requests = React.useRef(new Set<AbortController>());
	const pendingRef = React.useRef<Pending | null>(null);
	const busyRef = React.useRef(false);
	const capabilityReady = React.useRef(false);
	const toast = React.useRef(lopu);
	toast.current = lopu;
	const current = React.useCallback(
		() => live.current && currentScope.current === scope && window.location.origin === origin,
		[currentScope, origin, scope]
	);

	const updatePending = React.useCallback((value: Pending | null) => {
		pendingRef.current = value;
		setPending(value);
	}, []);
	const request = React.useCallback(
		async (body?: Record<string, unknown>) => {
			const controller = new AbortController();
			const started = generation.current;
			requests.current.add(controller);
			try {
				try {
					await requireThingtimeCapability(CAPABILITY, '1.1.0');
				} catch {
					throw new Error('This Thingtime origin does not support ChatGPT plan connections yet. Update it, then retry.');
				}
				if (!current() || controller.signal.aborted || started !== generation.current) throw new DOMException('Scope changed', 'AbortError');
				capabilityReady.current = true;
				const response = await fetch(`${origin}${ENDPOINT}`, {
					method: body ? 'POST' : 'GET',
					credentials: 'same-origin',
					cache: 'no-store',
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
					headers: { Accept: 'application/json', 'X-Thingtime-Expected-User': ownerId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
					...(body ? { body: JSON.stringify(body) } : {})
				});
				const data = await response.json().catch(() => null);
				if (!current() || controller.signal.aborted || started !== generation.current) throw new DOMException('Scope changed', 'AbortError');
				if (!response.ok || !data?.ok) throw new Error(planFailure(response.status, data?.code));
				return data;
			} finally {
				requests.current.delete(controller);
			}
		},
		[current, origin, ownerId]
	);

	const refresh = React.useCallback(async () => {
		const sequence = ++readSequence.current;
		const result = await request();
		if (typeof result.available !== 'boolean' || !Array.isArray(result.accounts) || !Array.isArray(result.attempts))
			throw new Error('ChatGPT connection status is unavailable. Please retry.');
		const next: Snapshot = { available: result.available, accounts: result.accounts, attempts: result.attempts,
			canAuthorize: result.canAuthorize === true, storageMode: result.storageMode };
		if (current() && sequence === readSequence.current) {
			snapshots.set(scope, next);
			setSnapshot(next);
			setError('');
		}
		return next;
	}, [current, request, scope]);

	// Best effort on a same-account unmount. Expected-user fencing prevents a new
	// cookie identity from exercising authority on the old account's attempt.
	const cancelOnExit = React.useCallback(
		(attemptId: string) => {
			if (!capabilityReady.current || currentScope.current !== scope || window.location.origin !== origin) return;
			void fetch(`${origin}${ENDPOINT}`, {
				method: 'POST',
				credentials: 'same-origin',
				keepalive: true,
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-User': ownerId },
				body: JSON.stringify({ action: 'cancel', attemptId })
			}).catch(() => {});
		},
		[currentScope, origin, ownerId, scope]
	);

	const stopRequests = React.useCallback(() => {
		live.current = false;
		generation.current++;
		readSequence.current++;
		for (const controller of requests.current) controller.abort();
		requests.current.clear();
		const owned = pendingRef.current;
		if (owned) cancelOnExit(owned.id);
		pendingRef.current = null;
	}, [cancelOnExit]);
	React.useEffect(() => {
		live.current = true;
		const started = ++generation.current;
		void refresh().catch((failure) => {
			if (current() && generation.current === started)
				setError(failure instanceof Error ? failure.message : 'ChatGPT connection status is unavailable.');
		});
		return stopRequests;
	}, [current, refresh, stopRequests]);

	React.useEffect(() => {
		if (!pending?.id) return;
		const id = pending.id;
		const expiresAt = pending.expiresAt;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let failures = 0;
		const poll = async () => {
			if (stopped || !current() || pendingRef.current?.id !== id) return;
			if (Date.now() >= expiresAt) {
				cancelOnExit(id);
				updatePending(null);
				setError('ChatGPT sign-in timed out. Continue with ChatGPT to start again.');
				return;
			}
			try {
				const result = await refresh();
				if (stopped || !current() || pendingRef.current?.id !== id) return;
				const attempt = result.attempts.find((item) => item.id === id);
				if (!attempt || !['pending', 'connecting'].includes(attempt.status)) {
					updatePending(null);
					if (attempt?.status === 'connected') {
						toast.current({ title: 'ChatGPT plan connected', description: 'Choose this account in Lopu’s Your providers menu.', status: 'success' });
						const key = `tt-chatgpt-plan-welcome:${scope}`;
						let seen = acknowledged.has(key);
						try {
							seen ||= localStorage.getItem(key) === '1';
						} catch {
							/* Acknowledgement is optional local UI state. */
						}
						if (!seen) setWelcome(true);
					} else if (attempt?.status !== 'cancelled') setError('ChatGPT sign-in did not complete. Continue with ChatGPT to try again.');
					return;
				}
				failures = 0;
				if (attempt.status === 'connecting') updatePending({ ...pendingRef.current!, status: 'connecting' });
			} catch (failure) {
				if (stopped || !current()) return;
				failures++;
				setError(failure instanceof Error ? failure.message : 'Connection status is temporarily unavailable.');
			}
			if (!stopped && current()) timer = setTimeout(poll, Math.min(2000 * 2 ** Math.min(failures, 3), 15000));
		};
		timer = setTimeout(poll, 1500);
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
		};
	}, [pending?.id, pending?.expiresAt, cancelOnExit, current, refresh, scope, updatePending]);

	const run = async (body: Record<string, unknown>) => {
		if (busyRef.current || !current()) return;
		busyRef.current = true;
		setBusy(true);
		setError('');
		readSequence.current++;
		try {
			const data = await request(body);
			if (!current()) return;
			if (body.action === 'begin') {
				const id = data.result?.attemptId;
				if (typeof id !== 'string' || !id) throw new Error('Sign-in could not be prepared. Please retry.');
				try {
					updatePending({
						id,
						url: safeAuthorizationUrl(data.result?.authorizationUrl),
						expiresAt: Date.now() + ATTEMPT_LIFETIME,
						status: 'pending'
					});
				} catch (failure) {
					cancelOnExit(id);
					throw failure;
				}
			} else if (body.action === 'cancel') updatePending(null);
			else if (body.action === 'disconnect')
				toast.current({
					title: 'ChatGPT account signed out',
					status: data.result?.remoteRevoked ? 'success' : 'warning',
					description: data.result?.remoteRevoked
						? 'The account registration is saved for your next sign-in.'
						: 'Local access was cleared. Remote revocation was not confirmed; disconnect Thingtime in ChatGPT settings.',
					...(data.result?.remoteRevoked ? {} : { link: { label: 'Manage usage', href: USAGE } })
				});
			else if (body.action === 'select-model')
				toast.current({ title: 'ChatGPT model saved', description: 'Choose this account in Lopu’s Your providers menu.', status: 'success' });
			await refresh();
		} catch (failure) {
			if (current()) {
				const message = failure instanceof Error ? failure.message : 'Please try again.';
				setError(message);
				toast.current({ title: 'ChatGPT connection unavailable', description: message, status: 'error' });
			}
		} finally {
			if (current()) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	};
	const acknowledge = () => {
		const key = `tt-chatgpt-plan-welcome:${scope}`;
		acknowledged.add(key);
		try {
			localStorage.setItem(key, '1');
		} catch {
			/* Storage may be disabled. */
		}
		setWelcome(false);
	};
	const unavailable = snapshot?.available === false;
	return (
		<Box borderTop="1px solid var(--tt-border, #ececef)" pt={4} minW={0}>
			<Flex align="center" justify="space-between" gap={2} flexWrap="wrap">
				<Text as="h3" fontWeight={700} fontSize="sm">
					ChatGPT plan
				</Text>
				<Link href={USAGE} target="_blank" rel="noopener noreferrer" fontSize="sm" textDecoration="underline">
					Manage usage
				</Link>
			</Flex>
			<Text fontSize="sm" mt={2} color="var(--tt-muted, #777783)">
				Use your ChatGPT plan for eligible Lopu requests. Credentials stay in protected runtime storage, linked to your Thingtime account.
			</Text>
			<Text fontSize="xs" mt={2} color="var(--tt-muted, #777783)">
				Choose a model below, then select the account in Lopu → Your providers. Plan limits apply; this connection never switches to API credits
				automatically.
			</Text>
			{unavailable ? (
				<Text role="status" fontSize="sm" mt={3}>
					Enable the local API and database in Electron’s Desktop settings, or choose a configured self-hosted API. Complete initial ChatGPT sign-in on the runtime computer.
				</Text>
			) : null}
			{snapshot?.available && !snapshot.canAuthorize ? <Text role="status" fontSize="sm" mt={3}>
				This runtime accepts moved connections. Sign in through your local Electron runtime, then use “Move between runtimes” below.
			</Text> : null}
			{!snapshot && !error ? (
				<Text role="status" fontSize="sm" mt={3}>
					Checking ChatGPT connections…
				</Text>
			) : null}
			{error ? (
				<Flex align="center" flexWrap="wrap" gap={2} mt={3}>
					<Text role="alert" fontSize="sm" flex="1" minW="160px">
						{error}
					</Text>
					<Button
						size="sm"
						variant="outline"
						isDisabled={busy}
						onClick={() => {
							void refresh().catch((failure) => {
								if (current()) setError(failure instanceof Error ? failure.message : 'Please retry.');
							});
						}}
					>
						Retry
					</Button>
				</Flex>
			) : null}
			<Flex mt={3} gap={2} flexWrap="wrap" align="center">
				<Button onClick={() => void run({ action: 'begin' })} isDisabled={busy || !snapshot?.available || !snapshot.canAuthorize || Boolean(pending)}>
					Continue with ChatGPT
				</Button>
			</Flex>
			{pending ? (
				<Box mt={3} p={3} border="1px solid var(--tt-border, #ececef)" borderRadius="10px">
					<Text role="status" fontSize="sm" mb={2}>
						{pending.status === 'connecting' ? 'Verifying your ChatGPT account…' : 'Sign-in is ready. Continue in your browser, then return here.'}
					</Text>
					<Flex gap={2} flexWrap="wrap">
						{pending.status === 'pending' ? (
							<Button as="a" href={pending.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
								Continue with ChatGPT
							</Button>
						) : null}
						<Button variant="ghost" isDisabled={busy} onClick={() => void run({ action: 'cancel', attemptId: pending.id })}>
							Cancel sign-in
						</Button>
					</Flex>
				</Box>
			) : null}
			<Flex direction="column" gap={3} mt={snapshot?.accounts.length ? 4 : 0}>
				{snapshot?.accounts.map((account) => (
					<Box key={account.id} border="1px solid var(--tt-border, #ececef)" borderRadius="10px" p={3} minW={0}>
						<Flex align="center" gap={2} flexWrap="wrap">
							<Text fontWeight={600} fontSize="sm" overflowWrap="anywhere">
								{account.label || account.email || 'ChatGPT account'} · {account.id.slice(-8)}
							</Text>
							<Badge>{account.connected ? 'Connected' : 'Signed out'}</Badge>
						</Flex>
						{account.email ? (
							<Text fontSize="xs" mt={1} overflowWrap="anywhere" color="var(--tt-muted, #777783)">
								{account.email}
							</Text>
						) : null}
						{account.connected ? (
							<>
								<Text as="label" htmlFor={`chatgpt-model-${account.id}`} display="block" fontSize="sm" mt={3} mb={1}>
									Model
								</Text>
								<Select
									{...fieldStyles}
									id={`chatgpt-model-${account.id}`}
									aria-describedby={`chatgpt-model-name-${account.id}`}
									value={account.model || ''}
									maxW="100%"
									textOverflow="ellipsis"
									isDisabled={busy || !snapshot?.available || account.models.length === 0}
									onChange={(event) => void run({ action: 'select-model', id: account.id, model: event.target.value })}
								>
									{!account.models.some((model) => model.slug === account.model) ? (
										<option value="" disabled>
											Choose an available model
										</option>
									) : null}
									{account.models.map((model) => (
										<option key={model.slug} value={model.slug}>
											{model.displayName}
										</option>
									))}
								</Select>
								<Text id={`chatgpt-model-name-${account.id}`} fontSize="xs" mt={1} overflowWrap="anywhere" color="var(--tt-muted, #777783)">
									{account.models.find((model) => model.slug === account.model)?.displayName}
								</Text>
								{!account.models.length ? (
									<Text fontSize="xs" mt={2}>
										No eligible models are available for this account.
									</Text>
								) : null}
								<Button mt={2} size="sm" variant="ghost" isDisabled={busy || !snapshot?.available || Boolean(pending)} onClick={() => void run({ action: 'refresh-models', id: account.id })}>
									Refresh available models
								</Button>
								<Button
									mt={2}
									size="sm"
									variant="ghost"
									isDisabled={busy || !snapshot?.available || Boolean(pending)}
									onClick={() => void run({ action: 'disconnect', id: account.id })}
								>
									Sign out
								</Button>
							</>
						) : (
							<Button
								mt={2}
								size="sm"
								isDisabled={busy || !snapshot?.available || !snapshot.canAuthorize || Boolean(pending)}
								onClick={() => void run({ action: 'begin', id: account.id })}
							>
								Continue with ChatGPT
							</Button>
						)}
					</Box>
				))}
			</Flex>
			{snapshot?.available ? <ChatGPTPlanTransfer accounts={snapshot.accounts} disabled={busy || Boolean(pending)} request={request} refresh={refresh} /> : null}
			<Modal isOpen={welcome} onClose={acknowledge} isCentered size="md">
				<ModalOverlay />
				<ModalContent mx={4} maxH="calc(100dvh - 32px)" overflowY="auto">
					<ModalHeader>You’re using your ChatGPT plan</ModalHeader>
					<ModalBody>
						Eligible Lopu requests through this account use your ChatGPT plan. Review usage and app limits in{' '}
						<Link href={USAGE} target="_blank" rel="noopener noreferrer" textDecoration="underline">
							ChatGPT settings
						</Link>
						.
					</ModalBody>
					<ModalFooter>
						<Button onClick={acknowledge}>Got it</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</Box>
	);
};
